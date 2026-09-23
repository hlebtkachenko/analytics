import {
  Body,
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  Headers,
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
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import { organizationIdentifierSchema } from '@bap/security';
import { employeeIdSchema } from '../hr/contract.js';
import { MembershipResolver } from '../membership-resolver.js';
import type { AuthenticatedRequest } from '../request-context.js';
import { ResourceJwtGuard } from '../resource-jwt.guard.js';
import { SubjectRateLimitGuard } from '../subject-rate-limit.guard.js';
import { allowedEntityIds, resolveTenantAccess } from '../tenant-access.js';
import {
  componentListQuerySchema,
  componentOpenApiSchema,
  componentSchema,
  compensationListQuerySchema,
  compensationOpenApiSchema,
  compensationSchema,
  createCompensationOpenApiSchema,
  createCompensationSchema,
  createComponentOpenApiSchema,
  createComponentSchema,
  createMappingOpenApiSchema,
  createMappingSchema,
  listOpenApiSchema,
  listSchema,
  mappingListQuerySchema,
  mappingOpenApiSchema,
  mappingSchema,
  updateCompensationOpenApiSchema,
  updateCompensationSchema,
  updateComponentOpenApiSchema,
  updateComponentSchema,
  updateMappingOpenApiSchema,
  updateMappingSchema,
  type ComponentListQuery,
  type CreateCompensation,
  type CreateComponent,
  type CreateMapping,
  type MappingListQuery,
  type UpdateCompensation,
  type UpdateComponent,
  type UpdateMapping,
  createPayrollRunSchema,
  payrollRunSchema,
  payrollRunListQuerySchema,
  emptyCommandSchema,
  rejectCommandSchema,
  paymentCommandSchema,
  correctionCommandSchema,
  approvalsOpenApiSchema,
  correctionCommandOpenApiSchema,
  createPayrollRunOpenApiSchema,
  emptyCommandOpenApiSchema,
  liabilitiesOpenApiSchema,
  paymentCommandOpenApiSchema,
  payrollRunListOpenApiSchema,
  payrollRunOpenApiSchema,
  rejectCommandOpenApiSchema,
  type CreatePayrollRun,
  type EmployeePayrollResultsQuery,
  employeePayrollResultSchema,
  employeePayrollResultsOpenApiSchema,
  employeePayrollResultsQuerySchema,
} from './contract.js';
import { isPayrollConflict, PayrollRepository } from './payroll-repository.js';

@ApiBearerAuth('resource-token')
@Controller({ path: 'organizations', version: '1' })
export class PayrollController {
  constructor(
    @Inject(PayrollRepository) private readonly payroll: PayrollRepository,
    @Inject(MembershipResolver)
    private readonly memberships: MembershipResolver,
  ) {}
  private async scope(
    org: string,
    request: AuthenticatedRequest,
    capability: 'readPayroll' | 'managePayroll' | 'approvePayroll',
  ) {
    const { tenant, entityScope } = await resolveTenantAccess({
      capability,
      memberships: this.memberships,
      organizationId: org,
      request,
    });
    return { ...tenant, legalEntityIds: allowedEntityIds(entityScope) };
  }
  @Get(':organizationId/payroll/components')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({
    schema: listOpenApiSchema('components', componentOpenApiSchema),
  })
  async listComponents(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Query({ schema: componentListQuerySchema }) query: ComponentListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    const r = await this.payroll.listComponents({
      ...(await this.scope(org, request, 'readPayroll')),
      query,
    });
    if (!r) throw new NotFoundException();
    return listSchema('components', componentSchema).parse({
      components: r.items,
      page: r.page,
      pageSize: r.pageSize,
      total: r.total,
    });
  }
  @Post(':organizationId/payroll/components')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiBody({ schema: createComponentOpenApiSchema })
  @ApiCreatedResponse({ schema: componentOpenApiSchema })
  async createComponent(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Body({ schema: createComponentSchema }) body: CreateComponent,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      const r = await this.payroll.createComponent({
        ...(await this.scope(org, request, 'managePayroll')),
        body,
      });
      if (!r) throw new NotFoundException();
      return componentSchema.parse(r);
    } catch (e) {
      if (isPayrollConflict(e)) throw new ConflictException();
      throw e;
    }
  }
  @Patch(':organizationId/payroll/components/:id')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiBody({ schema: updateComponentOpenApiSchema })
  @ApiOkResponse({ schema: componentOpenApiSchema })
  async updateComponent(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Param('id', { schema: employeeIdSchema }) id: string,
    @Body({ schema: updateComponentSchema }) body: UpdateComponent,
    @Req() request: AuthenticatedRequest,
  ) {
    const r = await this.payroll.updateComponent({
      ...(await this.scope(org, request, 'managePayroll')),
      id,
      body,
    });
    if (!r) throw new NotFoundException();
    return componentSchema.parse(r);
  }
  @Get(':organizationId/employees/:employeeId/compensation-components')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({
    schema: listOpenApiSchema(
      'compensationComponents',
      compensationOpenApiSchema,
    ),
  })
  async listCompensation(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Param('employeeId', { schema: employeeIdSchema }) employeeId: string,
    @Query({ schema: compensationListQuerySchema })
    query: { page: number; pageSize: number },
    @Req() request: AuthenticatedRequest,
  ) {
    const r = await this.payroll.listCompensation({
      ...(await this.scope(org, request, 'readPayroll')),
      employeeId,
      ...query,
    });
    if (!r) throw new NotFoundException();
    return listSchema('compensationComponents', compensationSchema).parse({
      compensationComponents: r.items,
      page: r.page,
      pageSize: r.pageSize,
      total: r.total,
    });
  }
  @Post(':organizationId/employees/:employeeId/compensation-components')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiBody({ schema: createCompensationOpenApiSchema })
  @ApiCreatedResponse({ schema: compensationOpenApiSchema })
  async createCompensation(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Param('employeeId', { schema: employeeIdSchema }) employeeId: string,
    @Body({ schema: createCompensationSchema }) body: CreateCompensation,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      const r = await this.payroll.createCompensation({
        ...(await this.scope(org, request, 'managePayroll')),
        employeeId,
        body,
      });
      if (!r) throw new NotFoundException();
      return compensationSchema.parse(r);
    } catch (e) {
      if (isPayrollConflict(e)) throw new ConflictException();
      throw e;
    }
  }
  @Patch(':organizationId/employees/:employeeId/compensation-components/:id')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiBody({ schema: updateCompensationOpenApiSchema })
  @ApiOkResponse({ schema: compensationOpenApiSchema })
  async updateCompensation(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Param('employeeId', { schema: employeeIdSchema }) employeeId: string,
    @Param('id', { schema: employeeIdSchema }) id: string,
    @Body({ schema: updateCompensationSchema }) body: UpdateCompensation,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      const r = await this.payroll.updateCompensation({
        ...(await this.scope(org, request, 'managePayroll')),
        employeeId,
        id,
        body,
      });
      if (!r) throw new NotFoundException();
      return compensationSchema.parse(r);
    } catch (e) {
      if (isPayrollConflict(e)) throw new ConflictException();
      throw e;
    }
  }
  @Get(':organizationId/employees/:employeeId/payroll-results')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({ schema: employeePayrollResultsOpenApiSchema })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse({ description: 'The employee is not visible' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  async listEmployeePayrollResults(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Param('employeeId', { schema: employeeIdSchema }) employeeId: string,
    @Query({ schema: employeePayrollResultsQuerySchema })
    query: EmployeePayrollResultsQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    const result = await this.payroll.listEmployeePayrollResults({
      ...(await this.scope(org, request, 'readPayroll')),
      employeeId,
      query,
    });
    if (!result) throw new NotFoundException();
    return {
      payrollResults: result.items.map((item) =>
        employeePayrollResultSchema.parse(item),
      ),
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
    };
  }
  @Get(':organizationId/payroll/account-mappings')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({
    schema: listOpenApiSchema('mappings', mappingOpenApiSchema),
  })
  async listMappings(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Query({ schema: mappingListQuerySchema }) query: MappingListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    const r = await this.payroll.listMappings({
      ...(await this.scope(org, request, 'readPayroll')),
      query,
    });
    if (!r) throw new NotFoundException();
    return listSchema('mappings', mappingSchema).parse({
      mappings: r.items,
      page: r.page,
      pageSize: r.pageSize,
      total: r.total,
    });
  }
  @Post(':organizationId/payroll/account-mappings')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiBody({ schema: createMappingOpenApiSchema })
  @ApiCreatedResponse({ schema: mappingOpenApiSchema })
  async createMapping(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Body({ schema: createMappingSchema }) body: CreateMapping,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      const r = await this.payroll.createMapping({
        ...(await this.scope(org, request, 'managePayroll')),
        body,
      });
      if (!r) throw new NotFoundException();
      return mappingSchema.parse(r);
    } catch (e) {
      if (isPayrollConflict(e)) throw new ConflictException();
      throw e;
    }
  }
  @Patch(':organizationId/payroll/account-mappings/:id')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiBody({ schema: updateMappingOpenApiSchema })
  @ApiOkResponse({ schema: mappingOpenApiSchema })
  async updateMapping(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Param('id', { schema: employeeIdSchema }) id: string,
    @Body({ schema: updateMappingSchema }) body: UpdateMapping,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      const r = await this.payroll.updateMapping({
        ...(await this.scope(org, request, 'managePayroll')),
        id,
        body,
      });
      if (!r) throw new NotFoundException();
      return mappingSchema.parse(r);
    } catch (e) {
      if (isPayrollConflict(e)) throw new ConflictException();
      throw e;
    }
  }
  private key(value: string | undefined) {
    if (
      !value ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
    )
      throw new BadRequestException();
    return value;
  }
  @Get(':organizationId/payroll-runs')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({ schema: payrollRunListOpenApiSchema })
  @ApiBadRequestResponse()
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  async listRuns(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Query({ schema: payrollRunListQuerySchema })
    query: {
      page: number;
      pageSize: number;
      legalEntityId?: string;
      month?: string;
    },
    @Req() request: AuthenticatedRequest,
  ) {
    const result = await this.payroll.listRuns({
      ...(await this.scope(org, request, 'readPayroll')),
      query,
    });
    return {
      payrollRuns: result.items.map((x) => payrollRunSchema.parse(x)),
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
    };
  }
  @Post(':organizationId/payroll-runs')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { format: 'uuid', type: 'string' },
  })
  @ApiBody({ schema: createPayrollRunOpenApiSchema })
  @ApiCreatedResponse({ schema: payrollRunOpenApiSchema })
  @ApiOkResponse({ schema: payrollRunOpenApiSchema })
  @ApiBadRequestResponse()
  @ApiConflictResponse()
  @ApiNotFoundResponse({ description: 'The legal entity is not visible' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  async createRun(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body({ schema: createPayrollRunSchema }) body: CreatePayrollRun,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      const result = await this.payroll.createRun({
        ...(await this.scope(org, request, 'managePayroll')),
        body,
        idempotencyKey: this.key(key),
      });
      if (!result) throw new NotFoundException();
      return payrollRunSchema.parse(result);
    } catch (e) {
      if (isPayrollConflict(e)) throw new ConflictException();
      throw e;
    }
  }
  @Get(':organizationId/payroll-runs/:id')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({ schema: payrollRunOpenApiSchema })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse({ description: 'The payroll run is not visible' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  async readRun(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Param('id', { schema: employeeIdSchema }) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const result = await this.payroll.readRun({
      ...(await this.scope(org, request, 'readPayroll')),
      id,
    });
    if (!result) throw new NotFoundException();
    return payrollRunSchema.parse(result);
  }
  private async execute(
    org: string,
    request: AuthenticatedRequest,
    id: string,
    command:
      | 'validate'
      | 'submit'
      | 'approve'
      | 'reject'
      | 'finalize'
      | 'record_payment'
      | 'correct',
    key: string | undefined,
    body: Record<string, unknown>,
    capability: 'managePayroll' | 'approvePayroll',
  ) {
    try {
      const result = await this.payroll.command({
        ...(await this.scope(org, request, capability)),
        id,
        command,
        body,
        idempotencyKey: this.key(key),
      });
      if (!result) throw new NotFoundException();
      return payrollRunSchema.parse(result);
    } catch (e) {
      if (isPayrollConflict(e)) throw new ConflictException();
      throw e;
    }
  }
  @Post(':organizationId/payroll-runs/:id/validate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { format: 'uuid', type: 'string' },
  })
  @ApiBody({ schema: emptyCommandOpenApiSchema })
  @ApiOkResponse({ schema: payrollRunOpenApiSchema })
  @ApiBadRequestResponse()
  @ApiConflictResponse()
  @ApiNotFoundResponse({ description: 'The payroll run is not visible' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  async validate(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Param('id', { schema: employeeIdSchema }) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body({ schema: emptyCommandSchema }) body: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.execute(
      org,
      request,
      id,
      'validate',
      key,
      body,
      'managePayroll',
    );
  }
  @Post(':organizationId/payroll-runs/:id/submit-for-approval')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { format: 'uuid', type: 'string' },
  })
  @ApiBody({ schema: emptyCommandOpenApiSchema })
  @ApiOkResponse({ schema: payrollRunOpenApiSchema })
  @ApiBadRequestResponse()
  @ApiConflictResponse()
  @ApiNotFoundResponse({ description: 'The payroll run is not visible' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  async submit(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Param('id', { schema: employeeIdSchema }) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body({ schema: emptyCommandSchema }) body: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.execute(org, request, id, 'submit', key, body, 'managePayroll');
  }
  @Post(':organizationId/payroll-runs/:id/approve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { format: 'uuid', type: 'string' },
  })
  @ApiBody({ schema: emptyCommandOpenApiSchema })
  @ApiOkResponse({ schema: payrollRunOpenApiSchema })
  @ApiBadRequestResponse()
  @ApiConflictResponse()
  @ApiNotFoundResponse({ description: 'The payroll run is not visible' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  async approve(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Param('id', { schema: employeeIdSchema }) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body({ schema: emptyCommandSchema }) body: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.execute(
      org,
      request,
      id,
      'approve',
      key,
      body,
      'approvePayroll',
    );
  }
  @Post(':organizationId/payroll-runs/:id/reject')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { format: 'uuid', type: 'string' },
  })
  @ApiBody({ schema: rejectCommandOpenApiSchema })
  @ApiOkResponse({ schema: payrollRunOpenApiSchema })
  @ApiBadRequestResponse()
  @ApiConflictResponse()
  @ApiNotFoundResponse({ description: 'The payroll run is not visible' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  async reject(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Param('id', { schema: employeeIdSchema }) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body({ schema: rejectCommandSchema }) body: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.execute(org, request, id, 'reject', key, body, 'managePayroll');
  }
  @Post(':organizationId/payroll-runs/:id/finalize')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { format: 'uuid', type: 'string' },
  })
  @ApiBody({ schema: emptyCommandOpenApiSchema })
  @ApiOkResponse({ schema: payrollRunOpenApiSchema })
  @ApiBadRequestResponse()
  @ApiConflictResponse()
  @ApiNotFoundResponse({ description: 'The payroll run is not visible' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  async finalize(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Param('id', { schema: employeeIdSchema }) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body({ schema: emptyCommandSchema }) body: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.execute(
      org,
      request,
      id,
      'finalize',
      key,
      body,
      'managePayroll',
    );
  }
  @Post(':organizationId/payroll-runs/:id/record-payment')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { format: 'uuid', type: 'string' },
  })
  @ApiBody({ schema: paymentCommandOpenApiSchema })
  @ApiOkResponse({ schema: payrollRunOpenApiSchema })
  @ApiBadRequestResponse()
  @ApiConflictResponse()
  @ApiNotFoundResponse({ description: 'The payroll run is not visible' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  async payment(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Param('id', { schema: employeeIdSchema }) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body({ schema: paymentCommandSchema }) body: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.execute(
      org,
      request,
      id,
      'record_payment',
      key,
      body,
      'managePayroll',
    );
  }
  @Post(':organizationId/payroll-runs/:id/corrections')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { format: 'uuid', type: 'string' },
  })
  @ApiBody({ schema: correctionCommandOpenApiSchema })
  @ApiOkResponse({ schema: payrollRunOpenApiSchema })
  @ApiBadRequestResponse()
  @ApiConflictResponse()
  @ApiNotFoundResponse({ description: 'The payroll run is not visible' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  async correction(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Param('id', { schema: employeeIdSchema }) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body({ schema: correctionCommandSchema }) body: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.execute(
      org,
      request,
      id,
      'correct',
      key,
      body,
      'managePayroll',
    );
  }
  @Get(':organizationId/payroll-runs/:id/approvals')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({ schema: approvalsOpenApiSchema })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse({ description: 'The payroll run is not visible' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  async approvals(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Param('id', { schema: employeeIdSchema }) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const rows = await this.payroll.approvals({
      ...(await this.scope(org, request, 'readPayroll')),
      id,
    });
    if (!rows) throw new NotFoundException();
    return {
      approvals: rows.map((r) => ({
        action: r.action,
        reason: r.reason,
        actor: r.actor_user_id,
        actedAt:
          r.acted_at instanceof Date
            ? r.acted_at.toISOString()
            : String(r.acted_at),
      })),
    };
  }
  @Get(':organizationId/payroll-runs/:id/liabilities')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({ schema: liabilitiesOpenApiSchema })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse({ description: 'The payroll run is not visible' })
  @ApiForbiddenResponse({ description: 'Organization access is denied' })
  async liabilities(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Param('id', { schema: employeeIdSchema }) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const rows = await this.payroll.liabilities({
      ...(await this.scope(org, request, 'readPayroll')),
      id,
    });
    if (!rows) throw new NotFoundException();
    return {
      liabilities: rows.map((r) => ({
        kind: r.kind,
        creditorReference: r.creditor_reference,
        amount: String(r.amount),
        dueOn:
          r.due_on instanceof Date
            ? r.due_on.toISOString().slice(0, 10)
            : String(r.due_on),
        status: r.status,
        paidAt:
          r.paid_at instanceof Date
            ? r.paid_at.toISOString()
            : r.paid_at === null
              ? null
              : String(r.paid_at),
      })),
    };
  }
}
