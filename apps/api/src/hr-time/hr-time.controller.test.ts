import { ConflictException, NotFoundException } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';

import { HrTimeController } from './hr-time.controller.js';
import { HrTimeConflictError } from './hr-time-repository.js';

const id = '11111111-1111-4111-8111-111111111111';
const timesheet = {
  id,
  legalEntityId: id,
  employeeId: id,
  relationshipId: id,
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  version: 1,
  status: 'draft' as const,
  submittedAt: null,
  approvedBy: null,
  approvedAt: null,
  rejectionReason: null,
  supersedesTimesheetId: null,
  entries: [],
  totalWorkedMinutes: 0,
  totalBreakMinutes: 0,
  totalOvertimeMinutes: 0,
  totalNightMinutes: 0,
  totalHolidayMinutes: 0,
  totalStandbyMinutes: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};
const schedule = {
  id,
  legalEntityId: id,
  employeeId: id,
  relationshipId: id,
  version: 1,
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  status: 'draft' as const,
  shifts: [],
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};
function controller(repository: Record<string, unknown>) {
  const api = new HrTimeController(repository as never, {} as never);
  const scope = vi
    .spyOn(
      api as unknown as { scope: (...args: unknown[]) => Promise<unknown> },
      'scope',
    )
    .mockImplementation(async (...args: unknown[]) => ({
      capability: args[2],
      legalEntityIds: null,
      organizationId: 'org',
      role: 'owner',
      userId: 'user',
    }));
  return { api, scope };
}

