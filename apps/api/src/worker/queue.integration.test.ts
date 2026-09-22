import {
  bootstrapDatabaseRoles,
  createDatabasePool,
  runMigrations,
} from '@bap/db';
import type { DatabaseConfiguration, DatabaseRole } from '@bap/db/config';
import type { DatabasePool } from '@bap/db/pool';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import type { PgBoss } from 'pg-boss';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SPLIT_EMAIL_ITEM_QUEUE } from '../inbox/contract.js';
import { sendSplitEmailItem } from '../inbox/inbox-queue.js';
import { endPools } from '../test-support/end-pools.js';
import { runTenantJob } from './job-context.js';
import { createQueue, createQueueClientFromConfiguration } from './queue.js';

const postgresImage =
  'pgvector/pgvector:pg18@sha256:2ba9ca5f2e7daa0f0e7723cba1ee9167bab54efd3640516a44ac1a928dd67e7a';
const testPassword = 'test-only-database-credential';
const queueName = 'worker_tenant_probe';

let apiPool: DatabasePool;
let boss: PgBoss;
let container: StartedPostgreSqlContainer;
let migratorPool: DatabasePool;
let rootPool: DatabasePool;

function configurationFor(role: DatabaseRole): DatabaseConfiguration {
  return {
    database: container.getDatabase(),
    host: container.getHost(),
    password: testPassword,
    port: container.getPort(),
    role,
    ssl: false,
    user: role,
  };
}

