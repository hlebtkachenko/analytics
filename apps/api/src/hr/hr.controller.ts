import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { organizationIdentifierSchema } from '@bap/security';

import { MembershipResolver } from '../membership-resolver.js';
import type { AuthenticatedRequest } from '../request-context.js';
import { ResourceJwtGuard } from '../resource-jwt.guard.js';
import { SubjectRateLimitGuard } from '../subject-rate-limit.guard.js';
import { allowedEntityIds, resolveTenantAccess } from '../tenant-access.js';
import {
  createEmployeeRequestSchema,
  createEmployeeRequestOpenApiSchema,
  createEmploymentRelationshipRequestSchema,
  employeeDetailSchema,
  employeeDocumentLinkResponseSchema,
  employeeDocumentListResponseSchema,
  employeeDocumentOpenApiSchema,
  employeeIdSchema,
  employeeListQuerySchema,
  employeeListResponseSchema,
  employeeSchema,
  employeeOpenApiSchema,
  employmentRelationshipSchema,
  linkEmployeeDocumentRequestSchema,
  linkEmployeeDocumentRequestOpenApiSchema,
  employeeDocumentListQuerySchema,
  updateEmployeeDocumentRequestSchema,
  updateEmployeeDocumentRequestOpenApiSchema,
  relationshipListResponseSchema,
  updateEmployeeRequestSchema,
  updateEmployeeRequestOpenApiSchema,
  createEmploymentTermRequestSchema,
  createEmploymentTermRequestOpenApiSchema,
  employmentTermListQuerySchema,
  employmentTermListResponseSchema,
  employmentTermOpenApiSchema,
  employmentTermSchema,
  employeeStatusChangeSchema,
  employeeStatusChangeOpenApiSchema,
  employeeStatusHistoryQuerySchema,
  employeeStatusHistoryResponseSchema,
  employeeStatusTransitionRequestOpenApiSchema,
  employeeStatusTransitionRequestSchema,
  checklistTemplateListQuerySchema,
  checklistListQuerySchema,
  createChecklistTemplateRequestSchema,
  updateChecklistTemplateRequestSchema,
  createChecklistTemplateItemRequestSchema,
  updateChecklistTemplateItemRequestSchema,
  createChecklistRequestSchema,
  updateChecklistTaskRequestSchema,
  checklistTemplateListResponseSchema,
  checklistListResponseSchema,
  checklistSchema,
  checklistTemplateSchema,
  checklistTemplateItemSchema,
  checklistTaskSchema,
  checklistTemplateOpenApiSchema,
  checklistTemplateItemOpenApiSchema,
  checklistTaskOpenApiSchema,
  checklistOpenApiSchema,
  createChecklistTemplateRequestOpenApiSchema,
  updateChecklistTemplateRequestOpenApiSchema,
  createChecklistTemplateItemRequestOpenApiSchema,
  updateChecklistTemplateItemRequestOpenApiSchema,
  createChecklistRequestOpenApiSchema,
  updateChecklistTaskRequestOpenApiSchema,
  checklistTemplateListOpenApiSchema,
  checklistListOpenApiSchema,
} from './contract.js';
import type {
  CreateEmployeeRequest,
  CreateEmploymentRelationshipRequest,
  EmployeeListQuery,
  UpdateEmployeeRequest,
  CreateEmploymentTermRequest,
  EmploymentTermListQuery,
  EmployeeStatusHistoryQuery,
  EmployeeStatusTransitionRequest,
  EmployeeDocumentListQuery,
  LinkEmployeeDocumentRequest,
  UpdateEmployeeDocumentRequest,
  ChecklistTemplateListQuery,
  ChecklistListQuery,
  CreateChecklistTemplateRequest,
  UpdateChecklistTemplateRequest,
  CreateChecklistTemplateItemRequest,
  UpdateChecklistTemplateItemRequest,
  CreateChecklistRequest,
  UpdateChecklistTaskRequest,
} from './contract.js';
import {
  HrRepository,
  HrTermConflictError,
  HrTermNotFoundError,
  HrEmployeeNotFoundError,
  HrEmployeeStatusConflictError,
  HrEmployeeStatusReasonError,
  HrEmployeeDocumentNotFoundError,
  HrEmployeeDocumentConflictError,
  isEmployeeDocumentConflict,
  isDuplicateHrRecord,
  HrChecklistNotFoundError,
  HrChecklistConflictError,
  HrChecklistBadRequestError,
} from './hr-repository.js';

