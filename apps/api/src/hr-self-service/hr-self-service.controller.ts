import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
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
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { organizationIdentifierSchema } from '@bap/security';
import { MembershipResolver } from '../membership-resolver.js';
import type { AuthenticatedRequest } from '../request-context.js';
import { ResourceJwtGuard } from '../resource-jwt.guard.js';
import { SubjectRateLimitGuard } from '../subject-rate-limit.guard.js';
import { allowedEntityIds, resolveTenantAccess } from '../tenant-access.js';
import {
  createEmployeeUserBindingOpenApiSchema,
  createEmployeeUserBindingSchema,
  employeeUserBindingIdSchema,
  employeeUserBindingListOpenApiSchema,
  employeeUserBindingListQuerySchema,
  employeeUserBindingListSchema,
  employeeUserBindingOpenApiSchema,
  employeeUserBindingSchema,
  myHrAccessOpenApiSchema,
  myHrAccessSchema,
  myHrDocumentsOpenApiSchema,
  myHrDocumentsQuerySchema,
  myHrDocumentsSchema,
  myHrPayslipsOpenApiSchema,
  myHrPayslipsQuerySchema,
  myHrPayslipsSchema,
  myHrLeaveTypesQuerySchema,
  myHrProfileOpenApiSchema,
  myHrProfileSchema,
  type CreateEmployeeUserBinding,
} from './contract.js';
import {
  EmployeeUserBindingConflictError,
  EmployeeUserBindingNotFoundError,
  HrSelfServiceRepository,
  MyHrBindingNotFoundError,
} from './hr-self-service-repository.js';
import {
  createLeaveRequestSchema,
  createTimesheetOpenApiSchema,
  createTimesheetSchema,
  emptyCommandOpenApiSchema,
  emptyCommandSchema,
  leaveCancelOpenApiSchema,
  leaveCancelSchema,
  leaveRequestCreateOpenApiSchema,
  leaveRequestIdSchema,
  leaveRequestListQuerySchema,
  leaveRequestListSchema,
  leaveRequestOpenApiSchema,
  leaveRequestSchema,
  leaveTypeListSchema,
  leaveTypeOpenApiSchema,
  listOpenApi,
  timesheetIdSchema,
  timesheetListQuerySchema,
  timesheetListSchema,
  timesheetOpenApiSchema,
  timesheetSchema,
  updateTimesheetOpenApiSchema,
  updateTimesheetSchema,
} from '../hr-time/contract.js';
import {
  HrTimeRepository,
  isHrTimeConflict,
} from '../hr-time/hr-time-repository.js';

