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
  Post,
  Req,
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
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { TenantContext } from '@bap/db';
import { organizationIdentifierSchema } from '@bap/security';
import { join } from 'node:path';
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
import { loadRuntimeConfiguration } from '../runtime-configuration.js';
import { SubjectRateLimitGuard } from '../subject-rate-limit.guard.js';
import { allowedEntityIds, resolveTenantAccess } from '../tenant-access.js';
import type { TenantAccess } from '../tenant-access.js';
import {
  createInboxChannelBodyOpenApiSchema,
  createInboxChannelRequestSchema,
  credentialIdentifierSchema,
  fileIntakeBodyOpenApiSchema,
  fileIntakeFieldsSchema,
  inboxChannelIdentifierSchema,
  inboxChannelListOpenApiSchema,
  inboxChannelListResponseSchema,
  inboxChannelOpenApiSchema,
  inboxChannelSchema,
  inboxIntakeResponseOpenApiSchema,
  inboxIntakeResponseSchema,
  issueInboxChannelCredentialResponseOpenApiSchema,
  issueInboxChannelCredentialResponseSchema,
  structuredIntakeBodyOpenApiSchema,
  structuredIntakeRequestSchema,
  updateInboxChannelBodyOpenApiSchema,
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
  @ApiOperation({ summary: 'Create an API channel' })
  @ApiBody({ schema: createInboxChannelBodyOpenApiSchema })
  @ApiCreatedResponse({ schema: inboxChannelOpenApiSchema })
  @ApiBadRequestResponse({ description: 'Only API channels can be created' })
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
    summary: 'Issue an intake credential; the secret is shown exactly once',
  })
  @ApiCreatedResponse({
    schema: issueInboxChannelCredentialResponseOpenApiSchema,
  })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  @ApiNotFoundResponse(channelNotFound)
  @ApiConflictResponse({
    description: 'The channel already holds two active credentials',
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

    return { origin: access.tenant.userId, tenant: access.tenant };
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
