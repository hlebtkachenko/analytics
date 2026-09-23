import {
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import { organizationIdentifierSchema } from '@bap/security';
import { allowedEntityIds, resolveTenantAccess } from '../tenant-access.js';
import { MembershipResolver } from '../membership-resolver.js';
import type { AuthenticatedRequest } from '../request-context.js';
import { ResourceJwtGuard } from '../resource-jwt.guard.js';
import { SubjectRateLimitGuard } from '../subject-rate-limit.guard.js';
import {
  costCentreSchema,
  createCostCentreRequestSchema,
  createCostCentreRequestOpenApiSchema,
  createDepartmentRequestSchema,
  createDepartmentRequestOpenApiSchema,
  createDocumentCategoryRequestSchema,
  createDocumentCategoryRequestOpenApiSchema,
  createPositionRequestSchema,
  createPositionRequestOpenApiSchema,
  createWorkplaceRequestSchema,
  createWorkplaceRequestOpenApiSchema,
  departmentSchema,
  documentCategorySchema,
  documentCategoryOpenApiSchema,
  departmentOpenApiSchema,
  hrReferenceIdSchema,
  hrReferenceListQuerySchema,
  positionSchema,
  positionOpenApiSchema,
  costCentreOpenApiSchema,
  workplaceOpenApiSchema,
  referenceListOpenApiSchema,
  referenceListResponseSchema,
  updateCostCentreRequestSchema,
  updateCostCentreRequestOpenApiSchema,
  updateDepartmentRequestSchema,
  updateDepartmentRequestOpenApiSchema,
  updateDocumentCategoryRequestSchema,
  updateDocumentCategoryRequestOpenApiSchema,
  updatePositionRequestSchema,
  updatePositionRequestOpenApiSchema,
  updateWorkplaceRequestSchema,
  updateWorkplaceRequestOpenApiSchema,
  workplaceSchema,
} from './contract.js';
import type {
  CreateCostCentreRequest,
  CreateDepartmentRequest,
  CreateDocumentCategoryRequest,
  CreatePositionRequest,
  CreateWorkplaceRequest,
  HrReferenceListQuery,
  UpdateCostCentreRequest,
  UpdateDepartmentRequest,
  UpdateDocumentCategoryRequest,
  UpdatePositionRequest,
  UpdateWorkplaceRequest,
} from './contract.js';
import {
  isDuplicateReference,
  ReferenceRepository,
} from './reference-repository.js';
import type {
  CreateReference,
  Reference,
  UpdateReference,
} from './reference-repository.js';

type Kind =
  'department' | 'position' | 'costCentre' | 'workplace' | 'documentCategory';
@ApiBearerAuth('resource-token')
@Controller({ path: 'organizations', version: '1' })
export class ReferenceController {
  constructor(
    @Inject(ReferenceRepository)
    private readonly references: ReferenceRepository,
    @Inject(MembershipResolver)
    private readonly memberships: MembershipResolver,
  ) {}
  private async scope(
    organizationId: string,
    request: AuthenticatedRequest,
    capability: 'readHr' | 'manageHr',
  ) {
    const { tenant, entityScope } = await resolveTenantAccess({
      capability,
      memberships: this.memberships,
      organizationId,
      request,
    });
    return { ...tenant, legalEntityIds: allowedEntityIds(entityScope) };
  }
  private async list(
    kind: Kind,
    organizationId: string,
    query: HrReferenceListQuery,
    request: AuthenticatedRequest,
  ) {
    const result = await this.references.list({
      ...(await this.scope(organizationId, request, 'readHr')),
      kind,
      query,
    });
    if (!result) throw new NotFoundException();
    return result;
  }
  private async create(
    kind: Kind,
    organizationId: string,
    body: CreateReference,
    request: AuthenticatedRequest,
  ): Promise<Reference> {
    try {
      const result = await this.references.create({
        ...(await this.scope(organizationId, request, 'manageHr')),
        kind,
        body,
      });
      if (!result) throw new NotFoundException();
      return result;
    } catch (error) {
      if (isDuplicateReference(error, kind)) throw new ConflictException();
      throw error;
    }
  }
  private async update(
    kind: Kind,
    organizationId: string,
    id: string,
    body: UpdateReference,
    request: AuthenticatedRequest,
  ): Promise<Reference> {
    try {
      const result = await this.references.update({
        ...(await this.scope(organizationId, request, 'manageHr')),
        kind,
        id,
        body,
      });
      if (!result) throw new NotFoundException();
      return result;
    } catch (error) {
      if (isDuplicateReference(error, kind)) throw new ConflictException();
      throw error;
    }
  }
  @Get(':organizationId/hr/departments')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({
    schema: referenceListOpenApiSchema('departments', departmentOpenApiSchema),
  })
  async departments(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Query({ schema: hrReferenceListQuerySchema }) query: HrReferenceListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    const result = await this.list(
      'department',
      organizationId,
      query,
      request,
    );
    return referenceListResponseSchema('departments', departmentSchema).parse({
      departments: result.items,
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
    });
  }
  @Post(':organizationId/hr/departments')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiBody({ schema: createDepartmentRequestOpenApiSchema })
  @ApiCreatedResponse({ schema: departmentOpenApiSchema })
  async createDepartment(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Body({ schema: createDepartmentRequestSchema })
    body: CreateDepartmentRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return departmentSchema.parse(
      await this.create('department', organizationId, body, request),
    );
  }
  @Patch(':organizationId/hr/departments/:id')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({ schema: departmentOpenApiSchema })
  @ApiBody({ schema: updateDepartmentRequestOpenApiSchema })
  async updateDepartment(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('id', { schema: hrReferenceIdSchema }) id: string,
    @Body({ schema: updateDepartmentRequestSchema })
    body: UpdateDepartmentRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return departmentSchema.parse(
      await this.update('department', organizationId, id, body, request),
    );
  }
  @Get(':organizationId/hr/positions')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({
    schema: referenceListOpenApiSchema('positions', positionOpenApiSchema),
  })
  async positions(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Query({ schema: hrReferenceListQuerySchema }) query: HrReferenceListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    const result = await this.list('position', organizationId, query, request);
    return referenceListResponseSchema('positions', positionSchema).parse({
      positions: result.items,
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
    });
  }
  @Post(':organizationId/hr/positions')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiBody({ schema: createPositionRequestOpenApiSchema })
  @ApiCreatedResponse({ schema: positionOpenApiSchema })
  async createPosition(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Body({ schema: createPositionRequestSchema }) body: CreatePositionRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return positionSchema.parse(
      await this.create('position', organizationId, body, request),
    );
  }
  @Patch(':organizationId/hr/positions/:id')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({ schema: positionOpenApiSchema })
  @ApiBody({ schema: updatePositionRequestOpenApiSchema })
  async updatePosition(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('id', { schema: hrReferenceIdSchema }) id: string,
    @Body({ schema: updatePositionRequestSchema }) body: UpdatePositionRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return positionSchema.parse(
      await this.update('position', organizationId, id, body, request),
    );
  }
  @Get(':organizationId/hr/cost-centres')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({
    schema: referenceListOpenApiSchema('costCentres', costCentreOpenApiSchema),
  })
  async costCentres(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Query({ schema: hrReferenceListQuerySchema }) query: HrReferenceListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    const result = await this.list(
      'costCentre',
      organizationId,
      query,
      request,
    );
    return referenceListResponseSchema('costCentres', costCentreSchema).parse({
      costCentres: result.items,
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
    });
  }
  @Post(':organizationId/hr/cost-centres')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiBody({ schema: createCostCentreRequestOpenApiSchema })
  @ApiCreatedResponse({ schema: costCentreOpenApiSchema })
  async createCostCentre(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Body({ schema: createCostCentreRequestSchema })
    body: CreateCostCentreRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return costCentreSchema.parse(
      await this.create('costCentre', organizationId, body, request),
    );
  }
  @Patch(':organizationId/hr/cost-centres/:id')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({ schema: costCentreOpenApiSchema })
  @ApiBody({ schema: updateCostCentreRequestOpenApiSchema })
  async updateCostCentre(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('id', { schema: hrReferenceIdSchema }) id: string,
    @Body({ schema: updateCostCentreRequestSchema })
    body: UpdateCostCentreRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return costCentreSchema.parse(
      await this.update('costCentre', organizationId, id, body, request),
    );
  }
  @Get(':organizationId/hr/workplaces')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({
    schema: referenceListOpenApiSchema('workplaces', workplaceOpenApiSchema),
  })
  async workplaces(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Query({ schema: hrReferenceListQuerySchema }) query: HrReferenceListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    const result = await this.list('workplace', organizationId, query, request);
    return referenceListResponseSchema('workplaces', workplaceSchema).parse({
      workplaces: result.items,
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
    });
  }
  @Post(':organizationId/hr/workplaces')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiBody({ schema: createWorkplaceRequestOpenApiSchema })
  @ApiCreatedResponse({ schema: workplaceOpenApiSchema })
  async createWorkplace(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Body({ schema: createWorkplaceRequestSchema })
    body: CreateWorkplaceRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return workplaceSchema.parse(
      await this.create('workplace', organizationId, body, request),
    );
  }
  @Patch(':organizationId/hr/workplaces/:id')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({ schema: workplaceOpenApiSchema })
  @ApiBody({ schema: updateWorkplaceRequestOpenApiSchema })
  async updateWorkplace(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('id', { schema: hrReferenceIdSchema }) id: string,
    @Body({ schema: updateWorkplaceRequestSchema })
    body: UpdateWorkplaceRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return workplaceSchema.parse(
      await this.update('workplace', organizationId, id, body, request),
    );
  }
  @Get(':organizationId/hr/document-categories')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({
    schema: referenceListOpenApiSchema(
      'documentCategories',
      documentCategoryOpenApiSchema,
    ),
  })
  async documentCategories(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Query({ schema: hrReferenceListQuerySchema }) query: HrReferenceListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    const result = await this.list(
      'documentCategory',
      organizationId,
      query,
      request,
    );
    return referenceListResponseSchema(
      'documentCategories',
      documentCategorySchema,
    ).parse({
      documentCategories: result.items,
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
    });
  }
  @Post(':organizationId/hr/document-categories')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiBody({ schema: createDocumentCategoryRequestOpenApiSchema })
  @ApiCreatedResponse({ schema: documentCategoryOpenApiSchema })
  async createDocumentCategory(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Body({ schema: createDocumentCategoryRequestSchema })
    body: CreateDocumentCategoryRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return documentCategorySchema.parse(
      await this.create('documentCategory', organizationId, body, request),
    );
  }
  @Patch(':organizationId/hr/document-categories/:id')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({ schema: documentCategoryOpenApiSchema })
  @ApiBody({ schema: updateDocumentCategoryRequestOpenApiSchema })
  async updateDocumentCategory(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('id', { schema: hrReferenceIdSchema }) id: string,
    @Body({ schema: updateDocumentCategoryRequestSchema })
    body: UpdateDocumentCategoryRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return documentCategorySchema.parse(
      await this.update('documentCategory', organizationId, id, body, request),
    );
  }
}
