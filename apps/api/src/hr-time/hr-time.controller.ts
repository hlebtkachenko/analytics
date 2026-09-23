import {
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
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
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
  createScheduleOpenApiSchema,
  createScheduleSchema,
  createTimesheetOpenApiSchema,
  createTimesheetSchema,
  emptyCommandOpenApiSchema,
  emptyCommandSchema,
  listOpenApi,
  reasonCommandOpenApiSchema,
  reasonCommandSchema,
  scheduleIdSchema,
  scheduleListQuerySchema,
  scheduleOpenApiSchema,
  scheduleSchema,
  scheduleListSchema,
  timesheetIdSchema,
  timesheetListQuerySchema,
  timesheetOpenApiSchema,
  timesheetSchema,
  timesheetListSchema,
  updateTimesheetOpenApiSchema,
  updateTimesheetSchema,
  type CreateSchedule,
  type CreateTimesheet,
  type ScheduleListQuery,
  type TimesheetListQuery,
  type UpdateTimesheet,
  absenceIdSchema,
  absenceListQuerySchema,
  absenceListSchema,
  absenceSchema,
  createAbsenceSchema,
  createLeaveLedgerSchema,
  createLeaveRequestSchema,
  createLeaveTypeSchema,
  leaveBalancesSchema,
  leaveBalancesOpenApiSchema,
  leaveCancelSchema,
  leaveCancelOpenApiSchema,
  leaveDecisionOpenApiSchema,
  leaveDecisionSchema,
  leaveLedgerSchema,
  leaveLedgerOpenApiSchema,
  leaveLedgerCreateOpenApiSchema,
  leaveRequestIdSchema,
  leaveRequestListQuerySchema,
  leaveRequestListSchema,
  leaveRequestSchema,
  leaveRequestOpenApiSchema,
  leaveTypeIdSchema,
  leaveTypeListQuerySchema,
  leaveTypeListSchema,
  leaveTypeSchema,
  leaveTypeOpenApiSchema,
  leaveTypeCreateOpenApiSchema,
  leaveTypeUpdateOpenApiSchema,
  leaveRequestCreateOpenApiSchema,
  absenceCreateOpenApiSchema,
  absenceOpenApiSchema,
  absenceUpdateOpenApiSchema,
  updateAbsenceSchema,
  updateLeaveTypeSchema,
  type AbsenceListQuery,
  type CreateAbsence,
  type CreateLeaveLedger,
  type CreateLeaveRequest,
  type CreateLeaveType,
  type LeaveRequestListQuery,
  type LeaveTypeListQuery,
  type UpdateAbsence,
  type UpdateLeaveType,
} from './contract.js';
import { HrTimeRepository, isHrTimeConflict } from './hr-time-repository.js';

