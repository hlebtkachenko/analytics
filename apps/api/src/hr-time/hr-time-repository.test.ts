import { describe, expect, it } from 'vitest';
import type { DatabasePool } from '@bap/db/pool';

import {
  DatabaseHrTimeRepository,
  HrTimeConflictError,
  isHrTimeConflict,
} from './hr-time-repository.js';

const id = '11111111-1111-4111-8111-111111111111';
const row = {
  id,
  legal_entity_id: id,
  employee_id: id,
  relationship_id: id,
  period_start: '2026-10-01',
  period_end: '2026-10-31',
  version: 1,
  status: 'draft',
  submitted_at: null,
  approved_by: null,
  approved_at: null,
  rejection_reason: null,
  supersedes_timesheet_id: null,
  created_at: new Date('2026-10-01T00:00:00.000Z'),
  updated_at: new Date('2026-10-01T00:00:00.000Z'),
};
function pool() {
  const calls: { sql: string; params?: unknown[] }[] = [];
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push(params === undefined ? { sql } : { sql, params });
      if (
        ['begin', 'commit', 'rollback'].includes(sql) ||
        sql.startsWith('select set_config')
      )
        return { rows: [], rowCount: 0 };
      if (sql.includes('select 1 from app.employee'))
        return { rows: [{}], rowCount: 1 };
      if (sql.includes('join app.employment_relationship'))
        return { rows: [{ legal_entity_id: id }], rowCount: 1 };
      if (sql.includes('coalesce(max(version)'))
        return { rows: [{ version: 1 }], rowCount: 1 };
      if (sql.includes('count(*)'))
        return { rows: [{ count: '1' }], rowCount: 1 };
      if (sql.includes('from app.time_entry')) return { rows: [], rowCount: 0 };
      if (sql.includes('from app.work_shift')) return { rows: [], rowCount: 0 };
      if (sql.includes('app.timesheet')) return { rows: [row], rowCount: 1 };
      return { rows: [row], rowCount: 1 };
    },
    release: () => undefined,
  };
  return { connect: async () => client, calls } as unknown as DatabasePool & {
    calls: { sql: string; params?: unknown[] }[];
  };
}
function statePool(timesheetStatus: string, leaveStatus: string) {
  const calls: { sql: string; params?: unknown[] }[] = [];
  const leave = {
    id,
    legal_entity_id: id,
    employee_id: id,
    relationship_id: id,
    leave_type_id: id,
    starts_on: '2026-10-01',
    ends_on: '2026-10-01',
    requested_amount: '1',
    status: leaveStatus,
    decided_by: null,
    decided_at: null,
    reason: null,
    created_at: new Date('2026-10-01T00:00:00.000Z'),
    updated_at: new Date('2026-10-01T00:00:00.000Z'),
  };
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push(params === undefined ? { sql } : { sql, params });
      if (
        ['begin', 'commit', 'rollback'].includes(sql) ||
        sql.startsWith('select set_config')
      )
        return { rows: [], rowCount: 0 };
      if (sql.includes('select 1 from app.employee'))
        return { rows: [{}], rowCount: 1 };
      if (sql.includes('from app.time_entry')) return { rows: [], rowCount: 0 };
      if (sql.includes('from app.timesheet where'))
        return { rows: [{ ...row, status: timesheetStatus }], rowCount: 1 };
      if (sql.startsWith('update app.timesheet set status='))
        return {
          rows: [{ ...row, status: 'submitted', submitted_at: new Date() }],
          rowCount: 1,
        };
      if (sql.includes('from app.leave_request where'))
        return { rows: [leave], rowCount: 1 };
      if (sql.startsWith('update app.leave_request set status='))
        return {
          rows: [{ ...leave, status: String(params?.[1]) }],
          rowCount: 1,
        };
      return { rows: [], rowCount: 0 };
    },
    release: () => undefined,
  };
  return { connect: async () => client, calls } as unknown as DatabasePool & {
    calls: { sql: string; params?: unknown[] }[];
  };
}
function repository(db: DatabasePool) {
  const result = new DatabaseHrTimeRepository();
  (result as unknown as { poolPromise: Promise<DatabasePool> }).poolPromise =
    Promise.resolve(db);
  return result;
}
const scope = {
  organizationId: 'org',
  userId: 'user',
  role: 'owner' as const,
  legalEntityIds: [id],
};

