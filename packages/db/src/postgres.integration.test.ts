import { readFile, readdir } from 'node:fs/promises';

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  bootstrapDatabaseRoles,
  checkMigrationCompatibility,
  countSoleOwnedOrganizations,
  consumePublicSignupEdgeRateLimit,
  ensureInitialOrganizationQuota,
  getOrganizationCreationQuota,
  organizationCreationLimitReached,
  publicSignupInvitationExists,
  publicSignupEnabled,
  recordUserErasureRequest,
  resolveMembership,
  resolveOrganizationRoute,
  runMigrations,
  setOrganizationQuota,
  withTenantContext,
} from './index.js';
import type { TenantContext } from './index.js';
import { executeEraseUser } from './cli.js';

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

type OrganizationSlugCase = Readonly<{ slug: string; valid: boolean }>;

async function readOrganizationSlugCorpus(): Promise<OrganizationSlugCase[]> {
  return JSON.parse(
    await readFile(
      new URL(
        '../../../tests/fixtures/organization-slugs.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as OrganizationSlugCase[];
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

async function asEraser<T>(
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await migratorPool.connect();
  await client.query('begin');
  await client.query('set local role bap_owner');
  await client.query('set local role bap_eraser');

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
    await expect(
      resolveMembership(apiPool, {
        organizationId: 'one',
        subjectId: 'user-1',
      }),
    ).resolves.toBeNull();
  });

  it('resolves an organization slug only for its member through bap_auth', async () => {
    await expect(
      resolveOrganizationRoute(authPool, {
        organizationSlug: 'one',
        subjectId: 'user-1',
      }),
    ).resolves.toEqual({
      id: 'org-1',
      name: 'One',
      role: 'owner',
      slug: 'one',
    });
    await expect(
      resolveOrganizationRoute(authPool, {
        organizationSlug: 'two',
        subjectId: 'user-1',
      }),
    ).resolves.toBeNull();
    await expect(
      resolveOrganizationRoute(authPool, {
        organizationSlug: 'unknown-organization',
        subjectId: 'user-1',
      }),
    ).resolves.toBeNull();
  });

  it('pins the organization schema, quota ACL, trigger, and function exactly', async () => {
    const columns = await rootPool.query<{
      column_default: string | null;
      column_name: string;
      data_type: string;
      is_nullable: 'NO' | 'YES';
    }>(`select column_name, data_type, is_nullable, column_default
       from information_schema.columns
       where table_schema = 'auth'
         and table_name = 'organization_quota'
       order by ordinal_position`);
    expect(columns.rows).toEqual([
      {
        column_default: null,
        column_name: 'user_id',
        data_type: 'text',
        is_nullable: 'NO',
      },
      {
        column_default: '0',
        column_name: 'granted_total',
        data_type: 'integer',
        is_nullable: 'NO',
      },
      {
        column_default: null,
        column_name: 'granted_by',
        data_type: 'text',
        is_nullable: 'YES',
      },
      {
        column_default: 'now()',
        column_name: 'granted_at',
        data_type: 'timestamp with time zone',
        is_nullable: 'NO',
      },
      {
        column_default: null,
        column_name: 'note',
        data_type: 'text',
        is_nullable: 'YES',
      },
    ]);

    const constraints = await rootPool.query<{
      conname: string;
      convalidated: boolean;
      definition: string;
      table_name: string;
    }>(`select relation.relname as table_name,
              catalog_constraint.conname,
              catalog_constraint.convalidated,
              pg_get_constraintdef(catalog_constraint.oid) as definition
       from pg_constraint as catalog_constraint
       inner join pg_class as relation on relation.oid = catalog_constraint.conrelid
       inner join pg_namespace as namespace on namespace.oid = relation.relnamespace
       where namespace.nspname = 'auth'
         and catalog_constraint.conname in (
           'organization_created_by_fkey',
           'organization_slug_format_check',
           'organization_slug_length_check',
           'organization_slug_not_numeric_check',
           'organization_slug_reserved_check',
           'organization_quota_pkey',
           'organization_quota_user_id_fkey',
           'organization_quota_granted_by_fkey',
           'organization_quota_granted_total_check',
           'member_role_check',
           'invitation_role_check'
         )
       order by catalog_constraint.conname`);
    expect(constraints.rows).toEqual([
      {
        conname: 'invitation_role_check',
        convalidated: false,
        definition:
          "CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text]))) NOT VALID",
        table_name: 'invitation',
      },
      {
        conname: 'member_role_check',
        convalidated: false,
        definition:
          "CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text]))) NOT VALID",
        table_name: 'member',
      },
      {
        conname: 'organization_created_by_fkey',
        convalidated: true,
        definition:
          'FOREIGN KEY (created_by) REFERENCES auth."user"(id) ON DELETE SET NULL',
        table_name: 'organization',
      },
      {
        conname: 'organization_quota_granted_by_fkey',
        convalidated: true,
        definition:
          'FOREIGN KEY (granted_by) REFERENCES auth."user"(id) ON DELETE SET NULL',
        table_name: 'organization_quota',
      },
      {
        conname: 'organization_quota_granted_total_check',
        convalidated: true,
        definition: 'CHECK ((granted_total >= 0))',
        table_name: 'organization_quota',
      },
      {
        conname: 'organization_quota_pkey',
        convalidated: true,
        definition: 'PRIMARY KEY (user_id)',
        table_name: 'organization_quota',
      },
      {
        conname: 'organization_quota_user_id_fkey',
        convalidated: true,
        definition:
          'FOREIGN KEY (user_id) REFERENCES auth."user"(id) ON DELETE CASCADE',
        table_name: 'organization_quota',
      },
      {
        conname: 'organization_slug_format_check',
        convalidated: true,
        definition: "CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text))",
        table_name: 'organization',
      },
      {
        conname: 'organization_slug_length_check',
        convalidated: true,
        definition:
          'CHECK (((char_length(slug) >= 3) AND (char_length(slug) <= 20)))',
        table_name: 'organization',
      },
      {
        conname: 'organization_slug_not_numeric_check',
        convalidated: true,
        definition: "CHECK ((slug !~ '^[0-9]+$'::text))",
        table_name: 'organization',
      },
      {
        conname: 'organization_slug_reserved_check',
        convalidated: true,
        definition:
          "CHECK ((slug <> ALL (ARRAY['access'::text, 'api'::text, 'datasets'::text, 'design-system'::text, 'health'::text, 'invitation'::text, 'metrics'::text, 'ready'::text, 'sign-in'::text, 'sign-up'::text, 'forgot-password'::text, 'reset-password'::text, 'activate'::text, 'welcome'::text, 'account'::text, 'organizations'::text])))",
        table_name: 'organization',
      },
    ]);

    const foreignKeys = await rootPool.query<{
      confdeltype: string;
      conname: string;
    }>(`select conname, confdeltype
       from pg_constraint
       where conname in (
         'organization_created_by_fkey',
         'organization_quota_user_id_fkey',
         'organization_quota_granted_by_fkey'
       )
       order by conname`);
    expect(foreignKeys.rows).toEqual([
      { confdeltype: 'n', conname: 'organization_created_by_fkey' },
      { confdeltype: 'n', conname: 'organization_quota_granted_by_fkey' },
      { confdeltype: 'c', conname: 'organization_quota_user_id_fkey' },
    ]);

    const tableAcl = await rootPool.query<{
      grantee: string;
      privilege_type: string;
    }>(`select grantee, privilege_type
       from information_schema.table_privileges
       where table_schema = 'auth'
         and table_name = 'organization_quota'
       order by grantee, privilege_type`);
    expect(tableAcl.rows).toEqual([
      { grantee: 'bap_auth', privilege_type: 'SELECT' },
      { grantee: 'bap_backup', privilege_type: 'SELECT' },
      { grantee: 'bap_owner', privilege_type: 'DELETE' },
      { grantee: 'bap_owner', privilege_type: 'INSERT' },
      { grantee: 'bap_owner', privilege_type: 'REFERENCES' },
      { grantee: 'bap_owner', privilege_type: 'SELECT' },
      { grantee: 'bap_owner', privilege_type: 'TRIGGER' },
      { grantee: 'bap_owner', privilege_type: 'TRUNCATE' },
      { grantee: 'bap_owner', privilege_type: 'UPDATE' },
    ]);

    const defaultTableAcl = await rootPool.query<{
      grantee: string;
      privilege_type: string;
    }>(`select role.rolname as grantee, privilege.privilege_type
       from pg_default_acl as default_acl
       cross join lateral aclexplode(default_acl.defaclacl) as privilege
       inner join pg_roles as role on role.oid = privilege.grantee
       where default_acl.defaclrole = 'bap_owner'::regrole
         and default_acl.defaclnamespace = 'auth'::regnamespace
         and default_acl.defaclobjtype = 'r'
       order by grantee, privilege_type`);
    expect(defaultTableAcl.rows).toEqual([
      { grantee: 'bap_auth', privilege_type: 'DELETE' },
      { grantee: 'bap_auth', privilege_type: 'INSERT' },
      { grantee: 'bap_auth', privilege_type: 'SELECT' },
      { grantee: 'bap_auth', privilege_type: 'UPDATE' },
      { grantee: 'bap_backup', privilege_type: 'SELECT' },
    ]);

    const functionProperties = await rootPool.query<{
      owner: string;
      proconfig: string[];
      prosecdef: boolean;
    }>(`select pg_get_userbyid(proowner) as owner, proconfig, prosecdef
       from pg_proc
       where oid = 'auth.enforce_organization_creation_quota()'::regprocedure`);
    expect(functionProperties.rows).toEqual([
      {
        owner: 'bap_owner',
        proconfig: ['search_path=pg_catalog, auth'],
        prosecdef: false,
      },
    ]);
    const functionDefinition = await rootPool.query<{ definition: string }>(
      `select pg_get_functiondef(
         'auth.enforce_organization_creation_quota()'::regprocedure
       ) as definition`,
    );
    expect(functionDefinition.rows[0]?.definition).toContain(
      'PERFORM pg_advisory_xact_lock(hashtext(NEW.created_by));',
    );
    expect(functionDefinition.rows[0]?.definition).not.toContain('FOR UPDATE');

    const functionAcl = await rootPool.query<{
      grantee: string;
      privilege_type: string;
    }>(`select coalesce(grantee_role.rolname, 'PUBLIC') as grantee,
              privilege.privilege_type
       from pg_proc as function
       cross join lateral aclexplode(
         coalesce(function.proacl, acldefault('f', function.proowner))
       ) as privilege
       left join pg_roles as grantee_role on grantee_role.oid = privilege.grantee
       where function.oid = 'auth.enforce_organization_creation_quota()'::regprocedure
       order by grantee, privilege_type`);
    expect(functionAcl.rows).toEqual([
      { grantee: 'bap_owner', privilege_type: 'EXECUTE' },
    ]);

    const trigger = await rootPool.query<{
      function_name: string;
      tgenabled: string;
      tgname: string;
    }>(`select trigger.tgname,
              trigger.tgenabled,
              trigger.tgfoid::regprocedure::text as function_name
       from pg_trigger as trigger
       where trigger.tgrelid = 'auth.organization'::regclass
         and not trigger.tgisinternal`);
    expect(trigger.rows).toEqual([
      {
        function_name: 'auth.enforce_organization_creation_quota()',
        tgenabled: 'O',
        tgname: 'organization_creation_quota_trigger',
      },
    ]);

    await expect(
      authPool.query('select user_id from auth.organization_quota'),
    ).resolves.toBeDefined();
    for (const statement of [
      `insert into auth.organization_quota (user_id, granted_total) values ('user-1', 1)`,
      `update auth.organization_quota set granted_total = 99 where user_id = 'user-1'`,
      `delete from auth.organization_quota where user_id = 'user-1'`,
    ]) {
      await expect(authPool.query(statement)).rejects.toThrow(
        /permission denied/,
      );
    }
    await expect(
      authPool.query('select auth.enforce_organization_creation_quota()'),
    ).rejects.toThrow(/permission denied/);
    await expect(
      authPool.query(
        'alter table auth.organization disable trigger organization_creation_quota_trigger',
      ),
    ).rejects.toThrow(/must be owner|permission denied/);
    await expect(
      authPool.query("set session_replication_role = 'replica'"),
    ).rejects.toThrow(/permission denied/);
    for (const pool of [apiPool, reportingPool]) {
      await expect(
        pool.query('select user_id from auth.organization_quota'),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it('rejects every reserved slug and keeps all database slug rules in parity with the shared corpus', async () => {
    const corpus = await readOrganizationSlugCorpus();

    for (const [index, testCase] of corpus.entries()) {
      const insertion = asOwner((client) =>
        client.query(
          `insert into auth.organization (id, name, slug)
           values ($1, 'Slug parity fixture', $2)`,
          [`slug-parity-${index}`, testCase.slug],
        ),
      );
      if (testCase.valid) {
        await expect(insertion, testCase.slug).resolves.toBeDefined();
      } else {
        await expect(insertion, testCase.slug).rejects.toThrow();
      }
    }

    await asOwner((client) =>
      client.query(
        "delete from auth.organization where id like 'slug-parity-%'",
      ),
    );
  });

  it('fails the route reservation migration before replacing the constraint when the slug is occupied', async () => {
    const migration = await readFile(
      new URL(
        '../drizzle/20260831.0004_organizations_route_slug.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const client = await migratorPool.connect();
    let transactionOpen = false;

    try {
      await client.query('begin');
      transactionOpen = true;
      await client.query('set local role bap_owner');
      await client.query(
        'alter table auth.organization drop constraint organization_slug_reserved_check',
      );
      await client.query(
        `insert into auth.organization (id, name, slug)
         values ('reserved-route-collision', 'Reserved route collision', 'organizations')`,
      );

      await expect(client.query(migration)).rejects.toMatchObject({
        code: '23514',
        constraint: 'organization_slug_reserved_check',
      });
    } finally {
      if (transactionOpen) {
        await client.query('rollback').catch(() => undefined);
      }
      client.release();
    }

    await expect(
      asOwner((owner) =>
        owner.query(
          `insert into auth.organization (id, name, slug)
           values ('reserved-route-still-blocked', 'Reserved route blocked', 'organizations')`,
        ),
      ),
    ).rejects.toThrow();
  });

  it('enforces attributed quota atomically and preserves initial-seed provenance', async () => {
    await asOwner(async (client) => {
      await client.query(`
        insert into auth."user" (id, name, email, email_verified)
        values
          ('quota-none', 'Quota None', 'quota-none@example.test', true),
          ('quota-two', 'Quota Two', 'quota-two@example.test', true),
          ('quota-race', 'Quota Race', 'quota-race@example.test', true),
          ('quota-zero', 'Quota Zero', 'quota-zero@example.test', true),
          ('quota-existing', 'Quota Existing', 'quota-existing@example.test', true),
          ('quota-operator', 'Quota Operator', 'quota-operator@example.test', true),
          ('quota-grantor', 'Quota Grantor', 'quota-grantor@example.test', true)
      `);
      await client.query(`
        insert into auth.organization_quota (
          user_id, granted_total, granted_by, granted_at, note
        ) values
          ('quota-two', 2, 'quota-grantor', '2026-08-30T12:00:00Z', 'two approved'),
          ('quota-race', 1, 'quota-grantor', '2026-08-30T12:00:00Z', 'one approved'),
          ('quota-zero', 0, 'quota-grantor', '2026-08-30T12:00:00Z', 'zero approved'),
          ('quota-existing', 4, 'quota-grantor', '2026-08-30T12:00:00Z', 'four approved')
      `);
    });

    try {
      await expect(
        organizationCreationLimitReached(authPool, 'quota-none'),
      ).resolves.toBeNull();
      await expect(
        setOrganizationQuota(migratorPool, {
          email: 'quota-operator@example.test',
          note: 'operator-approved: phase-8 integration',
          total: 2,
        }),
      ).resolves.toMatchObject({
        grantedBy: null,
        grantedTotal: 2,
        note: 'operator-approved: phase-8 integration',
        userId: 'quota-operator',
      });
      await expect(
        organizationCreationLimitReached(authPool, 'quota-operator'),
      ).resolves.toBe(false);

      await expect(
        authPool.query(
          `insert into auth.organization (id, name, slug, created_by)
           values ('quota-denied', 'Quota Denied', 'quota-denied', 'quota-none')`,
        ),
      ).rejects.toThrow(/quota exceeded/);
      await expect(
        authPool.query(
          `insert into auth.organization (id, name, slug, created_by)
           values ('quota-null', 'Quota Null', 'quota-null', null)`,
        ),
      ).resolves.toBeDefined();
      await expect(
        authPool.query(
          `insert into auth.organization (id, name, slug, created_by)
           values
             ('quota-two-1', 'Quota Two One', 'quota-two-one', 'quota-two'),
             ('quota-two-2', 'Quota Two Two', 'quota-two-two', 'quota-two')`,
        ),
      ).resolves.toBeDefined();
      await expect(
        authPool.query(
          `insert into auth.organization (id, name, slug, created_by)
           values ('quota-two-3', 'Quota Two Three', 'quota-two-three', 'quota-two')`,
        ),
      ).rejects.toThrow(/quota exceeded/);
      await expect(
        organizationCreationLimitReached(authPool, 'quota-two'),
      ).resolves.toBe(true);
      await expect(
        getOrganizationCreationQuota(authPool, 'quota-two'),
      ).resolves.toEqual({
        attributedTotal: 2,
        grantedTotal: 2,
        remainingTotal: 0,
      });
      await expect(
        getOrganizationCreationQuota(authPool, 'quota-none'),
      ).resolves.toBeNull();

      const firstRaceClient = await authPool.connect();
      let firstTransactionOpen = false;

      try {
        const secondRaceClient = await authPool.connect();
        let secondTransactionOpen = false;
        let secondInsertOutcome:
          | Promise<
              | Readonly<{ status: 'fulfilled' }>
              | Readonly<{ error: unknown; status: 'rejected' }>
            >
          | undefined;

        try {
          await firstRaceClient.query('begin');
          firstTransactionOpen = true;
          await secondRaceClient.query('begin');
          secondTransactionOpen = true;
          const firstPid = await firstRaceClient.query<{ pid: number }>(
            'select pg_backend_pid() as pid',
          );
          const secondPid = await secondRaceClient.query<{ pid: number }>(
            'select pg_backend_pid() as pid',
          );
          const firstBackendPid = firstPid.rows[0]?.pid;
          const secondBackendPid = secondPid.rows[0]?.pid;
          expect(firstBackendPid).toBeTypeOf('number');
          expect(secondBackendPid).toBeTypeOf('number');
          expect(secondBackendPid).not.toBe(firstBackendPid);

          await firstRaceClient.query(
            `insert into auth.organization (id, name, slug, created_by)
             values ('quota-race-1', 'Quota Race One', 'quota-race-one', 'quota-race')`,
          );
          secondInsertOutcome = secondRaceClient
            .query(
              `insert into auth.organization (id, name, slug, created_by)
               values ('quota-race-2', 'Quota Race Two', 'quota-race-two', 'quota-race')`,
            )
            .then<Readonly<{ status: 'fulfilled' }>>(() => ({
              status: 'fulfilled',
            }))
            .catch<Readonly<{ error: unknown; status: 'rejected' }>>(
              (error) => ({
                error,
                status: 'rejected',
              }),
            );

          let observedAdvisoryWait = false;
          for (let attempt = 0; attempt < 1_000; attempt += 1) {
            const locks = await rootPool.query<{
              holder_granted: boolean;
              waiter_waiting: boolean;
            }>(
              `select
                 exists (
                   select 1
                   from pg_locks
                   where locktype = 'advisory'
                     and mode = 'ExclusiveLock'
                     and pid = $1
                     and granted
                 ) as holder_granted,
                 exists (
                   select 1
                   from pg_locks
                   where locktype = 'advisory'
                     and mode = 'ExclusiveLock'
                     and pid = $2
                     and not granted
                 ) as waiter_waiting`,
              [firstBackendPid, secondBackendPid],
            );
            const lockState = locks.rows[0];
            if (lockState?.holder_granted && lockState.waiter_waiting) {
              observedAdvisoryWait = true;
              break;
            }
          }
          expect(observedAdvisoryWait).toBe(true);

          await firstRaceClient.query('commit');
          firstTransactionOpen = false;
          const secondResult = await secondInsertOutcome;
          expect(secondResult.status).toBe('rejected');
          if (secondResult.status === 'rejected') {
            expect(secondResult.error).toMatchObject({
              code: '23514',
              constraint: 'organization_creation_quota_check',
              message: 'Organization creation quota exceeded',
            });
          }
          await secondRaceClient.query('rollback');
          secondTransactionOpen = false;

          await expect(
            rootPool.query<{ total: number }>(
              `select count(*)::integer as total
               from auth.organization
               where created_by = 'quota-race'`,
            ),
          ).resolves.toMatchObject({ rows: [{ total: 1 }] });
        } finally {
          if (firstTransactionOpen) {
            await firstRaceClient.query('rollback').catch(() => undefined);
            firstTransactionOpen = false;
          }
          if (secondInsertOutcome !== undefined) {
            await secondInsertOutcome;
          }
          if (secondTransactionOpen) {
            await secondRaceClient.query('rollback').catch(() => undefined);
          }
          secondRaceClient.release();
        }
      } finally {
        if (firstTransactionOpen) {
          await firstRaceClient.query('rollback').catch(() => undefined);
        }
        firstRaceClient.release();
      }

      await expect(
        ensureInitialOrganizationQuota(migratorPool, 'quota-none'),
      ).resolves.toMatchObject({
        grantedBy: null,
        grantedTotal: 1,
        note: 'system-bootstrap: initial organization',
      });
      await expect(
        ensureInitialOrganizationQuota(migratorPool, 'quota-zero'),
      ).resolves.toMatchObject({
        grantedBy: null,
        grantedTotal: 1,
        note: 'system-bootstrap: initial organization',
      });
      await expect(
        ensureInitialOrganizationQuota(migratorPool, 'quota-existing'),
      ).resolves.toMatchObject({
        grantedAt: new Date('2026-08-30T12:00:00.000Z'),
        grantedBy: 'quota-grantor',
        grantedTotal: 4,
        note: 'four approved',
      });
    } finally {
      await asOwner(async (client) => {
        await client.query(
          "delete from auth.organization where id like 'quota-%'",
        );
        await client.query('delete from auth."user" where id like \'quota-%\'');
      });
    }
  });

  it('applies creator and quota foreign-key deletion policies and scalar role checks', async () => {
    await asOwner(async (client) => {
      await client.query(`
        insert into auth."user" (id, name, email, email_verified)
        values
          ('schema-subject', 'Schema Subject', 'schema-subject@example.test', true),
          ('schema-grantor', 'Schema Grantor', 'schema-grantor@example.test', true)
      `);
      await client.query(`
        insert into auth.organization_quota (user_id, granted_total, granted_by, note)
        values ('schema-subject', 1, 'schema-grantor', 'schema test')
      `);
      await client.query(`
        insert into auth.organization (id, name, slug, created_by)
        values ('schema-org', 'Schema Organization', 'schema-org', 'schema-subject')
      `);
      await client.query(`
        insert into auth.member (id, organization_id, user_id, role)
        values ('schema-member', 'schema-org', 'schema-subject', 'owner')
      `);
      await client.query(`
        insert into auth.invitation (
          id, organization_id, email, role, status, expires_at, inviter_id
        ) values (
          'schema-invitation', 'schema-org', 'schema-invite@example.test',
          'member', 'pending', now() + interval '1 hour', 'schema-grantor'
        )
      `);
    });

    await expect(
      asOwner((client) =>
        client.query(`
          insert into auth.member (id, organization_id, user_id, role)
          values ('schema-invalid-member', 'schema-org', 'schema-grantor', 'owner,admin')
        `),
      ),
    ).rejects.toThrow(/member_role_check/);
    await expect(
      asOwner((client) =>
        client.query(`
          insert into auth.invitation (
            id, organization_id, email, role, status, expires_at, inviter_id
          ) values (
            'schema-invalid-invitation', 'schema-org', 'invalid@example.test',
            'legacy', 'pending', now() + interval '1 hour', 'schema-grantor'
          )
        `),
      ),
    ).rejects.toThrow(/invitation_role_check/);

    await asOwner((client) =>
      client.query('delete from auth."user" where id = \'schema-grantor\''),
    );
    await expect(
      rootPool.query<{ granted_by: string | null }>(
        "select granted_by from auth.organization_quota where user_id = 'schema-subject'",
      ),
    ).resolves.toMatchObject({ rows: [{ granted_by: null }] });
    await asOwner((client) =>
      client.query('delete from auth."user" where id = \'schema-subject\''),
    );
    await expect(
      rootPool.query<{ created_by: string | null }>(
        "select created_by from auth.organization where id = 'schema-org'",
      ),
    ).resolves.toMatchObject({ rows: [{ created_by: null }] });
    await expect(
      rootPool.query(
        "select user_id from auth.organization_quota where user_id = 'schema-subject'",
      ),
    ).resolves.toMatchObject({ rows: [] });
    await asOwner((client) =>
      client.query("delete from auth.organization where id = 'schema-org'"),
    );
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

  it('executes inherited auth-table DML as bap_auth on a newly created disposable table', async () => {
    await asOwner((client) =>
      client.query(
        'create table auth.default_privilege_probe (id text primary key, value text not null)',
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
    await expect(
      authPool.query(
        "insert into auth.default_privilege_probe (id, value) values ('probe', 'initial') returning id, value",
      ),
    ).resolves.toMatchObject({
      rows: [{ id: 'probe', value: 'initial' }],
    });
    await expect(
      authPool.query(
        "select id, value from auth.default_privilege_probe where id = 'probe'",
      ),
    ).resolves.toMatchObject({
      rows: [{ id: 'probe', value: 'initial' }],
    });
    await expect(
      authPool.query(
        "update auth.default_privilege_probe set value = 'updated' where id = 'probe' returning id, value",
      ),
    ).resolves.toMatchObject({
      rows: [{ id: 'probe', value: 'updated' }],
    });
    await expect(
      authPool.query(
        "delete from auth.default_privilege_probe where id = 'probe' returning id, value",
      ),
    ).resolves.toMatchObject({
      rows: [{ id: 'probe', value: 'updated' }],
    });
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

  it('reconciles the eraser role to exact non-login operator-only privileges', async () => {
    const databaseName = container.getDatabase().replaceAll('"', '""');
    await rootPool.query(
      "alter role bap_eraser login inherit nobypassrls password 'test-only-temporary-password'",
    );
    await rootPool.query(
      `grant connect on database "${databaseName}" to bap_eraser`,
    );
    await rootPool.query(
      'grant bap_eraser to bap_auth with inherit true, set true, admin false',
    );
    await rootPool.query('grant pg_read_all_settings to bap_eraser');
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

    const role = await rootPool.query<{
      rolbypassrls: boolean;
      rolcanlogin: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolinherit: boolean;
      rolpasswordisnull: boolean;
      rolreplication: boolean;
      rolsuper: boolean;
    }>(`select
      rolbypassrls,
      rolcanlogin,
      rolcreatedb,
      rolcreaterole,
      rolinherit,
      rolpassword is null as rolpasswordisnull,
      rolreplication,
      rolsuper
    from pg_authid
    where rolname = 'bap_eraser'`);
    expect(role.rows).toEqual([
      {
        rolbypassrls: true,
        rolcanlogin: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolinherit: false,
        rolpasswordisnull: true,
        rolreplication: false,
        rolsuper: false,
      },
    ]);

    const memberships = await rootPool.query<{
      admin_option: boolean;
      granted_role: string;
      inherit_option: boolean;
      member_role: string;
      set_option: boolean;
    }>(`select
      granted_role.rolname as granted_role,
      member_role.rolname as member_role,
      membership.admin_option,
      membership.inherit_option,
      membership.set_option
    from pg_auth_members as membership
    inner join pg_roles as granted_role on granted_role.oid = membership.roleid
    inner join pg_roles as member_role on member_role.oid = membership.member
    where granted_role.rolname = 'bap_eraser'
       or member_role.rolname = 'bap_eraser'
    order by granted_role, member_role`);
    expect(memberships.rows).toEqual([
      {
        admin_option: false,
        granted_role: 'bap_eraser',
        inherit_option: false,
        member_role: 'bap_owner',
        set_option: true,
      },
    ]);

    const connectivity = await rootPool.query<{ can_connect: boolean }>(
      `select has_database_privilege(
        'bap_eraser',
        current_database(),
        'CONNECT'
      ) as can_connect`,
    );
    expect(connectivity.rows).toEqual([{ can_connect: false }]);
  });

  it('pins request and erasure functions, table ACLs, and column-scoped eraser grants', async () => {
    const functionProperties = await rootPool.query<{
      identity_arguments: string;
      owner: string;
      proconfig: string[];
      prosecdef: boolean;
      schema_name: string;
    }>(`select
      namespace.nspname as schema_name,
      pg_get_function_identity_arguments(function.oid) as identity_arguments,
      pg_get_userbyid(function.proowner) as owner,
      function.proconfig,
      function.prosecdef
    from pg_proc as function
    inner join pg_namespace as namespace on namespace.oid = function.pronamespace
    where function.oid in (
      'auth.request_user_erasure(text)'::regprocedure,
      'app.erase_user(text)'::regprocedure
    )
    order by schema_name`);
    expect(functionProperties.rows).toEqual([
      {
        identity_arguments: 'subject_user_id text',
        owner: 'bap_owner',
        proconfig: ['search_path=pg_catalog, app'],
        prosecdef: false,
        schema_name: 'app',
      },
      {
        identity_arguments: 'requested_user_id text',
        owner: 'bap_owner',
        proconfig: ['search_path=pg_catalog, auth'],
        prosecdef: true,
        schema_name: 'auth',
      },
    ]);

    const functionAcl = await rootPool.query<{
      function_name: string;
      grantee: string;
      privilege_type: string;
    }>(`select
      namespace.nspname || '.' || function.proname as function_name,
      coalesce(grantee_role.rolname, 'PUBLIC') as grantee,
      privilege.privilege_type
    from pg_proc as function
    inner join pg_namespace as namespace on namespace.oid = function.pronamespace
    cross join lateral aclexplode(
      coalesce(function.proacl, acldefault('f', function.proowner))
    ) as privilege
    left join pg_roles as grantee_role on grantee_role.oid = privilege.grantee
    where function.oid in (
      'auth.request_user_erasure(text)'::regprocedure,
      'app.erase_user(text)'::regprocedure
    )
    order by function_name, grantee, privilege_type`);
    expect(functionAcl.rows).toEqual([
      {
        function_name: 'app.erase_user',
        grantee: 'bap_eraser',
        privilege_type: 'EXECUTE',
      },
      {
        function_name: 'app.erase_user',
        grantee: 'bap_owner',
        privilege_type: 'EXECUTE',
      },
      {
        function_name: 'auth.request_user_erasure',
        grantee: 'bap_auth',
        privilege_type: 'EXECUTE',
      },
      {
        function_name: 'auth.request_user_erasure',
        grantee: 'bap_owner',
        privilege_type: 'EXECUTE',
      },
    ]);

    const requestTableAcl = await rootPool.query<{
      grantee: string;
      privilege_type: string;
    }>(`select grantee, privilege_type
       from information_schema.table_privileges
       where table_schema = 'auth'
         and table_name = 'user_erasure_request'
       order by grantee, privilege_type`);
    expect(requestTableAcl.rows).toEqual([
      { grantee: 'bap_backup', privilege_type: 'SELECT' },
      { grantee: 'bap_owner', privilege_type: 'DELETE' },
      { grantee: 'bap_owner', privilege_type: 'INSERT' },
      { grantee: 'bap_owner', privilege_type: 'REFERENCES' },
      { grantee: 'bap_owner', privilege_type: 'SELECT' },
      { grantee: 'bap_owner', privilege_type: 'TRIGGER' },
      { grantee: 'bap_owner', privilege_type: 'TRUNCATE' },
      { grantee: 'bap_owner', privilege_type: 'UPDATE' },
    ]);

    const eraserSchemaAccess = await rootPool.query<{
      can_create: boolean;
      can_use: boolean;
    }>(`select
      has_schema_privilege('bap_eraser', 'app', 'CREATE') as can_create,
      has_schema_privilege('bap_eraser', 'app', 'USAGE') as can_use`);
    expect(eraserSchemaAccess.rows).toEqual([
      { can_create: false, can_use: true },
    ]);

    const eraserTableAcl = await rootPool.query<{
      privilege_type: string;
      table_name: string;
    }>(`select table_name, privilege_type
       from information_schema.table_privileges
       where table_schema = 'app'
         and grantee = 'bap_eraser'
       order by table_name, privilege_type`);
    expect(eraserTableAcl.rows).toEqual([]);

    const eraserColumns = await rootPool.query<{
      column_name: string;
      privilege_type: string;
      table_name: string;
    }>(`select table_name, column_name, privilege_type
       from information_schema.column_privileges
       where table_schema = 'app'
         and grantee = 'bap_eraser'
       order by table_name, column_name, privilege_type`);
    expect(eraserColumns.rows).toEqual([
      {
        column_name: 'user_id',
        privilege_type: 'SELECT',
        table_name: 'audit_log',
      },
      {
        column_name: 'user_id',
        privilege_type: 'UPDATE',
        table_name: 'audit_log',
      },
      {
        column_name: 'user_id',
        privilege_type: 'SELECT',
        table_name: 'data_grants',
      },
      {
        column_name: 'user_id',
        privilege_type: 'UPDATE',
        table_name: 'data_grants',
      },
      {
        column_name: 'created_by',
        privilege_type: 'SELECT',
        table_name: 'dataset',
      },
      {
        column_name: 'created_by',
        privilege_type: 'UPDATE',
        table_name: 'dataset',
      },
    ]);

    await expect(
      authPool.query('select app.erase_user($1)', ['not-requested']),
    ).rejects.toThrow(/permission denied/);
    await expect(
      apiPool.query('select app.erase_user($1)', ['not-requested']),
    ).rejects.toThrow(/permission denied/);
    await expect(
      apiPool.query("update app.audit_log set user_id = 'denied' where false"),
    ).rejects.toThrow(/permission denied/);
    for (const statement of [
      'select * from app.audit_log',
      "insert into app.data_grants (organization_id, user_id, resource_type, resource_id, scope) values ('org-1', 'denied', 'dataset', 'denied', 'read')",
      "update app.dataset set created_by = 'denied' where false",
      'delete from app.audit_log where false',
    ]) {
      await expect(authPool.query(statement)).rejects.toThrow(
        /permission denied/,
      );
    }
    const authAppSchema = await rootPool.query<{ can_use: boolean }>(
      `select has_schema_privilege('bap_auth', 'app', 'USAGE') as can_use`,
    );
    expect(authAppSchema.rows).toEqual([{ can_use: false }]);
  });

  it('counts only sole-owned organizations and records requests through the narrow accessor', async () => {
    await asOwner(async (client) => {
      await client.query(`
        insert into auth."user" (id, name, email, email_verified)
        values
          ('lifecycle-owner', 'Lifecycle Owner', 'lifecycle-owner@example.test', true),
          ('lifecycle-coowner', 'Lifecycle Co-owner', 'lifecycle-coowner@example.test', true)
      `);
      await client.query(`
        insert into auth.organization (id, name, slug)
        values
          ('lifecycle-sole-org', 'Lifecycle Sole', 'lifecycle-sole'),
          ('lifecycle-shared-org', 'Lifecycle Shared', 'lifecycle-shared')
      `);
      await client.query(`
        insert into auth.member (id, organization_id, user_id, role)
        values
          ('lifecycle-member-sole', 'lifecycle-sole-org', 'lifecycle-owner', 'owner'),
          ('lifecycle-member-shared-a', 'lifecycle-shared-org', 'lifecycle-owner', 'owner'),
          ('lifecycle-member-shared-b', 'lifecycle-shared-org', 'lifecycle-coowner', 'owner')
      `);
    });

    try {
      await expect(
        countSoleOwnedOrganizations(authPool, 'lifecycle-owner'),
      ).resolves.toBe(1);
      await expect(
        countSoleOwnedOrganizations(authPool, 'lifecycle-coowner'),
      ).resolves.toBe(0);
      await expect(
        countSoleOwnedOrganizations(authPool, 'missing-user'),
      ).resolves.toBe(0);
      await expect(
        recordUserErasureRequest(authPool, 'lifecycle-coowner'),
      ).resolves.toBeUndefined();
      await expect(
        authPool.query('select * from auth.user_erasure_request'),
      ).rejects.toThrow(/permission denied/);
      await expect(
        authPool.query(
          "insert into auth.user_erasure_request (user_id) values ('denied')",
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        apiPool.query('select auth.request_user_erasure($1)', [
          'lifecycle-coowner',
        ]),
      ).rejects.toThrow(/permission denied/);
      await expect(
        reportingPool.query('select auth.request_user_erasure($1)', [
          'lifecycle-coowner',
        ]),
      ).rejects.toThrow(/permission denied/);
      await expect(
        recordUserErasureRequest(authPool, 'missing-user'),
      ).rejects.toThrow(/live identity/);
    } finally {
      await asOwner(async (client) => {
        await client.query(
          "delete from auth.user_erasure_request where user_id like 'lifecycle-%'",
        );
        await client.query(
          "delete from auth.organization where id like 'lifecycle-%'",
        );
        await client.query(
          'delete from auth."user" where id like \'lifecycle-%\'',
        );
      });
    }
  });

  it('cascades identity deletion through every user-owned Better Auth table', async () => {
    await asOwner(async (client) => {
      await client.query(`
        insert into auth."user" (id, name, email, email_verified)
        values ('cascade-user', 'Cascade User', 'cascade@example.test', true)
      `);
      await client.query(`
        insert into auth.organization (id, name, slug)
        values ('cascade-org', 'Cascade Organization', 'cascade-org')
      `);
      await client.query(`
        insert into auth.session (id, expires_at, token, user_id)
        values ('cascade-session', now() + interval '1 hour', 'cascade-token', 'cascade-user')
      `);
      await client.query(`
        insert into auth.account (id, account_id, issuer, provider_id, user_id, password)
        values ('cascade-account', 'cascade-user', 'credential', 'credential', 'cascade-user', 'hash')
      `);
      await client.query(`
        insert into auth.member (id, organization_id, user_id, role)
        values ('cascade-member', 'cascade-org', 'cascade-user', 'member')
      `);
      await client.query(`
        insert into auth.invitation (id, organization_id, email, status, expires_at, inviter_id)
        values ('cascade-invitation', 'cascade-org', 'invited@example.test', 'pending', now() + interval '1 hour', 'cascade-user')
      `);
      await client.query(`
        insert into auth.two_factor (id, user_id, secret, backup_codes)
        values ('cascade-two-factor', 'cascade-user', 'secret', 'codes')
      `);
      await client.query(`delete from auth."user" where id = 'cascade-user'`);
    });

    const survivors = await rootPool.query<{
      account: number;
      invitation: number;
      member: number;
      session: number;
      two_factor: number;
    }>(`select
      (select count(*)::integer from auth.account where user_id = 'cascade-user') as account,
      (select count(*)::integer from auth.invitation where inviter_id = 'cascade-user') as invitation,
      (select count(*)::integer from auth.member where user_id = 'cascade-user') as member,
      (select count(*)::integer from auth.session where user_id = 'cascade-user') as session,
      (select count(*)::integer from auth.two_factor where user_id = 'cascade-user') as two_factor`);
    expect(survivors.rows).toEqual([
      { account: 0, invitation: 0, member: 0, session: 0, two_factor: 0 },
    ]);
    await asOwner((client) =>
      client.query("delete from auth.organization where id = 'cascade-org'"),
    );
  });

  it('erases only the requested absent identity with one opaque tombstone', async () => {
    const datasetId = '00000000-0000-4000-8000-000000000101';
    await asOwner((client) =>
      client.query(`
        insert into auth."user" (id, name, email, email_verified)
        values ('erasure-user', 'Erasure User', 'erasure@example.test', true)
      `),
    );
    await rootPool.query(
      `insert into app.audit_log (organization_id, user_id, action, resource_type, metadata)
       values ('erasure-org', 'erasure-user', 'account.test', 'user', '{"subject_id":"erasure-user"}')`,
    );
    await rootPool.query(
      `insert into app.data_grants (organization_id, user_id, resource_type, resource_id, scope)
       values ('erasure-org', 'erasure-user', 'dataset', 'erasure-resource', 'read')`,
    );
    await rootPool.query(
      `insert into app.dataset (id, organization_id, name, status, created_by)
       values ($1, 'erasure-org', 'erasure container', 'ready', 'erasure-user')`,
      [datasetId],
    );
    await recordUserErasureRequest(authPool, 'erasure-user');

    await expect(
      executeEraseUser(migratorPool, 'erasure-user'),
    ).rejects.toThrow(/Live users/);
    await expect(
      backupPool.query(
        "select user_id from auth.user_erasure_request where user_id = 'erasure-user'",
      ),
    ).resolves.toMatchObject({ rows: [{ user_id: 'erasure-user' }] });

    await asOwner((client) =>
      client.query(`delete from auth."user" where id = 'erasure-user'`),
    );
    const result = await executeEraseUser(migratorPool, 'erasure-user');
    expect(result.tombstone).toMatch(
      /^erased_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    const stored = await rootPool.query<{
      audit_metadata: { subject_id: string };
      audit_user_id: string;
      dataset_created_by: string;
      grant_user_id: string;
    }>(
      `select
      audit.user_id as audit_user_id,
      audit.metadata as audit_metadata,
      data_grant.user_id as grant_user_id,
      dataset.created_by as dataset_created_by
    from app.audit_log as audit
    inner join app.data_grants as data_grant on data_grant.resource_id = 'erasure-resource'
    inner join app.dataset as dataset on dataset.id = $1
    where audit.action = 'account.test'`,
      [datasetId],
    );
    expect(stored.rows).toEqual([
      {
        audit_metadata: { subject_id: 'erasure-user' },
        audit_user_id: result.tombstone,
        dataset_created_by: result.tombstone,
        grant_user_id: result.tombstone,
      },
    ]);
    await expect(
      backupPool.query(
        "select user_id from auth.user_erasure_request where user_id = 'erasure-user'",
      ),
    ).resolves.toMatchObject({ rows: [] });
    await expect(
      executeEraseUser(migratorPool, 'erasure-user'),
    ).rejects.toThrow(/request not found/);

    await expect(
      asEraser((client) =>
        client.query<{ tombstone: string | null }>(
          'select app.erase_user($1) as tombstone',
          ['erasure-user'],
        ),
      ),
    ).resolves.toMatchObject({ rows: [{ tombstone: null }] });
    await expect(executeEraseUser(migratorPool, 'user-3')).rejects.toThrow(
      /request not found/,
    );
    await expect(
      rootPool.query(
        "select count(*)::integer as total from app.dataset where created_by = 'user-3'",
      ),
    ).resolves.toMatchObject({ rows: [{ total: 2 }] });
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
