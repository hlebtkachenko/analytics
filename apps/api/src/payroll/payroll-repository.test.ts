import { describe, expect, it } from 'vitest';
import type { DatabasePool } from '@bap/db/pool';

import {
  listComponents,
  listEmployeePayrollResults,
} from './payroll-repository.js';

const entityId = '11111111-1111-4111-8111-111111111111';
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
      if (sql.includes('from app.legal_entity'))
        return { rows: [{}], rowCount: 1 };
      if (sql.includes('count(*)'))
        return { rows: [{ count: '1' }], rowCount: 1 };
      return {
        rows: [
          {
            id: entityId,
            legal_entity_id: entityId,
            code: 'A',
            name: 'Alpha',
            kind: 'earning',
            recurrence: 'recurring',
            accounting_key: 'wage',
            active: true,
            created_at: new Date(0),
            updated_at: new Date(0),
          },
        ],
        rowCount: 1,
      };
    },
    release: () => undefined,
  };
  return { connect: async () => client, calls } as unknown as DatabasePool & {
    calls: typeof calls;
  };
}
describe('payroll repository', () => {
  it('reads employee history in bounded queries with the payslip join and fixed ordering', async () => {
    const db = pool();
    await listEmployeePayrollResults(db, {
      organizationId: 'org',
      userId: 'user',
      role: 'owner',
      legalEntityIds: [entityId],
      employeeId: entityId,
      query: {
        fromMonth: '2026-01',
        toMonth: '2026-12',
        page: 2,
        pageSize: 10,
      },
    });
    const history = db.calls.find((call) =>
      call.sql.includes('left join lateral'),
    )!;
    expect(history.sql).toContain("kind='payslip'");
    expect(history.sql).toContain(
      'order by run.payroll_month desc,run.version desc,run.id asc',
    );
    expect(history.sql).toContain('limit $4 offset $5');
    expect(history.params).toEqual([
      entityId,
      '2026-01-01',
      '2026-12-01',
      10,
      10,
    ]);
  });
  it('uses escaped bounded search and deterministic component ordering', async () => {
    const db = pool();
    const result = await listComponents(db, {
      organizationId: 'org',
      userId: 'user',
      role: 'owner',
      legalEntityIds: [entityId],
      query: { legalEntityId: entityId, q: 'a%_', page: 1, pageSize: 25 },
    });
    expect(result?.items[0]?.code).toBe('A');
    const call = db.calls.find((c) =>
      c.sql.includes('order by code asc,id asc'),
    )!;
    expect(call.sql).toContain("ilike $4 escape '\\'");
    expect(call.params).toContain('%a\\%\\_%');
  });
});
