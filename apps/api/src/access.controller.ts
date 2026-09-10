import { Controller, Get, Inject, Param, Req, UseGuards } from '@nestjs/common';
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
  type OrganizationAccessResponse,
} from '@bap/security';

import { MembershipResolver } from './membership-resolver.js';
import type { AuthenticatedRequest } from './request-context.js';
import { ResourceJwtGuard } from './resource-jwt.guard.js';
import { SubjectRateLimitGuard } from './subject-rate-limit.guard.js';
import { resolveTenantAccess } from './tenant-access.js';

@ApiBearerAuth('resource-token')
@Controller({ path: 'organizations', version: '1' })
export class AccessController {
  constructor(
    @Inject(MembershipResolver)
    private readonly memberships: MembershipResolver,
  ) {}

  @Get(':organizationId/access')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'Resolve application API organization access' })
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
        service: { enum: ['application-api'], type: 'string' },
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
    const { access } = await resolveTenantAccess({
      memberships: this.memberships,
      organizationId,
      request,
    });

    return access;
  }
}