@ApiBearerAuth('resource-token')
@Controller({ path: 'organizations', version: '1' })
export class HrController {
  constructor(
    @Inject(HrRepository) private readonly hr: HrRepository,
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
  @Get(':organizationId/hr/checklist-templates')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({ schema: checklistTemplateListOpenApiSchema })
  async listChecklistTemplates(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Query({ schema: checklistTemplateListQuerySchema })
    query: ChecklistTemplateListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    const r = await this.hr.listChecklistTemplates({
      ...(await this.scope(organizationId, request, 'readHr')),
      query,
    });
    return checklistTemplateListResponseSchema.parse({
      items: r.items,
      page: r.page,
      pageSize: r.pageSize,
      total: r.total,
    });
  }
  @Post(':organizationId/hr/checklist-templates')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiBody({ schema: createChecklistTemplateRequestOpenApiSchema })
  @ApiCreatedResponse({ schema: checklistTemplateOpenApiSchema })
  async createChecklistTemplate(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Body({ schema: createChecklistTemplateRequestSchema })
    body: CreateChecklistTemplateRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      const r = await this.hr.createChecklistTemplate({
        ...(await this.scope(organizationId, request, 'manageHr')),
        body,
      });
      if (!r) throw new NotFoundException();
      return checklistTemplateSchema.parse(r);
    } catch (e) {
      if (isDuplicateHrRecord(e)) throw new ConflictException();
      throw e;
    }
  }
  @Patch(':organizationId/hr/checklist-templates/:templateId')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiBody({ schema: updateChecklistTemplateRequestOpenApiSchema })
  @ApiOkResponse({ schema: checklistTemplateOpenApiSchema })
  async updateChecklistTemplate(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('templateId', { schema: employeeIdSchema }) templateId: string,
    @Body({ schema: updateChecklistTemplateRequestSchema })
    body: UpdateChecklistTemplateRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    const r = await this.hr.updateChecklistTemplate({
      ...(await this.scope(organizationId, request, 'manageHr')),
      templateId,
      body,
    });
    if (!r) throw new NotFoundException();
    return checklistTemplateSchema.parse(r);
  }
  @Post(':organizationId/hr/checklist-templates/:templateId/items')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiBody({ schema: createChecklistTemplateItemRequestOpenApiSchema })
  @ApiCreatedResponse({ schema: checklistTemplateItemOpenApiSchema })
  async createChecklistTemplateItem(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('templateId', { schema: employeeIdSchema }) templateId: string,
    @Body({ schema: createChecklistTemplateItemRequestSchema })
    body: CreateChecklistTemplateItemRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      const r = await this.hr.createChecklistTemplateItem({
        ...(await this.scope(organizationId, request, 'manageHr')),
        templateId,
        body,
      });
      if (!r) throw new NotFoundException();
      return checklistTemplateItemSchema.parse(r);
    } catch (e) {
      if (isDuplicateHrRecord(e)) throw new ConflictException();
      throw e;
    }
  }
  @Patch(':organizationId/hr/checklist-templates/:templateId/items/:itemId')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiBody({ schema: updateChecklistTemplateItemRequestOpenApiSchema })
  @ApiOkResponse({ schema: checklistTemplateItemOpenApiSchema })
  async updateChecklistTemplateItem(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('templateId', { schema: employeeIdSchema }) templateId: string,
    @Param('itemId', { schema: employeeIdSchema }) itemId: string,
    @Body({ schema: updateChecklistTemplateItemRequestSchema })
    body: UpdateChecklistTemplateItemRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      const r = await this.hr.updateChecklistTemplateItem({
        ...(await this.scope(organizationId, request, 'manageHr')),
        templateId,
        itemId,
        body,
      });
      if (!r) throw new NotFoundException();
      return checklistTemplateItemSchema.parse(r);
    } catch (e) {
      if (isDuplicateHrRecord(e)) throw new ConflictException();
      throw e;
    }
  }
  @Get(':organizationId/employees/:employeeId/checklists')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({ schema: checklistListOpenApiSchema })
  async listChecklists(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('employeeId', { schema: employeeIdSchema }) employeeId: string,
    @Query({ schema: checklistListQuerySchema }) query: ChecklistListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      const r = await this.hr.listChecklists({
        ...(await this.scope(organizationId, request, 'readHr')),
        employeeId,
        query,
      });
      return checklistListResponseSchema.parse({
        items: r.items,
        page: r.page,
        pageSize: r.pageSize,
        total: r.total,
      });
    } catch (e) {
      if (e instanceof HrChecklistNotFoundError) throw new NotFoundException();
      throw e;
    }
  }
  @Post(':organizationId/employees/:employeeId/checklists')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiBody({ schema: createChecklistRequestOpenApiSchema })
  @ApiCreatedResponse({ schema: checklistOpenApiSchema })
  async createChecklist(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('employeeId', { schema: employeeIdSchema }) employeeId: string,
    @Body({ schema: createChecklistRequestSchema })
    body: CreateChecklistRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      return checklistSchema.parse(
        await this.hr.createChecklist({
          ...(await this.scope(organizationId, request, 'manageHr')),
          employeeId,
          body,
        }),
      );
    } catch (e) {
      if (e instanceof HrChecklistNotFoundError) throw new NotFoundException();
      if (e instanceof HrChecklistConflictError) throw new ConflictException();
      throw e;
    }
  }
  @Patch(
    ':organizationId/employees/:employeeId/checklists/:checklistId/tasks/:taskId',
  )
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiBody({ schema: updateChecklistTaskRequestOpenApiSchema })
  @ApiOkResponse({ schema: checklistTaskOpenApiSchema })
  async updateChecklistTask(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('employeeId', { schema: employeeIdSchema }) employeeId: string,
    @Param('checklistId', { schema: employeeIdSchema }) checklistId: string,
    @Param('taskId', { schema: employeeIdSchema }) taskId: string,
    @Body({ schema: updateChecklistTaskRequestSchema })
    body: UpdateChecklistTaskRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      return checklistTaskSchema.parse(
        await this.hr.updateChecklistTask({
          ...(await this.scope(organizationId, request, 'manageHr')),
          employeeId,
          checklistId,
          taskId,
          body,
        }),
      );
    } catch (e) {
      if (e instanceof HrChecklistNotFoundError) throw new NotFoundException();
      if (e instanceof HrChecklistConflictError) throw new ConflictException();
      if (e instanceof HrChecklistBadRequestError)
        throw new BadRequestException();
      throw e;
    }
  }
  @Get(':organizationId/employees')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOperation({ summary: 'List employees in visible legal entities' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        employees: { type: 'array', items: employeeOpenApiSchema },
      },
      required: ['employees'],
    },
  })
  async list(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Query({ schema: employeeListQuerySchema }) query: EmployeeListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    const result = await this.hr.listEmployees({
      ...(await this.scope(organizationId, request, 'readHr')),
      query,
    });
    return employeeListResponseSchema.parse({
      employees: result.items,
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
    });
  }
  @Post(':organizationId/employees')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiBody({ schema: createEmployeeRequestOpenApiSchema })
  @ApiCreatedResponse({ schema: employeeOpenApiSchema })
  async create(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Body({ schema: createEmployeeRequestSchema }) body: CreateEmployeeRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      const result = await this.hr.createEmployee({
        ...(await this.scope(organizationId, request, 'manageHr')),
        body,
      });
      if (!result) throw new NotFoundException();
      return employeeSchema.parse(result);
    } catch (error) {
      if (isDuplicateHrRecord(error)) throw new ConflictException();
      throw error;
    }
  }
  @Get(':organizationId/employees/:employeeId')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiNotFoundResponse({ description: 'Employee is not visible' })
  async get(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('employeeId', { schema: employeeIdSchema }) employeeId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const result = await this.hr.readEmployee({
      ...(await this.scope(organizationId, request, 'readHr')),
      employeeId,
    });
    if (!result) throw new NotFoundException();
    return employeeDetailSchema.parse({
      ...result,
      relationships: await this.hr.listRelationships({
        ...(await this.scope(organizationId, request, 'readHr')),
        employeeId,
      }),
      documents: (
        await this.hr.listEmployeeDocuments({
          ...(await this.scope(organizationId, request, 'readHr')),
          employeeId,
        })
      ).items,
    });
  }
  @Patch(':organizationId/employees/:employeeId')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiBody({ schema: updateEmployeeRequestOpenApiSchema })
  async update(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('employeeId', { schema: employeeIdSchema }) employeeId: string,
    @Body({ schema: updateEmployeeRequestSchema }) body: UpdateEmployeeRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    const result = await this.hr.updateEmployee({
      ...(await this.scope(organizationId, request, 'manageHr')),
      employeeId,
      body,
    });
    if (!result) throw new NotFoundException();
    return employeeSchema.parse(result);
  }
  @Post(':organizationId/employees/:employeeId/status-transitions')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBody({ schema: employeeStatusTransitionRequestOpenApiSchema })
  @ApiOkResponse({ schema: employeeStatusChangeOpenApiSchema })
  @ApiNotFoundResponse({ description: 'Employee is not visible' })
  async transitionStatus(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('employeeId', { schema: employeeIdSchema }) employeeId: string,
    @Body({ schema: employeeStatusTransitionRequestSchema })
    body: EmployeeStatusTransitionRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      return employeeStatusChangeSchema.parse(
        await this.hr.transitionEmployeeStatus({
          ...(await this.scope(organizationId, request, 'manageHr')),
          employeeId,
          body,
        }),
      );
    } catch (error) {
      if (error instanceof HrEmployeeNotFoundError)
        throw new NotFoundException();
      if (error instanceof HrEmployeeStatusConflictError)
        throw new ConflictException();
      if (error instanceof HrEmployeeStatusReasonError)
        throw new BadRequestException();
      throw error;
    }
  }
  @Get(':organizationId/employees/:employeeId/status-history')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        items: { type: 'array', items: employeeStatusChangeOpenApiSchema },
        page: { type: 'integer' },
        pageSize: { type: 'integer' },
        total: { type: 'integer', minimum: 0 },
      },
      required: ['items', 'page', 'pageSize', 'total'],
    },
  })
  @ApiNotFoundResponse({ description: 'Employee is not visible' })
  async statusHistory(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('employeeId', { schema: employeeIdSchema }) employeeId: string,
    @Query({ schema: employeeStatusHistoryQuerySchema })
    query: EmployeeStatusHistoryQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      return employeeStatusHistoryResponseSchema.parse(
        await this.hr.listEmployeeStatusHistory({
          ...(await this.scope(organizationId, request, 'readHr')),
          employeeId,
          query,
        }),
      );
    } catch (error) {
      if (error instanceof HrEmployeeNotFoundError)
        throw new NotFoundException();
      throw error;
    }
  }
  @Get(':organizationId/employees/:employeeId/relationships')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  async relationships(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('employeeId', { schema: employeeIdSchema }) employeeId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return relationshipListResponseSchema.parse({
      relationships: await this.hr.listRelationships({
        ...(await this.scope(organizationId, request, 'readHr')),
        employeeId,
      }),
    });
  }
  @Post(':organizationId/employees/:employeeId/relationships')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  async createRelationship(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('employeeId', { schema: employeeIdSchema }) employeeId: string,
    @Body({ schema: createEmploymentRelationshipRequestSchema })
    body: CreateEmploymentRelationshipRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    const result = await this.hr.createRelationship({
      ...(await this.scope(organizationId, request, 'manageHr')),
      employeeId,
      body,
    });
    if (!result) throw new NotFoundException();
    return employmentRelationshipSchema.parse(result);
  }
  @Get(':organizationId/employees/:employeeId/employment-terms')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        items: { type: 'array', items: employmentTermOpenApiSchema },
        page: { type: 'integer' },
        pageSize: { type: 'integer' },
        total: { type: 'integer' },
      },
      required: ['items', 'page', 'pageSize', 'total'],
    },
  })
  async employmentTerms(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('employeeId', { schema: employeeIdSchema }) employeeId: string,
    @Query({ schema: employmentTermListQuerySchema })
    query: EmploymentTermListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      const result = await this.hr.listEmploymentTerms({
        ...(await this.scope(organizationId, request, 'readHr')),
        employeeId,
        query,
      });
      return employmentTermListResponseSchema.parse(result);
    } catch (error) {
      if (error instanceof HrTermNotFoundError) throw new NotFoundException();
      throw error;
    }
  }
  @Post(':organizationId/employees/:employeeId/employment-terms')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiBody({ schema: createEmploymentTermRequestOpenApiSchema })
  @ApiCreatedResponse({ schema: employmentTermOpenApiSchema })
  async createEmploymentTerm(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('employeeId', { schema: employeeIdSchema }) employeeId: string,
    @Body({ schema: createEmploymentTermRequestSchema })
    body: CreateEmploymentTermRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      const result = await this.hr.createEmploymentTerm({
        ...(await this.scope(organizationId, request, 'manageHr')),
        employeeId,
        body,
      });
      if (!result) throw new NotFoundException();
      return employmentTermSchema.parse(result);
    } catch (error) {
      if (error instanceof HrTermConflictError || isDuplicateHrRecord(error))
        throw new ConflictException();
      throw error;
    }
  }
  @Get(':organizationId/employees/:employeeId/documents')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        items: { type: 'array', items: employeeDocumentOpenApiSchema },
        page: { type: 'integer' },
        pageSize: { type: 'integer' },
        total: { type: 'integer', minimum: 0 },
      },
      required: ['items', 'page', 'pageSize', 'total'],
    },
  })
  @ApiQuery({
    name: 'categoryId',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiQuery({
    name: 'approvalStatus',
    required: false,
    schema: {
      type: 'string',
      enum: ['not_required', 'pending', 'approved', 'rejected'],
    },
  })
  @ApiQuery({
    name: 'currentOnly',
    required: false,
    schema: { type: 'boolean', default: true },
  })
  @ApiQuery({
    name: 'page',
    required: false,
    schema: { type: 'integer', minimum: 1, default: 1 },
  })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
  })
  async documents(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('employeeId', { schema: employeeIdSchema }) employeeId: string,
    @Query({ schema: employeeDocumentListQuerySchema })
    query: EmployeeDocumentListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      const result = await this.hr.listEmployeeDocuments({
        ...(await this.scope(organizationId, request, 'readHr')),
        employeeId,
        query,
      });
      return employeeDocumentListResponseSchema.parse(result);
    } catch (error) {
      if (error instanceof HrEmployeeDocumentNotFoundError)
        throw new NotFoundException();
      throw error;
    }
  }
  @Post(':organizationId/employees/:employeeId/documents')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiBody({ schema: linkEmployeeDocumentRequestOpenApiSchema })
  @ApiCreatedResponse({ schema: employeeDocumentOpenApiSchema })
  async link(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('employeeId', { schema: employeeIdSchema }) employeeId: string,
    @Body({ schema: linkEmployeeDocumentRequestSchema })
    body: LinkEmployeeDocumentRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      const result = await this.hr.linkEmployeeDocument({
        ...(await this.scope(organizationId, request, 'manageHr')),
        employeeId,
        body,
      });
      return employeeDocumentLinkResponseSchema.parse(result);
    } catch (error) {
      if (error instanceof HrEmployeeDocumentNotFoundError)
        throw new NotFoundException();
      if (
        error instanceof HrEmployeeDocumentConflictError ||
        isEmployeeDocumentConflict(error) ||
        isDuplicateHrRecord(error)
      )
        throw new ConflictException();
      throw error;
    }
  }
  @Patch(':organizationId/employees/:employeeId/documents/:documentId')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiBody({ schema: updateEmployeeDocumentRequestOpenApiSchema })
  @ApiOkResponse({ schema: employeeDocumentOpenApiSchema })
  async updateDocument(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('employeeId', { schema: employeeIdSchema }) employeeId: string,
    @Param('documentId', { schema: employeeIdSchema }) documentId: string,
    @Body({ schema: updateEmployeeDocumentRequestSchema })
    body: UpdateEmployeeDocumentRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      return employeeDocumentLinkResponseSchema.parse(
        await this.hr.updateEmployeeDocument({
          ...(await this.scope(organizationId, request, 'manageHr')),
          employeeId,
          documentId,
          body,
        }),
      );
    } catch (error) {
      if (error instanceof HrEmployeeDocumentNotFoundError)
        throw new NotFoundException();
      if (
        error instanceof HrEmployeeDocumentConflictError ||
        isEmployeeDocumentConflict(error) ||
        isDuplicateHrRecord(error)
      )
        throw new ConflictException();
      throw error;
    }
  }
}
