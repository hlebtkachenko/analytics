import {
  bootstrapDatabaseRoles,
  createDatabasePool,
  runMigrations,
  withTenantContext,
} from '@bap/db';
import type { TenantContext } from '@bap/db';
import type { DatabaseConfiguration, DatabaseRole } from '@bap/db/config';
import type { DatabasePool } from '@bap/db/pool';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEmployee, createRelationship } from '../hr/hr-repository.js';
import {
  DatabaseHrTimeRepository,
  HrTimeConflictError,
} from './hr-time-repository.js';

const postgresImage =
  'pgvector/pgvector:pg18@sha256:2ba9ca5f2e7daa0f0e7723cba1ee9167bab54efd3640516a44ac1a928dd67e7a';
const password = 'test-only-database-credential';
const owner: TenantContext = {
  organizationId: 'org-1',
  role: 'owner',
  userId: 'user-1',
};
const otherTenant: TenantContext = {
  organizationId: 'org-2',
  role: 'owner',
  userId: 'user-2',
};
const allEntities = { legalEntityIds: null };
let container: StartedPostgreSqlContainer;
let apiPool: DatabasePool;
let migratorPool: DatabasePool;
let repository: DatabaseHrTimeRepository;
let entityId = '';
let secondEntityId = '';
let employeeId = '';
let relationshipId = '';

function configurationFor(role: DatabaseRole): DatabaseConfiguration {
  return {
    database: container.getDatabase(),
    host: container.getHost(),
    password,
    port: container.getPort(),
    role,
    ssl: false,
    user: role,
  };
}
async function asTenant<T>(
  tenant: TenantContext,
  operation: (tx: PoolClient) => Promise<T>,
) {
  const client = await apiPool.connect();
  try {
    return await withTenantContext(client, tenant, operation);
  } finally {
    client.release();
  }
}
async function seed(
  tenant: TenantContext,
  legalEntityId: string,
  suffix: string,
) {
  const employee = await createEmployee(apiPool, {
    ...tenant,
    ...allEntities,
    body: {
      legalEntityId,
      employeeNumber: `EMP-${suffix}`,
      firstName: 'Test',
      lastName: suffix,
      workEmail: null,
      workPhone: null,
    },
  });
  if (!employee) throw new Error('Employee seed failed.');
  const relationship = await createRelationship(apiPool, {
    ...tenant,
    ...allEntities,
    employeeId: employee.id,
    body: {
      kind: 'employment',
      position: 'Tester',
      department: null,
      costCentre: null,
      weeklyHours: '40',
      startDate: '2026-01-01',
      endDate: null,
    },
  });
  if (!relationship) throw new Error('Relationship seed failed.');
  return { employeeId: employee.id, relationshipId: relationship.id };
}
function input(periodStart = '2026-10-25') {
  return {
    relationshipId,
    periodStart,
    periodEnd: periodStart,
    entries: [
      {
        workDate: periodStart,
        startedAt: `${periodStart}T00:30:00.000Z`,
        endedAt: `${periodStart}T02:30:00.000Z`,
        breakMinutes: 15,
        overtimeMinutes: 30,
        nightMinutes: 60,
        holidayMinutes: 0,
        standbyMinutes: 0,
        activityCode: 'regular',
      },
    ],
  };
}
function scope(tenant = owner) {
  return { ...tenant, ...allEntities, employeeId };
}
async function query<T extends Record<string, unknown>>(
  sql: string,
  values: unknown[] = [],
) {
  return asTenant(owner, async (tx) => (await tx.query<T>(sql, values)).rows);
}

