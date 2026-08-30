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
});

afterAll(async () => {
  await boss.stop({ graceful: false });
  await Promise.all([apiPool.end(), migratorPool.end(), rootPool.end()]);
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

  it('refuses object creation in the pgboss schema so self-migration stays impossible', async () => {
    await expect(
      apiPool.query('create table pgboss.worker_probe (id text)'),
    ).rejects.toThrow();
  });
});
