import { randomUUID } from 'node:crypto';
import { rename } from 'node:fs/promises';
import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UnprocessableEntityException,
  UploadedFile,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiPayloadTooLargeResponse,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
  organizationIdentifierSchema,
  legalEntityIdentifierSchema,
  legalEntityInScope,
} from '@bap/security';
import { z } from 'zod';
import { MembershipResolver } from '../membership-resolver.js';
import type { AuthenticatedRequest } from '../request-context.js';
import { ResourceJwtGuard } from '../resource-jwt.guard.js';
import { SubjectRateLimitGuard } from '../subject-rate-limit.guard.js';
import { allowedEntityIds, resolveTenantAccess } from '../tenant-access.js';
import { resolveDatasetFormat } from '../ingestion/parser.js';
import {
  deleteStagedFile,
  deleteTemporaryUpload,
  loadStagingDirectory,
  resolveStagedFilePath,
} from '../ingestion/staging.js';
import {
  MAX_PAYROLL_IMPORT_BYTES,
  payrollImportIdSchema,
  payrollImportSchema,
} from './contract.js';
import { PayrollImportQueue } from './payroll-import-queue.js';
import { PayrollImportRepository } from './payroll-import-repository.js';
import { PayrollImportEntityNotFoundError } from './payroll-import-repository.js';
const key = z.string().uuid();
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/);
const safeFilename = /^[^\p{Cc}\p{Cf}\\/]{1,255}$/u;
const mediaTypes: Record<'csv' | 'xlsx', ReadonlySet<string>> = {
  csv: new Set([
    'application/csv',
    'application/octet-stream',
    'application/vnd.ms-excel',
    'text/csv',
    'text/plain',
  ]),
  xlsx: new Set([
    'application/octet-stream',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ]),
};
const fileLimit = {
  dest: (_r: unknown, _f: unknown, cb: (e: Error | null, d: string) => void) =>
    cb(null, loadStagingDirectory(process.env)),
  limits: {
    fileSize: MAX_PAYROLL_IMPORT_BYTES,
    files: 1,
    fields: 2,
    fieldSize: 64,
  },
};
interface UploadedPayrollFile {
  mimetype: string;
  originalname: string;
  path: string;
  size: number;
}
interface StatusResponse {
  status(code: number): void;
}
const importEnvelope = {
  additionalProperties: false,
  properties: {
    payrollImport: {
      additionalProperties: false,
      properties: {
        id: { format: 'uuid', type: 'string' },
        legalEntityId: { format: 'uuid', type: 'string' },
        sourceDocumentId: { format: 'uuid', type: 'string' },
        payrollMonth: { pattern: '^\\d{4}-\\d{2}-01$', type: 'string' },
        format: { enum: ['csv', 'xlsx'], type: 'string' },
        status: {
          enum: ['staged', 'validated', 'failed', 'consumed'],
          type: 'string',
        },
        rowCount: { minimum: 0, type: 'integer' },
        errorCount: { minimum: 0, type: 'integer' },
        errorReport: {
          items: {
            additionalProperties: false,
            properties: {
              row: { minimum: 1, type: 'integer' },
              field: { type: 'string' },
              code: {
                enum: [
                  'malformed_file',
                  'invalid_header',
                  'row_limit_exceeded',
                  'required',
                  'invalid_employee_number',
                  'employee_not_found',
                  'duplicate_employee',
                  'invalid_amount',
                  'arithmetic_mismatch',
                  'component_not_found',
                ],
                type: 'string',
              },
            },
            required: ['row', 'field', 'code'],
            type: 'object',
          },
          type: 'array',
        },
        payrollRunId: { format: 'uuid', nullable: true, type: 'string' },
        createdAt: { format: 'date-time', type: 'string' },
      },
      required: [
        'id',
        'legalEntityId',
        'sourceDocumentId',
        'payrollMonth',
        'format',
        'status',
        'rowCount',
        'errorCount',
        'errorReport',
        'payrollRunId',
        'createdAt',
      ],
      type: 'object',
    },
  },
  required: ['payrollImport'],
  type: 'object',
};
const consumeEnvelope = {
  additionalProperties: false,
  properties: {
    payrollRunId: { format: 'uuid', type: 'string' },
    status: { enum: ['draft'], type: 'string' },
  },
  required: ['payrollRunId', 'status'],
  type: 'object',
};
@ApiBearerAuth('resource-token')
@Controller({ path: 'organizations', version: '1' })
export class PayrollImportController {
  constructor(
    @Inject(PayrollImportRepository)
    private readonly repo: PayrollImportRepository,
    @Inject(PayrollImportQueue) private readonly queue: PayrollImportQueue,
    @Inject(MembershipResolver)
    private readonly memberships: MembershipResolver,
  ) {}
  @Post(':organizationId/payroll/imports')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @UseInterceptors(FileInterceptor('file', fileLimit))
  @ApiConsumes('multipart/form-data')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { format: 'uuid', type: 'string' },
  })
  @ApiBody({
    schema: {
      properties: {
        file: { format: 'binary', type: 'string' },
        legalEntityId: { format: 'uuid', type: 'string' },
        payrollMonth: {
          pattern: '^\\d{4}-(0[1-9]|1[0-2])-01$',
          type: 'string',
        },
      },
      required: ['file', 'legalEntityId', 'payrollMonth'],
      type: 'object',
    },
  })
  @ApiCreatedResponse({ schema: importEnvelope })
  @ApiOkResponse({ schema: importEnvelope })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse()
  @ApiPayloadTooLargeResponse()
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  async create(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file?: UploadedPayrollFile,
    @Res({ passthrough: true }) response?: StatusResponse,
  ) {
    const dir = loadStagingDirectory(process.env);
    let tmp = file?.path;
    let cleanupId: string | undefined;
    try {
      const entity = legalEntityIdentifierSchema.safeParse(
          req.body?.legalEntityId,
        ),
        m = month.safeParse(req.body?.payrollMonth),
        k = key.safeParse(req.headers['idempotency-key']);
      const format = file && resolveDatasetFormat(file.originalname);
      if (
        !entity.success ||
        !m.success ||
        !k.success ||
        !file ||
        file.size < 1 ||
        !format ||
        !safeFilename.test(file.originalname) ||
        !mediaTypes[format].has(file.mimetype)
      )
        throw new BadRequestException();
      const access = await resolveTenantAccess({
        capability: 'managePayroll',
        memberships: this.memberships,
        organizationId,
        request: req,
      });
      if (!legalEntityInScope(access.entityScope, entity.data))
        throw new NotFoundException();
      const uploadId = randomUUID();
      cleanupId = uploadId;
      await rename(file.path, resolveStagedFilePath(dir, uploadId));
      tmp = undefined;
      let created;
      try {
        created = await this.repo.create({
          ...access.tenant,
          legalEntityId: entity.data,
          payrollMonth: m.data,
          format,
          filename: file.originalname,
          byteSize: file.size,
          idempotencyKey: k.data,
          uploadId,
        });
      } catch (error) {
        if (error instanceof PayrollImportEntityNotFoundError)
          throw new NotFoundException();
        throw error;
      }
      if (!created.replay) {
        try {
          await this.queue.enqueue({
            organizationId,
            payrollImportId: created.import.id,
            userId: access.tenant.userId,
          });
        } catch (error) {
          await this.repo.failEnqueue({
            ...access.tenant,
            id: created.import.id,
          });
          throw error;
        }
      }
      if (!created.replay) cleanupId = undefined;
      response?.status(created.replay ? 200 : 201);
      return { payrollImport: payrollImportSchema.parse(created.import) };
    } finally {
      if (tmp) await deleteTemporaryUpload(dir, tmp);
      if (cleanupId) await deleteStagedFile(dir, cleanupId);
    }
  }
  @Get(':organizationId/payroll/imports/:id')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({ schema: importEnvelope })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse()
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  async get(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('id', { schema: payrollImportIdSchema }) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const a = await resolveTenantAccess({
      capability: 'readPayroll',
      memberships: this.memberships,
      organizationId,
      request: req,
    });
    const r = await this.repo.get({
      ...a.tenant,
      id,
      legalEntityIds: allowedEntityIds(a.entityScope),
    });
    if (!r) throw new NotFoundException();
    return { payrollImport: payrollImportSchema.parse(r) };
  }
  @Post(':organizationId/payroll/imports/:id/consume')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiCreatedResponse({ schema: consumeEnvelope })
  @ApiOkResponse({ schema: consumeEnvelope })
  @ApiBadRequestResponse()
  @ApiConflictResponse()
  @ApiUnprocessableEntityResponse()
  @ApiNotFoundResponse()
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  async consume(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('id', { schema: payrollImportIdSchema }) id: string,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) response?: StatusResponse,
  ) {
    const a = await resolveTenantAccess({
      capability: 'managePayroll',
      memberships: this.memberships,
      organizationId,
      request: req,
    });
    const r = await this.repo.consume({
      ...a.tenant,
      id,
      legalEntityIds: allowedEntityIds(a.entityScope),
    });
    if (!r) throw new NotFoundException();
    if (r.status === 'staged') throw new ConflictException();
    if (r.status === 'failed') throw new UnprocessableEntityException();
    if (!r.runId) throw new ConflictException();
    response?.status(r.replay ? 200 : 201);
    return { payrollRunId: r.runId, status: 'draft' };
  }
}