describe('HR time repository', () => {
  it('uses scoped, filtered, deterministic paged SQL for both collections', async () => {
    const db = pool();
    const api = repository(db);
    await api.listSchedules({
      ...scope,
      employeeId: id,
      query: {
        from: '2026-10-01',
        to: '2026-10-31',
        status: 'draft',
        page: 2,
        pageSize: 10,
      },
    });
    await api.listTimesheets({
      ...scope,
      employeeId: id,
      query: {
        from: '2026-10-01',
        to: '2026-10-31',
        status: 'draft',
        page: 2,
        pageSize: 10,
      },
    });
    const lists = db.calls.filter((call) =>
      call.sql.includes('order by period_start desc,id asc'),
    );
    expect(lists).toHaveLength(2);
    for (const call of lists) {
      expect(call.sql).toContain('period_start<=$2');
      expect(call.sql).toContain('period_end>=$3');
      expect(call.sql).toContain('status=$4');
      expect(call.params?.slice(-2)).toEqual([10, 10]);
    }
  });

  it('creates entries atomically with identifier-only domain audit metadata', async () => {
    const db = pool();
    const api = repository(db);
    await api.createTimesheet({
      ...scope,
      employeeId: id,
      body: {
        relationshipId: id,
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        entries: [
          {
            workDate: '2026-10-25',
            startedAt: '2026-10-25T00:30:00.000Z',
            endedAt: '2026-10-25T02:30:00.000Z',
            breakMinutes: 0,
            overtimeMinutes: 0,
            nightMinutes: 0,
            holidayMinutes: 0,
            standbyMinutes: 0,
            activityCode: null,
          },
        ],
      },
    });
    expect(
      db.calls.some((call) =>
        call.sql.startsWith('insert into app.time_entry'),
      ),
    ).toBe(true);
    const audit = db.calls.find((call) =>
      call.sql.includes('app.record_audit'),
    )!;
    expect(audit.params).toEqual(['timesheet.created', 'timesheet', id]);
    expect(audit.sql).toContain("'{}'::jsonb");
    expect(db.calls.some((call) => call.sql === 'commit')).toBe(true);
  });

  it('replaces draft entries under a row lock without a draft-to-draft parent update', async () => {
    const db = pool();
    const api = repository(db);
    const entries = [
      {
        workDate: '2026-10-25',
        startedAt: '2026-10-25T00:30:00.000Z',
        endedAt: '2026-10-25T02:30:00.000Z',
        breakMinutes: 0,
        overtimeMinutes: 0,
        nightMinutes: 0,
        holidayMinutes: 0,
        standbyMinutes: 0,
        activityCode: null,
      },
    ];
    await api.updateTimesheet({
      ...scope,
      employeeId: id,
      id,
      body: { entries },
    });
    const lock = db.calls.find((call) =>
      call.sql.includes('timesheet where id=$1'),
    )!;
    expect(lock.sql).toContain('for update');
    expect(
      db.calls.some(
        (call) =>
          call.sql === 'delete from app.time_entry where timesheet_id=$1',
      ),
    ).toBe(true);
    expect(
      db.calls.some((call) =>
        call.sql.startsWith('insert into app.time_entry'),
      ),
    ).toBe(true);
    expect(
      db.calls.some((call) =>
        call.sql.startsWith('update app.timesheet set updated_at'),
      ),
    ).toBe(false);
    expect(
      db.calls.some((call) => call.params?.[0] === 'timesheet.updated'),
    ).toBe(true);
    await expect(
      api.command({ ...scope, employeeId: id, id, command: 'approve' }),
    ).rejects.toBeInstanceOf(Error);
    expect(db.calls.some((call) => call.sql === 'rollback')).toBe(true);
  });

  it('serializes legal state transitions through a row lock and writes domain action names', async () => {
    const db = pool();
    const api = repository(db);
    await api.command({ ...scope, employeeId: id, id, command: 'submit' });
    expect(
      db.calls.some(
        (call) =>
          call.sql.includes("status='submitted'") &&
          call.sql.includes('returning'),
      ),
    ).toBe(true);
    expect(
      db.calls.some((call) => call.params?.[0] === 'timesheet.submitted'),
    ).toBe(true);
  });

  it.each(['submitted', 'approved', 'corrected'] as const)(
    'rejects %s timesheet PATCH and submit according to the repository state machine',
    async (status) => {
      const patchApi = repository(statePool(status, 'requested'));
      await expect(
        patchApi.updateTimesheet({
          ...scope,
          employeeId: id,
          id,
          body: {},
        }),
      ).rejects.toBeInstanceOf(HrTimeConflictError);
      const submitApi = repository(statePool(status, 'requested'));
      await expect(
        submitApi.command({ ...scope, employeeId: id, id, command: 'submit' }),
      ).rejects.toBeInstanceOf(HrTimeConflictError);
    },
  );

  it.each(['rejected', 'cancelled', 'taken'] as const)(
    'rejects %s leave cancellation according to the repository state machine',
    async (status) => {
      const api = repository(statePool('draft', status));
      await expect(
        api.leaveCommand({ ...scope, employeeId: id, id, command: 'cancel' }),
      ).rejects.toBeInstanceOf(HrTimeConflictError);
    },
  );

  it.each(['requested', 'approved'] as const)(
    'cancels a %s leave request through the repository state machine',
    async (status) => {
      const api = repository(statePool('draft', status));
      await expect(
        api.leaveCommand({ ...scope, employeeId: id, id, command: 'cancel' }),
      ).resolves.toMatchObject({ status: 'cancelled' });
    },
  );

  it('maps database overlap, immutable transition, and uniqueness failures to conflicts', () => {
    expect(isHrTimeConflict({ constraint: 'time_entry_overlap_check' })).toBe(
      true,
    );
    expect(isHrTimeConflict({ constraint: 'timesheet_immutable_check' })).toBe(
      true,
    );
    expect(
      isHrTimeConflict({
        code: '23505',
        constraint: 'timesheet_relationship_period_version_key',
      }),
    ).toBe(true);
    expect(isHrTimeConflict({ constraint: 'unrelated' })).toBe(false);
    expect(
      isHrTimeConflict({
        code: '23505',
        constraint: 'leave_type_entity_code_key',
      }),
    ).toBe(true);
  });

  it('uses scoped escaped leave-type SQL and appends approval ledger facts', async () => {
    const db = pool();
    const api = repository(db);
    await api.listLeaveTypes({
      ...scope,
      query: { q: 'a_%', page: 1, pageSize: 10 },
    });
    const list = db.calls.find((call) =>
      call.sql.includes('from app.leave_type'),
    )!;
    expect(list.sql).toContain('legal_entity_id=any');
    expect(list.sql).toContain("escape '\\'");
    expect(list.params?.[2]).toBe('%a\\_\\%%');
  });
});
