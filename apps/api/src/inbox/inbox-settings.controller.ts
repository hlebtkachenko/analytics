import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { organizationIdentifierSchema } from '@bap/security';

import { MembershipResolver } from '../membership-resolver.js';
import type { AuthenticatedRequest } from '../request-context.js';
import { ResourceJwtGuard } from '../resource-jwt.guard.js';
import { SubjectRateLimitGuard } from '../subject-rate-limit.guard.js';
import { resolveTenantAccess } from '../tenant-access.js';
import type { TenantAccess } from '../tenant-access.js';
import {
  detectedTypeSchema,
  inboxRoutingTargetListOpenApiSchema,
  inboxRoutingTargetListResponseSchema,
  inboxRoutingTargetOpenApiSchema,
  inboxRoutingTargetSchema,
  inboxSettingsOpenApiSchema,
  inboxSettingsSchema,
  putInboxRoutingTargetBodyOpenApiSchema,
  putInboxRoutingTargetRequestSchema,
  updateInboxSettingsBodyOpenApiSchema,
  updateInboxSettingsRequestSchema,
} from './contract.js';
import type {
  InboxRoutingTarget,
  InboxRoutingTargetListResponse,
  InboxSettings,
  PutInboxRoutingTargetRequest,
  UpdateInboxSettingsRequest,
} from './contract.js';
import { InboxService } from './inbox.service.js';
import type { DetectedType } from './routing-targets.js';

const unauthorized = { description: 'The resource token is invalid' };
const forbidden = { description: 'Organization access is denied' };

// Routing targets and the quota: read with manageDocuments, written by an owner with manageOrganization.
@ApiBearerAuth('resource-token')
@Controller({ path: 'organizations', version: '1' })
export class InboxSettingsController {
  constructor(
    @Inject(InboxService) private readonly inbox: InboxService,
    @Inject(MembershipResolver)
    private readonly memberships: MembershipResolver,
  ) {}

  @Get(':organizationId/inbox/routing-targets')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({
    summary: 'List the effective routing target of every detected type',
  })
  @ApiOkResponse({ schema: inboxRoutingTargetListOpenApiSchema })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  async listRoutingTargets(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<InboxRoutingTargetListResponse> {
    const { tenant } = await this.manageDocuments(organizationId, request);

    return inboxRoutingTargetListResponseSchema.parse({
      targets: await this.inbox.listRoutingTargets(tenant),
    });
  }

  @Put(':organizationId/inbox/routing-targets/:detectedType')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({
    summary: 'Set the whole routing target of one detected type',
  })
  @ApiBody({ schema: putInboxRoutingTargetBodyOpenApiSchema })
  @ApiOkResponse({ schema: inboxRoutingTargetOpenApiSchema })
  @ApiBadRequestResponse({ description: 'The target is unusable' })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  @ApiNotFoundResponse({ description: 'The legal entity is not visible' })
  async putRoutingTarget(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('detectedType', { schema: detectedTypeSchema })
    detectedType: DetectedType,
    @Body({ schema: putInboxRoutingTargetRequestSchema })
    body: PutInboxRoutingTargetRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<InboxRoutingTarget> {
    const { tenant } = await this.manageOrganization(organizationId, request);
    const target = await this.inbox.putRoutingTarget({
      ...tenant,
      body,
      detectedType,
    });

    if (target === null) {
      throw new NotFoundException();
    }

    return inboxRoutingTargetSchema.parse(target);
  }

  @Delete(':organizationId/inbox/routing-targets/:detectedType')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({
    summary: 'Remove the organization target, back to the platform default',
  })
  @ApiNoContentResponse({ description: 'The platform default is in force' })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  @ApiNotFoundResponse({
    description: 'The organization holds no target for this type',
  })
  async deleteRoutingTarget(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('detectedType', { schema: detectedTypeSchema })
    detectedType: DetectedType,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    const { tenant } = await this.manageOrganization(organizationId, request);
    const deleted = await this.inbox.deleteRoutingTarget({
      ...tenant,
      detectedType,
    });

    if (!deleted) {
      throw new NotFoundException();
    }
  }

  @Get(':organizationId/inbox/settings')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({
    summary: 'Read the blob quota, the platform cap and the bytes in use',
  })
  @ApiOkResponse({ schema: inboxSettingsOpenApiSchema })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  async getSettings(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<InboxSettings> {
    const { tenant } = await this.manageDocuments(organizationId, request);

    return inboxSettingsSchema.parse(await this.inbox.readSettings(tenant));
  }

  @Patch(':organizationId/inbox/settings')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'Set or reset the organization blob quota' })
  @ApiBody({ schema: updateInboxSettingsBodyOpenApiSchema })
  @ApiOkResponse({ schema: inboxSettingsOpenApiSchema })
  @ApiBadRequestResponse({ description: 'The body is unusable' })
  @ApiUnauthorizedResponse(unauthorized)
  @ApiForbiddenResponse(forbidden)
  @ApiUnprocessableEntityResponse({
    description: 'The quota exceeds the platform cap',
  })
  async updateSettings(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Body({ schema: updateInboxSettingsRequestSchema })
    body: UpdateInboxSettingsRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<InboxSettings> {
    const { tenant } = await this.manageOrganization(organizationId, request);
    const settings = await this.inbox.updateSettings({ ...tenant, body });

    // The owner policy refused the row: the resolver said owner, the database disagreed.
    if (settings === null) {
      throw new NotFoundException();
    }

    return inboxSettingsSchema.parse(settings);
  }

  private manageDocuments(
    organizationId: string,
    request: AuthenticatedRequest,
  ): Promise<TenantAccess> {
    return resolveTenantAccess({
      capability: 'manageDocuments',
      memberships: this.memberships,
      organizationId,
      request,
    });
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
