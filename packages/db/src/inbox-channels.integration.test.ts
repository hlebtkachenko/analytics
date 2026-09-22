import { createHash } from 'node:crypto';

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

const postgresImage =
  'pgvector/pgvector:pg18@sha256:2ba9ca5f2e7daa0f0e7723cba1ee9167bab54efd3640516a44ac1a928dd67e7a';
const testPassword = 'test-only-database-credential';

// Every non-inbox tenant table a channel must not read.
const hiddenTables = [
  'audit_log',
  'dataset',
  'document',
  'legal_entity',
  'partner',
] as const;

// Neutral fixtures inside org-1 and one channel inside org-2.
const ownedEntityId = '00000000-0000-4000-8000-0000000000e1';
const partnerId = '00000000-0000-4000-8000-0000000000b1';
const documentId = '00000000-0000-4000-8000-0000000000a1';
const datasetId = '00000000-0000-4000-8000-0000000000d1';
const channelId = '00000000-0000-4000-8000-0000000000c1';
const disabledChannelId = '00000000-0000-4000-8000-0000000000c2';
const foreignChannelId = '00000000-0000-4000-8000-0000000000c3';
const secondChannelId = '00000000-0000-4000-8000-0000000000c4';
const routedItemId = '00000000-0000-4000-8000-000000001001';
const decidedItemId = '00000000-0000-4000-8000-000000001002';
const channelItemId = '00000000-0000-4000-8000-000000001003';
const channelBlobId = '00000000-0000-4000-8000-00000000f001';
const channelSha256 = 'a'.repeat(64);
const secretPrefix = 'bap_intake_';

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
const orgTwoOwner: TenantContext = {
  organizationId: 'org-2',
  role: 'owner',
  userId: 'user-2',
};
const orgOneChannel: TenantContext = {
  organizationId: 'org-1',
  role: 'channel',
  userId: `channel_${channelId}`,
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

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
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

interface IssuedCredential {
  credential_id: string;
  display_prefix: string;
  secret: string;
}

async function issueCredential(
  context: TenantContext,
  targetChannelId: string,
): Promise<IssuedCredential> {
  const result = await asTenant(apiPool, context, (transaction) =>
    transaction.query<IssuedCredential>(
      'select credential_id, secret, display_prefix from auth.issue_channel_credential($1, $2)',
      [targetChannelId, 'api_token'],
    ),
  );
  const issued = result.rows[0];

  if (issued === undefined) {
    throw new Error('No credential was issued.');
  }

  return issued;
}

async function resolveCredential(secret: string) {
  return authPool.query<{
    channel_id: string;
    kind: string;
    organization_id: string;
  }>(
    'select organization_id, channel_id, kind from auth.resolve_channel_credential($1)',
    [sha256Hex(secret)],
  );
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
     values ($1, 'org-1', 'Placeholder Holding', 'company', 'user-1')`,
    [ownedEntityId],
  );
  await rootPool.query(
    `insert into app.partner (id, organization_id, name, created_by)
     values ($1, 'org-1', 'Placeholder Supplier', 'user-1')`,
    [partnerId],
  );
  await rootPool.query(
    `insert into app.document (id, organization_id, legal_entity_id, kind, title, document_date, created_by)
     values ($1, 'org-1', $2, 'received_invoice', 'Placeholder received invoice', '2026-09-01', 'user-1')`,
    [documentId, ownedEntityId],
  );
  await rootPool.query(
    `insert into app.dataset (id, organization_id, legal_entity_id, name, status, created_by)
     values ($1, 'org-1', $2, 'Placeholder dataset', 'ready', 'user-1')`,
    [datasetId, ownedEntityId],
  );
  await rootPool.query(
    `insert into app.inbox_channel (id, organization_id, kind, name, enabled, created_by)
     values ($1, 'org-1', 'api', 'Placeholder disabled push', false, 'user-1'),
            ($2, 'org-2', 'api', 'Placeholder foreign push', true, 'user-2')`,
    [disabledChannelId, foreignChannelId],
  );
});

afterAll(async () => {
  await Promise.all([
    apiPool.end(),
    authPool.end(),
    migratorPool.end(),
    reportingPool.end(),
    rootPool.end(),
  ]);
  await container.stop();
});

describe('inbox channel principal', () => {
  it('applies the inbox channels migration and records the compatible version', async () => {
    const result = await runMigrations(migratorPool);
    const compatibility = await checkMigrationCompatibility(apiPool);

    expect(result.applied).toEqual([]);
    expect(result.currentVersion).toBe('20260917.0005');
    expect(DATABASE_MIGRATION_COMPATIBILITY).toBe('20260917.0005');
    expect(compatibility).toEqual({
      compatible: true,
      expectedVersion: '20260917.0005',
      version: '20260917.0005',
    });
  });

  it('lets an owner create a channel and refuses an admin', async () => {
    await asTenant(apiPool, orgOneOwner, (transaction) =>
      transaction.query(
        `insert into app.inbox_channel (id, organization_id, kind, name, legal_entity_id, hint_kind, created_by)
         values ($1, 'org-1', 'api', 'Placeholder push', $2, 'received_invoice', 'user-1')`,
        [channelId, ownedEntityId],
      ),
    );
    await expect(
      asTenant(apiPool, orgOneAdmin, (transaction) =>
        transaction.query(
          `insert into app.inbox_channel (organization_id, kind, name, created_by)
           values ('org-1', 'api', 'Placeholder admin push', 'user-4')`,
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    // An admin may still edit; a member may read.
    await expect(
      asTenant(apiPool, orgOneAdmin, (transaction) =>
        transaction.query(
          "update app.inbox_channel set name = 'Placeholder push' where id = $1",
          [channelId],
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      asTenant(apiPool, orgOneMember, (transaction) =>
        transaction.query<{ total: number }>(
          'select count(*)::integer as total from app.inbox_channel',
        ),
      ),
    ).resolves.toMatchObject({ rows: [{ total: 2 }] });
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.inbox_channel (organization_id, kind, name, created_by)
           values ('org-1', 'upload', 'Placeholder upload', 'user-1')`,
        ),
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_channel_kind_check',
    });
  });

  it('issues at most two active credentials, stores only the hash and never stores the secret', async () => {
    const first = await issueCredential(orgOneOwner, channelId);
    const second = await issueCredential(orgOneOwner, channelId);

    expect(first.secret).toMatch(/^bap_intake_[A-Za-z0-9_-]{43}$/);
    expect(first.display_prefix).toBe(
      first.secret.slice(secretPrefix.length, secretPrefix.length + 8),
    );
    expect(second.secret).not.toBe(first.secret);

    const stored = await rootPool.query<{
      created_by: string;
      display_prefix: string;
      kind: string;
      secret_sha256: string;
    }>(
      `select secret_sha256, display_prefix, kind, created_by
       from auth.inbox_channel_credential
       where id = $1`,
      [first.credential_id],
    );
    expect(stored.rows).toEqual([
      {
        created_by: 'user-1',
        display_prefix: first.display_prefix,
        kind: 'api_token',
        secret_sha256: sha256Hex(first.secret),
      },
    ]);
    const leaked = await rootPool.query<{ total: number }>(
      `select count(*)::integer as total
       from auth.inbox_channel_credential
       where secret_sha256 = $1 or display_prefix = $1`,
      [first.secret],
    );
    expect(leaked.rows).toEqual([{ total: 0 }]);

    await expect(issueCredential(orgOneOwner, channelId)).rejects.toMatchObject(
      {
        code: '23514',
        constraint: 'inbox_channel_credential_active_limit',
      },
    );
    await expect(issueCredential(orgOneAdmin, channelId)).rejects.toMatchObject(
      { code: '42501' },
    );
    // A channel of another organization is not found, exactly like a missing one.
    await expect(
      issueCredential(orgOneOwner, foreignChannelId),
    ).rejects.toMatchObject({ code: 'P0002' });
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query('select auth.issue_channel_credential($1, $2)', [
          channelId,
          'password',
        ]),
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_channel_credential_kind_check',
    });
  });

  it('resolves a live credential through bap_auth, records its use, and forgets revoked or disabled ones', async () => {
    const [issued] = (
      await rootPool.query<{ id: string }>(
        `select id from auth.inbox_channel_credential
         where channel_id = $1 and revoked_at is null
         order by created_at limit 1`,
        [channelId],
      )
    ).rows;
    // Issue a fresh one to hold the plain secret; the first is revoked to make room.
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query<{ revoked: boolean }>(
          'select auth.revoke_channel_credential($1) as revoked',
          [issued?.id],
        ),
      ),
    ).resolves.toMatchObject({ rows: [{ revoked: true }] });
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query<{ revoked: boolean }>(
          'select auth.revoke_channel_credential($1) as revoked',
          [issued?.id],
        ),
      ),
    ).resolves.toMatchObject({ rows: [{ revoked: false }] });
    const live = await issueCredential(orgOneOwner, channelId);

    await expect(resolveCredential(live.secret)).resolves.toMatchObject({
      rows: [
        { channel_id: channelId, kind: 'api_token', organization_id: 'org-1' },
      ],
    });
    await expect(
      rootPool.query<{ used: boolean }>(
        'select last_used_at is not null as used from auth.inbox_channel_credential where id = $1',
        [live.credential_id],
      ),
    ).resolves.toMatchObject({ rows: [{ used: true }] });
    await expect(
      resolveCredential(`${secretPrefix}${'x'.repeat(43)}`),
    ).resolves.toMatchObject({ rows: [] });

    // Revocation from another organization changes nothing.
    await expect(
      asTenant(apiPool, orgTwoOwner, (transaction) =>
        transaction.query<{ revoked: boolean }>(
          'select auth.revoke_channel_credential($1) as revoked',
          [live.credential_id],
        ),
      ),
    ).resolves.toMatchObject({ rows: [{ revoked: false }] });
    await expect(
      asTenant(apiPool, orgOneAdmin, (transaction) =>
        transaction.query('select auth.revoke_channel_credential($1)', [
          live.credential_id,
        ]),
      ),
    ).rejects.toMatchObject({ code: '42501' });

    // Disabling the channel stops resolution without touching the credential.
    await asTenant(apiPool, orgOneOwner, (transaction) =>
      transaction.query(
        'update app.inbox_channel set enabled = false where id = $1',
        [channelId],
      ),
    );
    await expect(resolveCredential(live.secret)).resolves.toMatchObject({
      rows: [],
    });
    await asTenant(apiPool, orgOneOwner, (transaction) =>
      transaction.query(
        'update app.inbox_channel set enabled = true where id = $1',
        [channelId],
      ),
    );
    await expect(resolveCredential(live.secret)).resolves.toMatchObject({
      rowCount: 1,
    });

    await asTenant(apiPool, orgOneOwner, (transaction) =>
      transaction.query('select auth.revoke_channel_credential($1)', [
        live.credential_id,
      ]),
    );
    await expect(resolveCredential(live.secret)).resolves.toMatchObject({
      rows: [],
    });
  });

  it('keeps the credential table behind its definer functions', async () => {
    await expect(
      authPool.query('select * from auth.inbox_channel_credential'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      authPool.query(
        `insert into auth.inbox_channel_credential (organization_id, channel_id, kind, secret_sha256, display_prefix)
         values ('org-1', $1, 'api_token', $2, 'aaaaaaaa')`,
        [channelId, 'c'.repeat(64)],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      apiPool.query('select * from auth.inbox_channel_credential'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      authPool.query('select auth.issue_channel_credential($1, $2)', [
        channelId,
        'api_token',
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      apiPool.query('select auth.resolve_channel_credential($1)', [
        'd'.repeat(64),
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      reportingPool.query('select auth.resolve_channel_credential($1)', [
        'd'.repeat(64),
      ]),
    ).rejects.toMatchObject({ code: '42501' });

    const tableAcl = await rootPool.query<{
      grantee: string;
      privilege_type: string;
    }>(`select grantee, privilege_type
       from information_schema.table_privileges
       where table_schema = 'auth'
         and table_name = 'inbox_channel_credential'
         and grantee <> 'bap_owner'
       order by grantee, privilege_type`);
    expect(tableAcl.rows).toEqual([
      { grantee: 'bap_backup', privilege_type: 'SELECT' },
    ]);

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
      'auth.issue_channel_credential(uuid, text, text)'::regprocedure,
      'auth.revoke_channel_credential(uuid)'::regprocedure,
      'auth.resolve_channel_credential(text)'::regprocedure,
      'app.role_is_channel()'::regprocedure
    )
    order by function_name`);
    expect(functions.rows).toEqual([
      {
        function_name: 'app.role_is_channel',
        grantees: ['bap_api', 'bap_owner', 'bap_reporting'],
        owner: 'bap_owner',
        proconfig: ['search_path=pg_catalog, app'],
        prosecdef: false,
      },
      {
        function_name: 'auth.issue_channel_credential',
        grantees: ['bap_api', 'bap_owner'],
        owner: 'bap_owner',
        proconfig: ['search_path=pg_catalog, auth'],
        prosecdef: true,
      },
      {
        function_name: 'auth.resolve_channel_credential',
        grantees: ['bap_auth', 'bap_owner'],
        owner: 'bap_owner',
        proconfig: ['search_path=pg_catalog, auth'],
        prosecdef: true,
      },
      {
        function_name: 'auth.revoke_channel_credential',
        grantees: ['bap_api', 'bap_owner'],
        owner: 'bap_owner',
        proconfig: ['search_path=pg_catalog, auth'],
        prosecdef: true,
      },
    ]);
  });

  it('lets a channel write the inbox graph as itself and read only its own channel row', async () => {
    await asTenant(apiPool, orgOneChannel, async (transaction) => {
      await transaction.query(
        `insert into app.blob (id, organization_id, sha256, byte_size, media_type, storage_key, created_by)
         values ($1, 'org-1', $2, 1024, 'application/pdf', $3, $4)`,
        [
          channelBlobId,
          channelSha256,
          `org/org-1/${channelSha256}`,
          orgOneChannel.userId,
        ],
      );
      await transaction.query(
        `insert into app.inbox_item (
           id, organization_id, channel_kind, channel_id, payload_kind, origin, legal_entity_id, hint_kind, created_by
         )
         values ($1, 'org-1', 'api', $2, 'file', 'abcdefgh', $3, 'received_invoice', $4)`,
        [channelItemId, channelId, ownedEntityId, orgOneChannel.userId],
      );
      await transaction.query(
        `insert into app.inbox_item_file (item_id, organization_id, blob_id, position)
         values ($1, 'org-1', $2, 1)`,
        [channelItemId, channelBlobId],
      );
      await transaction.query(
        `insert into app.inbox_event (organization_id, item_id, kind, actor_user_id)
         values ('org-1', $1, 'received', $2)`,
        [channelItemId, orgOneChannel.userId],
      );
      await transaction.query(
        `insert into app.inbox_item_extraction (
           organization_id, item_id, provider, provider_version, confidence, created_by
         )
         values ('org-1', $1, 'sniff', '1', 0.500, $2)`,
        [channelItemId, orgOneChannel.userId],
      );
      // The audit log accepts the channel as an actor even though it can never read the log back.
      await transaction.query(
        "select app.record_audit('inbox.intake', 'inbox_item', $1)",
        [channelItemId],
      );
    });

    const visible = await asTenant(
      apiPool,
      orgOneChannel,
      async (transaction) => {
        const channels = await transaction.query<{ id: string }>(
          'select id from app.inbox_channel order by id',
        );
        const totals: Record<string, number> = {};

        for (const table of hiddenTables) {
          const result = await transaction.query<{ total: number }>(
            `select count(*)::integer as total from app.${table}`,
          );
          totals[table] = result.rows[0]?.total ?? -1;
        }

        const inbox = await transaction.query<{
          blobs: number;
          items: number;
        }>(
          `select (select count(*)::integer from app.blob) as blobs,
                  (select count(*)::integer from app.inbox_item) as items`,
        );

        return { channels: channels.rows, inbox: inbox.rows[0], totals };
      },
    );

    expect(visible.channels).toEqual([{ id: channelId }]);
    expect(visible.totals).toEqual({
      audit_log: 0,
      dataset: 0,
      document: 0,
      legal_entity: 0,
      partner: 0,
    });
    expect(visible.inbox).toEqual({ blobs: 1, items: 1 });
    // The audit entry exists and names the channel; only a person can read it.
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query<{ user_id: string }>(
          "select user_id from app.audit_log where action = 'inbox.intake'",
        ),
      ),
    ).resolves.toMatchObject({ rows: [{ user_id: orgOneChannel.userId }] });
  });

  it('refuses a channel that writes as someone else or outside the inbox', async () => {
    await expect(
      asTenant(apiPool, orgOneChannel, (transaction) =>
        transaction.query(
          `insert into app.inbox_item (organization_id, channel_kind, channel_id, payload_kind, created_by)
           values ('org-1', 'api', $1, 'file', 'user-1')`,
          [channelId],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asTenant(apiPool, orgOneChannel, (transaction) =>
        transaction.query(
          `insert into app.document (organization_id, legal_entity_id, kind, title, document_date, created_by)
           values ('org-1', $1, 'other', 'Placeholder channel document', '2026-09-03', $2)`,
          [ownedEntityId, orgOneChannel.userId],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asTenant(apiPool, orgOneChannel, (transaction) =>
        transaction.query(
          `insert into app.partner (organization_id, name, created_by)
           values ('org-1', 'Placeholder channel partner', $1)`,
          [orgOneChannel.userId],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asTenant(apiPool, orgOneChannel, (transaction) =>
        transaction.query(
          `insert into app.document_file (document_id, organization_id, blob_id, position, created_by)
           values ($1, 'org-1', $2, 1, $3)`,
          [documentId, channelBlobId, orgOneChannel.userId],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asTenant(apiPool, orgOneChannel, (transaction) =>
        transaction.query(
          `insert into app.inbox_channel (organization_id, kind, name, created_by)
           values ('org-1', 'api', 'Placeholder self made', $1)`,
          [orgOneChannel.userId],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asTenant(apiPool, orgOneChannel, (transaction) =>
        transaction.query(
          "update app.blob set scan_status = 'clean' where id = $1",
          [channelBlobId],
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 0 });
  });

  it('lets a channel move its item but never route it or override a person', async () => {
    await rootPool.query(
      `insert into app.inbox_item (
         id, organization_id, channel_kind, channel_id, payload_kind, status, document_id,
         decided_by_kind, decided_by_user_id, routed_at, created_by
       )
       values ($1, 'org-1', 'api', $3, 'file', 'routed', $4, 'user', 'user-1', now(), $5),
              ($2, 'org-1', 'api', $3, 'file', 'needs_review', null, 'user', 'user-1', null, $5)`,
      [
        routedItemId,
        decidedItemId,
        channelId,
        documentId,
        orgOneChannel.userId,
      ],
    );

    await expect(
      asTenant(apiPool, orgOneChannel, (transaction) =>
        transaction.query(
          "update app.inbox_item set status = 'processing' where id = $1",
          [channelItemId],
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      asTenant(apiPool, orgOneChannel, (transaction) =>
        transaction.query(
          "update app.inbox_item set status = 'failed' where id = $1",
          [routedItemId],
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 0 });
    await expect(
      asTenant(apiPool, orgOneChannel, (transaction) =>
        transaction.query(
          "update app.inbox_item set status = 'failed' where id = $1",
          [decidedItemId],
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 0 });
    await expect(
      asTenant(apiPool, orgOneChannel, (transaction) =>
        transaction.query(
          "update app.inbox_item set status = 'routed', document_id = $2, routed_at = now() where id = $1",
          [channelItemId, documentId],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asTenant(apiPool, orgOneChannel, (transaction) =>
        transaction.query(
          'update app.inbox_item set partner_id = $2 where id = $1',
          [channelItemId, partnerId],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asTenant(apiPool, orgOneChannel, (transaction) =>
        transaction.query(
          "update app.inbox_item set decided_by_kind = 'user', decided_by_user_id = 'user-1' where id = $1",
          [channelItemId],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      rootPool.query<{ status: string }>(
        'select status from app.inbox_item where id = $1',
        [channelItemId],
      ),
    ).resolves.toMatchObject({ rows: [{ status: 'processing' }] });
  });

  it('keeps every non-inbox read open to members and the reporting role', async () => {
    await expect(
      asTenant(reportingPool, orgOneMember, (transaction) =>
        transaction.query<{ documents: number; partners: number }>(
          `select (select count(*)::integer from app.document) as documents,
                  (select count(*)::integer from app.partner) as partners`,
        ),
      ),
    ).resolves.toMatchObject({ rows: [{ documents: 1, partners: 1 }] });
    await expect(
      asTenant(apiPool, orgOneMember, (transaction) =>
        transaction.query<{ total: number }>(
          'select count(*)::integer as total from app.audit_log',
        ),
      ),
    ).resolves.toMatchObject({ rows: [{ total: 1 }] });
    await expect(
      reportingPool.query(
        `insert into app.inbox_channel (organization_id, kind, name, created_by)
         values ('org-1', 'api', 'Placeholder reporting', 'user-1')`,
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('pins the item to its channel kind', async () => {
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.inbox_item (organization_id, channel_kind, payload_kind, created_by)
           values ('org-1', 'api', 'file', 'user-1')`,
        ),
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_item_channel_check',
    });
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.inbox_item (organization_id, channel_kind, channel_id, payload_kind, created_by)
           values ('org-1', 'upload', $1, 'file', 'user-1')`,
          [channelId],
        ),
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_item_channel_check',
    });
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.inbox_item (organization_id, channel_kind, channel_id, payload_kind, created_by)
           values ('org-1', 'api', $1, 'file', 'user-1')`,
          [foreignChannelId],
        ),
      ),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'inbox_item_channel_fkey',
    });
    // A channel with items is soft deleted, never removed.
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query('delete from app.inbox_channel where id = $1', [
          channelId,
        ]),
      ),
    ).rejects.toMatchObject({
      code: '23001',
      constraint: 'inbox_item_channel_fkey',
    });
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          'update app.inbox_channel set deleted_at = now() where id = $1',
          [disabledChannelId],
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          'update app.inbox_channel set enabled = true where id = $1',
          [disabledChannelId],
        ),
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_channel_deleted_disabled_check',
    });
  });

  it('keys the replay per channel, so two channels of one organization may share an external id', async () => {
    const indexes = await rootPool.query<{ indexdef: string }>(
      `select indexdef from pg_indexes
        where schemaname = 'app' and tablename = 'inbox_item' and indexname like '%external_id%'`,
    );
    expect(indexes.rows.map((row) => row.indexdef)).toEqual([
      'CREATE UNIQUE INDEX inbox_item_channel_external_id_key ON app.inbox_item USING btree (organization_id, channel_id, external_id) WHERE ((external_id IS NOT NULL) AND (channel_id IS NOT NULL))',
    ]);

    await asTenant(apiPool, orgOneOwner, (transaction) =>
      transaction.query(
        `insert into app.inbox_channel (id, organization_id, kind, name, created_by)
         values ($1, 'org-1', 'api', 'Placeholder second push', 'user-1')`,
        [secondChannelId],
      ),
    );
    for (const target of [channelId, secondChannelId]) {
      await asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.inbox_item (organization_id, channel_kind, channel_id, payload_kind, external_id, created_by)
           values ('org-1', 'api', $1, 'structured', 'shared-1', 'user-1')`,
          [target],
        ),
      );
    }
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.inbox_item (organization_id, channel_kind, channel_id, payload_kind, external_id, created_by)
           values ('org-1', 'api', $1, 'structured', 'shared-1', 'user-1')`,
          [secondChannelId],
        ),
      ),
    ).rejects.toMatchObject({
      code: '23505',
      constraint: 'inbox_item_channel_external_id_key',
    });

    await rootPool.query(
      "delete from app.inbox_item where external_id = 'shared-1'",
    );
    await rootPool.query('delete from app.inbox_channel where id = $1', [
      secondChannelId,
    ]);
  });

  it('keeps the channel namespace out of identities and out of erasure', async () => {
    await expect(
      asOwner((client) =>
        client.query(
          `insert into auth."user" (id, name, email, email_verified)
           values ('channel_x', 'Channel', 'channel@example.test', true)`,
        ),
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'user_id_not_channel_check',
    });
    await expect(
      asEraser((client) =>
        client.query('select app.erase_user($1)', [orgOneChannel.userId]),
      ),
    ).rejects.toMatchObject({ code: 'P0001' });
    await expect(
      rootPool.query<{ created_by: string }>(
        'select created_by from app.inbox_item where id = $1',
        [channelItemId],
      ),
    ).resolves.toMatchObject({ rows: [{ created_by: orgOneChannel.userId }] });

    // The person who created a channel is still erased from it.
    await rootPool.query(
      `insert into app.inbox_channel (organization_id, kind, name, created_by)
       values ('org-1', 'api', 'Placeholder erased author', 'erasure-user')`,
    );
    const erasure = await asEraser((client) =>
      client.query<{ tombstone: string | null }>(
        'select app.erase_user($1) as tombstone',
        ['erasure-user'],
      ),
    );
    expect(erasure.rows[0]?.tombstone).toMatch(/^erased_/);
    await expect(
      rootPool.query<{ created_by: string }>(
        "select created_by from app.inbox_channel where name = 'Placeholder erased author'",
      ),
    ).resolves.toMatchObject({
      rows: [{ created_by: erasure.rows[0]?.tombstone }],
    });
  });
});
