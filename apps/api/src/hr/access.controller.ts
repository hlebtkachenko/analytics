import {
  Body,
  BadRequestException,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
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
  ApiNotFoundResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import { organizationIdentifierSchema } from '@bap/security';
import { MembershipResolver } from '../membership-resolver.js';
import type { AuthenticatedRequest } from '../request-context.js';
import { ResourceJwtGuard } from '../resource-jwt.guard.js';
import { SubjectRateLimitGuard } from '../subject-rate-limit.guard.js';
import { resolveTenantAccess } from '../tenant-access.js';
import {
  createHrAccessAssignmentRequestSchema,
  createHrAccessAssignmentRequestOpenApiSchema,
  hrAccessAssignmentListOpenApiSchema,
  hrAccessAssignmentListSchema,
  hrAccessAssignmentOpenApiSchema,
  hrAccessAssignmentSchema,
  hrAccessAssignmentIdSchema,
  revokeHrAccessAssignmentResponseOpenApiSchema,
  revokeHrAccessAssignmentResponseSchema,
  type CreateHrAccessAssignmentRequest,
} from './contract.js';
import {
  HrAccessAssignmentConflictError,
  HrAccessAssignmentNotFoundError,
  HrAccessRepository,
} from './access-repository.js';

@ApiBearerAuth('resource-token')
@Controller({ path: 'organizations', version: '1' })
export class HrAccessController {
  constructor(
    @Inject(HrAccessRepository)
    private readonly assignments: HrAccessRepository,
    @Inject(MembershipResolver)
    private readonly memberships: MembershipResolver,
  ) {}
  private async owner(organizationId: string, request: AuthenticatedRequest) {
    const resolved = await resolveTenantAccess({
      memberships: this.memberships,
      organizationId,
      request,
    });
    if (resolved.tenant.role !== 'owner') throw new ForbiddenException();
    return resolved.tenant;
  }
  @Get(':organizationId/hr/access-assignments')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({ schema: hrAccessAssignmentListOpenApiSchema as never })
  @ApiForbiddenResponse({
    description: 'Only organization owners may manage HR access assignments',
  })
  async list(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return hrAccessAssignmentListSchema.parse({
      assignments: await this.assignments.list(
        await this.owner(organizationId, request),
      ),
    });
  }
  @Post(':organizationId/hr/access-assignments')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiBody({ schema: createHrAccessAssignmentRequestOpenApiSchema as never })
  @ApiCreatedResponse({ schema: hrAccessAssignmentOpenApiSchema as never })
  @ApiConflictResponse({
    description: 'The HR access assignment already exists',
  })
  @ApiForbiddenResponse({
    description: 'Only organization owners may manage HR access assignments',
  })
  @ApiNotFoundResponse({
    description: 'The legal entity is not visible in this organization',
  })
  async create(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Body() body: CreateHrAccessAssignmentRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = createHrAccessAssignmentRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    try {
      return hrAccessAssignmentSchema.parse(
        await this.assignments.create({
          ...(await this.owner(organizationId, request)),
          body: parsed.data,
        }),
      );
    } catch (error) {
      if (error instanceof HrAccessAssignmentNotFoundError)
        throw new NotFoundException();
      if (error instanceof HrAccessAssignmentConflictError)
        throw new ConflictException();
      throw error;
    }
  }
  @Delete(':organizationId/hr/access-assignments/:assignmentId')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({
    schema: revokeHrAccessAssignmentResponseOpenApiSchema as never,
  })
  @ApiForbiddenResponse({
    description: 'Only organization owners may manage HR access assignments',
  })
  @ApiNotFoundResponse({
    description: 'The HR access assignment is not visible in this organization',
  })
  async remove(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('assignmentId', { schema: hrAccessAssignmentIdSchema })
    assignmentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      await this.assignments.remove({
        ...(await this.owner(organizationId, request)),
        assignmentId: hrAccessAssignmentIdSchema.parse(assignmentId),
      });
      return revokeHrAccessAssignmentResponseSchema.parse({ revoked: true });
    } catch (error) {
      if (error instanceof HrAccessAssignmentNotFoundError)
        throw new NotFoundException();
      throw error;
    }
  }
}