beforeAll(async () => {
  container = await new PostgreSqlContainer(postgresImage)
    .withDatabase('bap')
    .withUsername('postgres')
    .withPassword(password)
    .start();
  const rootPool = createDatabasePool(configurationFor('postgres'));
  const root = await rootPool.connect();
  try {
    await bootstrapDatabaseRoles(root, {
      bap_api: password,
      bap_auth: password,
      bap_backup: password,
      bap_migrator: password,
      bap_reporting: password,
    });
  } finally {
    root.release();
  }
  migratorPool = createDatabasePool(configurationFor('bap_migrator'));
  await runMigrations(migratorPool);
  const migration = await migratorPool.connect();
  try {
    await migration.query('begin');
    await migration.query('set local role bap_owner');
    await migration.query(
      "insert into auth.\"user\" (id,name,email,email_verified) values ('user-1','One','one@example.test',true),('user-2','Two','two@example.test',true)",
    );
    await migration.query(
      "insert into auth.organization (id,name,slug) values ('org-1','One','one'),('org-2','Two','two')",
    );
    await migration.query(
      "insert into auth.member (id,organization_id,user_id,role) values ('member-1','org-1','user-1','owner'),('member-2','org-2','user-2','owner')",
    );
    await migration.query('commit');
  } finally {
    migration.release();
  }
  await rootPool.end();
  apiPool = createDatabasePool(configurationFor('bap_api'));
  entityId = await asTenant(
    owner,
    async (tx) =>
      (
        await tx.query<{ id: string }>(
          "insert into app.legal_entity (organization_id,name,kind,created_by) values ('org-1','One','company','user-1') returning id",
        )
      ).rows[0]!.id,
  );
  secondEntityId = await asTenant(
    owner,
    async (tx) =>
      (
        await tx.query<{ id: string }>(
          "insert into app.legal_entity (organization_id,name,kind,created_by) values ('org-1','Two','company','user-1') returning id",
        )
      ).rows[0]!.id,
  );
  ({ employeeId, relationshipId } = await seed(owner, entityId, 'ONE'));
  repository = new DatabaseHrTimeRepository();
  (
    repository as unknown as { poolPromise: Promise<DatabasePool> }
  ).poolPromise = Promise.resolve(apiPool);
});
afterAll(async () => {
  await Promise.all([apiPool.end(), migratorPool.end()]);
  await container.stop();
});

