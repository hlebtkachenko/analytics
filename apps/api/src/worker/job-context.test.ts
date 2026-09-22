import type { DatabasePool } from '@bap/db/pool';
import type { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  channelJobPayloadSchema,
  jobPayloadSchema,
  runTenantJob,
  tenantJobPayloadSchema,
} from './job-context.js';

const CHANNEL_ID = '4a2b7c1e-9f5d-4c3a-8b21-6e0f7d5a4c39';
const ITEM_ID = '9f702163-4eac-4b8f-9076-b34ec2af9184';

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

function createFakePool(
  membershipRows: Record<string, unknown>[],
  channelRows: Record<string, unknown>[] = [],
): FakePool {
  const state: FakePool = {
    connects: 0,
    pool: undefined as unknown as DatabasePool,
    queries: [],
    releases: 0,
  };
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      state.queries.push({ text, values });
      return { rows: text.includes('app.inbox_channel') ? channelRows : [] };
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

describe('channelJobPayloadSchema', () => {
  it('accepts a channel payload with an optional item id, both as uuids', () => {
    expect(
      channelJobPayloadSchema.parse({
        channelId: CHANNEL_ID,
        organizationId: 'org-1',
      }),
    ).toEqual({ channelId: CHANNEL_ID, organizationId: 'org-1' });
    expect(
      jobPayloadSchema.parse({
        channelId: CHANNEL_ID,
        itemId: ITEM_ID,
        organizationId: 'org-1',
      }),
    ).toEqual({
      channelId: CHANNEL_ID,
      itemId: ITEM_ID,
      organizationId: 'org-1',
    });
  });

  it('refuses a non-uuid id, a user id beside the channel and unknown keys', () => {
    for (const payload of [
      { channelId: 'channel_1', organizationId: 'org-1' },
      { channelId: CHANNEL_ID, itemId: 'item-1', organizationId: 'org-1' },
      { channelId: CHANNEL_ID, organizationId: 'org-1', userId: 'user-1' },
      { channelId: CHANNEL_ID, organizationId: 'org-1', sender: 'a@b.c' },
    ]) {
      expect(() => jobPayloadSchema.parse(payload)).toThrow();
    }
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

  it('aborts without opening a transaction when the role can no longer write', async () => {
    const fake = createFakePool([{ email_verified: true, role: 'member' }]);

    await expect(
      runTenantJob({
        data: { organizationId: 'org-1', userId: 'user-1' },
        pool: fake.pool,
        work: async () => 'unreachable',
      }),
    ).rejects.toThrow('Job subject can no longer write in the organization.');
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
      "select set_config('bap.user_id', $1, true), set_config('bap.organization_id', $2, true), set_config('bap.role', $3, true)",
      'commit',
    ]);
    // The role comes from the freshly resolved membership, never from the job payload.
    expect(fake.queries[1]?.values).toEqual(['user-1', 'org-1', 'owner']);
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

  it('opens a channel job as the channel principal after finding its enabled row', async () => {
    const fake = createFakePool([], [{ '?column?': 1 }]);

    const result = await runTenantJob({
      data: { channelId: CHANNEL_ID, itemId: ITEM_ID, organizationId: 'org-1' },
      pool: fake.pool,
      work: async (_transaction, payload) =>
        'channelId' in payload ? payload.itemId : 'wrong branch',
    });

    expect(result).toBe(ITEM_ID);
    expect(fake.connects).toBe(1);
    expect(fake.releases).toBe(1);
    expect(fake.queries.map(({ text }) => text)).toEqual([
      'begin',
      "select set_config('bap.user_id', $1, true), set_config('bap.organization_id', $2, true), set_config('bap.role', $3, true)",
      'select 1 from app.inbox_channel where id = $1 and enabled and deleted_at is null',
      'commit',
    ]);
    // No membership is resolved: the channel is the principal, never a person.
    expect(fake.queries[1]?.values).toEqual([
      `channel_${CHANNEL_ID}`,
      'org-1',
      'channel',
    ]);
  });

  it('rolls back a channel job whose channel is disabled, deleted or missing', async () => {
    const fake = createFakePool([], []);

    await expect(
      runTenantJob({
        data: { channelId: CHANNEL_ID, organizationId: 'org-1' },
        pool: fake.pool,
        work: async () => 'unreachable',
      }),
    ).rejects.toThrow('Job channel is disabled or missing.');
    expect(fake.queries.at(-1)?.text).toBe('rollback');
    expect(fake.releases).toBe(1);
  });
});
