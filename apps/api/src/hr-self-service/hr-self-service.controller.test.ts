import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { MembershipResolver } from '../membership-resolver.js';
import { ResourceJwtGuard } from '../resource-jwt.guard.js';
import { SubjectRateLimitGuard } from '../subject-rate-limit.guard.js';
import { HrTimeRepository } from '../hr-time/hr-time-repository.js';
import { HrTimeConflictError } from '../hr-time/hr-time-repository.js';
import {
  createEmployeeUserBindingOpenApiSchema,
  createEmployeeUserBindingSchema,
  employeeUserBindingListOpenApiSchema,
  employeeUserBindingListQuerySchema,
  myHrAccessOpenApiSchema,
  myHrAccessSchema,
  myHrDocumentsQuerySchema,
  myHrDocumentsSchema,
  myHrLeaveTypesQuerySchema,
  myHrPayslipsQuerySchema,
  myHrPayslipsSchema,
  myHrProfileSchema,
} from './contract.js';
import { HrSelfServiceController } from './hr-self-service.controller.js';
import {
  EmployeeUserBindingConflictError,
  EmployeeUserBindingNotFoundError,
  HrSelfServiceRepository,
  MyHrBindingNotFoundError,
} from './hr-self-service-repository.js';

const id = '11111111-1111-4111-8111-111111111111';
const employeeId = '22222222-2222-4222-8222-222222222222';
const binding = {
  id,
  employeeId,
  legalEntityId: '33333333-3333-4333-8333-333333333333',
  userId: 'bound_user',
  status: 'pending' as const,
  verifiedAt: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};
const request = {
  headers: {},
  method: 'GET',
  resourcePrincipal: { issuedAt: 1, subject: 'bound_user' },
  url: '/',
} as never;
const timeRepository = {} as HrTimeRepository;
const membership = (
  role: 'owner' | 'admin' | 'member',
  emailVerified = true,
  entityScope:
    { mode: 'all' } | { mode: 'restricted'; legalEntityIds: string[] } = {
    mode: 'all',
  },
) =>
  ({
    checkReadiness: async () => true,
    getPoolStatistics: () => ({ idle: 0, total: 0, waiting: 0 }),
    readEntityScope: async () => entityScope,
    resolve: async () => ({ emailVerified, role }),
  }) as MembershipResolver;

