import { describe, expect, it } from 'vitest';
import type { DatabasePool } from '@bap/db/pool';

import {
  createReference,
  isDuplicateReference,
  listReferences,
  updateReference,
} from './reference-repository.js';

const scope = {
  organizationId: 'org',
  userId: 'user',
  role: 'owner' as const,
  legalEntityIds: ['11111111-1111-4111-8111-111111111111'],
};
const entityId = scope.legalEntityIds[0]!;
function pool(
  handler: (
    sql: string,
    params?: unknown[],
  ) => { rows: unknown[]; rowCount?: number },
) {
  const calls: { sql: string; params?: unknown[] }[] = [];
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      if (params === undefined) calls.push({ sql });
      else calls.push({ sql, params });
      if (
        ['begin', 'commit', 'rollback'].includes(sql) ||
        sql.startsWith('select set_config')
      )
        return { rows: [], rowCount: 0 };
      return handler(sql, params);
    },
    release: () => undefined,
  };
  return { connect: async () => client, calls } as unknown as DatabasePool & {
    calls: { sql: string; params?: unknown[] }[];
  };
}
const row = {
  id: '22222222-2222-4222-8222-222222222222',
  legal_entity_id: entityId,
  code: 'A',
  name: 'Alpha',
  active: false,
  created_at: new Date(0),
  updated_at: new Date(0),
};

describe('reference repository', () => {
  it('pages active references with escaped search and deterministic code/id ordering', async () => {
    const db = pool((sql) =>
      sql.includes('count(*)')
        ? { rows: [{ count: '2' }] }
        : sql.includes('order by code')
          ? { rows: [row], rowCount: 1 }
          : { rows: [{}], rowCount: 1 },
    );
    const result = await listReferences(db, {
      ...scope,
      kind: 'position',
      query: {
        legalEntityId: entityId,
        q: 'a%_',
        active: false,
        page: 2,
        pageSize: 1,
      },
    });
    expect(result).toMatchObject({
      page: 2,
      pageSize: 1,
      total: 2,
      items: [{ active: false }],
    });
    const list = db.calls.find((call) =>
      call.sql.includes('order by code asc,id asc'),
    )!;
    expect(list.sql).toContain("ilike $4 escape '\\'");
    expect(list.params).toEqual([
      [entityId],
      entityId,
      false,
      '%a\\%\\_%',
      1,
      1,
    ]);
  });
  it('maps each type-specific create field and records identifier-only audit metadata', async () => {
    for (const [kind, body, column] of [
      [
        'department',
        { legalEntityId: entityId, code: 'D', name: 'Dept', parentId: null },
        'parent_id',
      ],
      [
        'workplace',
        {
          legalEntityId: entityId,
          code: 'W',
          name: 'Work',
          addressLabel: 'Here',
        },
        'address_label',
      ],
      [
        'documentCategory',
        {
          legalEntityId: entityId,
          code: 'C',
          name: 'Category',
          confidentiality: 'operational',
          retentionKey: 'retention',
          requiresApproval: true,
        },
        'confidentiality,retention_key,requires_approval',
      ],
    ] as const) {
      const db = pool((sql) =>
        sql.startsWith('insert')
          ? {
              rows: [
                {
                  ...row,
                  ...(kind === 'workplace' ? { address_label: 'Here' } : {}),
                  ...(kind === 'department' ? { parent_id: null } : {}),
                  ...(kind === 'documentCategory'
                    ? {
                        confidentiality: 'operational',
                        retention_key: 'retention',
                        requires_approval: true,
                      }
                    : {}),
                },
              ],
              rowCount: 1,
            }
          : sql.includes('from app.legal_entity')
            ? { rows: [{}], rowCount: 1 }
            : { rows: [], rowCount: 1 },
      );
      await createReference(db, { ...scope, kind, body });
      expect(
        db.calls.find((call) => call.sql.startsWith('insert'))?.sql,
      ).toContain(column);
      expect(
        db.calls.find((call) => call.sql.includes('record_audit'))?.params,
      ).toHaveLength(3);
      expect(
        db.calls.find((call) => call.sql.includes('record_audit'))?.params?.[0],
      ).toMatch(/^hr_(department|workplace|document_category)\.created$/);
    }
  });
  it('returns null for invisible entity, parent, and item and rolls back when audit fails', async () => {
    const invisible = pool(() => ({ rows: [], rowCount: 0 }));
    await expect(
      createReference(invisible, {
        ...scope,
        kind: 'position',
        body: { legalEntityId: entityId, code: 'P', name: 'Position' },
      }),
    ).resolves.toBeNull();
    const parent = pool((sql) =>
      sql.includes('from app.legal_entity')
        ? { rows: [{}], rowCount: 1 }
        : { rows: [], rowCount: 0 },
    );
    await expect(
      createReference(parent, {
        ...scope,
        kind: 'department',
        body: {
          legalEntityId: entityId,
          code: 'D',
          name: 'Department',
          parentId: row.id,
        },
      }),
    ).resolves.toBeNull();
    const item = pool(() => ({ rows: [], rowCount: 0 }));
    await expect(
      updateReference(item, {
        ...scope,
        kind: 'position',
        id: row.id,
        body: { active: false },
      }),
    ).resolves.toBeNull();
    const audit = pool((sql) =>
      sql.includes('record_audit')
        ? (() => {
            throw new Error('audit failed');
          })()
        : sql.startsWith('insert')
          ? { rows: [row], rowCount: 1 }
          : sql.includes('from app.legal_entity')
            ? { rows: [{}], rowCount: 1 }
            : { rows: [row], rowCount: 1 },
    );
    await expect(
      createReference(audit, {
        ...scope,
        kind: 'position',
        body: { legalEntityId: entityId, code: 'P', name: 'Position' },
      }),
    ).rejects.toThrow('audit failed');
    expect(audit.calls.some((call) => call.sql === 'rollback')).toBe(true);
  });
  it('retires a visible reference and recognizes every entity/code duplicate', async () => {
    const db = pool((sql) =>
      sql.startsWith('update')
        ? { rows: [row], rowCount: 1 }
        : { rows: [], rowCount: 1 },
    );
    await expect(
      updateReference(db, {
        ...scope,
        kind: 'position',
        id: row.id,
        body: { active: false },
      }),
    ).resolves.toMatchObject({ active: false });
    expect(
      db.calls.find((call) => call.sql.startsWith('update'))?.params?.[0],
    ).toBe(false);
    expect(
      db.calls.find((call) => call.sql.includes('record_audit'))?.params?.[0],
    ).toBe('hr_position.updated');
    for (const [kind, constraint] of [
      ['department', 'hr_department_entity_code_key'],
      ['position', 'hr_position_entity_code_key'],
      ['costCentre', 'hr_cost_centre_entity_code_key'],
      ['workplace', 'hr_workplace_entity_code_key'],
      ['documentCategory', 'hr_document_category_entity_code_key'],
    ] as const)
      expect(isDuplicateReference({ code: '23505', constraint }, kind)).toBe(
        true,
      );
  });
});
