import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  bootstrapDatabaseRoles,
  checkMigrationCompatibility,
  DATABASE_MIGRATION_COMPATIBILITY,
  runMigrations,
  withTenantContext,
} from './index.js';
import type { TenantContext } from './index.js';
import { endPools } from './integration-support.js';

const postgresImage =
  'pgvector/pgvector:pg18@sha256:2ba9ca5f2e7daa0f0e7723cba1ee9167bab54efd3640516a44ac1a928dd67e7a';
const testPassword = 'test-only-database-credential';

// One legal entity per organization, four channels, two blobs and the items the maintenance functions sort through.
const ownedEntityId = '00000000-0000-4000-8000-0000000000e1';
const foreignEntityId = '00000000-0000-4000-8000-0000000000e2';
const enabledChannelId = '00000000-0000-4000-8000-0000000000c1';
const disabledChannelId = '00000000-0000-4000-8000-0000000000c2';
const deletedChannelId = '00000000-0000-4000-8000-0000000000c3';
const foreignChannelId = '00000000-0000-4000-8000-0000000000c4';
const ownedBlobHash = 'a'.repeat(64);
const foreignBlobHash = 'b'.repeat(64);
const missingBlobHash = 'c'.repeat(64);
const freshProcessingItemId = '00000000-0000-4000-8000-000000002001';
const halfHourProcessingItemId = '00000000-0000-4000-8000-000000002002';
const oldProcessingItemId = '00000000-0000-4000-8000-000000002003';
const olderProcessingItemId = '00000000-0000-4000-8000-000000002004';
const foreignOldProcessingItemId = '00000000-0000-4000-8000-000000002005';
const oldParentItemId = '00000000-0000-4000-8000-000000003001';
const childItemId = '00000000-0000-4000-8000-000000003002';
const freshParentItemId = '00000000-0000-4000-8000-000000003003';
const fiveMinuteParentItemId = '00000000-0000-4000-8000-000000003004';
const disabledChannelItemId = '00000000-0000-4000-8000-000000003005';
const deletedChannelItemId = '00000000-0000-4000-8000-000000003006';
const foreignOldParentItemId = '00000000-0000-4000-8000-000000003007';

const orgOneOwner: TenantContext = {
  organizationId: 'org-1',
  role: 'owner',
  userId: 'user-1',
};
const orgOneAdmin: TenantContext = {
  organizationId: 'org-1',
  role: 'admin',
  userId: 'user-4',
};
const orgOneMember: TenantContext = {
  organizationId: 'org-1',
  role: 'member',
  userId: 'user-3',
};
const orgOneChannel: TenantContext = {
  organizationId: 'org-1',
  role: 'channel',
  userId: `channel_${enabledChannelId}`,
};

let apiPool: Pool;
let authPool: Pool;
let container: StartedPostgreSqlContainer;
let migratorPool: Pool;
let reportingPool: Pool;
let rootPool: Pool;

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

interface RoutingTargetInput {
  auto?: string;
  autoThreshold?: number | null;
  defaultLegalEntityId?: string | null;
  destination: string;
  detectedType: string;
  documentKind: string | null;
  requiredFields?: (string | null)[];
}