describe('HR self-service binding controller', () => {
  it('lists a bounded manageHr-scoped page and rejects unknown query keys', async () => {
    const repository = {
      create: vi.fn().mockResolvedValue(binding),
      list: vi.fn().mockResolvedValue({ items: [binding], total: 1 }),
      verify: vi.fn(),
      revoke: vi.fn(),
      access: vi.fn().mockResolvedValue(null),
    };
    const admin = new HrSelfServiceController(
      repository as never,
      membership('admin', true, {
        mode: 'restricted',
        legalEntityIds: [binding.legalEntityId],
      }),
      timeRepository,
    );
    await expect(
      admin.list(
        'org',
        { page: '2', pageSize: '10', status: 'active' },
        request,
      ),
    ).resolves.toEqual({
      items: [binding],
      page: 2,
      pageSize: 10,
      total: 1,
    });
    expect(repository.list).toHaveBeenCalledWith(
      expect.objectContaining({
        legalEntityIds: [binding.legalEntityId],
        query: expect.objectContaining({ page: 2, pageSize: 10 }),
      }),
    );
    await expect(
      admin.list('org', { unknown: 'value' }, request),
    ).rejects.toBeInstanceOf(BadRequestException);

    const denied = new HrSelfServiceController(
      repository as never,
      membership('member'),
      timeRepository,
    );
    await expect(denied.list('org', {}, request)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('keeps create and revoke owner-only and maps persistence errors', async () => {
    const repository = {
      create: vi.fn().mockResolvedValue(binding),
      list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      verify: vi.fn(),
      revoke: vi.fn().mockResolvedValue(undefined),
      access: vi.fn(),
    };
    const owner = new HrSelfServiceController(
      repository as never,
      membership('owner'),
      timeRepository,
    );
    const body = {
      employeeId,
      legalEntityId: binding.legalEntityId,
      userId: binding.userId,
    };
    await expect(owner.create('org', body, request)).resolves.toEqual(binding);
    await expect(owner.revoke('org', id, request)).resolves.toBeUndefined();

    repository.create.mockRejectedValueOnce(
      new EmployeeUserBindingConflictError(),
    );
    await expect(owner.create('org', body, request)).rejects.toBeInstanceOf(
      ConflictException,
    );
    repository.create.mockRejectedValueOnce(
      new EmployeeUserBindingNotFoundError(),
    );
    await expect(owner.create('org', body, request)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const admin = new HrSelfServiceController(
      repository as never,
      membership('admin'),
      timeRepository,
    );
    await expect(admin.create('org', body, request)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(admin.revoke('org', id, request)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('activates only through the named verified member and maps unavailable access', async () => {
    const activeBinding = {
      ...binding,
      status: 'active' as const,
      verifiedAt: new Date(1).toISOString(),
    };
    const repository = {
      create: vi.fn(),
      list: vi.fn(),
      verify: vi.fn().mockResolvedValue(activeBinding),
      revoke: vi.fn(),
      access: vi
        .fn()
        .mockResolvedValueOnce({
          employeeId,
          legalEntityId: binding.legalEntityId,
        })
        .mockResolvedValueOnce(null),
    };
    const controller = new HrSelfServiceController(
      repository as never,
      membership('member'),
      timeRepository,
    );
    await expect(controller.verify('org', id, request)).resolves.toEqual(
      activeBinding,
    );
    expect(repository.verify).toHaveBeenCalledWith(
      expect.objectContaining({ id, userId: 'bound_user' }),
    );
    await expect(controller.access('org', request)).resolves.toEqual({
      available: true,
      employeeId,
      legalEntityId: binding.legalEntityId,
    });
    await expect(controller.access('org', request)).resolves.toEqual({
      available: false,
    });

    const unverified = new HrSelfServiceController(
      repository as never,
      membership('member', false),
      timeRepository,
    );
    await expect(unverified.verify('org', id, request)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(unverified.access('org', request)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('maps invalid and invisible binding IDs without exposing another user', async () => {
    const repository = {
      create: vi.fn(),
      list: vi.fn(),
      verify: vi.fn().mockRejectedValue(new EmployeeUserBindingNotFoundError()),
      revoke: vi.fn(),
      access: vi.fn(),
    };
    const controller = new HrSelfServiceController(
      repository as never,
      membership('member'),
      timeRepository,
    );
    await expect(
      controller.verify('org', 'not-a-uuid', request),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.verify('org', id, request)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('publishes strict contracts and command status metadata', () => {
    expect(
      createEmployeeUserBindingSchema.safeParse({
        employeeId,
        legalEntityId: binding.legalEntityId,
        userId: binding.userId,
        unexpected: true,
      }).success,
    ).toBe(false);
    expect(
      employeeUserBindingListQuerySchema.safeParse({ unknown: true }).success,
    ).toBe(false);
    expect(
      myHrAccessSchema.safeParse({ available: false, employeeId }).success,
    ).toBe(false);
    expect(createEmployeeUserBindingOpenApiSchema).toMatchObject({
      additionalProperties: false,
      required: ['legalEntityId', 'employeeId', 'userId'],
    });
    expect(employeeUserBindingListOpenApiSchema).toMatchObject({
      additionalProperties: false,
      required: ['items', 'page', 'pageSize', 'total'],
    });
    expect(myHrAccessOpenApiSchema.oneOf).toHaveLength(2);
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        HrSelfServiceController.prototype.verify,
      ),
    ).toBe(HttpStatus.OK);
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        HrSelfServiceController.prototype.revoke,
      ),
    ).toBe(HttpStatus.NO_CONTENT);
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        HrSelfServiceController.prototype.submitOwnTimesheet,
      ),
    ).toBe(HttpStatus.OK);
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        HrSelfServiceController.prototype.cancelOwnLeaveRequest,
      ),
    ).toBe(HttpStatus.OK);
  });

  it('serves only the caller binding, validates strict own queries, and maps unavailable binding to 404', async () => {
    const repository = {
      profile: vi.fn().mockResolvedValue({
        employee: {
          id: employeeId,
          legalEntityId: binding.legalEntityId,
          employeeNumber: 'E-1',
          firstName: 'Own',
          lastName: 'User',
          workEmail: null,
          workPhone: null,
          status: 'active',
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
        relationships: [],
      }),
      documents: vi.fn().mockResolvedValue({
        items: [
          {
            documentId: id,
            title: 'Operational',
            documentDate: '2026-01-01',
            categoryId: binding.legalEntityId,
            relationshipId: null,
            approvalStatus: 'approved',
            approvedAt: new Date(0).toISOString(),
            createdAt: new Date(0).toISOString(),
          },
        ],
        total: 1,
      }),
      payslips: vi.fn().mockResolvedValue({
        items: [
          {
            payrollRunId: id,
            month: '2026-02',
            version: 1,
            status: 'finalized',
            documentId: employeeId,
            finalizedAt: new Date(0).toISOString(),
            paidAt: null,
          },
        ],
        total: 1,
      }),
    };
    const controller = new HrSelfServiceController(
      repository as never,
      membership('member'),
      timeRepository,
    );
    await expect(controller.profile('org', request)).resolves.toMatchObject({
      employee: { id: employeeId },
    });
    await expect(
      controller.documents('org', { page: '2', pageSize: '10' }, request),
    ).resolves.toMatchObject({ page: 2, total: 1 });
    await expect(
      controller.payslips(
        'org',
        { fromMonth: '2026-01', toMonth: '2026-02' },
        request,
      ),
    ).resolves.toMatchObject({ page: 1, total: 1 });
    expect(repository.profile).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'bound_user' }),
    );
    await expect(
      controller.documents('org', { employeeId, unknown: 'x' }, request),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.payslips(
        'org',
        { fromMonth: '2026-03', toMonth: '2026-02' },
        request,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    repository.profile.mockRejectedValueOnce(new MyHrBindingNotFoundError());
    await expect(controller.profile('org', request)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects forbidden sensitive response keys in every W4.2 response schema', () => {
    const forbidden = {
      approvedBy: 'approver',
      bankAccount: 'private',
      taxId: 'private',
      dependant: 'private',
      medical: 'private',
      grossPay: '1',
    };
    expect(
      myHrProfileSchema.safeParse({
        employee: {
          id: employeeId,
          legalEntityId: binding.legalEntityId,
          employeeNumber: 'E-1',
          firstName: 'Own',
          lastName: 'User',
          workEmail: null,
          workPhone: null,
          status: 'active',
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
          ...forbidden,
        },
        relationships: [],
      }).success,
    ).toBe(false);
    expect(
      myHrDocumentsSchema.safeParse({
        items: [
          {
            documentId: id,
            title: 'Operational',
            documentDate: '2026-01-01',
            categoryId: null,
            relationshipId: null,
            approvalStatus: 'approved',
            approvedAt: null,
            createdAt: new Date(0).toISOString(),
            ...forbidden,
          },
        ],
        page: 1,
        pageSize: 25,
        total: 1,
      }).success,
    ).toBe(false);
    expect(
      myHrPayslipsSchema.safeParse({
        items: [
          {
            payrollRunId: id,
            month: '2026-01',
            version: 1,
            status: 'paid',
            documentId: employeeId,
            finalizedAt: null,
            paidAt: null,
            ...forbidden,
          },
        ],
        page: 1,
        pageSize: 25,
        total: 1,
      }).success,
    ).toBe(false);
    expect(
      myHrDocumentsQuerySchema.safeParse({ approvedBy: 'x' }).success,
    ).toBe(false);
    expect(
      myHrPayslipsQuerySchema.safeParse({ fromMonth: '2026-13' }).success,
    ).toBe(false);
  });

  it('orchestrates every own time and leave action through the active binding only', async () => {
    const now = new Date(0).toISOString();
    const ownBinding = { employeeId, legalEntityId: binding.legalEntityId };
    const timesheet = {
      id,
      legalEntityId: binding.legalEntityId,
      employeeId,
      relationshipId: '44444444-4444-4444-8444-444444444444',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      version: 1,
      status: 'draft' as const,
      submittedAt: null,
      approvedBy: null,
      approvedAt: null,
      rejectionReason: null,
      supersedesTimesheetId: null,
      entries: [
        {
          id: '55555555-5555-4555-8555-555555555555',
          workDate: '2026-01-02',
          startedAt: '2026-01-02T08:00:00.000Z',
          endedAt: '2026-01-02T16:00:00.000Z',
          breakMinutes: 30,
          overtimeMinutes: 0,
          nightMinutes: 0,
          holidayMinutes: 0,
          standbyMinutes: 0,
          activityCode: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
      totalWorkedMinutes: 450,
      totalBreakMinutes: 30,
      totalOvertimeMinutes: 0,
      totalNightMinutes: 0,
      totalHolidayMinutes: 0,
      totalStandbyMinutes: 0,
      createdAt: now,
      updatedAt: now,
    };
    const leave = {
      id,
      legalEntityId: binding.legalEntityId,
      employeeId,
      relationshipId: timesheet.relationshipId,
      leaveTypeId: '66666666-6666-4666-8666-666666666666',
      startsOn: '2026-02-01',
      endsOn: '2026-02-01',
      requestedAmount: '1',
      status: 'requested' as const,
      decidedBy: null,
      decidedAt: null,
      reason: null,
      createdAt: now,
      updatedAt: now,
    };
    const bindings = { access: vi.fn().mockResolvedValue(ownBinding) };
    const time = {
      listTimesheets: vi.fn().mockResolvedValue({
        items: [timesheet],
        page: 1,
        pageSize: 25,
        total: 1,
      }),
      createTimesheet: vi.fn().mockResolvedValue(timesheet),
      updateTimesheet: vi.fn().mockResolvedValue(timesheet),
      command: vi.fn().mockResolvedValue({
        ...timesheet,
        status: 'submitted',
        submittedAt: now,
      }),
      listLeaveRequests: vi
        .fn()
        .mockResolvedValue({ items: [leave], page: 1, pageSize: 25, total: 1 }),
      createLeaveRequest: vi.fn().mockResolvedValue(leave),
      leaveCommand: vi
        .fn()
        .mockResolvedValue({ ...leave, status: 'cancelled', decidedAt: now }),
    };
    const controller = new HrSelfServiceController(
      bindings as never,
      membership('member'),
      time as never,
    );
    const timesheetBody = {
      relationshipId: timesheet.relationshipId,
      periodStart: timesheet.periodStart,
      periodEnd: timesheet.periodEnd,
      entries: [
        {
          workDate: '2026-01-02',
          startedAt: '2026-01-02T08:00:00.000Z',
          endedAt: '2026-01-02T16:00:00.000Z',
        },
      ],
    };
    const leaveBody = {
      relationshipId: timesheet.relationshipId,
      leaveTypeId: leave.leaveTypeId,
      startsOn: leave.startsOn,
      endsOn: leave.endsOn,
      requestedAmount: leave.requestedAmount,
    };
    await controller.ownTimesheets('org', {}, request);
    await controller.createOwnTimesheet('org', timesheetBody, request);
    await controller.patchOwnTimesheet(
      'org',
      id,
      { entries: timesheetBody.entries },
      request,
    );
    await controller.submitOwnTimesheet('org', id, {}, request);
    await controller.ownLeaveRequests('org', {}, request);
    await controller.createOwnLeaveRequest('org', leaveBody, request);
    await controller.cancelOwnLeaveRequest('org', id, {}, request);
    for (const operation of [
      time.listTimesheets,
      time.createTimesheet,
      time.updateTimesheet,
      time.command,
      time.listLeaveRequests,
      time.createLeaveRequest,
      time.leaveCommand,
    ])
      expect(operation).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId,
          legalEntityIds: [binding.legalEntityId],
        }),
      );
    expect(time.command).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'submit' }),
    );
    expect(time.leaveCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'cancel' }),
    );
  });

  it('maps missing bindings and invisible own targets to 404, conflicts to 409, and malformed own input to 400', async () => {
    const active = {
      access: vi.fn().mockResolvedValue({
        employeeId,
        legalEntityId: binding.legalEntityId,
      }),
    };
    const time = {
      listTimesheets: vi.fn().mockResolvedValue(null),
      updateTimesheet: vi.fn().mockRejectedValue(new HrTimeConflictError()),
      command: vi.fn().mockRejectedValue(new HrTimeConflictError()),
      leaveCommand: vi.fn().mockRejectedValue(new HrTimeConflictError()),
    };
    const controller = new HrSelfServiceController(
      active as never,
      membership('member'),
      time as never,
    );
    await expect(
      controller.ownTimesheets('org', {}, request),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.patchOwnTimesheet('org', id, { entries: [] }, request),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.patchOwnTimesheet(
        'org',
        id,
        {
          entries: [
            {
              workDate: '2026-01-02',
              startedAt: '2026-01-02T08:00:00.000Z',
              endedAt: '2026-01-02T16:00:00.000Z',
            },
          ],
        },
        request,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      controller.submitOwnTimesheet('org', id, { unexpected: true }, request),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.submitOwnTimesheet('org', id, {}, request),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      controller.cancelOwnLeaveRequest('org', id, {}, request),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(time.command).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'submit' }),
    );
    expect(time.leaveCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'cancel' }),
    );
    const unavailable = new HrSelfServiceController(
      { access: vi.fn().mockResolvedValue(null) } as never,
      membership('member'),
      time as never,
    );
    await expect(
      unavailable.ownLeaveRequests('org', {}, request),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.ownLeaveRequests('org', { pageSize: '101' }, request),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects strict own input before dispatching to the Wave 3 repository', async () => {
    const bindings = {
      access: vi.fn().mockResolvedValue({
        employeeId,
        legalEntityId: binding.legalEntityId,
      }),
    };
    const time = {
      listTimesheets: vi.fn(),
      createTimesheet: vi.fn(),
      updateTimesheet: vi.fn(),
      command: vi.fn(),
      listLeaveRequests: vi.fn(),
      createLeaveRequest: vi.fn(),
      leaveCommand: vi.fn(),
    };
    const controller = new HrSelfServiceController(
      bindings as never,
      membership('member'),
      time as never,
    );
    const entry = {
      workDate: '2026-01-02',
      startedAt: '2026-01-02T08:00:00.000Z',
      endedAt: '2026-01-02T16:00:00.000Z',
    };
    await expect(
      controller.ownTimesheets('org', { unknown: 'x' }, request),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.ownTimesheets(
        'org',
        { from: '2026-02-01', to: '2026-01-01' },
        request,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.ownLeaveRequests('org', { unknown: 'x' }, request),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.ownLeaveRequests(
        'org',
        { from: '2026-02-01', to: '2026-01-01' },
        request,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.createOwnTimesheet(
        'org',
        {
          relationshipId: id,
          periodStart: '2026-01-01',
          periodEnd: '2026-01-01',
          entries: [entry],
          unknown: true,
        },
        request,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.createOwnLeaveRequest(
        'org',
        {
          relationshipId: id,
          leaveTypeId: id,
          startsOn: '2026-01-01',
          endsOn: '2026-01-01',
          requestedAmount: '1',
          unknown: true,
        },
        request,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.patchOwnTimesheet(
        'org',
        'invalid',
        { entries: [entry] },
        request,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.submitOwnTimesheet('org', 'invalid', {}, request),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.cancelOwnLeaveRequest(
        'org',
        'invalid',
        { unknown: true },
        request,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(time.listTimesheets).not.toHaveBeenCalled();
    expect(time.createTimesheet).not.toHaveBeenCalled();
    expect(time.updateTimesheet).not.toHaveBeenCalled();
    expect(time.command).not.toHaveBeenCalled();
    expect(time.listLeaveRequests).not.toHaveBeenCalled();
    expect(time.createLeaveRequest).not.toHaveBeenCalled();
    expect(time.leaveCommand).not.toHaveBeenCalled();
  });

  it('maps invisible own PATCH, submit, and leave cancel targets to 404', async () => {
    const time = {
      updateTimesheet: vi.fn().mockResolvedValue(null),
      command: vi.fn().mockResolvedValue(null),
      leaveCommand: vi.fn().mockResolvedValue(null),
    };
    const controller = new HrSelfServiceController(
      {
        access: vi.fn().mockResolvedValue({
          employeeId,
          legalEntityId: binding.legalEntityId,
        }),
      } as never,
      membership('member'),
      time as never,
    );
    const entries = [
      {
        workDate: '2026-01-02',
        startedAt: '2026-01-02T08:00:00.000Z',
        endedAt: '2026-01-02T16:00:00.000Z',
      },
    ];
    await expect(
      controller.patchOwnTimesheet('org', id, { entries }, request),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.submitOwnTimesheet('org', id, {}, request),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.cancelOwnLeaveRequest('org', id, {}, request),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists only active leave types in the binding entity with strict paging and search', async () => {
    const listLeaveTypes = vi
      .fn()
      .mockResolvedValue({ items: [], page: 2, pageSize: 10, total: 0 });
    const controller = new HrSelfServiceController(
      {
        access: vi.fn().mockResolvedValue({
          employeeId,
          legalEntityId: binding.legalEntityId,
        }),
      } as never,
      membership('member'),
      { listLeaveTypes } as never,
    );
    await expect(
      controller.ownLeaveTypes(
        'org',
        { q: 'annual', page: '2', pageSize: '10' },
        request,
      ),
    ).resolves.toEqual({ items: [], page: 2, pageSize: 10, total: 0 });
    expect(listLeaveTypes).toHaveBeenCalledWith(
      expect.objectContaining({
        legalEntityIds: [binding.legalEntityId],
        query: {
          active: true,
          legalEntityId: binding.legalEntityId,
          page: 2,
          pageSize: 10,
          q: 'annual',
        },
      }),
    );
    await expect(
      controller.ownLeaveTypes('org', { active: 'false' }, request),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.ownLeaveTypes('org', { legalEntityId: id }, request),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(listLeaveTypes).toHaveBeenCalledTimes(1);
    const unavailable = new HrSelfServiceController(
      { access: vi.fn().mockResolvedValue(null) } as never,
      membership('member'),
      { listLeaveTypes } as never,
    );
    await expect(
      unavailable.ownLeaveTypes('org', {}, request),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(myHrLeaveTypesQuerySchema.safeParse({ active: true }).success).toBe(
      false,
    );
  });

  it('publishes the fixed routes, queries, bodies, and success statuses in OpenAPI', async () => {
    const module = await Test.createTestingModule({
      controllers: [HrSelfServiceController],
      providers: [
        { provide: HrSelfServiceRepository, useValue: {} },
        { provide: HrTimeRepository, useValue: {} },
        { provide: MembershipResolver, useValue: {} },
      ],
    })
      .overrideGuard(ResourceJwtGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(SubjectRateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const document = SwaggerModule.createDocument(
      module.createNestApplication(),
      new DocumentBuilder().build(),
    );
    const collection =
      document.paths[
        '/organizations/{organizationId}/hr/employee-user-bindings'
      ]!;
    expect(
      collection.get?.parameters?.map((parameter) =>
        'name' in parameter ? parameter.name : undefined,
      ),
    ).toEqual(
      expect.arrayContaining([
        'organizationId',
        'legalEntityId',
        'status',
        'page',
        'pageSize',
      ]),
    );
    expect(
      collection.post?.requestBody && 'content' in collection.post.requestBody
        ? collection.post.requestBody.content['application/json']?.schema
        : undefined,
    ).toMatchObject({ additionalProperties: false });
    const item =
      document.paths[
        '/organizations/{organizationId}/hr/employee-user-bindings/{id}'
      ]!;
    expect(item.delete?.responses).toHaveProperty('204');
    const verify =
      document.paths[
        '/organizations/{organizationId}/hr/employee-user-bindings/{id}/verify'
      ]!;
    expect(verify.post?.responses).toHaveProperty('200');
    expect(verify.post?.responses).not.toHaveProperty('201');
    const ownAccess =
      document.paths['/organizations/{organizationId}/my-hr/access']!;
    expect(ownAccess.get?.responses).toHaveProperty('200');
    const profile =
      document.paths['/organizations/{organizationId}/my-hr/profile']!;
    const documents =
      document.paths['/organizations/{organizationId}/my-hr/documents']!;
    const payslips =
      document.paths['/organizations/{organizationId}/my-hr/payslips']!;
    expect(profile.get?.responses).toHaveProperty('404');
    expect(
      documents.get?.parameters?.map((parameter) =>
        'name' in parameter ? parameter.name : undefined,
      ),
    ).toEqual(expect.arrayContaining(['page', 'pageSize']));
    expect(
      payslips.get?.parameters?.map((parameter) =>
        'name' in parameter ? parameter.name : undefined,
      ),
    ).toEqual(
      expect.arrayContaining(['fromMonth', 'toMonth', 'page', 'pageSize']),
    );
    expect(payslips.get?.responses).toHaveProperty('200');
    const timesheets =
      document.paths['/organizations/{organizationId}/my-hr/timesheets']!;
    const timesheet =
      document.paths[
        '/organizations/{organizationId}/my-hr/timesheets/{timesheetId}'
      ]!;
    const submit =
      document.paths[
        '/organizations/{organizationId}/my-hr/timesheets/{timesheetId}/submit'
      ]!;
    const leaveRequests =
      document.paths['/organizations/{organizationId}/my-hr/leave-requests']!;
    const cancel =
      document.paths[
        '/organizations/{organizationId}/my-hr/leave-requests/{requestId}/cancel'
      ]!;
    const leaveTypes =
      document.paths['/organizations/{organizationId}/my-hr/leave-types']!;
    expect(
      timesheets.get?.parameters?.map((parameter) =>
        'name' in parameter ? parameter.name : undefined,
      ),
    ).toEqual(
      expect.arrayContaining(['from', 'to', 'status', 'page', 'pageSize']),
    );
    expect(timesheets.post?.responses).toHaveProperty('201');
    expect(timesheet.patch?.responses).toHaveProperty('200');
    expect(submit.post?.responses).toHaveProperty('200');
    expect(submit.post?.responses).not.toHaveProperty('201');
    expect(
      leaveRequests.get?.parameters?.map((parameter) =>
        'name' in parameter ? parameter.name : undefined,
      ),
    ).toEqual(
      expect.arrayContaining([
        'leaveTypeId',
        'from',
        'to',
        'status',
        'page',
        'pageSize',
      ]),
    );
    expect(leaveRequests.post?.responses).toHaveProperty('201');
    expect(cancel.post?.responses).toHaveProperty('200');
    expect(leaveTypes.get?.responses).toHaveProperty('200');
    for (const status of ['400', '403', '404'])
      expect(leaveTypes.get?.responses).toHaveProperty(status);
    expect(
      leaveTypes.get?.parameters?.map((parameter) =>
        'name' in parameter ? parameter.name : undefined,
      ),
    ).toEqual(expect.arrayContaining(['q', 'page', 'pageSize']));
    for (const operation of [
      timesheets.get,
      timesheets.post,
      timesheet.patch,
      submit.post,
      leaveRequests.get,
      leaveRequests.post,
      cancel.post,
    ]) {
      expect(operation?.responses).toHaveProperty('400');
      expect(operation?.responses).toHaveProperty('403');
      expect(operation?.responses).toHaveProperty('404');
    }
    for (const operation of [
      timesheets.post,
      timesheet.patch,
      submit.post,
      leaveRequests.post,
      cancel.post,
    ])
      expect(operation?.responses).toHaveProperty('409');
    expect(document.paths).not.toHaveProperty(
      '/organizations/{organizationId}/my-hr/timesheets/{timesheetId}/approve',
    );
    expect(document.paths).not.toHaveProperty(
      '/organizations/{organizationId}/my-hr/leave-requests/{requestId}/decide',
    );
  });
});