@ApiBearerAuth('resource-token')
@ApiForbiddenResponse()
@ApiNotFoundResponse()
@Controller({ path: 'organizations', version: '1' })
export class HrTimeController {
  constructor(
    @Inject(HrTimeRepository) private readonly time: HrTimeRepository,
    @Inject(MembershipResolver)
    private readonly memberships: MembershipResolver,
  ) {}
  private async scope(
    org: string,
    request: AuthenticatedRequest,
    capability: 'readHr' | 'manageHr',
  ) {
    const { tenant, entityScope } = await resolveTenantAccess({
      capability,
      memberships: this.memberships,
      organizationId: org,
      request,
    });
    return { ...tenant, legalEntityIds: allowedEntityIds(entityScope) };
  }
  private conflict(e: unknown): never {
    if (isHrTimeConflict(e)) throw new ConflictException();
    throw e;
  }
  @Get(':organizationId/employees/:employeeId/schedules')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({ schema: listOpenApi(scheduleOpenApiSchema) })
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  async schedules(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Param('employeeId', { schema: employeeIdSchema }) employeeId: string,
    @Query({ schema: scheduleListQuerySchema }) query: ScheduleListQuery,
    @Req() req: AuthenticatedRequest,
  ) {
    const r = await this.time.listSchedules({
      ...(await this.scope(org, req, 'readHr')),
      employeeId,
      query,
    });
    if (!r) throw new NotFoundException();
    return scheduleListSchema.parse({
      items: r.items,
      page: r.page,
      pageSize: r.pageSize,
      total: r.total,
    });
  }
  @Post(':organizationId/employees/:employeeId/schedules')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiBody({ schema: createScheduleOpenApiSchema })
  @ApiCreatedResponse({ schema: scheduleOpenApiSchema })
  @ApiConflictResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  async createSchedule(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Param('employeeId', { schema: employeeIdSchema }) employeeId: string,
    @Body({ schema: createScheduleSchema }) body: CreateSchedule,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const r = await this.time.createSchedule({
        ...(await this.scope(org, req, 'manageHr')),
        employeeId,
        body,
      });
      if (!r) throw new NotFoundException();
      return scheduleSchema.parse(r);
    } catch (e) {
      return this.conflict(e);
    }
  }
  @Post(':organizationId/employees/:employeeId/schedules/:scheduleId/publish')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBody({ schema: emptyCommandOpenApiSchema })
  @ApiOkResponse({ schema: scheduleOpenApiSchema })
  @ApiConflictResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  async publish(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Param('employeeId', { schema: employeeIdSchema }) employeeId: string,
    @Param('scheduleId', { schema: scheduleIdSchema }) id: string,
    @Body({ schema: emptyCommandSchema }) _body: Record<string, never>,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const r = await this.time.publish({
        ...(await this.scope(org, req, 'manageHr')),
        employeeId,
        id,
      });
      if (!r) throw new NotFoundException();
      return scheduleSchema.parse(r);
    } catch (e) {
      return this.conflict(e);
    }
  }
  @Get(':organizationId/employees/:employeeId/timesheets')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({ schema: listOpenApi(timesheetOpenApiSchema) })
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  async timesheets(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Param('employeeId', { schema: employeeIdSchema }) employeeId: string,
    @Query({ schema: timesheetListQuerySchema }) query: TimesheetListQuery,
    @Req() req: AuthenticatedRequest,
  ) {
    const r = await this.time.listTimesheets({
      ...(await this.scope(org, req, 'readHr')),
      employeeId,
      query,
    });
    if (!r) throw new NotFoundException();
    return timesheetListSchema.parse({
      items: r.items,
      page: r.page,
      pageSize: r.pageSize,
      total: r.total,
    });
  }
  @Post(':organizationId/employees/:employeeId/timesheets')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiBody({ schema: createTimesheetOpenApiSchema })
  @ApiCreatedResponse({ schema: timesheetOpenApiSchema })
  @ApiConflictResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  async createTimesheet(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Param('employeeId', { schema: employeeIdSchema }) employeeId: string,
    @Body({ schema: createTimesheetSchema }) body: CreateTimesheet,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const r = await this.time.createTimesheet({
        ...(await this.scope(org, req, 'manageHr')),
        employeeId,
        body,
      });
      if (!r) throw new NotFoundException();
      return timesheetSchema.parse(r);
    } catch (e) {
      return this.conflict(e);
    }
  }
  @Patch(':organizationId/employees/:employeeId/timesheets/:timesheetId')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiBody({ schema: updateTimesheetOpenApiSchema })
  @ApiOkResponse({ schema: timesheetOpenApiSchema })
  @ApiConflictResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  async patch(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Param('employeeId', { schema: employeeIdSchema }) employeeId: string,
    @Param('timesheetId', { schema: timesheetIdSchema }) id: string,
    @Body({ schema: updateTimesheetSchema }) body: UpdateTimesheet,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const r = await this.time.updateTimesheet({
        ...(await this.scope(org, req, 'manageHr')),
        employeeId,
        id,
        body,
      });
      if (!r) throw new NotFoundException();
      return timesheetSchema.parse(r);
    } catch (e) {
      return this.conflict(e);
    }
  }
  private async run(
    org: string,
    employeeId: string,
    id: string,
    command: 'submit' | 'approve' | 'reject' | 'correct',
    body: { reason?: string },
    req: AuthenticatedRequest,
  ) {
    try {
      const r = await this.time.command({
        ...(await this.scope(org, req, 'manageHr')),
        employeeId,
        id,
        command,
        ...(body.reason === undefined ? {} : { reason: body.reason }),
      });
      if (!r) throw new NotFoundException();
      return timesheetSchema.parse(r);
    } catch (e) {
      return this.conflict(e);
    }
  }
  @Post(':organizationId/employees/:employeeId/timesheets/:timesheetId/submit')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBody({ schema: emptyCommandOpenApiSchema })
  @ApiOkResponse({ schema: timesheetOpenApiSchema })
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse()
  async submit(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    o: string,
    @Param('employeeId', { schema: employeeIdSchema }) e: string,
    @Param('timesheetId', { schema: timesheetIdSchema }) i: string,
    @Body({ schema: emptyCommandSchema }) b: Record<string, never>,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.run(o, e, i, 'submit', b, r);
  }
  @Post(':organizationId/employees/:employeeId/timesheets/:timesheetId/approve')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBody({ schema: emptyCommandOpenApiSchema })
  @ApiOkResponse({ schema: timesheetOpenApiSchema })
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse()
  async approve(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    o: string,
    @Param('employeeId', { schema: employeeIdSchema }) e: string,
    @Param('timesheetId', { schema: timesheetIdSchema }) i: string,
    @Body({ schema: emptyCommandSchema }) b: Record<string, never>,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.run(o, e, i, 'approve', b, r);
  }
  @Post(':organizationId/employees/:employeeId/timesheets/:timesheetId/reject')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBody({ schema: reasonCommandOpenApiSchema })
  @ApiOkResponse({ schema: timesheetOpenApiSchema })
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse()
  async reject(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    o: string,
    @Param('employeeId', { schema: employeeIdSchema }) e: string,
    @Param('timesheetId', { schema: timesheetIdSchema }) i: string,
    @Body({ schema: reasonCommandSchema }) b: { reason: string },
    @Req() r: AuthenticatedRequest,
  ) {
    return this.run(o, e, i, 'reject', b, r);
  }
  @Post(':organizationId/employees/:employeeId/timesheets/:timesheetId/correct')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBody({ schema: reasonCommandOpenApiSchema })
  @ApiOkResponse({ schema: timesheetOpenApiSchema })
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse()
  async correct(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    o: string,
    @Param('employeeId', { schema: employeeIdSchema }) e: string,
    @Param('timesheetId', { schema: timesheetIdSchema }) i: string,
    @Body({ schema: reasonCommandSchema }) b: { reason: string },
    @Req() r: AuthenticatedRequest,
  ) {
    return this.run(o, e, i, 'correct', b, r);
  }

  @Get(':organizationId/hr/leave-types')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({ schema: listOpenApi(leaveTypeOpenApiSchema) })
  @ApiForbiddenResponse()
  async leaveTypes(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Query({ schema: leaveTypeListQuerySchema }) query: LeaveTypeListQuery,
    @Req() req: AuthenticatedRequest,
  ) {
    return leaveTypeListSchema.parse(
      await this.time.listLeaveTypes({
        ...(await this.scope(org, req, 'readHr')),
        query,
      }),
    );
  }
  @Post(':organizationId/hr/leave-types')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiBody({ schema: leaveTypeCreateOpenApiSchema })
  @ApiCreatedResponse({ schema: leaveTypeOpenApiSchema })
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse()
  async createLeaveType(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Body({ schema: createLeaveTypeSchema }) body: CreateLeaveType,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const r = await this.time.createLeaveType({
        ...(await this.scope(org, req, 'manageHr')),
        body,
      });
      if (!r) throw new NotFoundException();
      return leaveTypeSchema.parse(r);
    } catch (e) {
      return this.conflict(e);
    }
  }
  @Patch(':organizationId/hr/leave-types/:leaveTypeId')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiBody({ schema: leaveTypeUpdateOpenApiSchema })
  @ApiOkResponse({ schema: leaveTypeOpenApiSchema })
  @ApiConflictResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  async patchLeaveType(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Param('leaveTypeId', { schema: leaveTypeIdSchema }) id: string,
    @Body({ schema: updateLeaveTypeSchema }) body: UpdateLeaveType,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const r = await this.time.updateLeaveType({
        ...(await this.scope(org, req, 'manageHr')),
        id,
        body,
      });
      if (!r) throw new NotFoundException();
      return leaveTypeSchema.parse(r);
    } catch (e) {
      return this.conflict(e);
    }
  }
  @Get(':organizationId/employees/:employeeId/leave-requests')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({ schema: listOpenApi(leaveRequestOpenApiSchema) })
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  async leaveRequests(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Param('employeeId', { schema: employeeIdSchema }) employeeId: string,
    @Query({ schema: leaveRequestListQuerySchema })
    query: LeaveRequestListQuery,
    @Req() req: AuthenticatedRequest,
  ) {
    const r = await this.time.listLeaveRequests({
      ...(await this.scope(org, req, 'readHr')),
      employeeId,
      query,
    });
    if (!r) throw new NotFoundException();
    return leaveRequestListSchema.parse({
      items: r.items,
      page: r.page,
      pageSize: r.pageSize,
      total: r.total,
    });
  }
  @Post(':organizationId/employees/:employeeId/leave-requests')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiBody({ schema: leaveRequestCreateOpenApiSchema })
  @ApiCreatedResponse({ schema: leaveRequestOpenApiSchema })
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse()
  async createLeaveRequest(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Param('employeeId', { schema: employeeIdSchema }) employeeId: string,
    @Body({ schema: createLeaveRequestSchema }) body: CreateLeaveRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const r = await this.time.createLeaveRequest({
        ...(await this.scope(org, req, 'manageHr')),
        employeeId,
        body,
      });
      if (!r) throw new NotFoundException();
      return leaveRequestSchema.parse(r);
    } catch (e) {
      return this.conflict(e);
    }
  }
  @Post(
    ':organizationId/employees/:employeeId/leave-requests/:requestId/decide',
  )
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBody({ schema: leaveDecisionOpenApiSchema })
  @ApiOkResponse({ schema: leaveRequestOpenApiSchema })
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse()
  async decideLeave(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Param('employeeId', { schema: employeeIdSchema }) employeeId: string,
    @Param('requestId', { schema: leaveRequestIdSchema }) id: string,
    @Body({ schema: leaveDecisionSchema })
    body: { decision: 'approved' | 'rejected'; reason?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const r = await this.time.leaveCommand({
        ...(await this.scope(org, req, 'manageHr')),
        employeeId,
        id,
        command: 'decide',
        ...body,
      });
      if (!r) throw new NotFoundException();
      return leaveRequestSchema.parse(r);
    } catch (e) {
      return this.conflict(e);
    }
  }
  @Post(
    ':organizationId/employees/:employeeId/leave-requests/:requestId/cancel',
  )
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBody({ schema: leaveCancelOpenApiSchema })
  @ApiOkResponse({ schema: leaveRequestOpenApiSchema })
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse()
  async cancelLeave(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Param('employeeId', { schema: employeeIdSchema }) employeeId: string,
    @Param('requestId', { schema: leaveRequestIdSchema }) id: string,
    @Body({ schema: leaveCancelSchema }) body: { reason?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const r = await this.time.leaveCommand({
        ...(await this.scope(org, req, 'manageHr')),
        employeeId,
        id,
        command: 'cancel',
        ...body,
      });
      if (!r) throw new NotFoundException();
      return leaveRequestSchema.parse(r);
    } catch (e) {
      return this.conflict(e);
    }
  }
  @Get(':organizationId/employees/:employeeId/leave-balances')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({ schema: leaveBalancesOpenApiSchema })
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  async balances(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Param('employeeId', { schema: employeeIdSchema }) employeeId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const r = await this.time.leaveBalances({
      ...(await this.scope(org, req, 'readHr')),
      employeeId,
    });
    if (!r) throw new NotFoundException();
    return leaveBalancesSchema.parse(r);
  }
  @Post(':organizationId/employees/:employeeId/leave-ledger')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiBody({ schema: leaveLedgerCreateOpenApiSchema })
  @ApiCreatedResponse({ schema: leaveLedgerOpenApiSchema })
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse()
  async leaveLedger(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Param('employeeId', { schema: employeeIdSchema }) employeeId: string,
    @Body({ schema: createLeaveLedgerSchema }) body: CreateLeaveLedger,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const r = await this.time.createLeaveLedger({
        ...(await this.scope(org, req, 'manageHr')),
        employeeId,
        body,
      });
      if (!r) throw new NotFoundException();
      return leaveLedgerSchema.parse(r);
    } catch (e) {
      return this.conflict(e);
    }
  }
  @Get(':organizationId/employees/:employeeId/absences')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiOkResponse({ schema: listOpenApi(absenceOpenApiSchema) })
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  async absences(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Param('employeeId', { schema: employeeIdSchema }) employeeId: string,
    @Query({ schema: absenceListQuerySchema }) query: AbsenceListQuery,
    @Req() req: AuthenticatedRequest,
  ) {
    const r = await this.time.listAbsences({
      ...(await this.scope(org, req, 'readHr')),
      employeeId,
      query,
    });
    if (!r) throw new NotFoundException();
    return absenceListSchema.parse({
      items: r.items,
      page: r.page,
      pageSize: r.pageSize,
      total: r.total,
    });
  }
  @Post(':organizationId/employees/:employeeId/absences')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiBody({ schema: absenceCreateOpenApiSchema })
  @ApiCreatedResponse({ schema: absenceOpenApiSchema })
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse()
  async createAbsence(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Param('employeeId', { schema: employeeIdSchema }) employeeId: string,
    @Body({ schema: createAbsenceSchema }) body: CreateAbsence,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const r = await this.time.createAbsence({
        ...(await this.scope(org, req, 'manageHr')),
        employeeId,
        body,
      });
      if (!r) throw new NotFoundException();
      return absenceSchema.parse(r);
    } catch (e) {
      return this.conflict(e);
    }
  }
  @Patch(':organizationId/employees/:employeeId/absences/:absenceId')
  @UseGuards(ResourceJwtGuard, SubjectRateLimitGuard)
  @ApiBody({ schema: absenceUpdateOpenApiSchema })
  @ApiOkResponse({ schema: absenceOpenApiSchema })
  @ApiConflictResponse()
  async patchAbsence(
    @Param('organizationId', { schema: organizationIdentifierSchema })
    org: string,
    @Param('employeeId', { schema: employeeIdSchema }) employeeId: string,
    @Param('absenceId', { schema: absenceIdSchema }) id: string,
    @Body({ schema: updateAbsenceSchema }) body: UpdateAbsence,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const r = await this.time.updateAbsence({
        ...(await this.scope(org, req, 'manageHr')),
        employeeId,
        id,
        body,
      });
      if (!r) throw new NotFoundException();
      return absenceSchema.parse(r);
    } catch (e) {
      return this.conflict(e);
    }
  }
}
