import type { DatabasePool } from '@bap/db/pool';
import { describe, expect, it } from 'vitest';

import {
  DatabaseHrSelfServiceRepository,
  EmployeeUserBindingConflictError,
  EmployeeUserBindingNotFoundError,
} from './hr-self-service-repository.js';

const bindingId = '11111111-1111-4111-8111-111111111111';
const employeeId = '22222222-2222-4222-8222-222222222222';
const entityId = '33333333-3333-4333-8333-333333333333';
const scope = {
  organizationId: 'org',
  role: 'owner' as const,
  userId: 'bound_user',
};
const row = {
  id: bindingId,
  legal_entity_id: entityId,
  employee_id: employeeId,
  user_id: 'bound_user',
  status: 'active' as const,
  verified_at: new Date(0),
  created_at: new Date(0),
  updated_at: new Date(0),
};

function repository(
  handler: (
    sql: string,
    params?: unknown[],
  ) => { rowCount?: number; rows: unknown[] },
) {
  const calls: Array<{ params?: unknown[]; sql: string }> = [];
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push(params === undefined ? { sql } : { params, sql });
      if (
        ['begin', 'commit', 'rollback'].includes(sql) ||
        sql.startsWith('select set_config')
      )
        return { rowCount: 0, rows: [] };
      return handler(sql, params);
    },
    release: () => undefined,
  };
  const value = new DatabaseHrSelfServiceRepository() as unknown as {
    poolPromise: Promise<DatabasePool>;
    access: DatabaseHrSelfServiceRepository['access'];
    create: DatabaseHrSelfServiceRepository['create'];
    documents: DatabaseHrSelfServiceRepository['documents'];
    list: DatabaseHrSelfServiceRepository['list'];
    payslips: DatabaseHrSelfServiceRepository['payslips'];
    profile: DatabaseHrSelfServiceRepository['profile'];
    verify: DatabaseHrSelfServiceRepository['verify'];
  };
  value.poolPromise = Promise.resolve({
    connect: async () => client,
  } as unknown as DatabasePool);
  return { calls, value };
}