async function asOwner<T>(
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await migratorPool.connect();
  await client.query('begin');
  await client.query('set local role bap_owner');

  try {
    const result = await operation(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer(postgresImage)
    .withDatabase('bap')
    .withUsername('postgres')
    .withPassword(testPassword)
    .start();
  rootPool = createDatabasePool(configurationFor('postgres'));
  const root = await rootPool.connect();

  try {
    await bootstrapDatabaseRoles(root, {
      bap_api: testPassword,
      bap_auth: testPassword,
      bap_backup: testPassword,
      bap_migrator: testPassword,
      bap_reporting: testPassword,
    });
  } finally {
    root.release();
  }

  migratorPool = createDatabasePool(configurationFor('bap_migrator'));
  await runMigrations(migratorPool);
  await asOwner(async (client) => {
    await client.query(`
      insert into auth."user" (id, name, email, email_verified)
      values ('user-1', 'Member', 'member@example.test', true),
             ('user-2', 'Other', 'other@example.test', true)
    `);
    await client.query(`
      insert into auth.organization (id, name, slug)
      values ('org-1', 'One', 'one'), ('org-2', 'Two', 'two')
    `);
    await client.query(`
      insert into auth.member (id, organization_id, user_id, role)
      values ('member-1', 'org-1', 'user-1', 'owner'),
             ('member-2', 'org-2', 'user-2', 'member')
    `);
    await client.query(`
      create table app.worker_tenant_test (
        id text primary key,
        organization_id text not null,
        value text not null
      )
    `);
    await client.query(
      'alter table app.worker_tenant_test enable row level security',
    );
    await client.query(
      'alter table app.worker_tenant_test force row level security',
    );
    await client.query(`
      create policy worker_tenant_test_isolation on app.worker_tenant_test
      using (organization_id = current_setting('bap.organization_id', true))
      with check (organization_id = current_setting('bap.organization_id', true))
    `);
    await client.query('grant usage on schema app to bap_api');
    await client.query(
      'grant select, insert on app.worker_tenant_test to bap_api',
    );
  });
  await rootPool.query(`
    insert into app.worker_tenant_test (id, organization_id, value)
    values ('record-1', 'org-1', 'first'), ('record-2', 'org-2', 'second')
  `);
  apiPool = createDatabasePool(configurationFor('bap_api'));
  boss = createQueueClientFromConfiguration(configurationFor('bap_api'));
  await boss.start();
  await createQueue(boss, queueName);
  await createQueue(boss, SPLIT_EMAIL_ITEM_QUEUE, { policy: 'exclusive' });
});

afterAll(async () => {
  await boss.stop({ graceful: false });
  await endPools(apiPool, migratorPool, rootPool);
  await container.stop();
});

describe('worker queue confinement', () => {
  it('creates a non-partitioned queue on the shared job table', async () => {
    const queue = await apiPool.query<{
      partition: boolean;
      table_name: string;
    }>('select partition, table_name from pgboss.queue where name = $1', [
      queueName,
    ]);

    expect(queue.rows).toEqual([
      { partition: false, table_name: 'job_common' },
    ]);
  });

  it('confines a worked job to the organization named in its payload', async () => {
    let settle: (value: string[]) => void = () => undefined;
    let fail: (reason: unknown) => void = () => undefined;
    const worked = new Promise<string[]>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });

    await boss.work<unknown, void>(queueName, async (jobs) => {
      for (const job of jobs) {
        try {
          settle(
            await runTenantJob({
              data: job.data,
              pool: apiPool,
              work: async (transaction) => {
                await transaction.query(
                  "insert into app.worker_tenant_test (id, organization_id, value) values ('record-3', 'org-1', 'worker')",
                );
                const visible = await transaction.query<{ id: string }>(
                  'select id from app.worker_tenant_test order by id',
                );
                return visible.rows.map((row) => row.id);
              },
            }),
          );
        } catch (error) {
          fail(error);
        }
      }
    });
    // The payload carries identifiers only because pgboss.job is cross-tenant readable.
    await boss.send(queueName, { organizationId: 'org-1', userId: 'user-1' });

    await expect(worked).resolves.toEqual(['record-1', 'record-3']);
  });

  it('rejects a write addressed to another organization', async () => {
    await expect(
      runTenantJob({
        data: { organizationId: 'org-1', userId: 'user-1' },
        pool: apiPool,
        work: async (transaction) =>
          transaction.query(
            "insert into app.worker_tenant_test (id, organization_id, value) values ('record-4', 'org-2', 'leak')",
          ),
      }),
    ).rejects.toThrow();
    await expect(
      rootPool.query(
        "select id from app.worker_tenant_test where id = 'record-4'",
      ),
    ).resolves.toMatchObject({ rows: [] });
  });

  it('aborts a job whose subject has no membership in the organization', async () => {
    await expect(
      runTenantJob({
        data: { organizationId: 'org-2', userId: 'user-1' },
        pool: apiPool,
        work: async () => 'unreachable',
      }),
    ).rejects.toThrow('Job subject has no membership in the organization.');
  });

  it('drops a second split job with the same item key while the first is created, retrying or active', async () => {
    const job = {
      channelId: '4a2b7c1e-9f5d-4c3a-8b21-6e0f7d5a4c39',
      itemId: '6c4d9e30-1b7f-4e5c-ad43-801b9f7c6e51',
      organizationId: 'org-1',
    };
    const policy = await apiPool.query<{ policy: string }>(
      'select policy from pgboss.queue where name = $1',
      [SPLIT_EMAIL_ITEM_QUEUE],
    );
    expect(policy.rows[0]?.policy).toBe('exclusive');

    // The intake sends once and the maintenance requeue sends again: one job, with the retry options intact.
    await sendSplitEmailItem(boss, job);
    await sendSplitEmailItem(boss, job);
    const created = await apiPool.query<{
      retry_delay: number;
      retry_limit: number;
      singleton_key: string;
      state: string;
    }>(
      'select state, singleton_key, retry_limit, retry_delay from pgboss.job where name = $1',
      [SPLIT_EMAIL_ITEM_QUEUE],
    );
    expect(created.rows).toEqual([
      {
        retry_delay: 60,
        retry_limit: 3,
        singleton_key: job.itemId,
        state: 'created',
      },
    ]);

    // Fetched into active, the key is still held.
    const [active] = (await boss.fetch(SPLIT_EMAIL_ITEM_QUEUE)) ?? [];
    expect(active?.data).toEqual(job);
    await sendSplitEmailItem(boss, job);
    const whileActive = await apiPool.query(
      'select 1 from pgboss.job where name = $1',
      [SPLIT_EMAIL_ITEM_QUEUE],
    );
    expect(whileActive.rowCount).toBe(1);

    // Failed with retries left, the job goes to retry and the key is still held.
    await boss.fail(SPLIT_EMAIL_ITEM_QUEUE, active?.id ?? '');
    await sendSplitEmailItem(boss, job);
    const whileRetrying = await apiPool.query<{ state: string }>(
      'select state from pgboss.job where name = $1',
      [SPLIT_EMAIL_ITEM_QUEUE],
    );
    expect(whileRetrying.rows).toEqual([{ state: 'retry' }]);
  });

  it('recreates a queue found with another policy so the singleton key holds', async () => {
    const probe = 'worker_policy_probe';
    const warnings: string[] = [];
    // The queue as PR #67 left it: standard, with a pending job that the recreation drops.
    await boss.createQueue(probe, { partition: false });
    await boss.send(probe, { itemId: 'stale' }, { singletonKey: 'key-1' });

    await createQueue(boss, probe, { policy: 'exclusive' }, (message) =>
      warnings.push(message),
    );

    expect(warnings).toEqual([
      'Recreating queue worker_policy_probe: policy standard cannot become exclusive in place',
    ]);
    const policy = await apiPool.query<{ policy: string }>(
      'select policy from pgboss.queue where name = $1',
      [probe],
    );
    expect(policy.rows).toEqual([{ policy: 'exclusive' }]);
    const dropped = await apiPool.query(
      'select 1 from pgboss.job where name = $1',
      [probe],
    );
    expect(dropped.rowCount).toBe(0);

    // A second send with the same key is now dropped instead of queued twice.
    await boss.send(probe, { itemId: 'fresh' }, { singletonKey: 'key-1' });
    await boss.send(probe, { itemId: 'fresh' }, { singletonKey: 'key-1' });
    const queued = await apiPool.query<{ singleton_key: string }>(
      'select singleton_key from pgboss.job where name = $1',
      [probe],
    );
    expect(queued.rows).toEqual([{ singleton_key: 'key-1' }]);

    // Running the setup again against the exclusive queue changes nothing.
    await createQueue(boss, probe, { policy: 'exclusive' }, (message) =>
      warnings.push(message),
    );
    expect(warnings).toHaveLength(1);
    const kept = await apiPool.query(
      'select 1 from pgboss.job where name = $1',
      [probe],
    );
    expect(kept.rowCount).toBe(1);
  });

  it('refuses object creation in the pgboss schema so self-migration stays impossible', async () => {
    await expect(
      apiPool.query('create table pgboss.worker_probe (id text)'),
    ).rejects.toThrow();
  });
});
