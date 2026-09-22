import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
  PayloadTooLargeException,
  Post,
  Req,
  UnsupportedMediaTypeException,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { MulterModuleOptions } from '@nestjs/platform-express';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiUnauthorizedResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import type { TenantContext } from '@bap/db';
import { organizationIdentifierSchema } from '@bap/security';
import { randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { z } from 'zod';

import { BlobStore } from '../blobs/blob-store.js';
import {
  channelTenant,
  isChannelSubject,
  resolveChannelAccess,
} from '../channel-access.js';
import { MAX_UPLOAD_BYTES } from '../ingestion/contract.js';
import { MembershipResolver } from '../membership-resolver.js';
import type { AuthenticatedRequest } from '../request-context.js';
import { ResourceJwtGuard } from '../resource-jwt.guard.js';
import {
  loadRuntimeConfiguration,
  MAX_EMAIL_BYTES,
} from '../runtime-configuration.js';
import { SubjectRateLimitGuard } from '../subject-rate-limit.guard.js';
import { allowedEntityIds, resolveTenantAccess } from '../tenant-access.js';
import type { TenantAccess } from '../tenant-access.js';
import {
  createInboxChannelBodyOpenApiSchema,
  emailIntakeBodyOpenApiSchema,
  fileIntakeBodyOpenApiSchema,
  inboxChannelListOpenApiSchema,
  inboxChannelOpenApiSchema,
  inboxIntakeResponseOpenApiSchema,
  issueInboxChannelCredentialResponseOpenApiSchema,
  structuredIntakeBodyOpenApiSchema,
  updateInboxChannelBodyOpenApiSchema,
} from './contract-openapi.js';
import {
  createInboxChannelRequestSchema,
  credentialIdentifierSchema,
  EMAIL_MEDIA_TYPE,
  emailExternalIdSchema,
  emailSenderHeaderSchema,
  fileIntakeFieldsSchema,
  inboxChannelIdentifierSchema,
  inboxChannelListResponseSchema,
  inboxChannelSchema,
  inboxIntakeResponseSchema,
  issueInboxChannelCredentialResponseSchema,
  structuredIntakeRequestSchema,
  updateInboxChannelRequestSchema,
} from './contract.js';
import type {
  CreateInboxChannelRequest,
  InboxChannel,
  InboxChannelListResponse,
  InboxIntakeResponse,
  IssueInboxChannelCredentialResponse,
  UpdateInboxChannelRequest,
} from './contract.js';
import { InboxRepository } from './inbox-repository.js';
import { InboxService } from './inbox.service.js';

// The credential display prefix the web resolved before minting the channel token; display metadata only.
const ORIGIN_HEADER = 'x-bap-intake-origin';
const originHeaderSchema = z.string().regex(/^[A-Za-z0-9_-]{8}$/);
// The email route's provider token (the replay key) and the envelope sender, validated and never logged.
const EXTERNAL_ID_HEADER = 'x-bap-intake-external-id';
const SENDER_HEADER = 'x-bap-intake-sender';

class EmailTooLargeError extends Error {}

// Counts the bytes as they land on disk and stops past the cap, so a lying content-length changes nothing.
// The request is left undestroyed on purpose: a destroyed socket could not carry the 413 back to the caller.
async function writeCapped(
  source: Readable,
  path: string,
  limit: number,
): Promise<number> {
  const handle = await open(path, 'wx');
  let size = 0;

  try {
    for await (const chunk of source.iterator({ destroyOnReturn: false })) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;

      if (size > limit) {
        throw new EmailTooLargeError();
      }

      await handle.write(bytes);
    }
  } finally {
    await handle.close();
  }

  return size;
}

// One file part plus at most the externalId text field; the sniff decides what the bytes are, never the client.
const multerOptions: MulterModuleOptions = {
  defParamCharset: 'utf8',
  limits: {
    fields: 1,
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
    headerPairs: 32,
  },
};

const unauthorized = { description: 'The resource token is invalid' };
const forbidden = { description: 'Organization access is denied' };
const channelNotFound = { description: 'The channel is not visible' };