@ApiBearerAuth('resource-token')
@Controller({ path: 'organizations', version: '1' })
export class HrSelfServiceController {
  constructor(
    @Inject(HrSelfServiceRepository)
    private readonly bindings: HrSelfServiceRepository,
    @Inject(MembershipResolver)
    private readonly memberships: MembershipResolver,
    @Inject(HrTimeRepository) private readonly time: HrTimeRepository,
  ) {}
  private async tenant(organizationId: string, request: AuthenticatedRequest) {
    return (
      await resolveTenantAccess({
        memberships: this.memberships,
        organizationId,
        request,
      })
    ).tenant;
  }
  private async owner(organizationId: string, request: AuthenticatedRequest) {
    const tenant = await this.tenant(organizationId, request);
    if (tenant.role !== 'owner') throw new ForbiddenException();
    return tenant;
  }
  private async ownScope(
    organizationId: string,
    request: AuthenticatedRequest,
  ) {
    const tenant = await this.tenant(organizationId, request);
    const binding = await this.bindings.access(tenant);
    if (!binding) throw new NotFoundException();
    return {
      ...tenant,
      employeeId: binding.employeeId,
      legalEntityId: binding.legalEntityId,
      legalEntityIds: [binding.legalEntityId],
    };
  }
  private conflict(error: unknown): never {
    if (isHrTimeConflict(error)) throw new ConflictException();
    throw error;
  }
  @Get(':organizationId/hr/employee-user-bindings')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({ schema: employeeUserBindingListOpenApiSchema as never })
  @ApiBadRequestResponse()
  @ApiQuery({
    name: 'legalEntityId',
    required: false,
    schema: { format: 'uuid', type: 'string' },
  })
  @ApiQuery({
    name: 'status',
    required: false,
    schema: { enum: ['pending', 'active', 'revoked'], type: 'string' },
  })
  @ApiQuery({
    name: 'page',
    required: false,
    schema: { default: 1, minimum: 1, type: 'integer' },
  })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    schema: { default: 25, maximum: 100, minimum: 1, type: 'integer' },
  })
  @ApiForbiddenResponse()
  async list(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = employeeUserBindingListQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    const resolved = await resolveTenantAccess({
      capability: 'manageHr',
      memberships: this.memberships,
      organizationId,
      request,
    });
    const result = await this.bindings.list({
      ...resolved.tenant,
      legalEntityIds: allowedEntityIds(resolved.entityScope),
      query: parsed.data,
    });
    return employeeUserBindingListSchema.parse({
      ...result,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
    });
  }
  @Post(':organizationId/hr/employee-user-bindings')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiBody({ schema: createEmployeeUserBindingOpenApiSchema as never })
  @ApiCreatedResponse({ schema: employeeUserBindingOpenApiSchema as never })
  @ApiBadRequestResponse()
  @ApiConflictResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  async create(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Body() body: CreateEmployeeUserBinding,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = createEmployeeUserBindingSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    try {
      return employeeUserBindingSchema.parse(
        await this.bindings.create({
          ...(await this.owner(organizationId, request)),
          body: parsed.data,
        }),
      );
    } catch (error) {
      if (error instanceof EmployeeUserBindingConflictError)
        throw new ConflictException();
      if (error instanceof EmployeeUserBindingNotFoundError)
        throw new NotFoundException();
      throw error;
    }
  }
  @Post(':organizationId/hr/employee-user-bindings/:id/verify')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ schema: employeeUserBindingOpenApiSchema as never })
  @ApiBadRequestResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  async verify(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('id', { schema: employeeUserBindingIdSchema }) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsedId = employeeUserBindingIdSchema.safeParse(id);
    if (!parsedId.success) throw new BadRequestException();
    try {
      return employeeUserBindingSchema.parse(
        await this.bindings.verify({
          ...(await this.tenant(organizationId, request)),
          id: parsedId.data,
        }),
      );
    } catch (error) {
      if (error instanceof EmployeeUserBindingNotFoundError)
        throw new NotFoundException();
      throw error;
    }
  }
  @Delete(':organizationId/hr/employee-user-bindings/:id')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiBadRequestResponse()
  @ApiNotFoundResponse()
  @ApiForbiddenResponse()
  async revoke(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('id', { schema: employeeUserBindingIdSchema }) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsedId = employeeUserBindingIdSchema.safeParse(id);
    if (!parsedId.success) throw new BadRequestException();
    try {
      await this.bindings.revoke({
        ...(await this.owner(organizationId, request)),
        id: parsedId.data,
      });
      return;
    } catch (error) {
      if (error instanceof EmployeeUserBindingNotFoundError)
        throw new NotFoundException();
      throw error;
    }
  }
  @Get(':organizationId/my-hr/access')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({ schema: myHrAccessOpenApiSchema as never })
  @ApiForbiddenResponse()
  async access(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const access = await this.bindings.access(
      await this.tenant(organizationId, request),
    );
    return myHrAccessSchema.parse(
      access ? { available: true, ...access } : { available: false },
    );
  }
  @Get(':organizationId/my-hr/profile')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({ schema: myHrProfileOpenApiSchema as never })
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  async profile(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      return myHrProfileSchema.parse(
        await this.bindings.profile(await this.tenant(organizationId, request)),
      );
    } catch (error) {
      if (error instanceof MyHrBindingNotFoundError)
        throw new NotFoundException();
      throw error;
    }
  }
  @Get(':organizationId/my-hr/documents')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({ schema: myHrDocumentsOpenApiSchema as never })
  @ApiBadRequestResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  @ApiQuery({
    name: 'page',
    required: false,
    schema: { default: 1, minimum: 1, type: 'integer' },
  })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    schema: { default: 25, minimum: 1, maximum: 100, type: 'integer' },
  })
  async documents(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = myHrDocumentsQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    try {
      const result = await this.bindings.documents({
        ...(await this.tenant(organizationId, request)),
        query: parsed.data,
      });
      return myHrDocumentsSchema.parse({
        ...result,
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
      });
    } catch (error) {
      if (error instanceof MyHrBindingNotFoundError)
        throw new NotFoundException();
      throw error;
    }
  }
  @Get(':organizationId/my-hr/payslips')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({ schema: myHrPayslipsOpenApiSchema as never })
  @ApiBadRequestResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  @ApiQuery({
    name: 'fromMonth',
    required: false,
    schema: { pattern: '^\\d{4}-(0[1-9]|1[0-2])$', type: 'string' },
  })
  @ApiQuery({
    name: 'toMonth',
    required: false,
    schema: { pattern: '^\\d{4}-(0[1-9]|1[0-2])$', type: 'string' },
  })
  @ApiQuery({
    name: 'page',
    required: false,
    schema: { default: 1, minimum: 1, type: 'integer' },
  })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    schema: { default: 25, minimum: 1, maximum: 100, type: 'integer' },
  })
  async payslips(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = myHrPayslipsQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    try {
      const result = await this.bindings.payslips({
        ...(await this.tenant(organizationId, request)),
        query: parsed.data,
      });
      return myHrPayslipsSchema.parse({
        ...result,
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
      });
    } catch (error) {
      if (error instanceof MyHrBindingNotFoundError)
        throw new NotFoundException();
      throw error;
    }
  }

  @Get(':organizationId/my-hr/timesheets')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiForbiddenResponse()
  @ApiOkResponse({ schema: listOpenApi(timesheetOpenApiSchema) })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse()
  @ApiQuery({
    name: 'from',
    required: false,
    schema: { format: 'date', type: 'string' },
  })
  @ApiQuery({
    name: 'to',
    required: false,
    schema: { format: 'date', type: 'string' },
  })
  @ApiQuery({
    name: 'status',
    required: false,
    schema: {
      enum: ['draft', 'submitted', 'approved', 'corrected'],
      type: 'string',
    },
  })
  @ApiQuery({
    name: 'page',
    required: false,
    schema: { default: 1, minimum: 1, type: 'integer' },
  })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    schema: { default: 25, maximum: 100, minimum: 1, type: 'integer' },
  })
  async ownTimesheets(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = timesheetListQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    const scope = await this.ownScope(organizationId, request);
    const result = await this.time.listTimesheets({
      ...scope,
      query: parsed.data,
    });
    if (!result) throw new NotFoundException();
    return timesheetListSchema.parse(result);
  }

  @Post(':organizationId/my-hr/timesheets')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiForbiddenResponse()
  @ApiBody({ schema: createTimesheetOpenApiSchema as never })
  @ApiCreatedResponse({ schema: timesheetOpenApiSchema as never })
  @ApiBadRequestResponse()
  @ApiConflictResponse()
  @ApiNotFoundResponse()
  async createOwnTimesheet(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = createTimesheetSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    try {
      const scope = await this.ownScope(organizationId, request);
      const result = await this.time.createTimesheet({
        ...scope,
        body: parsed.data,
      });
      if (!result) throw new NotFoundException();
      return timesheetSchema.parse(result);
    } catch (error) {
      return this.conflict(error);
    }
  }

  @Patch(':organizationId/my-hr/timesheets/:timesheetId')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiForbiddenResponse()
  @ApiBody({ schema: updateTimesheetOpenApiSchema as never })
  @ApiOkResponse({ schema: timesheetOpenApiSchema as never })
  @ApiBadRequestResponse()
  @ApiConflictResponse()
  @ApiNotFoundResponse()
  async patchOwnTimesheet(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('timesheetId', { schema: timesheetIdSchema }) timesheetId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const id = timesheetIdSchema.safeParse(timesheetId);
    const parsed = updateTimesheetSchema.safeParse(body);
    if (!id.success || !parsed.success) throw new BadRequestException();
    try {
      const scope = await this.ownScope(organizationId, request);
      const result = await this.time.updateTimesheet({
        ...scope,
        id: id.data,
        body: parsed.data,
      });
      if (!result) throw new NotFoundException();
      return timesheetSchema.parse(result);
    } catch (error) {
      return this.conflict(error);
    }
  }

  @Post(':organizationId/my-hr/timesheets/:timesheetId/submit')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiForbiddenResponse()
  @HttpCode(HttpStatus.OK)
  @ApiBody({ schema: emptyCommandOpenApiSchema as never })
  @ApiOkResponse({ schema: timesheetOpenApiSchema as never })
  @ApiBadRequestResponse()
  @ApiConflictResponse()
  @ApiNotFoundResponse()
  async submitOwnTimesheet(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('timesheetId', { schema: timesheetIdSchema }) timesheetId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const id = timesheetIdSchema.safeParse(timesheetId);
    if (!id.success || !emptyCommandSchema.safeParse(body).success)
      throw new BadRequestException();
    try {
      const scope = await this.ownScope(organizationId, request);
      const result = await this.time.command({
        ...scope,
        id: id.data,
        command: 'submit',
      });
      if (!result) throw new NotFoundException();
      return timesheetSchema.parse(result);
    } catch (error) {
      return this.conflict(error);
    }
  }

  @Get(':organizationId/my-hr/leave-requests')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiForbiddenResponse()
  @ApiOkResponse({ schema: listOpenApi(leaveRequestOpenApiSchema) })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse()
  @ApiQuery({
    name: 'leaveTypeId',
    required: false,
    schema: { format: 'uuid', type: 'string' },
  })
  @ApiQuery({
    name: 'from',
    required: false,
    schema: { format: 'date', type: 'string' },
  })
  @ApiQuery({
    name: 'to',
    required: false,
    schema: { format: 'date', type: 'string' },
  })
  @ApiQuery({
    name: 'status',
    required: false,
    schema: {
      enum: ['requested', 'approved', 'rejected', 'cancelled', 'taken'],
      type: 'string',
    },
  })
  @ApiQuery({
    name: 'page',
    required: false,
    schema: { default: 1, minimum: 1, type: 'integer' },
  })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    schema: { default: 25, maximum: 100, minimum: 1, type: 'integer' },
  })
  async ownLeaveRequests(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = leaveRequestListQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    const scope = await this.ownScope(organizationId, request);
    const result = await this.time.listLeaveRequests({
      ...scope,
      query: parsed.data,
    });
    if (!result) throw new NotFoundException();
    return leaveRequestListSchema.parse(result);
  }

  @Post(':organizationId/my-hr/leave-requests')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiForbiddenResponse()
  @ApiBody({ schema: leaveRequestCreateOpenApiSchema as never })
  @ApiCreatedResponse({ schema: leaveRequestOpenApiSchema as never })
  @ApiBadRequestResponse()
  @ApiConflictResponse()
  @ApiNotFoundResponse()
  async createOwnLeaveRequest(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = createLeaveRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    try {
      const scope = await this.ownScope(organizationId, request);
      const result = await this.time.createLeaveRequest({
        ...scope,
        body: parsed.data,
      });
      if (!result) throw new NotFoundException();
      return leaveRequestSchema.parse(result);
    } catch (error) {
      return this.conflict(error);
    }
  }

  @Post(':organizationId/my-hr/leave-requests/:requestId/cancel')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiForbiddenResponse()
  @HttpCode(HttpStatus.OK)
  @ApiBody({ schema: leaveCancelOpenApiSchema as never })
  @ApiOkResponse({ schema: leaveRequestOpenApiSchema as never })
  @ApiBadRequestResponse()
  @ApiConflictResponse()
  @ApiNotFoundResponse()
  async cancelOwnLeaveRequest(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Param('requestId', { schema: leaveRequestIdSchema }) requestId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const id = leaveRequestIdSchema.safeParse(requestId);
    const parsed = leaveCancelSchema.safeParse(body);
    if (!id.success || !parsed.success) throw new BadRequestException();
    try {
      const scope = await this.ownScope(organizationId, request);
      const result = await this.time.leaveCommand({
        ...scope,
        id: id.data,
        command: 'cancel',
        ...(parsed.data.reason === undefined
          ? {}
          : { reason: parsed.data.reason }),
      });
      if (!result) throw new NotFoundException();
      return leaveRequestSchema.parse(result);
    } catch (error) {
      return this.conflict(error);
    }
  }

  @Get(':organizationId/my-hr/leave-types')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiForbiddenResponse()
  @ApiOkResponse({ schema: listOpenApi(leaveTypeOpenApiSchema) })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse()
  @ApiQuery({ name: 'q', required: false, schema: { type: 'string' } })
  @ApiQuery({
    name: 'page',
    required: false,
    schema: { default: 1, minimum: 1, type: 'integer' },
  })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    schema: { default: 25, maximum: 100, minimum: 1, type: 'integer' },
  })
  async ownLeaveTypes(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    organizationId: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = myHrLeaveTypesQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    const { legalEntityId, ...scope } = await this.ownScope(
      organizationId,
      request,
    );
    return leaveTypeListSchema.parse(
      await this.time.listLeaveTypes({
        ...scope,
        query: { ...parsed.data, active: true, legalEntityId },
      }),
    );
  }
}
