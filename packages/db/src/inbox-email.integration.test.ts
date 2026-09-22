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
const intakeDomain = 'in.example.test';

// Two email channels and one api channel inside org-1, one email channel and one blob inside org-2.
const apiChannelId = '00000000-0000-4000-8000-0000000000c1';
const emailChannelId = '00000000-0000-4000-8000-0000000000c2';
const secondEmailChannelId = '00000000-0000-4000-8000-0000000000c3';
const foreignEmailChannelId = '00000000-0000-4000-8000-0000000000c4';
const ownedBlobId = '00000000-0000-4000-8000-00000000f001';
const foreignBlobId = '00000000-0000-4000-8000-00000000f002';
const emailItemId = '00000000-0000-4000-8000-000000001001';
const emailAddressPattern = /^in-[0-9a-f]{32}@in\.example\.test$/;

const orgOneOwner: TenantContext = {
  organizationId: 'org-1',
  role: 'owner',
  userId: 'user-1',
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
  userId: `channel_${emailChannelId}`,
};

let apiPool: Pool;
let authPool: Pool;
let container: StartedPostgreSqlContainer;
let migratorPool: Pool;
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

// The email caller hashes the lowercased local part only, never the whole address.
function emailSecretHash(address: string): string {
  const localPart = address.split('@')[0] ?? '';

  return sha256Hex(localPart.toLowerCase());
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

interface IssuedCredential {
  credential_id: string;
  display_prefix: string;
  secret: string;
}

async function issueCredential(
  context: TenantContext,
  targetChannelId: string,
  kind: string,
  domain: string | null = null,
): Promise<IssuedCredential> {
  const result = await asTenant(apiPool, context, (transaction) =>
    transaction.query<IssuedCredential>(
      'select credential_id, secret, display_prefix from auth.issue_channel_credential($1, $2, $3)',
      [targetChannelId, kind, domain],
    ),
  );
  const issued = result.rows[0];

  if (issued === undefined) {
    throw new Error('No credential was issued.');
  }

  return issued;
}

async function resolveCredential(secretHash: string) {
  return authPool.query<{
    channel_id: string;
    kind: string;
    organization_id: string;
  }>(
    'select organization_id, channel_id, kind from auth.resolve_channel_credential($1)',
    [secretHash],
  );
}

async function revokeCredential(context: TenantContext, credentialId: string) {
  return asTenant(apiPool, context, (transaction) =>
    transaction.query<{ revoked: boolean }>(
      'select auth.revoke_channel_credential($1) as revoked',
      [credentialId],
    ),
  );
}

async function readChannelAddress(
  targetChannelId: string,
): Promise<string | null> {
  const result = await rootPool.query<{ email_address: string | null }>(
    'select email_address from app.inbox_channel where id = $1',
    [targetChannelId],
  );

  return result.rows[0]?.email_address ?? null;
}

async function readScanStatus(blobId: string): Promise<string | null> {
  const result = await rootPool.query<{ scan_status: string }>(
    'select scan_status from app.blob where id = $1',
    [blobId],
  );

  return result.rows[0]?.scan_status ?? null;
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
  await runMigrations(migratorPool);

  await asOwner(async (client) => {
    await client.query(`
      insert into auth."user" (id, name, email, email_verified)
      values ('user-1', 'Owner', 'owner@example.test', true),
             ('user-2', 'Other', 'other@example.test', true),
             ('user-3', 'Member', 'reader@example.test', true)
    `);
    await client.query(`
      insert into auth.organization (id, name, slug)
      values ('org-1', 'One', 'one'), ('org-2', 'Two', 'two')
    `);
    await client.query(`
      insert into auth.member (id, organization_id, user_id, role)
      values ('member-1', 'org-1', 'user-1', 'owner'),
             ('member-2', 'org-2', 'user-2', 'owner'),
             ('member-3', 'org-1', 'user-3', 'member')
    `);
  });
  await rootPool.query(
    `insert into app.inbox_channel (id, organization_id, kind, name, created_by)
     values ($1, 'org-1', 'api', 'Placeholder push', 'user-1'),
            ($2, 'org-1', 'email', 'Placeholder mailbox', 'user-1'),
            ($3, 'org-1', 'email', 'Placeholder second mailbox', 'user-1'),
            ($4, 'org-2', 'email', 'Placeholder foreign mailbox', 'user-2')`,
    [apiChannelId, emailChannelId, secondEmailChannelId, foreignEmailChannelId],
  );
  await rootPool.query(
    `insert into app.blob (id, organization_id, sha256, byte_size, media_type, storage_key, created_by)
     values ($1, 'org-1', $3, 2048, 'message/rfc822', $5, $7),
            ($2, 'org-2', $4, 2048, 'message/rfc822', $6, 'user-2')`,
    [
      ownedBlobId,
      foreignBlobId,
      'a'.repeat(64),
      'b'.repeat(64),
      `org/org-1/${'a'.repeat(64)}`,
      `org/org-2/${'b'.repeat(64)}`,
      orgOneChannel.userId,
    ],
  );
});

