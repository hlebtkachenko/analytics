import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  entityScopeSchema,
  organizationIdentifierSchema,
  type EntityScope,
} from '@bap/security';

import { MembershipResolver } from '../membership-resolver.js';
import type { AuthenticatedRequest } from '../request-context.js';
import { ResourceJwtGuard } from '../resource-jwt.guard.js';
import { SubjectRateLimitGuard } from '../subject-rate-limit.guard.js';
import { resolveTenantAccess } from '../tenant-access.js';
import { subjectIdentifierSchema } from '../worker/job-context.js';
import {
  entityScopeOpenApiSchema,
  entityScopeRequestSchema,
} from './contract.js';
import type { EntityScopeRequest } from './contract.js';
import { LegalEntityRepository } from './legal-entity-repository.js';

@ApiBearerAuth('resource-token')
@Controller({ path: 'organizations', version: '1' })
export class EntityScopeController {
  constructor(
    @Inject(LegalEntityRepository)
    private readonly entities: LegalEntityRepository,
    @Inject(MembershipResolver)
    private readonly memberships: MembershipResolver,
  ) {}

  @Get(':organizationId/members/:userId/entity-scope')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'Read the entity scope of one member' })
  @ApiOkResponse({ schema: entityScopeOpenApiSchema })
  @ApiUnauthorizedResponse({ description: 'The resource token is invalid' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  @ApiNotFoundResponse({ description: 'The subject is not a member' })
  async getEntityScope(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('userId', { schema: subjectIdentifierSchema }) userId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<EntityScope> {
    const { tenant } = await resolveTenantAccess({
      capability: 'manageEntityAccess',
      memberships: this.memberships,
      organizationId,
      request,
    });
    const target = await this.memberships.resolve(userId, organizationId);

    if (target.role === null) {
      throw new NotFoundException();
    }

    const scope = await this.entities.readMemberScope({
      ...tenant,
      targetRole: target.role,
      targetUserId: userId,
    });
    return entityScopeSchema.parse(scope);
  }

  @Put(':organizationId/members/:userId/entity-scope')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'Replace the entity scope of one member' })
  @ApiBody({ schema: entityScopeOpenApiSchema })
  @ApiOkResponse({ schema: entityScopeOpenApiSchema })
  @ApiBadRequestResponse({ description: 'An entity id is unknown' })
  @ApiUnauthorizedResponse({ description: 'The resource token is invalid' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  @ApiNotFoundResponse({ description: 'The subject is not a member' })
  @ApiConflictResponse({ description: 'An owner is never restricted' })
  async putEntityScope(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('userId', { schema: subjectIdentifierSchema }) userId: string,
    @Body({ schema: entityScopeRequestSchema }) body: EntityScopeRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<EntityScope> {
    const { tenant } = await resolveTenantAccess({
      capability: 'manageEntityAccess',
      memberships: this.memberships,
      organizationId,
      request,
    });
    const target = await this.memberships.resolve(userId, organizationId);

    if (target.role === null) {
      throw new NotFoundException();
    }

    // Owners are never restricted, so storing a scope for one would be a lie the resolver ignores.
    if (target.role === 'owner') {
      throw new ConflictException();
    }

    const written = await this.entities.writeMemberScope({
      ...tenant,
      scope: body,
      targetUserId: userId,
    });

    if (written === 'unknown-entity') {
      throw new BadRequestException();
    }

    return entityScopeSchema.parse(body);
  }
}
