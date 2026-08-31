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
  consumePublicSignupEdgeRateLimit,
  publicSignupInvitationExists,
  publicSignupEnabled,
  resolveMembership,
  runMigrations,
  withTenantContext,
} from './index.js';
import type { TenantContext } from './index.js';

const postgresImage =
  'pgvector/pgvector:pg18@sha256:2ba9ca5f2e7daa0f0e7723cba1ee9167bab54efd3640516a44ac1a928dd67e7a';
const testPassword = 'test-only-database-credential';

// Neutral dataset fixtures: fixed identifiers keep grant assertions exact.
const ownedDatasetId = '00000000-0000-4000-8000-000000000001';
const sharedDatasetId = '00000000-0000-4000-8000-000000000002';
const privateDatasetId = '00000000-0000-4000-8000-000000000003';
const foreignDatasetId = '00000000-0000-4000-8000-000000000004';
const unrelatedDatasetId = '00000000-0000-4000-8000-000000000009';

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

// Mirrors app.dataset_embedding.embedding: the migration pins the width, so a fixture must too.
const embeddingDimensions = 1536;

function vectorLiteral(leading: readonly number[]): string {
  const components = Array.from(
    { length: embeddingDimensions },
    (_value, index) => leading[index] ?? 0,
  );

  return `[${components.join(',')}]`;
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

// One tenant scoped transaction on a fresh connection, so a rejected statement cannot leak into the next assertion.
async function asTenant<T>(
  pool: Pool,
  context: TenantContext,
  operation: (transaction: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    return await withTenantContext(client, context, operation);
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
  // user-3 is a second subject inside org-1: app.dataset.created_by carries no foreign key to auth."user".
  await rootPool.query(`
    insert into app.dataset (id, organization_id, name, description, status, created_by)
    values ('${ownedDatasetId}', 'org-1', 'alpha container', 'orbit placeholder text', 'ready', 'user-1'),
           ('${sharedDatasetId}', 'org-1', 'beta container', 'meridian placeholder text', 'ready', 'user-3'),
           ('${privateDatasetId}', 'org-1', 'gamma container', 'lattice placeholder text', 'importing', 'user-3'),
           ('${foreignDatasetId}', 'org-2', 'delta container', 'nimbus placeholder text', 'ready', 'user-2')
  `);
  await rootPool.query(`
    insert into app.dataset_column (dataset_id, name, position, inferred_type)
    values ('${ownedDatasetId}', 'column_a', 0, 'text'),
           ('${sharedDatasetId}', 'column_b', 0, 'number'),
           ('${privateDatasetId}', 'column_c', 0, 'text'),
           ('${foreignDatasetId}', 'column_d', 0, 'text')
  `);
  await rootPool.query(`
    insert into app.dataset_row (dataset_id, organization_id, row_number, data)
    values ('${ownedDatasetId}', 'org-1', 0, '{"column_a": "value-a"}'),
           ('${sharedDatasetId}', 'org-1', 0, '{"column_b": 1}'),
           ('${privateDatasetId}', 'org-1', 0, '{"column_c": "value-c"}'),
           ('${foreignDatasetId}', 'org-2', 0, '{"column_d": "value-d"}')
  `);
  await rootPool.query(`
    insert into app.upload (organization_id, dataset_id, filename, byte_size, status)
    values ('org-1', '${ownedDatasetId}', 'upload-one.csv', 128, 'completed'),
           ('org-2', '${foreignDatasetId}', 'upload-two.csv', 256, 'completed')
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

  it('confines the public sign-up switch to its narrow auth accessor', async () => {
    await expect(publicSignupEnabled(authPool)).resolves.toBe(false);

    for (const statement of [
      'select * from auth.platform_setting',
      `insert into auth.platform_setting ("key", enabled) values ('denied', true)`,
      `update auth.platform_setting set enabled = true where "key" = 'public_signup'`,
      `delete from auth.platform_setting where "key" = 'public_signup'`,
    ]) {
      await expect(authPool.query(statement)).rejects.toThrow(
        /permission denied/,
      );
    }

    for (const pool of [apiPool, reportingPool]) {
      await expect(
        pool.query('select auth.public_signup_enabled()'),
      ).rejects.toThrow(/permission denied/);
      for (const statement of [
        'select * from auth.platform_setting',
        `insert into auth.platform_setting ("key", enabled) values ('denied', true)`,
        `update auth.platform_setting set enabled = true where "key" = 'public_signup'`,
        `delete from auth.platform_setting where "key" = 'public_signup'`,
      ]) {
        await expect(pool.query(statement)).rejects.toThrow(
          /permission denied/,
        );
      }
    }

    await expect(
      backupPool.query(
        `select "key", enabled from auth.platform_setting where "key" = 'public_signup'`,
      ),
    ).resolves.toMatchObject({
      rows: [{ enabled: false, key: 'public_signup' }],
    });
    await expect(
      backupPool.query('select auth.public_signup_enabled()'),
    ).rejects.toThrow(/permission denied/);

    const functionProperties = await rootPool.query<{
      owner: string;
      proconfig: string[];
      prosecdef: boolean;
      provolatile: string;
    }>(`select
      pg_get_userbyid(proowner) as owner,
      proconfig,
      prosecdef,
      provolatile
    from pg_proc
    where oid = 'auth.public_signup_enabled()'::regprocedure`);
    expect(functionProperties.rows).toEqual([
      {
        owner: 'bap_owner',
        proconfig: ['search_path=pg_catalog, auth'],
        prosecdef: true,
        provolatile: 's',
      },
    ]);
    const functionAcl = await rootPool.query<{
      grantee: string;
      privilege_type: string;
    }>(`select
      coalesce(grantee_role.rolname, 'PUBLIC') as grantee,
      privilege.privilege_type
    from pg_proc as p
    cross join lateral aclexplode(
      coalesce(p.proacl, acldefault('f', p.proowner))
    ) as privilege
    left join pg_roles as grantee_role on grantee_role.oid = privilege.grantee
    where p.oid = 'auth.public_signup_enabled()'::regprocedure
    order by grantee, privilege_type`);
    expect(functionAcl.rows).toEqual([
      { grantee: 'bap_auth', privilege_type: 'EXECUTE' },
      { grantee: 'bap_owner', privilege_type: 'EXECUTE' },
    ]);

    await asOwner((client) =>
      client.query(
        `delete from auth.platform_setting where "key" = 'public_signup'`,
      ),
    );
    try {
      await expect(publicSignupEnabled(authPool)).resolves.toBe(false);
    } finally {
      await asOwner((client) =>
        client.query(
          `insert into auth.platform_setting ("key", enabled)
           values ('public_signup', false)
           on conflict ("key") do update set enabled = excluded.enabled`,
        ),
      );
    }
  });

  it('matches only pending unexpired invitations case-insensitively', async () => {
    await asOwner((client) =>
      client.query(`
        insert into auth.invitation (
          id,
          organization_id,
          email,
          role,
          status,
          expires_at,
          inviter_id
        ) values
          ('public-signup-pending', 'org-1', 'MixedCase@example.test', 'member', 'pending', now() + interval '1 hour', 'user-1'),
          ('public-signup-expired', 'org-1', 'expired@example.test', 'member', 'pending', now() - interval '1 hour', 'user-1'),
          ('public-signup-accepted', 'org-1', 'accepted@example.test', 'member', 'accepted', now() + interval '1 hour', 'user-1'),
          ('public-signup-canceled', 'org-1', 'canceled@example.test', 'member', 'canceled', now() + interval '1 hour', 'user-1')
      `),
    );

    await expect(
      publicSignupInvitationExists(authPool, 'mixedcase@EXAMPLE.TEST'),
    ).resolves.toBe(true);
    for (const email of [
      'expired@example.test',
      'accepted@example.test',
      'canceled@example.test',
    ]) {
      await expect(publicSignupInvitationExists(authPool, email)).resolves.toBe(
        false,
      );
    }
  });

  it('atomically admits exactly three concurrent edge sign-up attempts', async () => {
    const now = 1_800_000_000_000;
    const decisions = await Promise.all(
      Array.from({ length: 4 }, () =>
        consumePublicSignupEdgeRateLimit(authPool, '198.51.100.77', now),
      ),
    );

    expect(decisions.filter(({ allowed }) => allowed)).toHaveLength(3);
    expect(decisions.filter(({ allowed }) => !allowed)).toEqual([
      { allowed: false, retryAfterSeconds: 60 },
    ]);
    await expect(
      authPool.query<{ count: number }>(
        `select count
         from auth.rate_limit
         where "key" like 'bap-edge:public-sign-up:%'`,
      ),
    ).resolves.toMatchObject({ rows: [{ count: 3 }] });
  });

  it('prunes only expired edge identities on every consume', async () => {
    const now = 1_810_000_000_000;
    await authPool.query(
      `insert into auth.rate_limit (id, "key", count, last_request)
       values
         ('expired-edge-one', 'bap-edge:public-sign-up:expired-one', 1, $1),
         ('expired-edge-two', 'bap-edge:public-sign-up:expired-two', 1, $1),
         ('fresh-edge', 'bap-edge:public-sign-up:fresh', 1, $2),
         ('expired-better-auth', 'better-auth:expired', 1, $1)`,
      [now - 60_001, now],
    );

    await expect(
      consumePublicSignupEdgeRateLimit(authPool, '203.0.113.41', now),
    ).resolves.toEqual({ allowed: true });

    await expect(
      authPool.query<{ key: string }>(
        `select "key" as key
         from auth.rate_limit
         where id in (
           'expired-edge-one',
           'expired-edge-two',
           'fresh-edge',
           'expired-better-auth'
         )
         order by "key"`,
      ),
    ).resolves.toMatchObject({
      rows: [
        { key: 'bap-edge:public-sign-up:fresh' },
        { key: 'better-auth:expired' },
      ],
    });
  });

  it('documents the auth default-privilege trap with a disposable table', async () => {
    await asOwner((client) =>
      client.query(
        'create table auth.default_privilege_probe (id text primary key)',
      ),
    );
    const privileges = await rootPool.query<{
      can_delete: boolean;
      can_insert: boolean;
      can_select: boolean;
      can_update: boolean;
    }>(`select
      has_table_privilege('bap_auth', 'auth.default_privilege_probe', 'DELETE') as can_delete,
      has_table_privilege('bap_auth', 'auth.default_privilege_probe', 'INSERT') as can_insert,
      has_table_privilege('bap_auth', 'auth.default_privilege_probe', 'SELECT') as can_select,
      has_table_privilege('bap_auth', 'auth.default_privilege_probe', 'UPDATE') as can_update`);

    expect(privileges.rows).toEqual([
      {
        can_delete: true,
        can_insert: true,
        can_select: true,
        can_update: true,
      },
    ]);
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

  it('isolates datasets, dataset rows, and uploads across tenants', async () => {
    const firstTenant = await asTenant(
      apiPool,
      { organizationId: 'org-1', userId: 'user-1' },
      async (transaction) => ({
        datasets: (
          await transaction.query<{ name: string }>(
            'select name from app.dataset order by name',
          )
        ).rows,
        rows: (
          await transaction.query<{ dataset_id: string }>(
            'select dataset_id from app.dataset_row order by dataset_id',
          )
        ).rows,
        uploads: (
          await transaction.query<{ filename: string }>(
            'select filename from app.upload order by filename',
          )
        ).rows,
      }),
    );

    // org-2 rows never appear, and inside org-1 only the subject's own dataset does.
    expect(firstTenant.datasets).toEqual([{ name: 'alpha container' }]);
    expect(firstTenant.rows).toEqual([{ dataset_id: ownedDatasetId }]);
    expect(firstTenant.uploads).toEqual([{ filename: 'upload-one.csv' }]);
    const secondTenant = await asTenant(
      apiPool,
      { organizationId: 'org-2', userId: 'user-2' },
      async (transaction) => ({
        datasets: (
          await transaction.query<{ name: string }>(
            'select name from app.dataset order by name',
          )
        ).rows,
        rows: (
          await transaction.query<{ dataset_id: string }>(
            'select dataset_id from app.dataset_row order by dataset_id',
          )
        ).rows,
        uploads: (
          await transaction.query<{ filename: string }>(
            'select filename from app.upload order by filename',
          )
        ).rows,
      }),
    );

    expect(secondTenant.datasets).toEqual([{ name: 'delta container' }]);
    expect(secondTenant.rows).toEqual([{ dataset_id: foreignDatasetId }]);
    expect(secondTenant.uploads).toEqual([{ filename: 'upload-two.csv' }]);
    await expect(
      asTenant(
        apiPool,
        { organizationId: 'org-1', userId: 'user-1' },
        async (transaction) =>
          transaction.query(
            "insert into app.dataset (organization_id, name, created_by) values ('org-2', 'intruder container', 'user-1')",
          ),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asTenant(
        apiPool,
        { organizationId: 'org-1', userId: 'user-1' },
        async (transaction) =>
          transaction.query(
            `insert into app.dataset_row (dataset_id, organization_id, row_number, data) values ('${foreignDatasetId}', 'org-2', 1, '{}')`,
          ),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asTenant(
        apiPool,
        { organizationId: 'org-1', userId: 'user-1' },
        async (transaction) =>
          transaction.query(
            "insert into app.upload (organization_id, filename, byte_size) values ('org-2', 'upload-three.csv', 1)",
          ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('never exposes dataset columns across tenants', async () => {
    const visible = await asTenant(
      apiPool,
      { organizationId: 'org-2', userId: 'user-2' },
      async (transaction) => ({
        all: (
          await transaction.query<{ name: string }>(
            'select name from app.dataset_column order by name',
          )
        ).rows,
        targeted: (
          await transaction.query<{ name: string }>(
            'select name from app.dataset_column where dataset_id = $1',
            [ownedDatasetId],
          )
        ).rows,
      }),
    );

    // app.dataset_column carries no organization_id, so the parent lookup is the only tenant boundary it has.
    expect(visible.all).toEqual([{ name: 'column_d' }]);
    expect(visible.targeted).toEqual([]);
    const owner = await asTenant(
      apiPool,
      { organizationId: 'org-1', userId: 'user-1' },
      async (transaction) => {
        const result = await transaction.query<{ name: string }>(
          'select name from app.dataset_column where dataset_id = $1',
          [ownedDatasetId],
        );
        return result.rows;
      },
    );

    expect(owner).toEqual([{ name: 'column_a' }]);
    await expect(
      asTenant(
        apiPool,
        { organizationId: 'org-1', userId: 'user-1' },
        async (transaction) =>
          transaction.query(
            `insert into app.dataset_column (dataset_id, name, position, inferred_type) values ('${foreignDatasetId}', 'column_e', 1, 'text')`,
          ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('hides another subject dataset in the same organization until a grant exists', async () => {
    const before = await asTenant(
      apiPool,
      { organizationId: 'org-1', userId: 'user-1' },
      async (transaction) => ({
        columns: (
          await transaction.query(
            'select name from app.dataset_column where dataset_id = $1',
            [sharedDatasetId],
          )
        ).rows,
        datasets: (
          await transaction.query('select id from app.dataset where id = $1', [
            sharedDatasetId,
          ])
        ).rows,
        rows: (
          await transaction.query(
            'select id from app.dataset_row where dataset_id = $1',
            [sharedDatasetId],
          )
        ).rows,
      }),
    );

    // Same tenant, different creator, no grant: the dataset and everything under it stay invisible.
    expect(before.datasets).toEqual([]);
    expect(before.rows).toEqual([]);
    expect(before.columns).toEqual([]);
    await asTenant(
      apiPool,
      { organizationId: 'org-1', userId: 'user-1' },
      async (transaction) =>
        transaction.query(
          'insert into app.data_grants (organization_id, user_id, resource_type, resource_id, scope) values ($1, $2, $3, $4, $5)',
          ['org-1', 'user-1', 'dataset', sharedDatasetId, 'read'],
        ),
    );
    const after = await asTenant(
      apiPool,
      { organizationId: 'org-1', userId: 'user-1' },
      async (transaction) => ({
        columns: (
          await transaction.query<{ name: string }>(
            'select name from app.dataset_column where dataset_id = $1',
            [sharedDatasetId],
          )
        ).rows,
        datasets: (
          await transaction.query<{ id: string }>(
            'select id from app.dataset where id = $1',
            [sharedDatasetId],
          )
        ).rows,
        rows: (
          await transaction.query<{ dataset_id: string }>(
            'select dataset_id from app.dataset_row where dataset_id = $1',
            [sharedDatasetId],
          )
        ).rows,
      }),
    );

    // The single new app.data_grants row is the only thing that changed.
    expect(after.datasets).toEqual([{ id: sharedDatasetId }]);
    expect(after.rows).toEqual([{ dataset_id: sharedDatasetId }]);
    expect(after.columns).toEqual([{ name: 'column_b' }]);
    // A read grant must not confer writing. The write policies match no row, so nothing changes.
    const write = await asTenant(
      apiPool,
      { organizationId: 'org-1', userId: 'user-1' },
      async (transaction) => {
        const renamed = await transaction.query(
          'update app.dataset set name = $1 where id = $2',
          ['renamed container', sharedDatasetId],
        );
        const removedRows = await transaction.query(
          'delete from app.dataset_row where dataset_id = $1',
          [sharedDatasetId],
        );
        const removed = await transaction.query(
          'delete from app.dataset where id = $1',
          [sharedDatasetId],
        );
        const survivors = await transaction.query<{ name: string }>(
          'select name from app.dataset where id = $1',
          [sharedDatasetId],
        );
        return {
          removed: removed.rowCount,
          removedRows: removedRows.rowCount,
          renamed: renamed.rowCount,
          survivors: survivors.rows,
        };
      },
    );

    expect(write).toEqual({
      removed: 0,
      removedRows: 0,
      renamed: 0,
      survivors: [{ name: 'beta container' }],
    });
  });

  it('ignores grants for another resource type and for another dataset', async () => {
    await asTenant(
      apiPool,
      { organizationId: 'org-1', userId: 'user-1' },
      async (transaction) => {
        await transaction.query(
          'insert into app.data_grants (organization_id, user_id, resource_type, resource_id, scope) values ($1, $2, $3, $4, $5)',
          ['org-1', 'user-1', 'report', privateDatasetId, 'read'],
        );
        await transaction.query(
          'insert into app.data_grants (organization_id, user_id, resource_type, resource_id, scope) values ($1, $2, $3, $4, $5)',
          ['org-1', 'user-1', 'dataset', unrelatedDatasetId, 'read'],
        );
      },
    );
    const visible = await asTenant(
      apiPool,
      { organizationId: 'org-1', userId: 'user-1' },
      async (transaction) => ({
        columns: (
          await transaction.query(
            'select name from app.dataset_column where dataset_id = $1',
            [privateDatasetId],
          )
        ).rows,
        datasets: (
          await transaction.query('select id from app.dataset where id = $1', [
            privateDatasetId,
          ])
        ).rows,
        rows: (
          await transaction.query(
            'select id from app.dataset_row where dataset_id = $1',
            [privateDatasetId],
          )
        ).rows,
      }),
    );

    // Only resource_type 'dataset' pointing at this exact dataset id can lift the veil.
    expect(visible.datasets).toEqual([]);
    expect(visible.rows).toEqual([]);
    expect(visible.columns).toEqual([]);
  });

  it('finds datasets by a word from the name or the description', async () => {
    const matches = await asTenant(
      apiPool,
      { organizationId: 'org-1', userId: 'user-1' },
      async (transaction) => ({
        byDescription: (
          await transaction.query<{ name: string }>(
            "select name from app.dataset where search_vector @@ plainto_tsquery('simple', 'orbit')",
          )
        ).rows,
        byName: (
          await transaction.query<{ name: string }>(
            "select name from app.dataset where search_vector @@ plainto_tsquery('simple', 'alpha')",
          )
        ).rows,
      }),
    );

    expect(matches.byName).toEqual([{ name: 'alpha container' }]);
    expect(matches.byDescription).toEqual([{ name: 'alpha container' }]);
    const foreignMatches = await asTenant(
      apiPool,
      { organizationId: 'org-2', userId: 'user-2' },
      async (transaction) => {
        const result = await transaction.query<{ name: string }>(
          "select name from app.dataset where search_vector @@ plainto_tsquery('simple', 'alpha')",
        );
        return result.rows;
      },
    );

    // Search is an ordinary read, so it stays behind the same policy.
    expect(foreignMatches).toEqual([]);
    const index = await rootPool.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where schemaname = 'app' and indexname = 'dataset_search_vector_idx'",
    );

    expect(index.rows[0]?.indexdef).toMatch(/USING gin/);
  });

  it('grants dataset writes to the application role and reads to reporting and backup', async () => {
    const written = await asTenant(
      apiPool,
      { organizationId: 'org-1', userId: 'user-1' },
      async (transaction) => {
        const dataset = await transaction.query<{ id: string }>(
          "insert into app.dataset (organization_id, name, description, created_by) values ('org-1', 'epsilon container', 'zenith placeholder text', 'user-1') returning id",
        );
        const datasetId = dataset.rows[0]?.id;
        await transaction.query(
          "insert into app.dataset_column (dataset_id, name, position, inferred_type) values ($1, 'column_f', 0, 'text')",
          [datasetId],
        );
        const row = await transaction.query<{ id: string }>(
          `insert into app.dataset_row (dataset_id, organization_id, row_number, data) values ($1, 'org-1', 0, '{"column_f": "value-f"}') returning id`,
          [datasetId],
        );
        await transaction.query(
          "insert into app.upload (organization_id, dataset_id, filename, byte_size) values ('org-1', $1, 'upload-four.csv', 64)",
          [datasetId],
        );
        const reread = await transaction.query<{ data: unknown }>(
          'select data from app.dataset_row where dataset_id = $1',
          [datasetId],
        );
        return { datasetId, reread: reread.rows, rowId: row.rows[0]?.id };
      },
    );

    // The identity column issues an id without any separate sequence grant.
    expect(typeof written.datasetId).toBe('string');
    expect(written.rowId).toBeDefined();
    expect(written.reread).toEqual([{ data: { column_f: 'value-f' } }]);
    await expect(
      reportingPool.query('select id from app.dataset'),
    ).resolves.toMatchObject({ rows: [] });
    await expect(
      reportingPool.query('select id from app.dataset_column'),
    ).resolves.toMatchObject({ rows: [] });
    await expect(
      reportingPool.query('select id from app.dataset_row'),
    ).resolves.toMatchObject({ rows: [] });
    await expect(
      reportingPool.query('select id from app.upload'),
    ).resolves.toMatchObject({ rows: [] });
    await expect(
      reportingPool.query(
        "insert into app.dataset (organization_id, name, created_by) values ('org-1', 'denied container', 'user-1')",
      ),
    ).rejects.toThrow(/permission denied/);
    for (const table of [
      'app.dataset',
      'app.dataset_column',
      'app.dataset_row',
      'app.upload',
    ]) {
      const counted = await backupPool.query<{ total: number }>(
        `select count(*)::int as total from ${table}`,
      );

      // bap_backup holds BYPASSRLS, so a dump sees every tenant's rows.
      expect(counted.rows[0]?.total).toBeGreaterThan(0);
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

  it('confines dataset embeddings to the tenant that owns the dataset', async () => {
    // The foreign vector is identical to the owned one, so a leaking search would rank it first.
    await rootPool.query(
      `insert into app.dataset_embedding (organization_id, dataset_id, model, content_hash, embedding)
       values ('org-1', $1, 'openai:test-embedding', $4, $6::vector),
              ('org-1', $2, 'openai:test-embedding', $5, $7::vector),
              ('org-2', $3, 'openai:test-embedding', $4, $6::vector)`,
      [
        ownedDatasetId,
        sharedDatasetId,
        foreignDatasetId,
        'a'.repeat(64),
        'b'.repeat(64),
        vectorLiteral([1, 0, 0]),
        vectorLiteral([0, 1, 0]),
      ],
    );
    const first = await asTenant(
      apiPool,
      { organizationId: 'org-1', userId: 'user-1' },
      async (transaction) => {
        const result = await transaction.query<{ dataset_id: string }>(
          'select dataset_id from app.dataset_embedding order by dataset_id',
        );
        return result.rows;
      },
    );
    const second = await asTenant(
      apiPool,
      { organizationId: 'org-2', userId: 'user-2' },
      async (transaction) => {
        const result = await transaction.query<{ dataset_id: string }>(
          'select dataset_id from app.dataset_embedding order by dataset_id',
        );
        return result.rows;
      },
    );

    // user-1 created the first dataset and holds a read grant on the second, so both are visible.
    expect(first).toEqual([
      { dataset_id: ownedDatasetId },
      { dataset_id: sharedDatasetId },
    ]);
    expect(second).toEqual([{ dataset_id: foreignDatasetId }]);
    await expect(
      asTenant(
        apiPool,
        { organizationId: 'org-1', userId: 'user-1' },
        async (transaction) =>
          transaction.query(
            `insert into app.dataset_embedding (organization_id, dataset_id, model, content_hash, embedding)
             values ('org-2', $1, 'openai:test-embedding', $2, $3::vector)`,
            [foreignDatasetId, 'c'.repeat(64), vectorLiteral([1, 0, 0])],
          ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('never returns another tenant row from a similarity query', async () => {
    const probe = vectorLiteral([1, 0, 0]);
    const owner = await asTenant(
      apiPool,
      { organizationId: 'org-1', userId: 'user-1' },
      async (transaction) => {
        // pgvector 0.8 introduced this setting; without it a filtered approximate scan can under-return.
        const scan = await transaction.query<{ mode: string }>(
          "select set_config('hnsw.iterative_scan', 'strict_order', true) as mode",
        );

        expect(scan.rows[0]?.mode).toBe('strict_order');
        const result = await transaction.query<{
          dataset_id: string;
          distance: number;
        }>(
          `select e.dataset_id, (e.embedding <=> $1::vector)::float8 as distance
           from app.dataset_embedding as e
           join app.dataset as d on d.id = e.dataset_id
           order by e.embedding <=> $1::vector
           limit 10`,
          [probe],
        );
        return result.rows;
      },
    );
    const stranger = await asTenant(
      apiPool,
      { organizationId: 'org-2', userId: 'user-2' },
      async (transaction) => {
        const result = await transaction.query<{ dataset_id: string }>(
          `select e.dataset_id
           from app.dataset_embedding as e
           order by e.embedding <=> $1::vector
           limit 10`,
          [probe],
        );
        return result.rows;
      },
    );

    // org-2 holds an identical vector, so its absence here is the isolation proof.
    expect(owner.map(({ dataset_id }) => dataset_id)).toEqual([
      ownedDatasetId,
      sharedDatasetId,
    ]);
    expect(Number(owner[0]?.distance)).toBeCloseTo(0);
    expect(stranger).toEqual([{ dataset_id: foreignDatasetId }]);
    const index = await rootPool.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where schemaname = 'app' and indexname = 'dataset_embedding_embedding_idx'",
    );

    expect(index.rows[0]?.indexdef).toMatch(/USING hnsw/);
    expect(index.rows[0]?.indexdef).toMatch(/vector_cosine_ops/);
    // An unknown dotted name would be accepted as a placeholder, so only a rejected value proves the setting is real.
    await expect(
      rootPool.query(
        "select set_config('hnsw.iterative_scan', 'not_a_mode', false)",
      ),
    ).rejects.toThrow(/invalid value/i);
    const extension = await rootPool.query<{ extversion: string }>(
      "select extversion from pg_extension where extname = 'vector'",
    );

    expect(extension.rows[0]?.extversion).toMatch(/^0\.(8|9)\.|^[1-9]/);
  });

  it('lets a read grant read an embedding and never delete, update or replace it', async () => {
    const write = await asTenant(
      apiPool,
      { organizationId: 'org-1', userId: 'user-1' },
      async (transaction) => {
        const removed = await transaction.query(
          'delete from app.dataset_embedding where dataset_id = $1',
          [sharedDatasetId],
        );
        const replaced = await transaction.query(
          'update app.dataset_embedding set model = $2 where dataset_id = $1',
          [sharedDatasetId, 'openai:hijacked-embedding'],
        );
        const survivors = await transaction.query<{ model: string }>(
          'select model from app.dataset_embedding where dataset_id = $1',
          [sharedDatasetId],
        );
        return {
          removed: removed.rowCount,
          replaced: replaced.rowCount,
          survivors: survivors.rows,
        };
      },
    );

    // A read grant widens SELECT only, so the per command policies leave the row untouched.
    expect(write).toEqual({
      removed: 0,
      replaced: 0,
      survivors: [{ model: 'openai:test-embedding' }],
    });
    await expect(
      asTenant(
        apiPool,
        { organizationId: 'org-1', userId: 'user-1' },
        async (transaction) =>
          transaction.query(
            `insert into app.dataset_embedding (organization_id, dataset_id, model, content_hash, embedding)
             values ('org-1', $1, 'openai:test-embedding', $2, $3::vector)
             on conflict (dataset_id) do update set model = excluded.model`,
            [sharedDatasetId, 'd'.repeat(64), vectorLiteral([0, 0, 1])],
          ),
      ),
    ).rejects.toThrow(/row-level security/);
    // The creator of a dataset keeps every command on its embedding.
    const creator = await asTenant(
      apiPool,
      { organizationId: 'org-1', userId: 'user-1' },
      async (transaction) => {
        const created = await transaction.query<{ id: string }>(
          "insert into app.dataset (organization_id, name, status, created_by) values ('org-1', 'zeta container', 'ready', 'user-1') returning id",
        );
        const datasetId = created.rows[0]?.id;
        await transaction.query(
          `insert into app.dataset_embedding (organization_id, dataset_id, model, content_hash, embedding)
           values ('org-1', $1, 'openai:test-embedding', $2, $3::vector)`,
          [datasetId, 'e'.repeat(64), vectorLiteral([0, 0, 1])],
        );
        const updated = await transaction.query(
          'update app.dataset_embedding set content_hash = $2 where dataset_id = $1',
          [datasetId, 'f'.repeat(64)],
        );
        const removed = await transaction.query(
          'delete from app.dataset_embedding where dataset_id = $1',
          [datasetId],
        );
        await transaction.query('delete from app.dataset where id = $1', [
          datasetId,
        ]);
        return { removed: removed.rowCount, updated: updated.rowCount };
      },
    );

    expect(creator).toEqual({ removed: 1, updated: 1 });
  });

  it('grants embedding writes to the application role and reads to reporting and backup', async () => {
    await expect(
      reportingPool.query('select id from app.dataset_embedding'),
    ).resolves.toMatchObject({ rows: [] });
    await expect(
      reportingPool.query(
        `insert into app.dataset_embedding (organization_id, dataset_id, model, content_hash, embedding)
         values ('org-1', $1, 'openai:test-embedding', $2, $3::vector)`,
        [ownedDatasetId, 'a'.repeat(64), vectorLiteral([1, 0, 0])],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      reportingPool.query('delete from app.dataset_embedding'),
    ).rejects.toThrow(/permission denied/);
    const counted = await backupPool.query<{ total: number }>(
      'select count(*)::int as total from app.dataset_embedding',
    );

    // bap_backup holds BYPASSRLS, so a dump sees every tenant's vectors.
    expect(counted.rows[0]?.total).toBe(3);
    await expect(
      backupPool.query('delete from app.dataset_embedding'),
    ).rejects.toThrow();
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
      // Word boundaries keep 'dataset' from matching the 'dataset_column' and 'dataset_row' entries.
      expect(contents.output).toMatch(/TABLE app dataset\b/);
      expect(contents.output).toMatch(/TABLE DATA app dataset\b/);
      expect(contents.output).toContain('TABLE app dataset_column');
      expect(contents.output).toContain('TABLE DATA app dataset_column');
      expect(contents.output).toContain('TABLE app dataset_row');
      expect(contents.output).toContain('TABLE DATA app dataset_row');
      expect(contents.output).toContain('TABLE app upload');
      expect(contents.output).toContain('TABLE DATA app upload');
      expect(contents.output).toContain('TABLE app dataset_embedding');
      expect(contents.output).toContain('TABLE DATA app dataset_embedding');
    } finally {
      await container.exec(['rm', '-f', '/tmp/bap-backup-test.dump']);
    }
  });
});
