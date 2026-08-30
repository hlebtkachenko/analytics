import type { DatabasePool } from '@bap/db/pool';
import type { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';

import { runTenantJob, tenantJobPayloadSchema } from './job-context.js';

interface RecordedQuery {
  text: string;
  values: unknown[];
}

interface FakePool {
  connects: number;
  pool: DatabasePool;
  queries: RecordedQuery[];
  releases: number;
}

function createFakePool(membershipRows: Record<string, unknown>[]): FakePool {
  const state: FakePool = {
    connects: 0,
    pool: undefined as unknown as DatabasePool,
    queries: [],
    releases: 0,
  };
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      state.queries.push({ text, values });
      return { rows: [] };
    },
    release: () => {
      state.releases += 1;
    },
  };

  state.pool = {
    connect: async () => {
      state.connects += 1;
      return client as unknown as PoolClient;
    },
    query: async () => ({ rows: membershipRows }),
  } as unknown as DatabasePool;

  return state;
}

const membership = [{ email_verified: true, role: 'owner' }];

describe('tenantJobPayloadSchema', () => {
  it('accepts a payload carrying identifiers only', () => {
    expect(
      tenantJobPayloadSchema.parse({
        organizationId: 'org-1',
        userId: 'user-1',
      }),
    ).toEqual({ organizationId: 'org-1', userId: 'user-1' });
  });

  it('rejects unknown keys', () => {
    expect(() =>
      tenantJobPayloadSchema.parse({
        fileContents: 'private',
        organizationId: 'org-1',
        userId: 'user-1',
      }),
    ).toThrow();
  });

  it('rejects a missing or blank organization identifier', () => {
    expect(() => tenantJobPayloadSchema.parse({ userId: 'user-1' })).toThrow();
    expect(() =>
      tenantJobPayloadSchema.parse({ organizationId: '  ', userId: 'user-1' }),
    ).toThrow();
  });

  it('rejects a missing user identifier', () => {
    expect(() =>
      tenantJobPayloadSchema.parse({ organizationId: 'org-1' }),
    ).toThrow();
  });
});

describe('runTenantJob', () => {
  it('fails a malformed payload before touching the database', async () => {
    const fake = createFakePool(membership);

    await expect(
      runTenantJob({
        data: { organizationId: 'org-1' },
        pool: fake.pool,
        work: async () => 'unreachable',
      }),
    ).rejects.toThrow();
    expect(fake.connects).toBe(0);
  });

  it('aborts without opening a transaction when membership is revoked', async () => {
    const fake = createFakePool([]);

    await expect(
      runTenantJob({
        data: { organizationId: 'org-1', userId: 'user-1' },
        pool: fake.pool,
        work: async () => 'unreachable',
      }),
    ).rejects.toThrow('Job subject has no membership in the organization.');
    expect(fake.connects).toBe(0);
    expect(fake.queries).toEqual([]);
  });

  it('runs the unit of work inside a tenant transaction and releases the client', async () => {
    const fake = createFakePool(membership);

    const result = await runTenantJob({
      data: { organizationId: 'org-1', userId: 'user-1' },
      pool: fake.pool,
      work: async (_transaction, payload) => payload.organizationId,
    });

    expect(result).toBe('org-1');
    expect(fake.connects).toBe(1);
    expect(fake.releases).toBe(1);
    expect(fake.queries.map(({ text }) => text)).toEqual([
      'begin',
      "select set_config('bap.user_id', $1, true), set_config('bap.organization_id', $2, true)",
      'commit',
    ]);
    expect(fake.queries[1]?.values).toEqual(['user-1', 'org-1']);
  });

  it('rolls back and releases the client when the work fails', async () => {
    const fake = createFakePool(membership);

    await expect(
      runTenantJob({
        data: { organizationId: 'org-1', userId: 'user-1' },
        pool: fake.pool,
        work: async () => {
          throw new Error('work failed');
        },
      }),
    ).rejects.toThrow('work failed');
    expect(fake.releases).toBe(1);
    expect(fake.queries.at(-1)?.text).toBe('rollback');
  });
});