function insertRoutingTarget(
  context: TenantContext,
  input: RoutingTargetInput,
  createdBy: string = context.userId,
) {
  return asTenant(apiPool, context, (transaction) =>
    transaction.query(
      `insert into app.inbox_routing_target
         (organization_id, detected_type, destination, document_kind, default_legal_entity_id,
          auto, auto_threshold, required_fields, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        context.organizationId,
        input.detectedType,
        input.destination,
        input.documentKind,
        input.defaultLegalEntityId ?? null,
        input.auto ?? 'never',
        input.autoThreshold ?? null,
        input.requiredFields ?? [],
        createdBy,
      ],
    ),
  );
}

async function readItemStatuses(
  itemIds: string[],
): Promise<Record<string, string>> {
  const result = await rootPool.query<{ id: string; status: string }>(
    'select id, status from app.inbox_item where id = any($1::uuid[])',
    [itemIds],
  );

  return Object.fromEntries(result.rows.map((row) => [row.id, row.status]));
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
  apiPool = poolFor('bap_api', testPassword);
  authPool = poolFor('bap_auth', testPassword);
  reportingPool = poolFor('bap_reporting', testPassword);
  await runMigrations(migratorPool);

  await asOwner(async (client) => {
    await client.query(`
      insert into auth."user" (id, name, email, email_verified)
      values ('user-1', 'Owner', 'owner@example.test', true),
             ('user-2', 'Other', 'other@example.test', true),
             ('user-3', 'Member', 'reader@example.test', true),
             ('user-4', 'Admin', 'admin@example.test', true)
    `);
    await client.query(`
      insert into auth.organization (id, name, slug)
      values ('org-1', 'One', 'one'), ('org-2', 'Two', 'two')
    `);
    await client.query(`
      insert into auth.member (id, organization_id, user_id, role)
      values ('member-1', 'org-1', 'user-1', 'owner'),
             ('member-2', 'org-2', 'user-2', 'owner'),
             ('member-3', 'org-1', 'user-3', 'member'),
             ('member-4', 'org-1', 'user-4', 'admin')
    `);
  });
  await rootPool.query(
    `insert into app.legal_entity (id, organization_id, name, kind, created_by)
     values ($1, 'org-1', 'Placeholder Holding', 'company', 'user-1'),
            ($2, 'org-2', 'Placeholder Foreign', 'company', 'user-2')`,
    [ownedEntityId, foreignEntityId],
  );
  await rootPool.query(
    `insert into app.inbox_channel (id, organization_id, kind, name, enabled, deleted_at, created_by)
     values ($1, 'org-1', 'email', 'Placeholder mailbox', true, null, 'user-1'),
            ($2, 'org-1', 'email', 'Placeholder disabled mailbox', false, null, 'user-1'),
            ($3, 'org-1', 'email', 'Placeholder deleted mailbox', false, now(), 'user-1'),
            ($4, 'org-2', 'email', 'Placeholder foreign mailbox', true, null, 'user-2')`,
    [enabledChannelId, disabledChannelId, deletedChannelId, foreignChannelId],
  );
  await rootPool.query(
    `insert into app.blob (organization_id, sha256, byte_size, media_type, storage_key, created_by)
     values ('org-1', $1, 2048, 'application/pdf', $3, 'user-1'),
            ('org-2', $2, 2048, 'application/pdf', $4, 'user-2')`,
    [
      ownedBlobHash,
      foreignBlobHash,
      `org/org-1/${ownedBlobHash}`,
      `org/org-2/${foreignBlobHash}`,
    ],
  );
  // Manual uploads in processing, aged by updated_at; the reaper reads nothing else.
  await rootPool.query(
    `insert into app.inbox_item (id, organization_id, channel_kind, payload_kind, status, updated_at, created_by)
     values ($1, 'org-1', 'upload', 'file', 'processing', now(), 'user-1'),
            ($2, 'org-1', 'upload', 'file', 'processing', now() - interval '30 minutes', 'user-1'),
            ($3, 'org-1', 'upload', 'file', 'processing', now() - interval '2 hours', 'user-1'),
            ($4, 'org-1', 'upload', 'file', 'processing', now() - interval '3 hours', 'user-1'),
            ($5, 'org-2', 'upload', 'file', 'processing', now() - interval '3 hours', 'user-2')`,
    [
      freshProcessingItemId,
      halfHourProcessingItemId,
      oldProcessingItemId,
      olderProcessingItemId,
      foreignOldProcessingItemId,
    ],
  );
  // Email parents still received, aged by received_at, on live, disabled and deleted channels.
  await rootPool.query(
    `insert into app.inbox_item
       (id, organization_id, channel_kind, channel_id, payload_kind, status, parent_item_id, received_at, created_by)
     values ($1, 'org-1', 'email', $8, 'email', 'received', null, now() - interval '1 hour', $12),
            ($2, 'org-1', 'email', $8, 'email', 'received', $1, now() - interval '1 hour', $12),
            ($3, 'org-1', 'email', $8, 'email', 'received', null, now(), $12),
            ($4, 'org-1', 'email', $8, 'email', 'received', null, now() - interval '5 minutes', $12),
            ($5, 'org-1', 'email', $9, 'email', 'received', null, now() - interval '1 hour', $13),
            ($6, 'org-1', 'email', $10, 'email', 'received', null, now() - interval '1 hour', $14),
            ($7, 'org-2', 'email', $11, 'email', 'received', null, now() - interval '2 hours', $15)`,
    [
      oldParentItemId,
      childItemId,
      freshParentItemId,
      fiveMinuteParentItemId,
      disabledChannelItemId,
      deletedChannelItemId,
      foreignOldParentItemId,
      enabledChannelId,
      disabledChannelId,
      deletedChannelId,
      foreignChannelId,
      `channel_${enabledChannelId}`,
      `channel_${disabledChannelId}`,
      `channel_${deletedChannelId}`,
      `channel_${foreignChannelId}`,
    ],
  );
});

afterAll(async () => {
  await endPools(apiPool, authPool, migratorPool, reportingPool, rootPool);
  await container.stop();
});

describe('inbox runtime', () => {
  it('applies the inbox runtime migration and records the compatible version', async () => {
    const result = await runMigrations(migratorPool);
    const compatibility = await checkMigrationCompatibility(apiPool);

    expect(result.applied).toEqual([]);
    expect(result.currentVersion).toBe('20260922.0008');
    expect(DATABASE_MIGRATION_COMPATIBILITY).toBe('20260922.0008');
    expect(compatibility).toEqual({
      compatible: true,
      expectedVersion: '20260922.0008',
      version: '20260922.0008',
    });

    const functions = await rootPool.query<{
      function_name: string;
      grantees: string[];
      owner: string;
      proconfig: string[];
      prosecdef: boolean;
    }>(`select
      namespace.nspname || '.' || function.proname as function_name,
      pg_get_userbyid(function.proowner) as owner,
      function.proconfig,
      function.prosecdef,
      (select array_agg(coalesce(grantee_role.rolname::text, 'PUBLIC') order by grantee_role.rolname)
       from aclexplode(coalesce(function.proacl, acldefault('f', function.proowner))) as privilege
       left join pg_roles as grantee_role on grantee_role.oid = privilege.grantee) as grantees
    from pg_proc as function
    inner join pg_namespace as namespace on namespace.oid = function.pronamespace
    where function.oid in (
      'app.list_blob_keys(text, text[])'::regprocedure,
      'app.reap_stalled_inbox_items(interval, integer)'::regprocedure,
      'app.list_stuck_email_items(interval, integer)'::regprocedure
    )
    order by function_name`);
    expect(functions.rows).toEqual(
      [
        'app.list_blob_keys',
        'app.list_stuck_email_items',
        'app.reap_stalled_inbox_items',
      ].map((functionName) => ({
        function_name: functionName,
        grantees: ['bap_api', 'bap_owner'],
        owner: 'bap_owner',
        proconfig: ['search_path=pg_catalog, app'],
        prosecdef: true,
      })),
    );

    const policies = await rootPool.query<{
      cmd: string;
      policyname: string;
      qual: string | null;
      roles: string[];
      tablename: string;
      with_check: string | null;
    }>(
      `select tablename, policyname, cmd, qual, roles::text[] as roles, with_check from pg_policies
        where schemaname = 'app'
          and tablename in ('blob', 'inbox_channel', 'inbox_item', 'inbox_item_file', 'inbox_event', 'document_file')
          and policyname like '%_maintenance_%'
        order by tablename, policyname`,
    );
    expect(policies.rows).toEqual([
      {
        cmd: 'SELECT',
        policyname: 'blob_maintenance_select',
        qual: 'true',
        roles: ['bap_owner'],
        tablename: 'blob',
        with_check: null,
      },
      {
        cmd: 'UPDATE',
        policyname: 'blob_maintenance_update',
        qual: "(organization_id = current_setting('bap.organization_id'::text, true))",
        roles: ['bap_owner'],
        tablename: 'blob',
        with_check:
          "(organization_id = current_setting('bap.organization_id'::text, true))",
      },
      {
        cmd: 'SELECT',
        policyname: 'inbox_channel_maintenance_select',
        qual: 'true',
        roles: ['bap_owner'],
        tablename: 'inbox_channel',
        with_check: null,
      },
      {
        cmd: 'INSERT',
        policyname: 'inbox_event_maintenance_insert',
        qual: null,
        roles: ['bap_owner'],
        tablename: 'inbox_event',
        with_check: 'true',
      },
      {
        cmd: 'SELECT',
        policyname: 'inbox_item_maintenance_select',
        qual: 'true',
        roles: ['bap_owner'],
        tablename: 'inbox_item',
        with_check: null,
      },
      {
        cmd: 'UPDATE',
        policyname: 'inbox_item_maintenance_update',
        qual: 'true',
        roles: ['bap_owner'],
        tablename: 'inbox_item',
        with_check: 'true',
      },
    ]);

    const grants = await rootPool.query<{
      grantee: string;
      privileges: string[];
      table_name: string;
    }>(
      `select table_name, grantee, array_agg(privilege_type::text order by privilege_type) as privileges
       from information_schema.role_table_grants
       where table_schema = 'app'
         and table_name in ('inbox_routing_target', 'organization_inbox_setting')
         and grantee <> 'bap_owner'
       group by table_name, grantee
       order by table_name, grantee`,
    );
    expect(grants.rows).toEqual([
      {
        grantee: 'bap_api',
        privileges: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
        table_name: 'inbox_routing_target',
      },
      {
        grantee: 'bap_backup',
        privileges: ['SELECT'],
        table_name: 'inbox_routing_target',
      },
      {
        grantee: 'bap_reporting',
        privileges: ['SELECT'],
        table_name: 'inbox_routing_target',
      },
      {
        grantee: 'bap_api',
        privileges: ['INSERT', 'SELECT', 'UPDATE'],
        table_name: 'organization_inbox_setting',
      },
      {
        grantee: 'bap_backup',
        privileges: ['SELECT'],
        table_name: 'organization_inbox_setting',
      },
      {
        grantee: 'bap_reporting',
        privileges: ['SELECT'],
        table_name: 'organization_inbox_setting',
      },
    ]);
  });

  it('lets owner and admin write a routing target and keeps member and channel out', async () => {
    await expect(
      insertRoutingTarget(orgOneMember, {
        destination: 'documents',
        detectedType: 'isdoc_invoice',
        documentKind: 'received_invoice',
      }),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      insertRoutingTarget(orgOneChannel, {
        destination: 'documents',
        detectedType: 'isdoc_invoice',
        documentKind: 'received_invoice',
      }),
    ).rejects.toMatchObject({ code: '42501' });
    // The created_by check: an admin cannot write the row as someone else.
    await expect(
      insertRoutingTarget(
        orgOneAdmin,
        {
          destination: 'documents',
          detectedType: 'isdoc_invoice',
          documentKind: 'received_invoice',
        },
        'user-1',
      ),
    ).rejects.toMatchObject({ code: '42501' });

    await expect(
      insertRoutingTarget(orgOneAdmin, {
        defaultLegalEntityId: ownedEntityId,
        destination: 'documents',
        detectedType: 'isdoc_invoice',
        documentKind: 'received_invoice',
        requiredFields: ['document_date', 'partner'],
      }),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      insertRoutingTarget(orgOneOwner, {
        destination: 'discard',
        detectedType: 'newsletter',
        documentKind: null,
      }),
    ).resolves.toMatchObject({ rowCount: 1 });

    await expect(
      rootPool.query<{
        created_by: string;
        partner_policy: string;
        required_fields: string[];
        updated_by: string;
      }>(
        `select created_by, updated_by, partner_policy, required_fields
         from app.inbox_routing_target where detected_type = 'isdoc_invoice'`,
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          created_by: 'user-4',
          partner_policy: 'match_only',
          required_fields: ['document_date', 'partner'],
          updated_by: 'user-4',
        },
      ],
    });

    await expect(
      asTenant(apiPool, orgOneMember, (transaction) =>
        transaction.query(
          "update app.inbox_routing_target set auto = 'always' where detected_type = 'isdoc_invoice'",
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 0 });
    await expect(
      asTenant(apiPool, orgOneAdmin, (transaction) =>
        transaction.query(
          "update app.inbox_routing_target set auto = 'always', updated_by = 'user-4' where detected_type = 'isdoc_invoice'",
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      asTenant(apiPool, orgOneAdmin, (transaction) =>
        transaction.query(
          "update app.inbox_routing_target set auto = 'always', updated_by = 'user-1' where detected_type = 'isdoc_invoice'",
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asTenant(apiPool, orgOneMember, (transaction) =>
        transaction.query(
          "delete from app.inbox_routing_target where detected_type = 'newsletter'",
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 0 });
    await expect(
      asTenant(apiPool, orgOneAdmin, (transaction) =>
        transaction.query(
          "delete from app.inbox_routing_target where detected_type = 'newsletter'",
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  it('keeps one routing target per detected type and enforces every check', async () => {
    await expect(
      insertRoutingTarget(orgOneOwner, {
        destination: 'datasets',
        detectedType: 'isdoc_invoice',
        documentKind: null,
      }),
    ).rejects.toMatchObject({
      code: '23505',
      constraint: 'inbox_routing_target_organization_detected_type_key',
    });
    await expect(
      insertRoutingTarget(orgOneOwner, {
        destination: 'documents',
        detectedType: 'bank_statement',
        documentKind: null,
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_routing_target_document_kind_check',
    });
    await expect(
      insertRoutingTarget(orgOneOwner, {
        destination: 'datasets',
        detectedType: 'bank_statement',
        documentKind: 'bank_statement',
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_routing_target_document_kind_check',
    });
    await expect(
      insertRoutingTarget(orgOneOwner, {
        destination: 'datasets',
        detectedType: 'Bank Statement',
        documentKind: null,
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_routing_target_detected_type_check',
    });
    await expect(
      insertRoutingTarget(orgOneOwner, {
        destination: 'partners',
        detectedType: 'bank_statement',
        documentKind: null,
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_routing_target_destination_check',
    });
    await expect(
      insertRoutingTarget(orgOneOwner, {
        auto: 'above_threshold',
        destination: 'datasets',
        detectedType: 'bank_statement',
        documentKind: null,
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_routing_target_auto_threshold_required_check',
    });
    await expect(
      insertRoutingTarget(orgOneOwner, {
        auto: 'above_threshold',
        autoThreshold: 1.5,
        destination: 'datasets',
        detectedType: 'bank_statement',
        documentKind: null,
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_routing_target_auto_threshold_check',
    });
    await expect(
      insertRoutingTarget(orgOneOwner, {
        auto: 'sometimes',
        destination: 'datasets',
        detectedType: 'bank_statement',
        documentKind: null,
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_routing_target_auto_check',
    });
    await expect(
      insertRoutingTarget(orgOneOwner, {
        destination: 'datasets',
        detectedType: 'bank_statement',
        documentKind: null,
        requiredFields: ['amount', null],
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_routing_target_required_fields_check',
    });
    await expect(
      insertRoutingTarget(orgOneOwner, {
        destination: 'datasets',
        detectedType: 'bank_statement',
        documentKind: null,
        requiredFields: Array.from({ length: 33 }, (_, index) => `f${index}`),
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_routing_target_required_fields_check',
    });
    // The composite key pins the default entity to the organization.
    await expect(
      insertRoutingTarget(orgOneOwner, {
        defaultLegalEntityId: foreignEntityId,
        destination: 'datasets',
        detectedType: 'bank_statement',
        documentKind: null,
      }),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'inbox_routing_target_default_legal_entity_fkey',
    });
    await expect(
      insertRoutingTarget(orgOneOwner, {
        auto: 'above_threshold',
        autoThreshold: 0.9,
        destination: 'datasets',
        detectedType: 'bank_statement',
        documentKind: null,
        requiredFields: Array.from({ length: 32 }, (_, index) => `f${index}`),
      }),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  it('hides routing targets from a channel and shows them to the reporting role', async () => {
    await expect(
      asTenant(apiPool, orgOneChannel, (transaction) =>
        transaction.query<{ total: number }>(
          'select count(*)::integer as total from app.inbox_routing_target',
        ),
      ),
    ).resolves.toMatchObject({ rows: [{ total: 0 }] });
    await expect(
      asTenant(apiPool, orgOneMember, (transaction) =>
        transaction.query<{ total: number }>(
          'select count(*)::integer as total from app.inbox_routing_target',
        ),
      ),
    ).resolves.toMatchObject({ rows: [{ total: 2 }] });
    await expect(
      asTenant(reportingPool, orgOneMember, (transaction) =>
        transaction.query<{ detected_type: string }>(
          'select detected_type from app.inbox_routing_target order by detected_type',
        ),
      ),
    ).resolves.toMatchObject({
      rows: [
        { detected_type: 'bank_statement' },
        { detected_type: 'isdoc_invoice' },
      ],
    });
    await expect(
      reportingPool.query(
        `insert into app.inbox_routing_target (organization_id, detected_type, destination, document_kind, created_by)
         values ('org-1', 'receipt', 'discard', null, 'user-3')`,
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('lets only an owner set the inbox setting and lets a channel read it', async () => {
    await expect(
      asTenant(apiPool, orgOneAdmin, (transaction) =>
        transaction.query(
          `insert into app.organization_inbox_setting (organization_id, blob_quota_bytes, created_by)
           values ('org-1', 1048576, 'user-4')`,
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.organization_inbox_setting (organization_id, blob_quota_bytes, created_by)
           values ('org-1', 0, 'user-1')`,
        ),
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'organization_inbox_setting_blob_quota_bytes_check',
    });
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.organization_inbox_setting (organization_id, blob_quota_bytes)
           values ('org-1', 1048576)`,
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      rootPool.query<{ created_by: string }>(
        "select created_by from app.organization_inbox_setting where organization_id = 'org-1'",
      ),
    ).resolves.toMatchObject({ rows: [{ created_by: 'user-1' }] });

    await expect(
      asTenant(apiPool, orgOneAdmin, (transaction) =>
        transaction.query(
          "update app.organization_inbox_setting set blob_quota_bytes = 2097152 where organization_id = 'org-1'",
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 0 });
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          "update app.organization_inbox_setting set blob_quota_bytes = -1 where organization_id = 'org-1'",
        ),
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'organization_inbox_setting_blob_quota_bytes_check',
    });
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          "update app.organization_inbox_setting set blob_quota_bytes = 2097152 where organization_id = 'org-1'",
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    // The row is reset by nulling the column; the api role holds no DELETE grant.
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          "delete from app.organization_inbox_setting where organization_id = 'org-1'",
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });

    await expect(
      asTenant(apiPool, orgOneChannel, (transaction) =>
        transaction.query<{ blob_quota_bytes: string }>(
          'select blob_quota_bytes from app.organization_inbox_setting',
        ),
      ),
    ).resolves.toMatchObject({ rows: [{ blob_quota_bytes: '2097152' }] });
    await expect(
      asTenant(reportingPool, orgOneMember, (transaction) =>
        transaction.query<{ blob_quota_bytes: string }>(
          'select blob_quota_bytes from app.organization_inbox_setting',
        ),
      ),
    ).resolves.toMatchObject({ rows: [{ blob_quota_bytes: '2097152' }] });
  });

  it('refuses the maintenance functions inside a tenant transaction and to every other role', async () => {
    const calls = [
      ["select app.list_blob_keys('org-1', $1)", [[ownedBlobHash]]],
      ["select app.reap_stalled_inbox_items('60 minutes', 500)", []],
      ["select app.list_stuck_email_items('10 minutes', 500)", []],
    ] as const;

    for (const [statement, values] of calls) {
      await expect(
        asTenant(apiPool, orgOneOwner, (transaction) =>
          transaction.query(statement, [...values]),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        asTenant(apiPool, orgOneChannel, (transaction) =>
          transaction.query(statement, [...values]),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        authPool.query(statement, [...values]),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        reportingPool.query(statement, [...values]),
      ).rejects.toMatchObject({ code: '42501' });
    }

    await expect(
      readItemStatuses([oldProcessingItemId, foreignOldProcessingItemId]),
    ).resolves.toEqual({
      [foreignOldProcessingItemId]: 'processing',
      [oldProcessingItemId]: 'processing',
    });
  });

  it('lists the hashes that already have a blob row in the named organization', async () => {
    const hashes = [ownedBlobHash, foreignBlobHash, missingBlobHash];

    await expect(
      apiPool.query<{ sha256: string }>(
        'select sha256 from app.list_blob_keys($1, $2) as sha256 order by sha256',
        ['org-1', hashes],
      ),
    ).resolves.toMatchObject({ rows: [{ sha256: ownedBlobHash }] });
    await expect(
      apiPool.query<{ sha256: string }>(
        'select sha256 from app.list_blob_keys($1, $2) as sha256 order by sha256',
        ['org-2', hashes],
      ),
    ).resolves.toMatchObject({ rows: [{ sha256: foreignBlobHash }] });
    await expect(
      apiPool.query<{ sha256: string }>(
        'select sha256 from app.list_blob_keys($1, $2) as sha256',
        ['org-3', hashes],
      ),
    ).resolves.toMatchObject({ rows: [] });
  });

  it('reaps stalled processing items across organizations with a floored stale window', async () => {
    // '1 minute' is floored to 60 minutes, so the 30 minute old row is skipped; max_rows bounds the batch.
    const first = await apiPool.query<{ id: string; organization_id: string }>(
      "select id, organization_id from app.reap_stalled_inbox_items('1 minute', 2) order by organization_id",
    );
    expect(first.rows).toEqual([
      { id: olderProcessingItemId, organization_id: 'org-1' },
      { id: foreignOldProcessingItemId, organization_id: 'org-2' },
    ]);

    const second = await apiPool.query<{ id: string; organization_id: string }>(
      "select id, organization_id from app.reap_stalled_inbox_items('1 minute', 500)",
    );
    expect(second.rows).toEqual([
      { id: oldProcessingItemId, organization_id: 'org-1' },
    ]);
    await expect(
      apiPool.query(
        "select * from app.reap_stalled_inbox_items('1 minute', 500)",
      ),
    ).resolves.toMatchObject({ rows: [] });

    await expect(
      readItemStatuses([
        freshProcessingItemId,
        halfHourProcessingItemId,
        oldProcessingItemId,
        olderProcessingItemId,
        foreignOldProcessingItemId,
      ]),
    ).resolves.toEqual({
      [foreignOldProcessingItemId]: 'failed',
      [freshProcessingItemId]: 'processing',
      [halfHourProcessingItemId]: 'processing',
      [oldProcessingItemId]: 'failed',
      [olderProcessingItemId]: 'failed',
    });

    const events = await rootPool.query<{
      actor_user_id: string | null;
      item_id: string;
      kind: string;
      organization_id: string;
      reason: string;
    }>(
      `select organization_id, item_id, kind, reason, actor_user_id
       from app.inbox_event where reason = 'stalled' order by organization_id, item_id`,
    );
    expect(events.rows).toEqual([
      {
        actor_user_id: null,
        item_id: oldProcessingItemId,
        kind: 'failed',
        organization_id: 'org-1',
        reason: 'stalled',
      },
      {
        actor_user_id: null,
        item_id: olderProcessingItemId,
        kind: 'failed',
        organization_id: 'org-1',
        reason: 'stalled',
      },
      {
        actor_user_id: null,
        item_id: foreignOldProcessingItemId,
        kind: 'failed',
        organization_id: 'org-2',
        reason: 'stalled',
      },
    ]);
    // A reaped item still counts as a person-visible failure: the reason is in the vocabulary, a stray one is not.
    await expect(
      rootPool.query(
        `insert into app.inbox_event (organization_id, item_id, kind, reason)
         values ('org-1', $1, 'failed', 'crashed')`,
        [oldProcessingItemId],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_event_reason_check',
    });

    // A reaped item is a terminal failure: the channel that owns it cannot revive it into review.
    await expect(
      asTenant(apiPool, orgOneChannel, (transaction) =>
        transaction.query(
          "update app.inbox_item set status = 'needs_review' where id = $1 and status = 'processing'",
          [oldProcessingItemId],
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 0 });
    await expect(readItemStatuses([oldProcessingItemId])).resolves.toEqual({
      [oldProcessingItemId]: 'failed',
    });
  });

  it('lists stuck email parents on live channels only, with a floored stale window', async () => {
    // '1 minute' is floored to 10 minutes, so the 5 minute old parent is skipped.
    const stuck = await apiPool.query<{
      channel_id: string;
      item_id: string;
      organization_id: string;
    }>(
      "select item_id, channel_id, organization_id from app.list_stuck_email_items('1 minute', 500) order by organization_id",
    );
    expect(stuck.rows).toEqual([
      {
        channel_id: enabledChannelId,
        item_id: oldParentItemId,
        organization_id: 'org-1',
      },
      {
        channel_id: foreignChannelId,
        item_id: foreignOldParentItemId,
        organization_id: 'org-2',
      },
    ]);
    await expect(
      apiPool.query<{ item_id: string }>(
        "select item_id from app.list_stuck_email_items('1 minute', 1)",
      ),
    ).resolves.toMatchObject({ rows: [{ item_id: foreignOldParentItemId }] });
    // The list is read only: nothing changed on the items it named or skipped.
    await expect(
      readItemStatuses([
        oldParentItemId,
        childItemId,
        freshParentItemId,
        fiveMinuteParentItemId,
        disabledChannelItemId,
        deletedChannelItemId,
        foreignOldParentItemId,
      ]),
    ).resolves.toEqual({
      [childItemId]: 'received',
      [deletedChannelItemId]: 'received',
      [disabledChannelItemId]: 'received',
      [fiveMinuteParentItemId]: 'received',
      [foreignOldParentItemId]: 'received',
      [freshParentItemId]: 'received',
      [oldParentItemId]: 'received',
    });
  });

  it('erases the routing target author, editor and default assignee and the setting author', async () => {
    await rootPool.query(
      `insert into app.inbox_routing_target
         (organization_id, detected_type, destination, document_kind, default_assignee_id, created_by, updated_by)
       values ('org-2', 'receipt', 'documents', 'receipt', 'erasure-user', 'erasure-user', 'erasure-user')`,
    );
    await rootPool.query(
      `insert into app.organization_inbox_setting (organization_id, created_by)
       values ('org-2', 'erasure-user')`,
    );

    const erasure = await asEraser((client) =>
      client.query<{ tombstone: string | null }>(
        'select app.erase_user($1) as tombstone',
        ['erasure-user'],
      ),
    );
    const tombstone = erasure.rows[0]?.tombstone;
    expect(tombstone).toMatch(/^erased_/);

    await expect(
      rootPool.query<{
        created_by: string;
        default_assignee_id: string | null;
        updated_by: string;
      }>(
        `select created_by, updated_by, default_assignee_id
         from app.inbox_routing_target where organization_id = 'org-2'`,
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          created_by: tombstone,
          default_assignee_id: null,
          updated_by: tombstone,
        },
      ],
    });
    await expect(
      rootPool.query<{ created_by: string }>(
        "select created_by from app.organization_inbox_setting where organization_id = 'org-2'",
      ),
    ).resolves.toMatchObject({ rows: [{ created_by: tombstone }] });
    // A subject with no remaining row is a no-op.
    await expect(
      asEraser((client) =>
        client.query<{ tombstone: string | null }>(
          'select app.erase_user($1) as tombstone',
          ['erasure-user'],
        ),
      ),
    ).resolves.toMatchObject({ rows: [{ tombstone: null }] });
  });
});
