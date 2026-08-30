import { randomUUID } from 'node:crypto';
import { rename } from 'node:fs/promises';

import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Inject,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { MulterModuleOptions } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  organizationIdentifierSchema,
  resolveOrganizationAccess,
} from '@bap/security';
import { z } from 'zod';

import { MembershipResolver } from '../membership-resolver.js';
import type { AuthenticatedRequest } from '../request-context.js';
import { ResourceJwtGuard } from '../resource-jwt.guard.js';
import { SubjectRateLimitGuard } from '../subject-rate-limit.guard.js';
import { MAX_UPLOAD_BYTES } from './contract.js';
import type { UploadAcceptedResponse } from './contract.js';
import { IngestionQueue } from './ingestion-queue.js';
import { resolveDatasetFormat } from './parser.js';
import type { DatasetFormat } from './parser.js';
import {
  deleteStagedFile,
  deleteTemporaryUpload,
  loadStagingDirectory,
  resolveStagedFilePath,
} from './staging.js';
import { UploadRepository } from './upload-repository.js';

// Display metadata only: no separator, no control character and no bidirectional override.
const SAFE_FILENAME = /^[^\p{Cc}\p{Cf}\\/]{1,255}$/u;

// Browsers disagree about the CSV media type, so the extension and the worker content check decide.
const ALLOWED_MEDIA_TYPES: Record<DatasetFormat, readonly string[]> = {
  csv: [
    'application/csv',
    'application/octet-stream',
    'application/vnd.ms-excel',
    'text/csv',
    'text/plain',
  ],
  xlsx: [
    'application/octet-stream',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
};

const uploadedFileSchema = z
  .object({
    mimetype: z.string().min(1).max(255),
    originalname: z.string().trim().regex(SAFE_FILENAME),
    // multer reports the bytes it actually wrote, not a proxy header or a client claim.
    size: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
    temporaryPath: z.string().min(1),
  })
  .superRefine((file, context) => {
    const format = resolveDatasetFormat(file.originalname);

    if (format === null) {
      context.addIssue({
        code: 'custom',
        message: 'Only CSV and XLSX uploads are accepted.',
      });
      return;
    }

    if (!ALLOWED_MEDIA_TYPES[format].includes(file.mimetype)) {
      context.addIssue({
        code: 'custom',
        message: 'The media type does not match the declared format.',
      });
    }
  });

// The staging directory is resolved per request so the mount, not module load order, decides it.
const multerOptions: MulterModuleOptions = {
  dest: (
    _request: unknown,
    _file: unknown,
    callback: (error: Error | null, destination: string) => void,
  ): void => {
    callback(null, loadStagingDirectory(process.env));
  },
  // Browsers send unencoded multipart filenames as UTF-8, but busboy defaults to latin1.
  defParamCharset: 'utf8',
  // fields and files bound the shape exactly, so no separate part count is needed.
  limits: {
    fieldSize: 1_024,
    fields: 0,
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
    headerPairs: 32,
  },
};

@ApiBearerAuth('resource-token')
@Controller({ path: 'organizations', version: '1' })
export class UploadController {
  constructor(
    @Inject(IngestionQueue) private readonly queue: IngestionQueue,
    @Inject(MembershipResolver)
    private readonly memberships: MembershipResolver,
    @Inject(UploadRepository) private readonly uploads: UploadRepository,
  ) {}

  @Post(':organizationId/uploads')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @UseInterceptors(FileInterceptor('file', multerOptions))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Stage a CSV or XLSX upload for ingestion' })
  @ApiCreatedResponse({
    schema: {
      additionalProperties: false,
      properties: {
        status: { enum: ['accepted'], type: 'string' },
        uploadId: { format: 'uuid', type: 'string' },
      },
      required: ['status', 'uploadId'],
      type: 'object',
    },
  })
  @ApiUnauthorizedResponse({ description: 'The resource token is invalid' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  @ApiPayloadTooLargeResponse({ description: 'The upload exceeds 25 MB' })
  async createUpload(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<UploadAcceptedResponse> {
    const principal = request.resourcePrincipal;

    if (principal === undefined) {
      throw new UnauthorizedException();
    }

    const received = request.file;
    const stagingDirectory = loadStagingDirectory(process.env);
    let cleanupTemporaryPath = received?.path ?? null;
    let cleanupUploadId: string | null = null;

    try {
      const file = uploadedFileSchema.safeParse({
        mimetype: received?.mimetype,
        originalname: received?.originalname,
        size: received?.size,
        temporaryPath: received?.path,
      });

      if (!file.success) {
        throw new BadRequestException();
      }

      const membership = await this.memberships.resolve(
        principal.subject,
        organizationId,
      );
      const access = resolveOrganizationAccess(
        'application-api',
        organizationId,
        membership,
      );

      if (access === null || !access.capabilities.uploadData) {
        throw new ForbiddenException();
      }

      const uploadId = randomUUID();
      await rename(
        file.data.temporaryPath,
        resolveStagedFilePath(stagingDirectory, uploadId),
      );
      // The temporary name is gone once renamed, so only the staged file needs cleaning up.
      cleanupTemporaryPath = null;
      cleanupUploadId = uploadId;

      await this.uploads.record({
        byteSize: file.data.size,
        filename: file.data.originalname,
        organizationId,
        uploadId,
        userId: principal.subject,
      });

      try {
        await this.queue.enqueue({
          organizationId,
          uploadId,
          userId: principal.subject,
        });
      } catch (error) {
        await this.uploads.fail({
          organizationId,
          uploadId,
          userId: principal.subject,
        });
        throw error;
      }

      cleanupUploadId = null;
      return { status: 'accepted', uploadId };
    } finally {
      if (cleanupTemporaryPath !== null) {
        await deleteTemporaryUpload(stagingDirectory, cleanupTemporaryPath);
      }

      if (cleanupUploadId !== null) {
        await deleteStagedFile(stagingDirectory, cleanupUploadId);
      }
    }
  }
}
