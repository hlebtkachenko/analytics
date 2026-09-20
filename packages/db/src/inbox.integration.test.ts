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

// Every app table the inbox migration adds, in the order a reader meets them.
const inboxTables = [
  'blob',
  'inbox_item',
  'inbox_item_file',
  'inbox_item_extraction',
  'inbox_event',
  'document_file',
] as const;

// Neutral fixtures: one legal entity, partner, document and dataset inside org-1, one entity inside org-2.
const ownedEntityId = '00000000-0000-4000-8000-0000000000e1';
const foreignEntityId = '00000000-0000-4000-8000-0000000000e3';
const partnerId = '00000000-0000-4000-8000-0000000000b1';
const documentId = '00000000-0000-4000-8000-0000000000a1';
const datasetId = '00000000-0000-4000-8000-0000000000d1';

// Fixed identifiers keep the policy and constraint assertions exact.
const blobId = '00000000-0000-4000-8000-00000000f001';
const foreignBlobId = '00000000-0000-4000-8000-00000000f002';
const itemId = '00000000-0000-4000-8000-000000001001';
const duplicateItemId = '00000000-0000-4000-8000-000000001002';
const foreignItemId = '00000000-0000-4000-8000-000000001003';
const routedItemId = '00000000-0000-4000-8000-000000001004';
const routedDocumentId = '00000000-0000-4000-8000-0000000000a4';
const channelId = '00000000-0000-4000-8000-0000000000c1';
const sha256 = 'a'.repeat(64);
const foreignSha256 = 'b'.repeat(64);

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

let apiPool: Pool;
let backupPool: Pool;
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
  reportingPool = poolFor('bap_reporting', testPassword);
  backupPool = poolFor('bap_backup', testPassword);
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
    `insert into app.legal_entity (id, organization_id, name, kind, created_by)
     values ($1, 'org-1', 'Placeholder Holding', 'company', 'user-1'),
            ($2, 'org-2', 'Placeholder Foreign', 'company', 'user-2')`,
    [ownedEntityId, foreignEntityId],
  );
  await rootPool.query(
    `insert into app.partner (id, organization_id, name, created_by)
     values ($1, 'org-1', 'Placeholder Supplier', 'user-1')`,
    [partnerId],
  );
  await rootPool.query(
    `insert into app.document (id, organization_id, legal_entity_id, kind, title, document_date, created_by)
     values ($1, 'org-1', $2, 'received_invoice', 'Placeholder received invoice', '2026-09-01', 'user-1'),
            ($3, 'org-1', $2, 'advance_request', 'Placeholder advance request', '2026-09-02', 'user-1')`,
    [documentId, ownedEntityId, routedDocumentId],
  );
  await rootPool.query(
    `insert into app.dataset (id, organization_id, legal_entity_id, name, status, created_by)
     values ($1, 'org-1', $2, 'Placeholder dataset', 'ready', 'user-1')`,
    [datasetId, ownedEntityId],
  );
});

afterAll(async () => {
  await Promise.all([
    apiPool.end(),
    backupPool.end(),
    migratorPool.end(),
    reportingPool.end(),
    rootPool.end(),
  ]);
  await container.stop();
});

