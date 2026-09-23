import { describe, expect, it } from 'vitest';
import type { DatabasePool } from '@bap/db/pool';

import {
  DatabaseHrAccessRepository,
  HrAccessAssignmentConflictError,
  HrAccessAssignmentNotFoundError,
} from './access-repository.js';

const entityId = '11111111-1111-4111-8111-111111111111';
const assignmentId = '22222222-2222-4222-8222-222222222222';
const scope = {
  organizationId: 'org',
  role: 'owner' as const,
  userId: 'owner_1',
};
const row = {
  access_role: 'payroll_specialist' as const,
  created_at: new Date(0),
  id: assignmentId,
  legal_entity_id: entityId,
  user_id: 'user_2',
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
      ) {
        return { rowCount: 0, rows: [] };
      }
      return handler(sql, params);
    },
    release: () => undefined,
  };
  const value = new DatabaseHrAccessRepository() as unknown as {
    poolPromise: Promise<DatabasePool>;
    create: DatabaseHrAccessRepository['create'];
    list: DatabaseHrAccessRepository['list'];
    remove: DatabaseHrAccessRepository['remove'];
  };
  value.poolPromise = Promise.resolve({
    connect: async () => client,
  } as unknown as DatabasePool);
  return { calls, value };
}

describe('HR access assignment repository', () => {
  it('lists assignments in deterministic entity, user, role, and id order', async () => {
    const { calls, value } = repository(() => ({ rowCount: 1, rows: [row] }));
    await expect(value.list(scope)).resolves.toEqual([
      {
        accessRole: 'payroll_specialist',
        createdAt: new Date(0).toISOString(),
        id: assignmentId,
        legalEntityId: entityId,
        userId: 'user_2',
      },
    ]);
    expect(
      calls.find((call) => call.sql.startsWith('select id'))?.sql,
    ).toContain(
      'order by legal_entity_id asc, user_id asc, access_role asc, id asc',
    );
  });

  it('treats an invisible entity or assignment as not found and pins each query to the tenant', async () => {
    const missingEntity = repository((sql) =>
      sql.startsWith('select 1')
        ? { rowCount: 0, rows: [] }
        : { rowCount: 0, rows: [] },
    );
    await expect(
      missingEntity.value.create({
        ...scope,
        body: {
          accessRole: 'hr_admin',
          legalEntityId: entityId,
          userId: 'user_2',
        },
      }),
    ).rejects.toBeInstanceOf(HrAccessAssignmentNotFoundError);
    expect(
      missingEntity.calls.find((call) => call.sql.startsWith('select 1'))
        ?.params,
    ).toEqual([entityId, 'org']);
    const missingAssignment = repository(() => ({ rowCount: 0, rows: [] }));
    await expect(
      missingAssignment.value.remove({ ...scope, assignmentId }),
    ).rejects.toBeInstanceOf(HrAccessAssignmentNotFoundError);
    expect(
      missingAssignment.calls.find((call) => call.sql.startsWith('delete'))
        ?.params,
    ).toEqual([assignmentId, 'org']);
  });

  it('maps the assignment uniqueness constraint to a conflict error', async () => {
    const { value } = repository((sql) => {
      if (sql.startsWith('select 1')) return { rowCount: 1, rows: [{}] };
      if (sql.startsWith('insert')) {
        throw Object.assign(new Error('duplicate key'), { code: '23505' });
      }
      return { rowCount: 0, rows: [] };
    });
    await expect(
      value.create({
        ...scope,
        body: {
          accessRole: 'payroll_specialist',
          legalEntityId: entityId,
          userId: 'user_2',
        },
      }),
    ).rejects.toBeInstanceOf(HrAccessAssignmentConflictError);
  });

  it('writes identifier-only audit in the mutation transaction and rolls both back on audit failure', async () => {
    const { calls, value } = repository((sql) => {
      if (sql.startsWith('select 1')) return { rowCount: 1, rows: [{}] };
      if (sql.startsWith('insert')) return { rowCount: 1, rows: [row] };
      if (sql.includes('record_audit')) throw new Error('audit failure');
      return { rowCount: 0, rows: [] };
    });
    await expect(
      value.create({
        ...scope,
        body: {
          accessRole: 'payroll_specialist',
          legalEntityId: entityId,
          userId: 'user_2',
        },
      }),
    ).rejects.toThrow('audit failure');
    const audit = calls.find((call) => call.sql.includes('record_audit'))!;
    expect(audit.params).toEqual([assignmentId]);
    expect(audit.sql).toContain("'{}'::jsonb");
    expect(calls.map((call) => call.sql)).toContain('rollback');
    expect(calls.map((call) => call.sql)).not.toContain('commit');
  });

  it('rolls the revoke back when its identifier-only audit write fails', async () => {
    const { calls, value } = repository((sql) => {
      if (sql.startsWith('delete')) return { rowCount: 1, rows: [row] };
      if (sql.includes('record_audit')) throw new Error('audit failure');
      return { rowCount: 0, rows: [] };
    });
    await expect(value.remove({ ...scope, assignmentId })).rejects.toThrow(
      'audit failure',
    );
    const audit = calls.find((call) => call.sql.includes('record_audit'))!;
    expect(audit.params).toEqual([assignmentId]);
    expect(audit.sql).toContain("'{}'::jsonb");
    expect(calls.map((call) => call.sql)).toContain('rollback');
    expect(calls.map((call) => call.sql)).not.toContain('commit');
  });
});
