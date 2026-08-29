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
  @ApiOperation({ summary: 'Resolve application API organization access' })
  @ApiOkResponse({
    schema: {
      additionalProperties: false,
      properties: {
        organizationId: { type: 'string' },
        role: { enum: ['owner', 'admin', 'member'], type: 'string' },
        service: { enum: ['application-api'], type: 'string' },
      },
      required: ['service', 'organizationId', 'role'],
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
    const access = resolveOrganizationAccess(
      'application-api',
      organizationId,
      membership,
    );

    if (access === null) {
      throw new ForbiddenException();
    }

    return access;
  }
}
