import {
  Body,
  ConflictException,
  Controller,
  Delete,
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
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  legalEntityIdentifierSchema,
  legalEntitySchema,
  organizationIdentifierSchema,
  type LegalEntity,
} from '@bap/security';

import { MembershipResolver } from '../membership-resolver.js';
import type { AuthenticatedRequest } from '../request-context.js';
import { ResourceJwtGuard } from '../resource-jwt.guard.js';
import { SubjectRateLimitGuard } from '../subject-rate-limit.guard.js';
import { allowedEntityIds, resolveTenantAccess } from '../tenant-access.js';
import {
  createLegalEntityRequestSchema,
  legalEntityBodyOpenApiSchema,
  legalEntityListResponseSchema,
  legalEntityOpenApiSchema,
  MAX_LEGAL_ENTITY_LIST_SIZE,
  updateLegalEntityRequestSchema,
} from './contract.js';
import type {
  CreateLegalEntityRequest,
  LegalEntityListResponse,
  UpdateLegalEntityRequest,
} from './contract.js';
import {
  isDuplicateEntityName,
  LegalEntityRepository,
} from './legal-entity-repository.js';

@ApiBearerAuth('resource-token')
@Controller({ path: 'organizations', version: '1' })
export class LegalEntityController {
  constructor(
    @Inject(LegalEntityRepository)
    private readonly entities: LegalEntityRepository,
    @Inject(MembershipResolver)
    private readonly memberships: MembershipResolver,
  ) {}

  @Post(':organizationId/legal-entities')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'Create a legal entity inside the organization' })
  @ApiBody({ schema: legalEntityBodyOpenApiSchema })
  @ApiCreatedResponse({ schema: legalEntityOpenApiSchema })
  @ApiUnauthorizedResponse({ description: 'The resource token is invalid' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  @ApiConflictResponse({ description: 'The name is already used' })
  async createLegalEntity(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Body({ schema: createLegalEntityRequestSchema })
    body: CreateLegalEntityRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<LegalEntity> {
    const { tenant } = await resolveTenantAccess({
      capability: 'createEntities',
      memberships: this.memberships,
      organizationId,
      request,
    });

    try {
      const created = await this.entities.createEntity({
        ...tenant,
        kind: body.kind,
        name: body.name,
        registrationNumber: body.registrationNumber ?? null,
      });

      return legalEntitySchema.parse(created);
    } catch (error) {
      if (isDuplicateEntityName(error)) {
        throw new ConflictException();
      }

      throw error;
    }
  }

  @Delete(':organizationId/legal-entities/:legalEntityId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'Delete a legal entity and everything under it' })
  @ApiNoContentResponse({ description: 'The legal entity was deleted' })
  @ApiUnauthorizedResponse({ description: 'The resource token is invalid' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  @ApiNotFoundResponse({ description: 'The legal entity is not visible' })
  async deleteLegalEntity(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('legalEntityId', { schema: legalEntityIdentifierSchema })
    legalEntityId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    const { entityScope, tenant } = await resolveTenantAccess({
      capability: 'deleteEntities',
      memberships: this.memberships,
      organizationId,
      request,
    });
    const deleted = await this.entities.deleteEntity({
      ...tenant,
      legalEntityId,
      legalEntityIds: allowedEntityIds(entityScope),
    });

    if (!deleted) {
      throw new NotFoundException();
    }
  }

  @Get(':organizationId/legal-entities')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'List the legal entities in the caller scope' })
  @ApiOkResponse({
    description: `At most ${MAX_LEGAL_ENTITY_LIST_SIZE} legal entities, newest first`,
    schema: {
      additionalProperties: false,
      properties: {
        legalEntities: { items: legalEntityOpenApiSchema, type: 'array' },
      },
      required: ['legalEntities'],
      type: 'object',
    },
  })
  @ApiUnauthorizedResponse({ description: 'The resource token is invalid' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  async listLegalEntities(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<LegalEntityListResponse> {
    const { entityScope, tenant } = await resolveTenantAccess({
      memberships: this.memberships,
      organizationId,
      request,
    });
    const legalEntities = await this.entities.listEntities({
      ...tenant,
      legalEntityIds: allowedEntityIds(entityScope),
    });

    return legalEntityListResponseSchema.parse({ legalEntities });
  }

  @Patch(':organizationId/legal-entities/:legalEntityId')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'Change the name, kind or registration number' })
  @ApiBody({
    schema: { ...legalEntityBodyOpenApiSchema, required: [] },
  })
  @ApiOkResponse({ schema: legalEntityOpenApiSchema })
  @ApiUnauthorizedResponse({ description: 'The resource token is invalid' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  @ApiNotFoundResponse({ description: 'The legal entity is not visible' })
  @ApiConflictResponse({ description: 'The name is already used' })
  async updateLegalEntity(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('legalEntityId', { schema: legalEntityIdentifierSchema })
    legalEntityId: string,
    @Body({ schema: updateLegalEntityRequestSchema })
    body: UpdateLegalEntityRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<LegalEntity> {
    const { entityScope, tenant } = await resolveTenantAccess({
      capability: 'updateEntities',
      memberships: this.memberships,
      organizationId,
      request,
    });

    try {
      const updated = await this.entities.updateEntity({
        ...tenant,
        kind: body.kind ?? null,
        legalEntityId,
        legalEntityIds: allowedEntityIds(entityScope),
        name: body.name ?? null,
        registrationNumber: body.registrationNumber ?? null,
        updatesRegistrationNumber: 'registrationNumber' in body,
      });

      if (updated === null) {
        throw new NotFoundException();
      }

      return legalEntitySchema.parse(updated);
    } catch (error) {
      if (isDuplicateEntityName(error)) {
        throw new ConflictException();
      }

      throw error;
    }
  }
}