describe('inbox intake isolation', () => {
  it('applies the inbox migration and records the compatible version', async () => {
    const result = await runMigrations(migratorPool);
    const compatibility = await checkMigrationCompatibility(apiPool);

    expect(result.applied).toEqual([]);
    expect(result.currentVersion).toBe('20260917.0006');
    expect(DATABASE_MIGRATION_COMPATIBILITY).toBe('20260917.0006');
    expect(compatibility).toEqual({
      compatible: true,
      expectedVersion: '20260917.0006',
      version: '20260917.0006',
    });
  });

  it('retires the document upload and content hash columns and widens the kind vocabularies', async () => {
    await expect(
      rootPool.query<{ column_name: string }>(
        `select column_name
         from information_schema.columns
         where table_schema = 'app'
           and table_name = 'document'
           and column_name in ('upload_id', 'content_hash', 'inbox_item_id')
         order by column_name`,
      ),
    ).resolves.toMatchObject({ rows: [{ column_name: 'inbox_item_id' }] });
    await expect(
      rootPool.query<{ conname: string }>(
        `select conname
         from pg_constraint
         where conname in ('document_upload_fkey', 'document_content_hash_check')`,
      ),
    ).resolves.toMatchObject({ rows: [] });
    await expect(
      rootPool.query<{ indexname: string }>(
        `select indexname from pg_indexes where schemaname = 'app' and indexname = 'document_upload_idx'`,
      ),
    ).resolves.toMatchObject({ rows: [] });
    // The advance request fixture already sits in the register, so the link only has to accept the new kind.
    await asTenant(apiPool, orgOneOwner, async (transaction) => {
      await transaction.query(
        `insert into app.document_link (organization_id, from_document_id, to_document_id, kind, created_by)
         values ('org-1', $1, $2, 'advance_of', 'user-1')`,
        [routedDocumentId, documentId],
      );
    });
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.document (organization_id, legal_entity_id, kind, title, document_date, created_by)
           values ('org-1', $1, 'unknown_kind', 'Placeholder unknown', '2026-09-02', 'user-1')`,
          [ownedEntityId],
        ),
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'document_kind_check',
    });
  });

  it('accepts a full inbox graph from an owner through bap_api', async () => {
    await asTenant(apiPool, orgOneOwner, async (transaction) => {
      await transaction.query(
        `insert into app.blob (
           id, organization_id, sha256, byte_size, media_type, storage_key, original_filename, created_by
         )
         values ($1, 'org-1', $2, 1024, 'application/pdf', $3, 'placeholder.pdf', 'user-1')`,
        [blobId, sha256, `org/org-1/${sha256}`],
      );
      await transaction.query(
        `insert into app.inbox_item (
           id, organization_id, channel_kind, payload_kind, status, detected_type, confidence,
           hint_text, hint_legal_entity_id, hint_kind, hint_partner_id, hint_link_document_id, created_by
         )
         values ($1, 'org-1', 'upload', 'file', 'needs_review', 'received_invoice', 0.750,
                 'Placeholder hint', $2, 'received_invoice', $3, $4, 'user-1')`,
        [itemId, ownedEntityId, partnerId, documentId],
      );
      await transaction.query(
        `insert into app.inbox_item_file (item_id, organization_id, blob_id, position, page_from, page_to)
         values ($1, 'org-1', $2, 1, 1, 2)`,
        [itemId, blobId],
      );
      await transaction.query(
        `insert into app.inbox_item_extraction (
           organization_id, item_id, provider, provider_version, detected_type, confidence,
           legal_entity_id, draft, field_confidences, reasons, issues, created_by
         )
         values ('org-1', $1, 'sniff', '1', 'received_invoice', 0.750, $2,
                 '{"kind": "received_invoice"}', '{"kind": 0.75}', '["pdf_magic_bytes"]', '[]', 'user-1')`,
        [itemId, ownedEntityId],
      );
      await transaction.query(
        `insert into app.inbox_event (organization_id, item_id, kind, actor_user_id)
         values ('org-1', $1, 'received', 'user-1'), ('org-1', $1, 'classified', null)`,
        [itemId],
      );
      await transaction.query(
        `insert into app.inbox_item (
           id, organization_id, channel_kind, payload_kind, status, duplicate_of_item_id, created_by
         )
         values ($1, 'org-1', 'upload', 'file', 'discarded', $2, 'user-1')`,
        [duplicateItemId, itemId],
      );
      await transaction.query(
        `insert into app.inbox_event (organization_id, item_id, kind, reason, actor_user_id)
         values ('org-1', $1, 'discarded', 'duplicate', 'user-1')`,
        [duplicateItemId],
      );
    });

    const stored = await asTenant(apiPool, orgOneOwner, (transaction) =>
      transaction.query<{
        event_kinds: string[];
        extraction_reasons: unknown;
        file_positions: number[];
        status: string;
      }>(
        `select item.status,
                (select array_agg(file.position order by file.position)
                 from app.inbox_item_file as file where file.item_id = item.id) as file_positions,
                (select extraction.reasons from app.inbox_item_extraction as extraction
                 where extraction.item_id = item.id
                 order by extraction.created_at desc limit 1) as extraction_reasons,
                (select array_agg(event.kind order by event.created_at, event.kind)
                 from app.inbox_event as event where event.item_id = item.id) as event_kinds
         from app.inbox_item as item
         where item.id = $1`,
        [itemId],
      ),
    );

    expect(stored.rows).toEqual([
      {
        event_kinds: ['classified', 'received'],
        extraction_reasons: ['pdf_magic_bytes'],
        file_positions: [1],
        status: 'needs_review',
      },
    ]);
  });

  it('hides every inbox table from another organization', async () => {
    await asTenant(apiPool, orgTwoOwner, async (transaction) => {
      await transaction.query(
        `insert into app.blob (id, organization_id, sha256, byte_size, media_type, storage_key, created_by)
         values ($1, 'org-2', $2, 512, 'image/png', $3, 'user-2')`,
        [foreignBlobId, foreignSha256, `org/org-2/${foreignSha256}`],
      );
      await transaction.query(
        `insert into app.inbox_item (id, organization_id, channel_kind, payload_kind, created_by)
         values ($1, 'org-2', 'upload', 'file', 'user-2')`,
        [foreignItemId],
      );
    });

    const visible = await asTenant(
      apiPool,
      orgTwoOwner,
      async (transaction) => {
        const totals: Record<string, number> = {};

        for (const table of inboxTables) {
          const result = await transaction.query<{ total: number }>(
            `select count(*)::integer as total from app.${table}`,
          );
          totals[table] = result.rows[0]?.total ?? -1;
        }

        return totals;
      },
    );

    expect(visible).toEqual({
      blob: 1,
      document_file: 0,
      inbox_event: 0,
      inbox_item: 1,
      inbox_item_extraction: 0,
      inbox_item_file: 0,
    });
    // The same bytes in a second organization are a second blob, never a shared row.
    await expect(
      asTenant(apiPool, orgTwoOwner, (transaction) =>
        transaction.query(
          `insert into app.blob (organization_id, sha256, byte_size, media_type, storage_key, created_by)
           values ('org-2', $1, 1024, 'application/pdf', $2, 'user-2')`,
          [sha256, `org/org-2/${sha256}`],
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  it('refuses an item or a file pinned to another organization', async () => {
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.inbox_item (organization_id, channel_kind, payload_kind, legal_entity_id, created_by)
           values ('org-1', 'upload', 'file', $1, 'user-1')`,
          [foreignEntityId],
        ),
      ),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'inbox_item_legal_entity_fkey',
    });
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.inbox_item_file (item_id, organization_id, blob_id, position)
           values ($1, 'org-1', $2, 2)`,
          [itemId, foreignBlobId],
        ),
      ),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'inbox_item_file_blob_fkey',
    });
  });

  it('refuses an inbox write from a member and still allows the read', async () => {
    await expect(
      asTenant(apiPool, orgOneMember, (transaction) =>
        transaction.query(
          `insert into app.inbox_item (organization_id, channel_kind, payload_kind, created_by)
           values ('org-1', 'upload', 'file', 'user-3')`,
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asTenant(apiPool, orgOneMember, (transaction) =>
        transaction.query(
          `insert into app.blob (organization_id, sha256, byte_size, media_type, storage_key, created_by)
           values ('org-1', $1, 1, 'text/plain', 'org/org-1/member', 'user-3')`,
          ['c'.repeat(64)],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asTenant(apiPool, orgOneMember, (transaction) =>
        transaction.query<{ total: number }>(
          'select count(*)::integer as total from app.inbox_item',
        ),
      ),
    ).resolves.toMatchObject({ rows: [{ total: 2 }] });
  });

  it('refuses an insert attributed to someone other than the session user', async () => {
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.inbox_item (organization_id, channel_kind, payload_kind, created_by)
           values ('org-1', 'upload', 'file', 'user-2')`,
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('keeps one blob per organization and hash', async () => {
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.blob (organization_id, sha256, byte_size, media_type, storage_key, created_by)
           values ('org-1', $1, 2048, 'application/pdf', 'org/org-1/duplicate', 'user-1')`,
          [sha256],
        ),
      ),
    ).rejects.toMatchObject({
      code: '23505',
      constraint: 'blob_organization_sha256_key',
    });
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.blob (organization_id, sha256, byte_size, media_type, storage_key, created_by)
           values ('org-1', 'not-a-hash', 2048, 'application/pdf', 'org/org-1/bad', 'user-1')`,
        ),
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'blob_sha256_check' });
  });

  it('keeps one item per organization, channel, and external id', async () => {
    // Since 20260917.0001 an api item must name its channel; the channel register itself is covered in inbox-channels.
    await rootPool.query(
      `insert into app.inbox_channel (id, organization_id, kind, name, created_by)
       values ($1, 'org-1', 'api', 'Placeholder push', 'user-1')`,
      [channelId],
    );
    await asTenant(apiPool, orgOneOwner, (transaction) =>
      transaction.query(
        `insert into app.inbox_item (organization_id, channel_kind, channel_id, payload_kind, external_id, created_by)
         values ('org-1', 'api', $1, 'structured', 'external-1', 'user-1')`,
        [channelId],
      ),
    );
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.inbox_item (organization_id, channel_kind, channel_id, payload_kind, external_id, created_by)
           values ('org-1', 'api', $1, 'structured', 'external-1', 'user-1')`,
          [channelId],
        ),
      ),
    ).rejects.toMatchObject({
      code: '23505',
      constraint: 'inbox_item_channel_external_id_key',
    });
    await rootPool.query(
      "delete from app.inbox_item where external_id = 'external-1'",
    );
    await rootPool.query('delete from app.inbox_channel where id = $1', [
      channelId,
    ]);
  });

  it('refuses a routed item with no destination and an item with two', async () => {
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.inbox_item (organization_id, channel_kind, payload_kind, status, created_by)
           values ('org-1', 'upload', 'file', 'routed', 'user-1')`,
        ),
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_item_routed_check',
    });
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.inbox_item (
             organization_id, channel_kind, payload_kind, status, document_id, dataset_id,
             decided_by_kind, decided_by_user_id, created_by
           )
           values ('org-1', 'upload', 'file', 'routed', $1, $2, 'user', 'user-1', 'user-1')`,
          [documentId, datasetId],
        ),
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_item_one_destination_check',
    });
    // A person's decision must name the person.
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.inbox_item (
             organization_id, channel_kind, payload_kind, status, document_id, decided_by_kind, created_by
           )
           values ('org-1', 'upload', 'file', 'routed', $1, 'user', 'user-1')`,
          [documentId],
        ),
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_item_decided_by_user_check',
    });
  });

  it('refuses deleting a document referenced by a routed item until the item is un-routed', async () => {
    await asTenant(apiPool, orgOneOwner, async (transaction) => {
      await transaction.query(
        `insert into app.inbox_item (
           id, organization_id, legal_entity_id, channel_kind, payload_kind, status, document_id,
           decided_by_kind, decided_by_user_id, routed_at, created_by
         )
         values ($1, 'org-1', $2, 'upload', 'file', 'routed', $3, 'user', 'user-1', now(), 'user-1')`,
        [routedItemId, ownedEntityId, routedDocumentId],
      );
      await transaction.query(
        'update app.document set inbox_item_id = $1 where id = $2',
        [routedItemId, routedDocumentId],
      );
      await transaction.query(
        `insert into app.document_file (document_id, organization_id, blob_id, position, created_by)
         values ($1, 'org-1', $2, 1, 'user-1')`,
        [routedDocumentId, blobId],
      );
    });

    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query('delete from app.document where id = $1', [
          routedDocumentId,
        ]),
      ),
    ).rejects.toMatchObject({
      code: '23001',
      constraint: 'inbox_item_document_fkey',
    });
    // The blob behind a document file is equally protected.
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query('delete from app.blob where id = $1', [blobId]),
      ),
    ).rejects.toMatchObject({ code: '23001' });

    // Undo: clear the destination first, then the register delete succeeds and cascades the file row.
    await asTenant(apiPool, orgOneOwner, async (transaction) => {
      await transaction.query(
        `update app.inbox_item
         set document_id = null, status = 'needs_review', routed_at = null
         where id = $1`,
        [routedItemId],
      );
      await transaction.query('delete from app.document where id = $1', [
        routedDocumentId,
      ]);
    });
    await expect(
      rootPool.query<{ total: number }>(
        'select count(*)::integer as total from app.document_file where document_id = $1',
        [routedDocumentId],
      ),
    ).resolves.toMatchObject({ rows: [{ total: 0 }] });
    await expect(
      rootPool.query<{ status: string }>(
        'select status from app.inbox_item where id = $1',
        [routedItemId],
      ),
    ).resolves.toMatchObject({ rows: [{ status: 'needs_review' }] });
  });

  it('destroys files, extractions, and events with their item and keeps the blob', async () => {
    await asTenant(apiPool, orgOneOwner, (transaction) =>
      transaction.query('delete from app.inbox_item where id = $1', [
        duplicateItemId,
      ]),
    );
    await asTenant(apiPool, orgOneOwner, (transaction) =>
      transaction.query('delete from app.inbox_item where id = $1', [itemId]),
    );

    const remaining = await rootPool.query<{
      blobs: number;
      events: number;
      extractions: number;
      files: number;
    }>(
      `select (select count(*)::integer from app.inbox_item_file where item_id = $1) as files,
              (select count(*)::integer from app.inbox_item_extraction where item_id = $1) as extractions,
              (select count(*)::integer from app.inbox_event where item_id = $1) as events,
              (select count(*)::integer from app.blob where id = $2) as blobs`,
      [itemId, blobId],
    );
    expect(remaining.rows).toEqual([
      { blobs: 1, events: 0, extractions: 0, files: 0 },
    ]);
  });

  it('tombstones every inbox attribution column on erasure', async () => {
    const erasedBlobId = '00000000-0000-4000-8000-00000000f009';
    const erasedItemId = '00000000-0000-4000-8000-000000001009';
    const erasedDocumentId = '00000000-0000-4000-8000-0000000000a9';
    const erasedSha256 = 'd'.repeat(64);

    await rootPool.query(
      `insert into app.blob (id, organization_id, sha256, byte_size, media_type, storage_key, created_by)
       values ($1, 'org-1', $2, 64, 'text/plain', $3, 'erasure-user')`,
      [erasedBlobId, erasedSha256, `org/org-1/${erasedSha256}`],
    );
    await rootPool.query(
      `insert into app.inbox_item (
         id, organization_id, channel_kind, payload_kind, status, assignee_id,
         decided_by_kind, decided_by_user_id, created_by
       )
       values ($1, 'org-1', 'upload', 'file', 'needs_review', 'erasure-user', 'user', 'erasure-user', 'erasure-user')`,
      [erasedItemId],
    );
    await rootPool.query(
      `insert into app.inbox_item_extraction (
         organization_id, item_id, provider, provider_version, confidence, created_by
       )
       values ('org-1', $1, 'manual', '1', 1.000, 'erasure-user')`,
      [erasedItemId],
    );
    await rootPool.query(
      `insert into app.inbox_event (organization_id, item_id, kind, actor_user_id)
       values ('org-1', $1, 'assigned', 'erasure-user')`,
      [erasedItemId],
    );
    await rootPool.query(
      `insert into app.document (id, organization_id, legal_entity_id, kind, title, document_date, created_by)
       values ($1, 'org-1', $2, 'other', 'Placeholder erased document', '2026-09-05', 'user-1')`,
      [erasedDocumentId, ownedEntityId],
    );
    await rootPool.query(
      `insert into app.document_file (document_id, organization_id, blob_id, position, created_by)
       values ($1, 'org-1', $2, 1, 'erasure-user')`,
      [erasedDocumentId, erasedBlobId],
    );

    const erasure = await asEraser((client) =>
      client.query<{ tombstone: string | null }>(
        'select app.erase_user($1) as tombstone',
        ['erasure-user'],
      ),
    );
    const tombstone = erasure.rows[0]?.tombstone ?? null;
    expect(tombstone).toMatch(
      /^erased_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    const attribution = await rootPool.query<{
      blob_created_by: string;
      event_actor_user_id: string;
      extraction_created_by: string;
      file_created_by: string;
      item_assignee_id: string;
      item_created_by: string;
      item_decided_by_user_id: string;
    }>(
      `select blob.created_by as blob_created_by,
              item.created_by as item_created_by,
              item.assignee_id as item_assignee_id,
              item.decided_by_user_id as item_decided_by_user_id,
              extraction.created_by as extraction_created_by,
              event.actor_user_id as event_actor_user_id,
              file.created_by as file_created_by
       from app.inbox_item as item
       inner join app.blob as blob on blob.id = $2
       inner join app.inbox_item_extraction as extraction on extraction.item_id = item.id
       inner join app.inbox_event as event on event.item_id = item.id
       inner join app.document_file as file on file.document_id = $3
       where item.id = $1`,
      [erasedItemId, erasedBlobId, erasedDocumentId],
    );
    expect(attribution.rows).toEqual([
      {
        blob_created_by: tombstone,
        event_actor_user_id: tombstone,
        extraction_created_by: tombstone,
        file_created_by: tombstone,
        item_assignee_id: tombstone,
        item_created_by: tombstone,
        item_decided_by_user_id: tombstone,
      },
    ]);
    // The owner's own rows keep their attribution: erasure names exactly one subject.
    await expect(
      rootPool.query<{ total: number }>(
        "select count(*)::integer as total from app.blob where created_by = 'user-1'",
      ),
    ).resolves.toMatchObject({ rows: [{ total: 1 }] });

    await rootPool.query('delete from app.document where id = $1', [
      erasedDocumentId,
    ]);
    await rootPool.query('delete from app.inbox_item where id = $1', [
      erasedItemId,
    ]);
    await rootPool.query('delete from app.blob where id = $1', [erasedBlobId]);
  });

  it('dumps every inbox table through bap_backup and refuses reporting writes', async () => {
    for (const table of inboxTables) {
      await expect(
        backupPool.query(`select * from app.${table}`),
      ).resolves.toMatchObject({ rowCount: expect.any(Number) });
      await expect(
        reportingPool.query(`select * from app.${table}`),
      ).resolves.toMatchObject({ rowCount: expect.any(Number) });
    }
    await expect(
      reportingPool.query(
        `insert into app.inbox_item (organization_id, channel_kind, payload_kind, created_by)
         values ('org-1', 'upload', 'file', 'user-1')`,
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('reserves the inbox organization slug', async () => {
    await expect(
      asOwner((client) =>
        client.query(
          `insert into auth.organization (id, name, slug)
           values ('reserved-inbox', 'Reserved inbox', 'inbox')`,
        ),
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'organization_slug_reserved_check',
    });
  });
});