@ApiBearerAuth('resource-token')
@Controller({ path: 'organizations', version: '1' })
export class InboxChannelController {
  constructor(
    @Inject(InboxService) private readonly inbox: InboxService,
    @Inject(InboxRepository) private readonly channels: InboxRepository,
    @Inject(BlobStore) private readonly blobs: BlobStore,
    @Inject(MembershipResolver)
    private readonly memberships: MembershipResolver,
  ) {}

  @Post(':organizationId/inbox/channels/:channelId/items')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      ...multerOptions,
      // Resolved per request so the mounted volume, not module load order, decides it.
      dest: (
        _request: unknown,
        _file: unknown,
        callback: (error: Error | null, destination: string) => void,
      ): void => {
        callback(
          null,
          join(
            loadRuntimeConfiguration(process.env).blob.storageDirectory,
            'tmp',
          ),
        );
      },
    }),
  )
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiOperation({
    summary: 'Receive one file or one structured payload through a channel',
  })
  @ApiBody({
    schema: {
      oneOf: [fileIntakeBodyOpenApiSchema, structuredIntakeBodyOpenApiSchema],
    },
  })
  @ApiAcceptedResponse({ schema: inboxIntakeResponseOpenApiSchema })
  @ApiBadRequestResponse({
    description: 'The file part or the body is unusable',
  })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  @ApiNotFoundResponse(channelNotFound)
  @ApiPayloadTooLargeResponse({
    description: 'The payload exceeds its cap or the organization quota',
  })
  async receiveItem(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('channelId', { schema: inboxChannelIdentifierSchema })
    channelId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<InboxIntakeResponse> {
    let tenant: TenantContext;
    let origin: string | null;

    try {
      ({ origin, tenant } = await this.intakeContext(
        organizationId,
        channelId,
        request,
      ));
    } catch (error) {
      // A refused caller leaves no file behind.
      if (request.file?.path !== undefined) {
        await this.blobs.deleteTemporary(request.file.path);
      }

      throw error;
    }

    if (request.file !== undefined) {
      const fields = fileIntakeFieldsSchema.safeParse(request.body ?? {});

      if (!fields.success) {
        await this.blobs.deleteTemporary(request.file.path ?? '');
        throw new BadRequestException();
      }

      return inboxIntakeResponseSchema.parse(
        await this.inbox.intakeFile({
          ...tenant,
          channelId,
          externalId: fields.data.externalId ?? null,
          file: request.file,
          origin,
        }),
      );
    }

    const body = structuredIntakeRequestSchema.safeParse(request.body);

    if (!body.success) {
      throw new BadRequestException();
    }

    return inboxIntakeResponseSchema.parse(
      await this.inbox.intakeStructured({
        ...tenant,
        channelId,
        externalId: body.data.externalId,
        origin,
        payload: body.data.payload,
      }),
    );
  }

  @Post(':organizationId/inbox/channels/:channelId/email')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiConsumes(EMAIL_MEDIA_TYPE)
  @ApiOperation({
    summary: 'Receive one raw email through an email channel token',
  })
  @ApiHeader({
    description: 'The provider token of this delivery; the replay key',
    name: 'X-BAP-Intake-External-Id',
    required: true,
  })
  @ApiHeader({
    description: 'The credential display prefix that received the mail',
    name: 'X-BAP-Intake-Origin',
    required: false,
  })
  @ApiHeader({
    description: 'The envelope sender as the provider reported it',
    name: 'X-BAP-Intake-Sender',
    required: false,
  })
  @ApiBody({ schema: emailIntakeBodyOpenApiSchema })
  @ApiAcceptedResponse({ schema: inboxIntakeResponseOpenApiSchema })
  @ApiBadRequestResponse({ description: 'A header or the body is unusable' })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse({ description: 'Only a channel token may submit mail' })
  @ApiNotFoundResponse(channelNotFound)
  @ApiPayloadTooLargeResponse({
    description: 'The message exceeds the email cap or the organization quota',
  })
  @ApiUnsupportedMediaTypeResponse({
    description: 'The body must be message/rfc822',
  })
  async receiveEmail(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('channelId', { schema: inboxChannelIdentifierSchema })
    channelId: string,
    @Req() request: AuthenticatedRequest & Readable,
  ): Promise<InboxIntakeResponse> {
    // A person never submits an .eml here: the route exists for the webhook's channel token only.
    if (!isChannelSubject(request.resourcePrincipal?.subject ?? '')) {
      throw new ForbiddenException();
    }

    const access = await resolveChannelAccess({
      channelId,
      channels: this.channels,
      organizationId,
      request,
    });
    const origin = originHeaderSchema
      .optional()
      .safeParse(request.headers[ORIGIN_HEADER]);
    const externalId = emailExternalIdSchema.safeParse(
      request.headers[EXTERNAL_ID_HEADER],
    );
    // Validated so a broken forwarder is refused; the worker stores the sender it parses from the MIME instead.
    const sender = emailSenderHeaderSchema
      .optional()
      .safeParse(request.headers[SENDER_HEADER]);

    if (!origin.success || !externalId.success || !sender.success) {
      throw new BadRequestException();
    }

    const contentType = request.headers['content-type'];

    if (
      typeof contentType !== 'string' ||
      contentType.split(';', 1)[0]?.trim().toLowerCase() !== EMAIL_MEDIA_TYPE
    ) {
      throw new UnsupportedMediaTypeException();
    }

    const declared = Number(request.headers['content-length'] ?? 0);

    if (Number.isFinite(declared) && declared > MAX_EMAIL_BYTES) {
      throw new PayloadTooLargeException();
    }

    const temporaryPath = join(
      this.blobs.temporaryDirectory(),
      `email-${randomUUID()}`,
    );
    let size: number;

    try {
      size = await writeCapped(request, temporaryPath, MAX_EMAIL_BYTES);
    } catch (error) {
      await this.blobs.deleteTemporary(temporaryPath);

      if (error instanceof EmailTooLargeError) {
        throw new PayloadTooLargeException();
      }

      throw error;
    }

    if (size === 0) {
      await this.blobs.deleteTemporary(temporaryPath);
      throw new BadRequestException();
    }

    return inboxIntakeResponseSchema.parse(
      await this.inbox.intakeEmail({
        ...channelTenant(access.organizationId, access.channelId),
        channelId: access.channelId,
        externalId: externalId.data,
        origin: origin.data ?? null,
        size,
        temporaryPath,
      }),
    );
  }

  @Get(':organizationId/inbox/channels')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({
    summary: 'List the channels with their active credential prefixes',
  })
  @ApiOkResponse({ schema: inboxChannelListOpenApiSchema })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  async listChannels(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<InboxChannelListResponse> {
    const { tenant } = await this.manageOrganization(organizationId, request);

    return inboxChannelListResponseSchema.parse({
      channels: await this.inbox.listChannels(tenant),
    });
  }

  @Post(':organizationId/inbox/channels')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'Create an API or an email channel' })
  @ApiBody({ schema: createInboxChannelBodyOpenApiSchema })
  @ApiCreatedResponse({ schema: inboxChannelOpenApiSchema })
  @ApiBadRequestResponse({ description: 'The channel body is unusable' })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  @ApiNotFoundResponse({ description: 'The legal entity is not visible' })
  async createChannel(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Body({ schema: createInboxChannelRequestSchema })
    body: CreateInboxChannelRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<InboxChannel> {
    const { tenant } = await this.manageOrganization(organizationId, request);

    return this.channel(this.inbox.createChannel({ ...tenant, body }));
  }

  @Get(':organizationId/inbox/channels/:channelId')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'Read one channel' })
  @ApiOkResponse({ schema: inboxChannelOpenApiSchema })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  @ApiNotFoundResponse(channelNotFound)
  async getChannel(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('channelId', { schema: inboxChannelIdentifierSchema })
    channelId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<InboxChannel> {
    const { tenant } = await this.manageOrganization(organizationId, request);

    return this.channel(this.inbox.readChannel({ ...tenant, channelId }));
  }

  @Patch(':organizationId/inbox/channels/:channelId')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({
    summary: 'Rename, retarget, enable, disable or soft delete a channel',
  })
  @ApiBody({ schema: updateInboxChannelBodyOpenApiSchema })
  @ApiOkResponse({ schema: inboxChannelOpenApiSchema })
  @ApiBadRequestResponse({ description: 'The patch is unusable' })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  @ApiNotFoundResponse({
    description: 'The channel or the legal entity is not visible',
  })
  async updateChannel(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('channelId', { schema: inboxChannelIdentifierSchema })
    channelId: string,
    @Body({ schema: updateInboxChannelRequestSchema })
    body: UpdateInboxChannelRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<InboxChannel> {
    const { tenant } = await this.manageOrganization(organizationId, request);

    return this.channel(
      this.inbox.updateChannel({ ...tenant, body, channelId }),
    );
  }

  @Post(':organizationId/inbox/channels/:channelId/credentials')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({
    summary:
      'Issue an intake credential: an API token shown exactly once, or the intake address of an email channel',
  })
  @ApiCreatedResponse({
    schema: issueInboxChannelCredentialResponseOpenApiSchema,
  })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  @ApiNotFoundResponse(channelNotFound)
  @ApiConflictResponse({
    description:
      'The channel already holds its active credentials: two API tokens, or one email address',
  })
  async issueCredential(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('channelId', { schema: inboxChannelIdentifierSchema })
    channelId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<IssueInboxChannelCredentialResponse> {
    const { tenant } = await this.manageOrganization(organizationId, request);

    return issueInboxChannelCredentialResponseSchema.parse(
      await this.inbox.issueCredential({ ...tenant, channelId }),
    );
  }

  @Delete(':organizationId/inbox/channels/:channelId/credentials/:credentialId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'Revoke an intake credential' })
  @ApiNoContentResponse({ description: 'The credential is revoked' })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  @ApiNotFoundResponse({
    description: 'The credential is not active on this channel',
  })
  async revokeCredential(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('channelId', { schema: inboxChannelIdentifierSchema })
    channelId: string,
    @Param('credentialId', { schema: credentialIdentifierSchema })
    credentialId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    const { tenant } = await this.manageOrganization(organizationId, request);
    const revoked = await this.inbox.revokeCredential({
      ...tenant,
      channelId,
      credentialId,
    });

    if (!revoked) {
      throw new NotFoundException();
    }
  }

  // A channel token runs as the channel; a person with manageDocuments runs as themselves, never with a restricted scope.
  private async intakeContext(
    organizationId: string,
    channelId: string,
    request: AuthenticatedRequest,
  ): Promise<{ origin: string | null; tenant: TenantContext }> {
    const subject = request.resourcePrincipal?.subject ?? '';

    if (isChannelSubject(subject)) {
      const access = await resolveChannelAccess({
        channelId,
        channels: this.channels,
        organizationId,
        request,
      });
      const header = request.headers[ORIGIN_HEADER];
      const origin =
        header === undefined ? null : originHeaderSchema.safeParse(header);

      // The header is optional, but a present one must be a display prefix.
      if (origin !== null && !origin.success) {
        throw new BadRequestException();
      }

      return {
        origin: origin === null ? null : origin.data,
        tenant: channelTenant(access.organizationId, access.channelId),
      };
    }

    const access = await resolveTenantAccess({
      capability: 'manageDocuments',
      memberships: this.memberships,
      organizationId,
      request,
    });

    if (allowedEntityIds(access.entityScope) !== null) {
      throw new ForbiddenException();
    }

    // Origin names a credential prefix, never a person; the item's created_by already records the user.
    return { origin: null, tenant: access.tenant };
  }

  private async channel(
    pending: Promise<InboxChannel | null>,
  ): Promise<InboxChannel> {
    const channel = await pending;

    if (channel === null) {
      throw new NotFoundException();
    }

    return inboxChannelSchema.parse(channel);
  }

  private manageOrganization(
    organizationId: string,
    request: AuthenticatedRequest,
  ): Promise<TenantAccess> {
    return resolveTenantAccess({
      capability: 'manageOrganization',
      memberships: this.memberships,
      organizationId,
      request,
    });
  }
}
