import { readdir } from 'node:fs/promises';

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  bootstrapDatabaseRoles,
  checkMigrationCompatibility,
  resolveMembership,
  runMigrations,
  withTenantContext,
} from './index.js';

const postgresImage =
  'pgvector/pgvector:pg18@sha256:2ba9ca5f2e7daa0f0e7723cba1ee9167bab54efd3640516a44ac1a928dd67e7a';
const testPassword = 'test-only-database-credential';

let apiPool: Pool;
let authPool: Pool;
let backupPool: Pool;
let container: StartedPostgreSqlContainer;
let migratorPool: Pool;
let reportingPool: Pool;
let rootPool: Pool;
let initialMigrationResults: Awaited<ReturnType<typeof runMigrations>>[];

// Mirrors the runner: name sorted, id is the segment before the first underscore.
async function readMigrationIds(): Promise<string[]> {
  const directory = new URL('../drizzle/', import.meta.url);
  const entries = await readdir(directory, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const id = name.split('_')[0];

      if (id === undefined || !/^\d{8}\.\d{4}$/.test(id)) {
        throw new Error(`Invalid migration name: ${name}`);
      }

      return id;
    });
}

function poolFor(user: string, password: string): Pool {
  return new Pool({
    database: container.getDatabase(),
    host: container.getHost(),
    password,
    port: container.getPort(),
    user,
  });
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
  rootPool = poolFor('postgres', testPassword);
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

  migratorPool = poolFor('bap_migrator', testPassword);
  authPool = poolFor('bap_auth', testPassword);
  apiPool = poolFor('bap_api', testPassword);
  reportingPool = poolFor('bap_reporting', testPassword);
  backupPool = poolFor('bap_backup', testPassword);
  const concurrentMigratorPool = poolFor('bap_migrator', testPassword);

  try {
    initialMigrationResults = await Promise.all([
      runMigrations(migratorPool),
      runMigrations(concurrentMigratorPool),
    ]);
  } finally {
    await concurrentMigratorPool.end();
  }
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
      create table app.tenant_test (
        id text primary key,
        organization_id text not null,
        value text not null
      )
    `);
    await client.query('alter table app.tenant_test enable row level security');
    await client.query('alter table app.tenant_test force row level security');
    await client.query(`
      create policy tenant_test_isolation on app.tenant_test
      using (organization_id = current_setting('bap.organization_id', true))
      with check (organization_id = current_setting('bap.organization_id', true))
    `);
    await client.query('grant usage on schema app to bap_api');
    await client.query('grant select on app.tenant_test to bap_api');
  });
  await rootPool.query(`
    insert into app.tenant_test (id, organization_id, value)
    values ('record-1', 'org-1', 'first'), ('record-2', 'org-2', 'second')
  `);
  await rootPool.query(`
    insert into app.data_grants (organization_id, user_id, resource_type, resource_id, scope)
    values ('org-1', 'user-1', 'dataset', 'dataset-1', 'read'),
           ('org-2', 'user-2', 'dataset', 'dataset-2', 'read')
  `);
});

afterAll(async () => {
  await Promise.all([
    apiPool.end(),
    authPool.end(),
    backupPool.end(),
    migratorPool.end(),
    reportingPool.end(),
    rootPool.end(),
  ]);
  await container.stop();
});

describe('PostgreSQL 18 isolation', () => {
  it('runs idempotent migrations and exposes compatibility by a narrow function', async () => {
    const migrationIds = await readMigrationIds();
    const result = await runMigrations(migratorPool);
    const compatibility = await checkMigrationCompatibility(apiPool);

    expect(migrationIds.length).toBeGreaterThan(0);
    expect(result.applied).toEqual([]);
    expect(compatibility).toMatchObject({
      compatible: true,
      version: migrationIds.at(-1),
    });
    expect(initialMigrationResults.flatMap(({ applied }) => applied)).toEqual(
      migrationIds,
    );
  });

  it('provisions pgvector during role bootstrap and exposes it to services', async () => {
    const extension = await rootPool.query<{ extname: string }>(
      "select extname from pg_extension where extname = 'vector'",
    );

    expect(extension.rows).toEqual([{ extname: 'vector' }]);
    await expect(
      apiPool.query("select '[1,2,3]'::vector as embedding"),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  it('resolves verified membership without auth table access', async () => {
    await expect(apiPool.query('select * from auth."user"')).rejects.toThrow();
    await expect(
      reportingPool.query('select * from auth.member'),
    ).rejects.toThrow();
    await expect(
      resolveMembership(apiPool, {
        organizationId: 'org-1',
        subjectId: 'user-1',
      }),
    ).resolves.toEqual({ emailVerified: true, role: 'owner' });
    await expect(
      resolveMembership(apiPool, {
        organizationId: 'org-2',
        subjectId: 'user-1',
      }),
    ).resolves.toBeNull();
  });

  it('permits Better Auth database rate limits only to the auth role', async () => {
    await expect(
      authPool.query(
        "insert into auth.rate_limit (id, key, count, last_request) values ('rate-limit-1', 'test-key', 1, 1) on conflict (key) do update set count = excluded.count, last_request = excluded.last_request",
      ),
    ).resolves.toBeDefined();
    await expect(
      authPool.query(
        "insert into auth.rate_limit (id, key, count, last_request) values ('rate-limit-2', 'test-key', 1, 1)",
      ),
    ).rejects.toThrow();
    await expect(
      authPool.query<{ id: string; key: string }>(
        "select id, key from auth.rate_limit where key = 'test-key'",
      ),
    ).resolves.toMatchObject({
      rows: [{ id: 'rate-limit-1', key: 'test-key' }],
    });
    await expect(
      apiPool.query('select * from auth.rate_limit'),
    ).rejects.toThrow();
    await expect(
      reportingPool.query('select * from auth.rate_limit'),
    ).rejects.toThrow();
  });

  it('fails closed without tenant context and resets settings after a transaction', async () => {
    await expect(
      apiPool.query('select id from app.tenant_test'),
    ).resolves.toMatchObject({ rows: [] });
    const client = await apiPool.connect();

    try {
      const rows = await withTenantContext(
        client,
        { organizationId: 'org-1', userId: 'user-1' },
        async (transaction) => {
          const result = await transaction.query<{ id: string }>(
            'select id from app.tenant_test order by id',
          );
          return result.rows;
        },
      );
      expect(rows).toEqual([{ id: 'record-1' }]);
      const otherRows = await withTenantContext(
        client,
        { organizationId: 'org-2', userId: 'user-2' },
        async (transaction) => {
          const result = await transaction.query<{ id: string }>(
            'select id from app.tenant_test order by id',
          );
          return result.rows;
        },
      );
      expect(otherRows).toEqual([{ id: 'record-2' }]);
      await expect(
        client.query('select id from app.tenant_test'),
      ).resolves.toMatchObject({ rows: [] });
    } finally {
      client.release();
    }
  });

  it('isolates data grants for reads and rejects cross-tenant writes', async () => {
    const client = await apiPool.connect();

    try {
      const visible = await withTenantContext(
        client,
        { organizationId: 'org-1', userId: 'user-1' },
        async (transaction) => {
          const result = await transaction.query<{ resource_id: string }>(
            'select resource_id from app.data_grants order by resource_id',
          );
          return result.rows;
        },
      );

      expect(visible).toEqual([{ resource_id: 'dataset-1' }]);
      await expect(
        withTenantContext(
          client,
          { organizationId: 'org-1', userId: 'user-1' },
          async (transaction) =>
            transaction.query(
              "insert into app.data_grants (organization_id, user_id, resource_type, resource_id, scope) values ('org-2', 'user-2', 'dataset', 'dataset-3', 'read')",
            ),
        ),
      ).rejects.toThrow(/row-level security/);
      const inserted = await withTenantContext(
        client,
        { organizationId: 'org-1', userId: 'user-1' },
        async (transaction) => {
          const result = await transaction.query<{ resource_id: string }>(
            "insert into app.data_grants (organization_id, user_id, resource_type, resource_id, scope) values ('org-1', 'user-1', 'dataset', 'dataset-4', 'read') returning resource_id",
          );
          return result.rows;
        },
      );

      expect(inserted).toEqual([{ resource_id: 'dataset-4' }]);
      await expect(
        reportingPool.query(
          "insert into app.data_grants (organization_id, user_id, resource_type, resource_id, scope) values ('org-1', 'user-1', 'dataset', 'dataset-5', 'read')",
        ),
      ).rejects.toThrow(/permission denied/);
    } finally {
      client.release();
    }
  });

  it('keeps the audit log append only for the application role', async () => {
    const client = await apiPool.connect();

    try {
      await withTenantContext(
        client,
        { organizationId: 'org-1', userId: 'user-1' },
        async (transaction) =>
          transaction.query(
            "select app.record_audit('grant.created', 'data_grant', 'dataset-1')",
          ),
      );
      await expect(
        withTenantContext(
          client,
          { organizationId: 'org-1', userId: 'user-1' },
          async (transaction) =>
            transaction.query(
              "insert into app.audit_log (organization_id, user_id, action, resource_type) values ('org-1', 'user-1', 'forged', 'data_grant')",
            ),
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        withTenantContext(
          client,
          { organizationId: 'org-1', userId: 'user-1' },
          async (transaction) =>
            transaction.query("update app.audit_log set action = 'edited'"),
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        withTenantContext(
          client,
          { organizationId: 'org-1', userId: 'user-1' },
          async (transaction) => transaction.query('delete from app.audit_log'),
        ),
      ).rejects.toThrow(/permission denied/);
      const remaining = await withTenantContext(
        client,
        { organizationId: 'org-1', userId: 'user-1' },
        async (transaction) => {
          const result = await transaction.query<{ action: string }>(
            'select action from app.audit_log order by created_at',
          );
          return result.rows;
        },
      );

      expect(remaining).toEqual([{ action: 'grant.created' }]);
    } finally {
      client.release();
    }
  });

  it('records audit entries for the tenant context and never for an argument', async () => {
    const definition = await rootPool.query<{
      arguments: string;
      security_definer: boolean;
      settings: string[] | null;
    }>(`
      select pg_get_function_arguments(routine.oid) as arguments,
             routine.prosecdef as security_definer,
             routine.proconfig as settings
      from pg_proc as routine
      inner join pg_namespace as namespace on namespace.oid = routine.pronamespace
      where namespace.nspname = 'app' and routine.proname = 'record_audit'
    `);

    expect(definition.rows).toHaveLength(1);
    expect(definition.rows[0]?.security_definer).toBe(true);
    expect(definition.rows[0]?.settings?.[0]).toMatch(/^search_path=/);
    // Security proof: no argument can carry a tenant or a subject into the log.
    expect(definition.rows[0]?.arguments).not.toMatch(/organization|user/i);
    const client = await apiPool.connect();

    try {
      const recordedId = await withTenantContext(
        client,
        { organizationId: 'org-1', userId: 'user-1' },
        async (transaction) => {
          const result = await transaction.query<{ id: string }>(
            "select app.record_audit('dataset.read', 'dataset', 'dataset-1', jsonb_build_object('organization_id', 'org-2', 'user_id', 'user-2')) as id",
          );
          return result.rows[0]?.id;
        },
      );

      expect(typeof recordedId).toBe('string');
      const attribution = await withTenantContext(
        client,
        { organizationId: 'org-1', userId: 'user-1' },
        async (transaction) => {
          const result = await transaction.query<{
            organization_id: string;
            user_id: string;
          }>(
            'select organization_id, user_id from app.audit_log where id = $1',
            [recordedId],
          );
          return result.rows;
        },
      );

      // The organization id claimed in the payload never becomes the attribution.
      expect(attribution).toEqual([
        { organization_id: 'org-1', user_id: 'user-1' },
      ]);
      const otherTenantRows = await withTenantContext(
        client,
        { organizationId: 'org-2', userId: 'user-2' },
        async (transaction) => {
          const result = await transaction.query<{ id: string }>(
            'select id from app.audit_log',
          );
          return result.rows;
        },
      );

      // Nothing reached org-2, so the call is not a cross-tenant write primitive.
      expect(otherTenantRows).toEqual([]);
      await expect(
        withTenantContext(
          client,
          { organizationId: 'org-1', userId: 'user-1' },
          async (transaction) =>
            transaction.query(
              "select app.record_audit('dataset.read', 'dataset', 'dataset-1', '{}'::jsonb, 'org-2')",
            ),
        ),
      ).rejects.toThrow(/does not exist/);
      await expect(
        apiPool.query(
          "select app.record_audit('dataset.read', 'dataset', 'dataset-1')",
        ),
      ).rejects.toThrow(/tenant context/);
    } finally {
      client.release();
    }
  });

  it('permits dump-only backup access and rejects writes, schema changes, and role changes', async () => {
    await expect(
      backupPool.query('select count(*) from auth."user"'),
    ).resolves.toBeDefined();
    await expect(
      backupPool.query(
        "insert into auth.organization (id, name, slug) values ('denied', 'Denied', 'denied')",
      ),
    ).rejects.toThrow();
    await expect(
      backupPool.query('create table app.denied (id text)'),
    ).rejects.toThrow();
    await expect(backupPool.query('set role bap_owner')).rejects.toThrow();
  });

  it('runs a full pg_dump as the backup role', async () => {
    try {
      const result = await container.exec(
        [
          'pg_dump',
          '--format=custom',
          '--username',
          'bap_backup',
          '--dbname',
          container.getDatabase(),
          '--file',
          '/tmp/bap-backup-test.dump',
          '--no-owner',
          '--no-acl',
        ],
        { env: { PGPASSWORD: testPassword } },
      );

      expect(result.exitCode).toBe(0);
      const contents = await container.exec([
        'pg_restore',
        '--list',
        '/tmp/bap-backup-test.dump',
      ]);

      expect(contents.exitCode).toBe(0);
      // The dump must carry every tenant table and its rows, not only the schema.
      expect(contents.output).toContain('TABLE app data_grants');
      expect(contents.output).toContain('TABLE DATA app data_grants');
      expect(contents.output).toContain('TABLE app audit_log');
      expect(contents.output).toContain('TABLE DATA app audit_log');
    } finally {
      await container.exec(['rm', '-f', '/tmp/bap-backup-test.dump']);
    }
  });
});