describe('HR self-service repository', () => {
  it('uses entity scope, filters, stable paging, and a separate count query', async () => {
    const { calls, value } = repository((sql) => {
      if (sql.includes('count(*)')) return { rows: [{ total: 1 }] };
      if (sql.startsWith('select id')) return { rows: [row] };
      return { rows: [] };
    });

    await expect(
      value.list({
        ...scope,
        legalEntityIds: [entityId],
        query: {
          legalEntityId: entityId,
          page: 2,
          pageSize: 10,
          status: 'active',
        },
      }),
    ).resolves.toMatchObject({ items: [{ id: bindingId }], total: 1 });

    const count = calls.find((call) => call.sql.includes('count(*)'))!;
    const list = calls.find((call) => call.sql.startsWith('select id'))!;
    expect(count.params).toEqual(['org', [entityId], entityId, 'active']);
    expect(list.params).toEqual([
      'org',
      [entityId],
      entityId,
      'active',
      10,
      10,
    ]);
    expect(list.sql).toContain(
      'order by legal_entity_id, employee_id, id limit $5 offset $6',
    );
  });

  it('keeps an empty allowed-entity scope empty at the SQL boundary', async () => {
    const { calls, value } = repository((sql) =>
      sql.includes('count(*)') ? { rows: [{ total: 0 }] } : { rows: [] },
    );

    await expect(
      value.list({
        ...scope,
        legalEntityIds: [],
        query: { page: 1, pageSize: 25 },
      }),
    ).resolves.toEqual({ items: [], total: 0 });
    expect(
      calls.find((call) => call.sql.includes('count(*)'))?.params?.[1],
    ).toEqual([]);
  });

  it('maps duplicate and invisible employee/entity inserts to domain errors', async () => {
    const input = {
      ...scope,
      body: { employeeId, legalEntityId: entityId, userId: 'bound_user' },
    };
    for (const [code, error] of [
      ['23505', EmployeeUserBindingConflictError],
      ['23503', EmployeeUserBindingNotFoundError],
      ['23514', EmployeeUserBindingNotFoundError],
    ] as const) {
      const { value } = repository((sql) => {
        if (sql.startsWith('insert'))
          throw Object.assign(new Error('database refusal'), { code });
        return { rows: [] };
      });
      await expect(value.create(input)).rejects.toBeInstanceOf(error);
    }
  });

  it('binds verification to the pending named user and writes identifier-only audit', async () => {
    const { calls, value } = repository((sql) => {
      if (sql.startsWith('update app.employee_user_binding'))
        return { rowCount: 1, rows: [row] };
      return { rows: [] };
    });

    await expect(
      value.verify({ ...scope, id: bindingId }),
    ).resolves.toMatchObject({ id: bindingId, status: 'active' });
    const update = calls.find((call) =>
      call.sql.startsWith('update app.employee_user_binding'),
    )!;
    expect(update.sql).toContain("user_id=$3 and status='pending'");
    expect(update.params).toEqual([bindingId, 'org', 'bound_user']);
    const audit = calls.find((call) => call.sql.includes('record_audit'))!;
    expect(audit.params).toEqual([bindingId]);
    expect(audit.sql).toContain("'{}'::jsonb");
  });

  it('returns unavailable access when no active binding is visible', async () => {
    const missing = repository(() => ({ rowCount: 0, rows: [] }));
    await expect(missing.value.access(scope)).resolves.toBeNull();

    const active = repository((sql) =>
      sql.includes("status='active'")
        ? {
            rowCount: 1,
            rows: [{ employee_id: employeeId, legal_entity_id: entityId }],
          }
        : { rowCount: 0, rows: [] },
    );
    await expect(active.value.access(scope)).resolves.toEqual({
      employeeId,
      legalEntityId: entityId,
    });
  });

  it('resolves the active binding and operational profile in one tenant transaction', async () => {
    const { calls, value } = repository((sql) => {
      if (sql.includes('employee_user_binding'))
        return {
          rows: [{ employee_id: employeeId, legal_entity_id: entityId }],
        };
      if (sql.includes('from app.employee where'))
        return {
          rows: [
            {
              id: employeeId,
              legal_entity_id: entityId,
              employee_number: 'E-1',
              first_name: 'Own',
              last_name: 'Employee',
              work_email: null,
              work_phone: null,
              status: 'active',
              created_at: new Date(0),
              updated_at: new Date(0),
            },
          ],
        };
      if (sql.includes('employment_relationship'))
        return {
          rows: [
            {
              id: bindingId,
              employee_id: employeeId,
              kind: 'employment',
              position: 'Analyst',
              department: null,
              cost_centre: null,
              weekly_hours: '40',
              start_date: '2026-01-01',
              end_date: null,
              created_at: new Date(0),
              updated_at: new Date(0),
            },
          ],
        };
      return { rows: [] };
    });
    await expect(value.profile(scope)).resolves.toMatchObject({
      employee: { id: employeeId, firstName: 'Own' },
      relationships: [{ employeeId }],
    });
    expect(calls.filter((call) => call.sql === 'begin')).toHaveLength(1);
    expect(
      calls.find((call) => call.sql.includes('employee_user_binding'))?.params,
    ).toEqual(['org', 'bound_user']);
    expect(
      calls.find((call) => call.sql.includes('employment_relationship'))?.sql,
    ).toContain('order by start_date desc, id');
  });

  it('filters own documents and payslips before paging without reading sensitive values', async () => {
    const { calls, value } = repository((sql) => {
      if (sql.includes('employee_user_binding'))
        return {
          rows: [{ employee_id: employeeId, legal_entity_id: entityId }],
        };
      if (sql.includes('count(*)')) return { rows: [{ total: 1 }] };
      if (sql.includes('d.title'))
        return {
          rows: [
            {
              document_id: bindingId,
              title: 'Operational',
              document_date: '2026-01-01',
              category_id: entityId,
              relationship_id: null,
              approval_status: 'approved',
              approved_at: new Date(0),
              created_at: new Date(0),
            },
          ],
        };
      if (sql.includes('run.id as payroll_run_id'))
        return {
          rows: [
            {
              payroll_run_id: bindingId,
              payroll_month: '2026-02-01',
              version: 2,
              status: 'paid',
              document_id: employeeId,
              finalized_at: new Date(0),
              paid_at: new Date(0),
            },
          ],
        };
      return { rows: [] };
    });
    await expect(
      value.documents({ ...scope, query: { page: 2, pageSize: 10 } }),
    ).resolves.toMatchObject({ total: 1, items: [{ documentId: bindingId }] });
    await expect(
      value.payslips({
        ...scope,
        query: {
          fromMonth: '2026-01',
          toMonth: '2026-02',
          page: 1,
          pageSize: 25,
        },
      }),
    ).resolves.toMatchObject({
      total: 1,
      items: [{ payrollRunId: bindingId, month: '2026-02' }],
    });
    const documentQuery = calls.find((call) =>
      call.sql.includes("c.confidentiality='operational'"),
    )!;
    expect(documentQuery.sql).toContain(
      "l.approval_status in ('approved','not_required')",
    );
    expect(documentQuery.sql).toContain('successor.supersedes_document_id');
    const payslipQuery = calls.find((call) =>
      call.sql.includes("link.kind='payslip'"),
    )!;
    expect(payslipQuery.sql).toContain(
      "run.status in ('finalized','paid','superseded')",
    );
    expect(payslipQuery.sql).not.toContain('gross_pay');
    expect(payslipQuery.params?.slice(0, 5)).toEqual([
      'org',
      employeeId,
      entityId,
      '2026-01-01',
      '2026-02-01',
    ]);
  });
});