afterAll(async () => {
  await Promise.all([
    apiPool.end(),
    authPool.end(),
    migratorPool.end(),
    rootPool.end(),
  ]);
  await container.stop();
});

describe('inbox email channel', () => {
  it('applies the inbox email migration and records the compatible version', async () => {
    const result = await runMigrations(migratorPool);
    const compatibility = await checkMigrationCompatibility(apiPool);

    expect(result.applied).toEqual([]);
    expect(result.currentVersion).toBe('20260922.0006');
    expect(DATABASE_MIGRATION_COMPATIBILITY).toBe('20260922.0006');
    expect(compatibility).toEqual({
      compatible: true,
      expectedVersion: '20260922.0006',
      version: '20260922.0006',
    });

    const indexes = await rootPool.query<{ indexdef: string }>(
      `select indexdef from pg_indexes
        where schemaname = 'app' and tablename = 'inbox_channel' and indexname = 'inbox_channel_email_address_key'`,
    );
    expect(indexes.rows.map((row) => row.indexdef)).toEqual([
      'CREATE UNIQUE INDEX inbox_channel_email_address_key ON app.inbox_channel USING btree (email_address) WHERE (email_address IS NOT NULL)',
    ]);

    const policies = await rootPool.query<{
      cmd: string;
      qual: string;
      roles: string[];
      with_check: string;
    }>(
      `select cmd, qual, roles::text[] as roles, with_check from pg_policies
        where schemaname = 'app' and tablename = 'blob' and policyname = 'blob_maintenance_update'`,
    );
    expect(policies.rows).toEqual([
      {
        cmd: 'UPDATE',
        qual: "(organization_id = current_setting('bap.organization_id'::text, true))",
        roles: ['bap_owner'],
        with_check:
          "(organization_id = current_setting('bap.organization_id'::text, true))",
      },
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
      'app.record_blob_scan(uuid, text)'::regprocedure,
      'auth.issue_channel_credential(uuid, text, text)'::regprocedure
    )
    order by function_name`);
    expect(functions.rows).toEqual([
      {
        function_name: 'app.record_blob_scan',
        grantees: ['bap_api', 'bap_owner'],
        owner: 'bap_owner',
        proconfig: ['search_path=pg_catalog, app'],
        prosecdef: true,
      },
      {
        function_name: 'auth.issue_channel_credential',
        grantees: ['bap_api', 'bap_owner'],
        owner: 'bap_owner',
        proconfig: ['search_path=pg_catalog, auth'],
        prosecdef: true,
      },
    ]);
    // The two argument signature is gone; the api caller relies on the default.
    await expect(
      rootPool.query(
        "select 'auth.issue_channel_credential(uuid, text)'::regprocedure",
      ),
    ).rejects.toMatchObject({ code: '42883' });
  });

  it('refuses a credential kind that does not match the channel kind', async () => {
    await expect(
      issueCredential(orgOneOwner, apiChannelId, 'email_address', intakeDomain),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_channel_credential_kind_match',
    });
    await expect(
      issueCredential(orgOneOwner, emailChannelId, 'api_token'),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_channel_credential_kind_match',
    });
    // An unknown kind is still the vocabulary check, before the channel is consulted.
    await expect(
      issueCredential(orgOneOwner, emailChannelId, 'password'),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_channel_credential_kind_check',
    });
    // The api path still issues through the default third argument.
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query<{ secret: string }>(
          "select secret from auth.issue_channel_credential($1, 'api_token')",
          [apiChannelId],
        ),
      ),
    ).resolves.toMatchObject({
      rows: [
        { secret: expect.stringMatching(/^bap_intake_[A-Za-z0-9_-]{43}$/) },
      ],
    });
  });

  it('issues one address per email channel, stores the hash of the local part and writes the address on the channel', async () => {
    await expect(
      issueCredential(orgOneOwner, emailChannelId, 'email_address'),
    ).rejects.toMatchObject({ code: '22023' });
    await expect(
      issueCredential(orgOneOwner, emailChannelId, 'email_address', ''),
    ).rejects.toMatchObject({ code: '22023' });
    await expect(readChannelAddress(emailChannelId)).resolves.toBeNull();

    const issued = await issueCredential(
      orgOneOwner,
      emailChannelId,
      'email_address',
      intakeDomain,
    );

    expect(issued.secret).toMatch(emailAddressPattern);
    expect(issued.display_prefix).toBe(issued.secret.slice(3, 11));
    await expect(readChannelAddress(emailChannelId)).resolves.toBe(
      issued.secret,
    );

    const stored = await rootPool.query<{
      created_by: string;
      display_prefix: string;
      kind: string;
      secret_sha256: string;
    }>(
      `select secret_sha256, display_prefix, kind, created_by
       from auth.inbox_channel_credential
       where id = $1`,
      [issued.credential_id],
    );
    expect(stored.rows).toEqual([
      {
        created_by: 'user-1',
        display_prefix: issued.display_prefix,
        kind: 'email_address',
        secret_sha256: emailSecretHash(issued.secret),
      },
    ]);
    expect(stored.rows[0]?.secret_sha256).not.toBe(sha256Hex(issued.secret));

    await expect(
      issueCredential(
        orgOneOwner,
        emailChannelId,
        'email_address',
        intakeDomain,
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_channel_credential_active_limit',
    });
    await expect(
      issueCredential(
        orgOneMember,
        emailChannelId,
        'email_address',
        intakeDomain,
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      issueCredential(
        orgOneOwner,
        foreignEmailChannelId,
        'email_address',
        intakeDomain,
      ),
    ).rejects.toMatchObject({ code: 'P0002' });
  });

  it('resolves an address by the lowercased local part and forgets it after revocation', async () => {
    const address = await readChannelAddress(emailChannelId);

    if (address === null) {
      throw new Error('The email channel holds no address.');
    }

    // A mail client may upper case the recipient; the caller lowercases before hashing.
    await expect(
      resolveCredential(emailSecretHash(address.toUpperCase())),
    ).resolves.toMatchObject({
      rows: [
        {
          channel_id: emailChannelId,
          kind: 'email_address',
          organization_id: 'org-1',
        },
      ],
    });
    // The whole address or the raw upper case local part is a miss.
    await expect(resolveCredential(sha256Hex(address))).resolves.toMatchObject({
      rows: [],
    });
    await expect(
      resolveCredential(sha256Hex(address.split('@')[0]?.toUpperCase() ?? '')),
    ).resolves.toMatchObject({ rows: [] });

    const [credential] = (
      await rootPool.query<{ id: string }>(
        `select id from auth.inbox_channel_credential
         where channel_id = $1 and revoked_at is null`,
        [emailChannelId],
      )
    ).rows;

    // Another organization cannot revoke it and the address stays.
    await expect(
      revokeCredential(orgTwoOwner, credential?.id ?? ''),
    ).resolves.toMatchObject({ rows: [{ revoked: false }] });
    await expect(readChannelAddress(emailChannelId)).resolves.toBe(address);

    await expect(
      revokeCredential(orgOneOwner, credential?.id ?? ''),
    ).resolves.toMatchObject({ rows: [{ revoked: true }] });
    await expect(readChannelAddress(emailChannelId)).resolves.toBeNull();
    await expect(
      resolveCredential(emailSecretHash(address)),
    ).resolves.toMatchObject({ rows: [] });
    await expect(
      revokeCredential(orgOneOwner, credential?.id ?? ''),
    ).resolves.toMatchObject({ rows: [{ revoked: false }] });

    // Reissue works once the slot is free and mints a different address.
    const reissued = await issueCredential(
      orgOneOwner,
      emailChannelId,
      'email_address',
      intakeDomain,
    );
    expect(reissued.secret).toMatch(emailAddressPattern);
    expect(reissued.secret).not.toBe(address);
    await expect(readChannelAddress(emailChannelId)).resolves.toBe(
      reissued.secret,
    );
  });

  it('keeps the address unique across the platform', async () => {
    const address = await readChannelAddress(emailChannelId);

    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          'update app.inbox_channel set email_address = $2 where id = $1',
          [secondEmailChannelId, address],
        ),
      ),
    ).rejects.toMatchObject({
      code: '23505',
      constraint: 'inbox_channel_email_address_key',
    });
    // Two channels without an address never collide.
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          'update app.inbox_channel set email_address = null where id = $1',
          [secondEmailChannelId],
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  it('records a scan verdict through the definer only inside the caller organization', async () => {
    await expect(readScanStatus(ownedBlobId)).resolves.toBe('not_scanned');

    await expect(
      asTenant(apiPool, orgOneChannel, (transaction) =>
        transaction.query('select app.record_blob_scan($1, $2)', [
          ownedBlobId,
          'clean',
        ]),
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(readScanStatus(ownedBlobId)).resolves.toBe('clean');

    await expect(
      asTenant(apiPool, orgOneChannel, (transaction) =>
        transaction.query('select app.record_blob_scan($1, $2)', [
          foreignBlobId,
          'infected',
        ]),
      ),
    ).rejects.toMatchObject({ code: 'P0002' });
    await expect(readScanStatus(foreignBlobId)).resolves.toBe('not_scanned');

    await expect(
      asTenant(apiPool, orgOneChannel, (transaction) =>
        transaction.query('select app.record_blob_scan($1, $2)', [
          ownedBlobId,
          'not_scanned',
        ]),
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'blob_scan_status_check',
    });
    await expect(
      asTenant(apiPool, orgOneChannel, (transaction) =>
        transaction.query('select app.record_blob_scan($1, $2)', [
          ownedBlobId,
          null,
        ]),
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      apiPool.query('select app.record_blob_scan($1, $2)', [
        ownedBlobId,
        'failed',
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      authPool.query('select app.record_blob_scan($1, $2)', [
        ownedBlobId,
        'failed',
      ]),
    ).rejects.toMatchObject({ code: '42501' });

    // blob_update still refuses the channel: a direct update changes nothing.
    await expect(
      asTenant(apiPool, orgOneChannel, (transaction) =>
        transaction.query(
          "update app.blob set scan_status = 'infected' where id = $1",
          [ownedBlobId],
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 0 });
    await expect(
      asTenant(apiPool, orgOneMember, (transaction) =>
        transaction.query(
          "update app.blob set scan_status = 'infected' where id = $1",
          [ownedBlobId],
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 0 });
    await expect(readScanStatus(ownedBlobId)).resolves.toBe('clean');

    // The maintenance policy admits bap_owner inside the caller organization only.
    await expect(
      asOwner(async (client) => {
        await client.query(
          "select set_config('bap.organization_id', 'org-1', true)",
        );
        return client.query(
          "update app.blob set scan_status = 'failed' where id = $1",
          [foreignBlobId],
        );
      }),
    ).resolves.toMatchObject({ rowCount: 0 });
    await expect(readScanStatus(foreignBlobId)).resolves.toBe('not_scanned');

    await expect(
      asTenant(apiPool, orgOneChannel, (transaction) =>
        transaction.query('select app.record_blob_scan($1, $2)', [
          ownedBlobId,
          'infected',
        ]),
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(readScanStatus(ownedBlobId)).resolves.toBe('infected');
  });

  it('stores the sender as display text within its length check', async () => {
    await expect(
      asTenant(apiPool, orgOneChannel, (transaction) =>
        transaction.query(
          `insert into app.inbox_item (id, organization_id, channel_kind, channel_id, payload_kind, origin, sender, created_by)
           values ($1, 'org-1', 'email', $2, 'email', 'abcdefgh', 'sender@example.test', $3)`,
          [emailItemId, emailChannelId, orgOneChannel.userId],
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      asTenant(apiPool, orgOneChannel, (transaction) =>
        transaction.query(
          "update app.inbox_item set sender = '' where id = $1",
          [emailItemId],
        ),
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_item_sender_check',
    });
    await expect(
      asTenant(apiPool, orgOneChannel, (transaction) =>
        transaction.query(
          'update app.inbox_item set sender = $2 where id = $1',
          [emailItemId, 'x'.repeat(321)],
        ),
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_item_sender_check',
    });
    await expect(
      asTenant(apiPool, orgOneChannel, (transaction) =>
        transaction.query(
          'update app.inbox_item set sender = null where id = $1',
          [emailItemId],
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 1 });

    const comments = await rootPool.query<{
      column_name: string;
      comment: string;
    }>(
      `select attribute.attname as column_name, col_description(attribute.attrelid, attribute.attnum) as comment
       from pg_attribute as attribute
       where attribute.attrelid = 'app.inbox_item'::regclass
         and attribute.attname in ('origin', 'sender')
       order by attribute.attname`,
    );
    expect(comments.rows).toEqual([
      {
        column_name: 'origin',
        comment:
          'The credential display prefix for every channel kind: who pushed, never a sender address.',
      },
      {
        column_name: 'sender',
        comment:
          'The parsed From header address of the MIME, unverified, display only, never MAIL FROM.',
      },
    ]);
  });
});