describe('HR time controller', () => {
  it('marks every command as HTTP 200 rather than the POST default', () => {
    for (const command of [
      'publish',
      'submit',
      'approve',
      'reject',
      'correct',
      'decideLeave',
      'cancelLeave',
    ] as const) {
      expect(
        Reflect.getMetadata(
          HTTP_CODE_METADATA,
          HrTimeController.prototype[command],
        ),
      ).toBe(200);
    }
  });

  it('uses readHr for leave reads and manageHr for leave and absence mutations', async () => {
    const repository = {
      listLeaveTypes: vi
        .fn()
        .mockResolvedValue({ items: [], page: 1, pageSize: 25, total: 0 }),
      listLeaveRequests: vi
        .fn()
        .mockResolvedValue({ items: [], page: 1, pageSize: 25, total: 0 }),
      leaveBalances: vi.fn().mockResolvedValue({ items: [] }),
      createLeaveType: vi.fn().mockResolvedValue({
        id,
        legalEntityId: id,
        code: 'VAC',
        name: 'Vacation',
        unit: 'days',
        paid: true,
        active: true,
        createdAt: timesheet.createdAt,
        updatedAt: timesheet.updatedAt,
      }),
      createLeaveRequest: vi.fn().mockResolvedValue({
        id,
        legalEntityId: id,
        employeeId: id,
        relationshipId: id,
        leaveTypeId: id,
        startsOn: '2026-10-01',
        endsOn: '2026-10-01',
        requestedAmount: '1.00',
        status: 'requested',
        decidedBy: null,
        decidedAt: null,
        reason: null,
        createdAt: timesheet.createdAt,
        updatedAt: timesheet.updatedAt,
      }),
      leaveCommand: vi.fn().mockResolvedValue({
        id,
        legalEntityId: id,
        employeeId: id,
        relationshipId: id,
        leaveTypeId: id,
        startsOn: '2026-10-01',
        endsOn: '2026-10-01',
        requestedAmount: '1.00',
        status: 'approved',
        decidedBy: 'user',
        decidedAt: timesheet.createdAt,
        reason: null,
        createdAt: timesheet.createdAt,
        updatedAt: timesheet.updatedAt,
      }),
      listAbsences: vi
        .fn()
        .mockResolvedValue({ items: [], page: 1, pageSize: 25, total: 0 }),
    };
    const { api, scope } = controller(repository);
    await api.leaveTypes('org', { page: 1, pageSize: 25 }, {} as never);
    await api.leaveRequests('org', id, { page: 1, pageSize: 25 }, {} as never);
    await api.balances('org', id, {} as never);
    await api.absences('org', id, { page: 1, pageSize: 25 }, {} as never);
    await api.createLeaveType(
      'org',
      {
        legalEntityId: id,
        code: 'VAC',
        name: 'Vacation',
        unit: 'days',
        paid: true,
      },
      {} as never,
    );
    await api.createLeaveRequest(
      'org',
      id,
      {
        relationshipId: id,
        leaveTypeId: id,
        startsOn: '2026-10-01',
        endsOn: '2026-10-01',
        requestedAmount: '1.00',
      },
      {} as never,
    );
    await api.decideLeave('org', id, id, { decision: 'approved' }, {} as never);
    expect(scope.mock.calls.map((call: unknown[]) => call[2])).toEqual([
      'readHr',
      'readHr',
      'readHr',
      'readHr',
      'manageHr',
      'manageHr',
      'manageHr',
    ]);
  });
  it('uses readHr for strict collection responses and turns scoped misses into 404', async () => {
    const repository = {
      listSchedules: vi.fn().mockResolvedValue({
        items: [],
        page: 1,
        pageSize: 25,
        total: 0,
      }),
      listTimesheets: vi.fn().mockResolvedValue({
        items: [timesheet],
        page: 1,
        pageSize: 25,
        total: 1,
      }),
    };
    const { api, scope } = controller(repository);
    await expect(
      api.schedules('org', id, { page: 1, pageSize: 25 }, {} as never),
    ).resolves.toEqual({ items: [], page: 1, pageSize: 25, total: 0 });
    await expect(
      api.timesheets('org', id, { page: 1, pageSize: 25 }, {} as never),
    ).resolves.toMatchObject({ items: [timesheet], total: 1 });
    expect(scope.mock.calls.map((call: unknown[]) => call[2])).toEqual([
      'readHr',
      'readHr',
    ]);
    const missing = controller({
      listTimesheets: vi.fn().mockResolvedValue(null),
    });
    await expect(
      missing.api.timesheets('org', id, { page: 1, pageSize: 25 }, {} as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('uses manageHr for every mutating operation and preserves the approval actor path', async () => {
    const repository = {
      command: vi.fn().mockResolvedValue(timesheet),
      createSchedule: vi.fn().mockResolvedValue(schedule),
      createTimesheet: vi.fn().mockResolvedValue(timesheet),
      publish: vi.fn().mockResolvedValue(schedule),
      updateTimesheet: vi.fn().mockResolvedValue(timesheet),
    };
    const { api, scope } = controller(repository);
    const scheduleBody = {
      relationshipId: id,
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      shifts: [],
    };
    const sheet = {
      relationshipId: id,
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      entries: [],
    };
    await api.createSchedule('org', id, scheduleBody as never, {} as never);
    await api.publish('org', id, id, {}, {} as never);
    await api.createTimesheet('org', id, sheet as never, {} as never);
    await api.patch('org', id, id, { entries: [] } as never, {} as never);
    await api.submit('org', id, id, {}, {} as never);
    await api.approve('org', id, id, {}, {} as never);
    await api.reject('org', id, id, { reason: 'Reason' }, {} as never);
    await api.correct('org', id, id, { reason: 'Reason' }, {} as never);
    expect(scope.mock.calls.map((call: unknown[]) => call[2])).toEqual(
      Array(8).fill('manageHr'),
    );
    expect(
      repository.command.mock.calls.map((call) => call[0].command),
    ).toEqual(['submit', 'approve', 'reject', 'correct']);
  });

  it('maps domain conflicts, but not unrelated errors', async () => {
    const conflict = controller({
      createTimesheet: vi.fn().mockRejectedValue(new HrTimeConflictError()),
    });
    await expect(
      conflict.api.createTimesheet('org', id, {} as never, {} as never),
    ).rejects.toBeInstanceOf(ConflictException);
    const failure = new Error('database unavailable');
    const unexpected = controller({
      createTimesheet: vi.fn().mockRejectedValue(failure),
    });
    await expect(
      unexpected.api.createTimesheet('org', id, {} as never, {} as never),
    ).rejects.toBe(failure);
  });
});
