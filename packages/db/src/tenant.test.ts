import type { Pool, PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  readEntityScope,
  runInTenantContext,
  withTenantContext,
} from './tenant.js';

interface RecordedQuery {
  text: string;
  values: unknown[];
}

function createClient(results: Record<string, Record<string, unknown>[]>): {
  client: PoolClient;
  queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      queries.push({ text, values });
      const matched = Object.entries(results).find(([fragment]) =>
        text.includes(fragment),
      );

      return { rows: matched?.[1] ?? [] };
    },
  };

  return { client: client as unknown as PoolClient, queries };
}

describe('runInTenantContext', () => {
  it('releases the connection whether the operation succeeds or fails', async () => {
    const { client, queries } = createClient({});
    let released = 0;
    const pool = {
      connect: async () => ({ ...client, release: () => (released += 1) }),
    } as unknown as Pool;
    const tenant = {
      organizationId: 'org-1',
      role: 'owner' as const,
      userId: 'user-1',
    };

    await expect(
      runInTenantContext(pool, tenant, async () => 'done'),
    ).resolves.toBe('done');
    await expect(
      runInTenantContext(pool, tenant, async () => {
        throw new Error('operation failed');
      }),
    ).rejects.toThrow('operation failed');

    expect(released).toBe(2);
    expect(
      queries.map(({ text }) => text).filter((text) => text !== 'begin'),
    ).toEqual([
      "select set_config('bap.user_id', $1, true), set_config('bap.organization_id', $2, true), set_config('bap.role', $3, true)",
      'commit',
      "select set_config('bap.user_id', $1, true), set_config('bap.organization_id', $2, true), set_config('bap.role', $3, true)",
      'rollback',
    ]);
  });
});

describe('withTenantContext', () => {
  it('binds the organization, the subject and the role in one transaction', async () => {
    const { client, queries } = createClient({});

    await expect(
      withTenantContext(
        client,
        { organizationId: 'org-1', role: 'admin', userId: 'user-1' },
        async () => 'done',
      ),
    ).resolves.toBe('done');
    expect(queries.map(({ text }) => text)).toEqual([
      'begin',
      "select set_config('bap.user_id', $1, true), set_config('bap.organization_id', $2, true), set_config('bap.role', $3, true)",
      'commit',
    ]);
    expect(queries[1]?.values).toEqual(['user-1', 'org-1', 'admin']);
  });

  it('rolls the transaction back when the operation fails', async () => {
    const { client, queries } = createClient({});

    await expect(
      withTenantContext(
        client,
        { organizationId: 'org-1', role: 'owner', userId: 'user-1' },
        async () => {
          throw new Error('operation failed');
        },
      ),
    ).rejects.toThrow('operation failed');
    expect(queries.at(-1)?.text).toBe('rollback');
  });
});

describe('readEntityScope', () => {
  const legalEntityId = '4a2b7c1e-9f5d-4c3a-8b21-6e0f7d5a4c39';

  it('never restricts an owner and never reads a row for one', async () => {
    const { client, queries } = createClient({
      'app.member_entity_scope': [{ mode: 'restricted' }],
    });

    await expect(
      readEntityScope(client, {
        organizationId: 'org-1',
        role: 'owner',
        userId: 'user-1',
      }),
    ).resolves.toEqual({ mode: 'all' });
    expect(queries).toEqual([]);
  });

  it('treats a missing row and an explicit all as the same unscoped answer', async () => {
    const missing = createClient({});
    const explicit = createClient({
      'app.member_entity_scope': [{ mode: 'all' }],
    });

    await expect(
      readEntityScope(missing.client, {
        organizationId: 'org-1',
        role: 'member',
        userId: 'user-1',
      }),
    ).resolves.toEqual({ mode: 'all' });
    await expect(
      readEntityScope(explicit.client, {
        organizationId: 'org-1',
        role: 'admin',
        userId: 'user-1',
      }),
    ).resolves.toEqual({ mode: 'all' });
    // The access table is never read when the mode is not restricted.
    expect(explicit.queries).toHaveLength(1);
  });

  it('returns the explicit entity list of a restricted member', async () => {
    const { client, queries } = createClient({
      'app.legal_entity_access': [{ legal_entity_id: legalEntityId }],
      'app.member_entity_scope': [{ mode: 'restricted' }],
    });

    await expect(
      readEntityScope(client, {
        organizationId: 'org-1',
        role: 'member',
        userId: 'user-1',
      }),
    ).resolves.toEqual({ legalEntityIds: [legalEntityId], mode: 'restricted' });
    expect(queries.map(({ values }) => values)).toEqual([
      ['org-1', 'user-1'],
      ['org-1', 'user-1'],
    ]);
  });

  it('returns an empty list when a restricted member holds no access row', async () => {
    const { client } = createClient({
      'app.member_entity_scope': [{ mode: 'restricted' }],
    });

    await expect(
      readEntityScope(client, {
        organizationId: 'org-1',
        role: 'member',
        userId: 'user-1',
      }),
    ).resolves.toEqual({ legalEntityIds: [], mode: 'restricted' });
  });
});