describe('HR time repository with bap_api PostgreSQL', () => {
  it('records leave decisions as append-only exact balance facts', async () => {
    const type = await repository.createLeaveType({
      ...owner,
      ...allEntities,
      body: {
        legalEntityId: entityId,
        code: `VAC-${Date.now()}`,
        name: 'Vacation',
        unit: 'days',
        paid: true,
      },
    });
    const request = await repository.createLeaveRequest({
      ...scope(),
      body: {
        relationshipId,
        leaveTypeId: type!.id,
        startsOn: '2026-12-01',
        endsOn: '2026-12-01',
        requestedAmount: '1.00',
      },
    });
    const approved = await repository.leaveCommand({
      ...scope(),
      id: request!.id,
      command: 'decide',
      decision: 'approved',
    });
    expect(approved!.status).toBe('approved');
    const cancelled = await repository.leaveCommand({
      ...scope(),
      id: request!.id,
      command: 'cancel',
    });
    expect(cancelled!.status).toBe('cancelled');
    const ledger = await query<{
      amount: string;
      source: string;
      source_id: string;
    }>(
      'select amount::text,source,source_id from app.leave_ledger where source_id=$1 order by created_at',
      [request!.id],
    );
    expect(ledger).toEqual([
      { amount: '-1.00', source: 'request', source_id: request!.id },
      { amount: '1.00', source: 'request', source_id: request!.id },
    ]);
    expect(
      (await repository.leaveBalances({ ...scope() }))!.items,
    ).toContainEqual({ leaveTypeId: type!.id, unit: 'days', balance: '0.00' });
  });
  it('enforces leave boundaries, transitions, and append-only ledger permissions', async () => {
    const code = `SICK-${Date.now()}`;
    const type = await repository.createLeaveType({
      ...owner,
      ...allEntities,
      body: {
        legalEntityId: entityId,
        code,
        name: 'Sickness',
        unit: 'days',
        paid: true,
      },
    });
    await expect(
      repository.createLeaveType({
        ...owner,
        ...allEntities,
        body: {
          legalEntityId: entityId,
          code,
          name: 'Duplicate',
          unit: 'days',
          paid: true,
        },
      }),
    ).rejects.toMatchObject({ constraint: 'leave_type_entity_code_key' });
    const opening = await repository.createLeaveLedger({
      ...scope(),
      body: {
        leaveTypeId: type!.id,
        relationshipId,
        effectiveOn: '2026-01-01',
        amount: '10.00',
        source: 'opening',
        reason: 'opening',
      },
    });
    await repository.createLeaveLedger({
      ...scope(),
      body: {
        leaveTypeId: type!.id,
        relationshipId,
        effectiveOn: '2026-01-02',
        amount: '-2.00',
        source: 'correction',
        reason: 'correction',
      },
    });
    expect(
      (await repository.leaveBalances({ ...scope() }))!.items,
    ).toContainEqual({ leaveTypeId: type!.id, unit: 'days', balance: '8.00' });
    const rejected = await repository.createLeaveRequest({
      ...scope(),
      body: {
        relationshipId,
        leaveTypeId: type!.id,
        startsOn: '2026-12-02',
        endsOn: '2026-12-02',
        requestedAmount: '1.00',
      },
    });
    await repository.leaveCommand({
      ...scope(),
      id: rejected!.id,
      command: 'decide',
      decision: 'rejected',
      reason: 'no',
    });
    const cancelled = await repository.createLeaveRequest({
      ...scope(),
      body: {
        relationshipId,
        leaveTypeId: type!.id,
        startsOn: '2026-12-03',
        endsOn: '2026-12-03',
        requestedAmount: '1.00',
      },
    });
    await repository.leaveCommand({
      ...scope(),
      id: cancelled!.id,
      command: 'cancel',
    });
    expect(
      await query<{ count: string }>(
        'select count(*)::text count from app.leave_ledger where source_id=any($1::uuid[])',
        [[rejected!.id, cancelled!.id]],
      ),
    ).toEqual([{ count: '0' }]);
    await expect(
      query('update app.leave_ledger set amount=2 where id=$1', [
        (opening as { id: string }).id,
      ]),
    ).rejects.toThrow();
    await expect(
      query('delete from app.leave_ledger where id=$1', [
        (opening as { id: string }).id,
      ]),
    ).rejects.toThrow();
    const audit = await query<{ metadata: unknown }>(
      'select metadata from app.audit_log where resource_id=$1',
      [type!.id],
    );
    expect(audit).toContainEqual({ metadata: {} });
  });
  it('stores absence classifications only and keeps open-ended absences visible', async () => {
    const absence = await repository.createAbsence({
      ...scope(),
      body: {
        relationshipId,
        kind: 'sickness',
        startsOn: '2026-12-10',
        endsOn: null,
        payrollCode: 'SICK',
        documentId: null,
      },
    });
    expect(absence).toMatchObject({
      kind: 'sickness',
      startsOn: '2026-12-10',
      endsOn: null,
      payrollCode: 'SICK',
      documentId: null,
    });
    expect(Object.keys(absence!)).not.toContain('diagnosis');
    const listed = await repository.listAbsences({
      ...scope(),
      query: { from: '2027-01-01', to: '2027-01-02', page: 1, pageSize: 25 },
    });
    expect(listed!.items.map((x) => x.id)).toContain(absence!.id);
    const patched = await repository.updateAbsence({
      ...scope(),
      id: absence!.id,
      body: { payrollCode: 'SICK-UPDATED' },
    });
    expect(patched!.payrollCode).toBe('SICK-UPDATED');
  });
  it('serializes concurrent leave approvals and cancellations into one ledger fact each', async () => {
    const type = await repository.createLeaveType({
      ...owner,
      ...allEntities,
      body: {
        legalEntityId: entityId,
        code: `CON-${Date.now()}`,
        name: 'Concurrent',
        unit: 'days',
        paid: true,
      },
    });
    const request = await repository.createLeaveRequest({
      ...scope(),
      body: {
        relationshipId,
        leaveTypeId: type!.id,
        startsOn: '2026-12-20',
        endsOn: '2026-12-20',
        requestedAmount: '1.00',
      },
    });
    const approved = await Promise.allSettled([
      repository.leaveCommand({
        ...scope(),
        id: request!.id,
        command: 'decide',
        decision: 'approved',
      }),
      repository.leaveCommand({
        ...scope(),
        id: request!.id,
        command: 'decide',
        decision: 'approved',
      }),
    ]);
    expect(approved.map((x) => x.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(
      await query<{ count: string }>(
        'select count(*)::text count from app.leave_ledger where source_id=$1 and amount=-1',
        [request!.id],
      ),
    ).toEqual([{ count: '1' }]);
    const cancelled = await Promise.allSettled([
      repository.leaveCommand({
        ...scope(),
        id: request!.id,
        command: 'cancel',
      }),
      repository.leaveCommand({
        ...scope(),
        id: request!.id,
        command: 'cancel',
      }),
    ]);
    expect(cancelled.map((x) => x.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(
      await query<{ count: string }>(
        'select count(*)::text count from app.leave_ledger where source_id=$1 and amount=1',
        [request!.id],
      ),
    ).toEqual([{ count: '1' }]);
  });
  it('rolls back leave mutation when its audit write is denied', async () => {
    const type = await repository.createLeaveType({
      ...owner,
      ...allEntities,
      body: {
        legalEntityId: entityId,
        code: `AUD-${Date.now()}`,
        name: 'Audit',
        unit: 'days',
        paid: true,
      },
    });
    const client = await migratorPool.connect();
    try {
      await client.query('begin');
      await client.query('set local role bap_owner');
      await client.query(
        'revoke execute on function app.record_audit(text,text,text,jsonb) from bap_api',
      );
      await client.query('commit');
      await expect(
        repository.createLeaveRequest({
          ...scope(),
          body: {
            relationshipId,
            leaveTypeId: type!.id,
            startsOn: '2026-12-21',
            endsOn: '2026-12-21',
            requestedAmount: '1.00',
          },
        }),
      ).rejects.toThrow();
      expect(
        await query<{ count: string }>(
          'select count(*)::text count from app.leave_request where leave_type_id=$1',
          [type!.id],
        ),
      ).toEqual([{ count: '0' }]);
    } finally {
      await client.query('begin');
      await client.query('set local role bap_owner');
      await client.query(
        'grant execute on function app.record_audit(text,text,text,jsonb) to bap_api',
      );
      await client.query('commit');
      client.release();
    }
  });
  it('pages ordered leave requests and hides them outside entity and tenant scope', async () => {
    const type = await repository.createLeaveType({
      ...owner,
      ...allEntities,
      body: {
        legalEntityId: entityId,
        code: `FLT-${Date.now()}`,
        name: 'Filter',
        unit: 'days',
        paid: true,
      },
    });
    await repository.createLeaveRequest({
      ...scope(),
      body: {
        relationshipId,
        leaveTypeId: type!.id,
        startsOn: '2026-12-22',
        endsOn: '2026-12-22',
        requestedAmount: '1.00',
      },
    });
    const second = await repository.createLeaveRequest({
      ...scope(),
      body: {
        relationshipId,
        leaveTypeId: type!.id,
        startsOn: '2026-12-21',
        endsOn: '2026-12-21',
        requestedAmount: '1.00',
      },
    });
    const listed = await repository.listLeaveRequests({
      ...scope(),
      query: {
        leaveTypeId: type!.id,
        from: '2026-12-21',
        to: '2026-12-22',
        status: 'requested',
        page: 1,
        pageSize: 1,
      },
    });
    expect(listed).toMatchObject({
      total: 2,
      items: [{ startsOn: '2026-12-22', status: 'requested' }],
    });
    const pageTwo = await repository.listLeaveRequests({
      ...scope(),
      query: {
        leaveTypeId: type!.id,
        from: '2026-12-21',
        to: '2026-12-22',
        status: 'requested',
        page: 2,
        pageSize: 1,
      },
    });
    expect(pageTwo).toMatchObject({
      total: 2,
      items: [{ startsOn: '2026-12-21', id: second!.id }],
    });
    expect(
      await repository.listLeaveRequests({
        ...scope(),
        legalEntityIds: [secondEntityId],
        query: { page: 1, pageSize: 25 },
      }),
    ).toBeNull();
    expect(
      await repository.listLeaveRequests({
        ...scope(otherTenant),
        query: { page: 1, pageSize: 25 },
      }),
    ).toBeNull();
  });
  it('rejects an absence document from another legal entity without inserting the absence', async () => {
    const document = await asTenant(
      owner,
      async (tx) =>
        (
          await tx.query<{ id: string }>(
            "insert into app.document (organization_id,legal_entity_id,kind,title,document_date,created_by) values ('org-1',$1,'receipt','Other entity','2026-12-01','user-1') returning id",
            [secondEntityId],
          )
        ).rows[0]!.id,
    );
    await expect(
      repository.createAbsence({
        ...scope(),
        body: {
          relationshipId,
          kind: 'sickness',
          startsOn: '2026-12-23',
          endsOn: null,
          payrollCode: 'SICK',
          documentId: document,
        },
      }),
    ).rejects.toMatchObject({ constraint: 'absence_entity_pinning_check' });
    expect(
      await query<{ count: string }>(
        "select count(*)::text count from app.absence where starts_on='2026-12-23'",
        [],
      ),
    ).toEqual([{ count: '0' }]);
  });
  it('versions and publishes schedules, with deterministic scoped paging', async () => {
    const first = await repository.createSchedule({
      ...scope(),
      body: {
        relationshipId,
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        shifts: [
          {
            startsAt: '2026-10-01T06:00:00.000Z',
            endsAt: '2026-10-01T14:00:00.000Z',
            breakMinutes: 30,
            kind: 'regular',
          },
        ],
      },
    });
    const published = await repository.publish({ ...scope(), id: first!.id });
    const next = await repository.createSchedule({
      ...scope(),
      body: {
        relationshipId,
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        shifts: [
          {
            startsAt: '2026-10-02T06:00:00.000Z',
            endsAt: '2026-10-02T14:00:00.000Z',
            breakMinutes: 30,
            kind: 'regular',
          },
        ],
      },
    });
    await repository.publish({ ...scope(), id: next!.id });
    expect([published!.status, next!.version]).toEqual(['published', 2]);
    const listed = await repository.listSchedules({
      ...scope(),
      query: {
        from: '2026-10-01',
        to: '2026-10-31',
        status: 'published',
        page: 1,
        pageSize: 1,
      },
    });
    expect([listed!.total, listed!.items[0]!.id]).toEqual([1, next!.id]);
    const concurrent = await Promise.allSettled([
      repository.createSchedule({
        ...scope(),
        body: {
          relationshipId,
          periodStart: '2026-11-01',
          periodEnd: '2026-11-01',
          shifts: [
            {
              startsAt: '2026-11-01T06:00:00.000Z',
              endsAt: '2026-11-01T14:00:00.000Z',
              breakMinutes: 0,
              kind: 'regular',
            },
          ],
        },
      }),
      repository.createSchedule({
        ...scope(),
        body: {
          relationshipId,
          periodStart: '2026-11-01',
          periodEnd: '2026-11-01',
          shifts: [
            {
              startsAt: '2026-11-01T06:00:00.000Z',
              endsAt: '2026-11-01T14:00:00.000Z',
              breakMinutes: 0,
              kind: 'regular',
            },
          ],
        },
      }),
    ]);
    expect(concurrent.map((result) => result.status)).toEqual([
      'fulfilled',
      'fulfilled',
    ]);
    expect(
      concurrent
        .map((result) =>
          result.status === 'fulfilled' ? result.value!.version : 0,
        )
        .sort((a, b) => a - b),
    ).toEqual([1, 2]);
  });

  it('stores Prague DST instants, derives exact totals, and replaces draft entries legally', async () => {
    const created = await repository.createTimesheet({
      ...scope(),
      body: input(),
    });
    expect(created).toMatchObject({
      totalWorkedMinutes: 105,
      totalBreakMinutes: 15,
      totalOvertimeMinutes: 30,
      totalNightMinutes: 60,
    });
    expect(created!.entries[0]!.startedAt).toBe('2026-10-25T00:30:00.000Z');
    const patched = await repository.updateTimesheet({
      ...scope(),
      id: created!.id,
      body: {
        entries: [
          {
            ...input().entries[0]!,
            startedAt: '2026-10-25T03:30:00.000Z',
            endedAt: '2026-10-25T05:00:00.000Z',
            breakMinutes: 0,
            overtimeMinutes: 0,
            nightMinutes: 0,
            activityCode: null,
          },
        ],
      },
    });
    expect([
      patched!.status,
      patched!.entries.length,
      patched!.totalWorkedMinutes,
    ]).toEqual(['draft', 1, 90]);
    expect(
      await query<{ action: string; metadata: unknown }>(
        'select action,metadata from app.audit_log where resource_id=$1 order by created_at',
        [created!.id],
      ),
    ).toContainEqual({ action: 'timesheet.updated', metadata: {} });
  });

  it('rolls back overlap and rejects every illegal representative state command', async () => {
    const bad = input('2026-10-26');
    bad.entries.push({
      ...bad.entries[0]!,
      startedAt: '2026-10-26T01:30:00.000Z',
      endedAt: '2026-10-26T03:30:00.000Z',
    });
    await expect(
      repository.createTimesheet({ ...scope(), body: bad }),
    ).rejects.toMatchObject({ constraint: 'time_entry_overlap_check' });
    expect(
      (await repository.listTimesheets({
        ...scope(),
        query: { page: 1, pageSize: 100 },
      }))!.items.some((x) => x.periodStart === '2026-10-26'),
    ).toBe(false);
    const draft = await repository.createTimesheet({
      ...scope(),
      body: input('2026-10-27'),
    });
    for (const command of ['approve', 'reject', 'correct'] as const)
      await expect(
        repository.command({
          ...scope(),
          id: draft!.id,
          command,
          ...(command === 'reject' ? { reason: 'no' } : {}),
        }),
      ).rejects.toBeInstanceOf(HrTimeConflictError);
  });

  it('enforces the state machine, immutable approval, correction copying, and one concurrent successor', async () => {
    const sheet = await repository.createTimesheet({
      ...scope(),
      body: input('2026-10-28'),
    });
    await repository.command({ ...scope(), id: sheet!.id, command: 'submit' });
    const rejected = await repository.command({
      ...scope(),
      id: sheet!.id,
      command: 'reject',
      reason: 'missing code',
    });
    expect([rejected!.status, rejected!.rejectionReason]).toEqual([
      'draft',
      'missing code',
    ]);
    await repository.updateTimesheet({
      ...scope(),
      id: sheet!.id,
      body: { entries: input('2026-10-28').entries },
    });
    await repository.command({ ...scope(), id: sheet!.id, command: 'submit' });
    const approved = await repository.command({
      ...scope(),
      id: sheet!.id,
      command: 'approve',
    });
    expect(approved!.approvedBy).toBe(owner.userId);
    await expect(
      repository.updateTimesheet({
        ...scope(),
        id: sheet!.id,
        body: { entries: input('2026-10-28').entries },
      }),
    ).rejects.toBeInstanceOf(HrTimeConflictError);
    const corrected = await repository.command({
      ...scope(),
      id: sheet!.id,
      command: 'correct',
      reason: 'correction',
    });
    expect(corrected!.status).toBe('draft');
    const successor = await query<{
      id: string;
      version: number;
      status: string;
      supersedes_timesheet_id: string;
      entries: string;
    }>(
      'select t.id,t.version,t.status,t.supersedes_timesheet_id,count(e.id)::text entries from app.timesheet t left join app.time_entry e on e.timesheet_id=t.id where t.supersedes_timesheet_id=$1 group by t.id',
      [sheet!.id],
    );
    expect(successor).toHaveLength(1);
    expect(successor[0]).toMatchObject({
      version: 2,
      status: 'draft',
      supersedes_timesheet_id: sheet!.id,
      entries: '1',
    });
  });

  it('keeps date-only filtering exact and hides cross-entity and cross-tenant records', async () => {
    await repository.createTimesheet({
      ...scope(),
      body: input('2026-11-15'),
    });
    const listed = await repository.listTimesheets({
      ...scope(),
      query: {
        from: '2026-11-15',
        to: '2026-11-15',
        status: 'draft',
        page: 1,
        pageSize: 25,
      },
    });
    expect(listed).toMatchObject({
      total: 1,
      items: [{ periodStart: '2026-11-15', status: 'draft' }],
    });
    expect(
      await repository.listTimesheets({
        ...scope(),
        employeeId,
        legalEntityIds: [secondEntityId],
        query: { page: 1, pageSize: 25 },
      }),
    ).toBeNull();
    expect(
      await repository.listSchedules({
        ...scope(),
        legalEntityIds: [secondEntityId],
        query: { page: 1, pageSize: 25 },
      }),
    ).toBeNull();
    expect(
      await repository.listTimesheets({
        ...scope(otherTenant),
        query: { page: 1, pageSize: 25 },
      }),
    ).toBeNull();
  });

  it('rolls back a write when its identifier-only audit cannot be recorded', async () => {
    const client = await migratorPool.connect();
    try {
      await client.query('begin');
      await client.query('set local role bap_owner');
      await client.query(
        'revoke execute on function app.record_audit(text,text,text,jsonb) from bap_api',
      );
      await client.query('commit');
    } finally {
      client.release();
    }
    await expect(
      repository.createTimesheet({ ...scope(), body: input('2026-10-30') }),
    ).rejects.toThrow();
    expect(
      (await repository.listTimesheets({
        ...scope(),
        query: { page: 1, pageSize: 100 },
      }))!.items.some((sheet) => sheet.periodStart === '2026-10-30'),
    ).toBe(false);
  });
});
