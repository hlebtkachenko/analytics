import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  entityScopeOpenApiSchema,
  organizationCapabilityNames,
  organizationIdentifierSchema,
  resolveOrganizationAccess,
  type OrganizationAccessResponse,
} from '@bap/security';

import { MembershipResolver } from './membership-resolver.js';
import type { AuthenticatedRequest } from './request-context.js';
import { ResourceJwtGuard } from './resource-jwt.guard.js';
import { SubjectRateLimitGuard } from './subject-rate-limit.guard.js';

@ApiBearerAuth('resource-token')
@Controller({ path: 'organizations', version: '1' })
export class AccessController {
  constructor(
    @Inject(MembershipResolver)
    private readonly memberships: MembershipResolver,
  ) {}

  @Get(':organizationId/access')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'Resolve reporting API organization access' })
  @ApiOkResponse({
    schema: {
      additionalProperties: false,
      properties: {
        capabilities: {
          additionalProperties: false,
          properties: Object.fromEntries(
            organizationCapabilityNames.map((name) => [
              name,
              { type: 'boolean' },
            ]),
          ),
          required: organizationCapabilityNames,
          type: 'object',
        },
        entityScope: entityScopeOpenApiSchema,
        organizationId: { type: 'string' },
        role: { enum: ['owner', 'admin', 'member'], type: 'string' },
        service: { enum: ['reporting-api'], type: 'string' },
      },
      required: [
        'service',
        'organizationId',
        'role',
        'capabilities',
        'entityScope',
      ],
      type: 'object',
    },
  })
  @ApiUnauthorizedResponse({ description: 'The resource token is invalid' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  async getAccess(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<OrganizationAccessResponse> {
    const principal = request.resourcePrincipal;

    if (principal === undefined) {
      throw new UnauthorizedException();
    }

    const membership = await this.memberships.resolve(
      principal.subject,
      organizationId,
    );

    if (!membership.emailVerified || membership.role === null) {
      throw new ForbiddenException();
    }

    // The scope needs the role, so it is read only once membership has been proven.
    const entityScope = await this.memberships.readEntityScope({
      organizationId,
      role: membership.role,
      userId: principal.subject,
    });
    const access = resolveOrganizationAccess(
      'reporting-api',
      organizationId,
      membership,
      entityScope,
    );

    if (access === null) {
      throw new ForbiddenException();
    }

    return access;
  }
}
