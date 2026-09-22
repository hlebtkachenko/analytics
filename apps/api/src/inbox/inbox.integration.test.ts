import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ConflictException,
  ForbiddenException,
  PayloadTooLargeException,
} from '@nestjs/common';
import {
  bootstrapDatabaseRoles,
  createDatabasePool,
  runMigrations,
  withTenantContext,
} from '@bap/db';
import type { TenantContext } from '@bap/db';
import type { DatabaseConfiguration, DatabaseRole } from '@bap/db/config';
import type { DatabasePool } from '@bap/db/pool';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  blobStorageKey,
  createBlobDirectories,
  FilesystemBlobStore,
} from '../blobs/blob-store.js';
import {
  deleteDocument,
  readDocument,
} from '../documents/document-repository.js';
import { inboxItemListQuerySchema } from './contract.js';
import { InboxService } from './inbox.service.js';
import {
  SNIFF_PROVIDER,
  SNIFF_PROVIDER_VERSION,
  sniffBytes,
  toProviderOutput,
} from './providers/sniff.js';
import {
  assignItem,
  discardItem,
  listItems,
  readBlob,
  readItem,
  readProviderInput,
  receiveUpload,
  recordExtraction,
  restoreItem,
  routeToDocument,
  snoozeItem,
  undoRoute,
  updateHints,
  type InboxRepository,
} from './inbox-repository.js';
import * as fixtures from './providers/__fixtures__/index.js';

const postgresImage =
  'pgvector/pgvector:pg18@sha256:2ba9ca5f2e7daa0f0e7723cba1ee9167bab54efd3640516a44ac1a928dd67e7a';
const testPassword = 'test-only-database-credential';
const QUOTA = 50_000;

let apiPool: DatabasePool;
let container: StartedPostgreSqlContainer;
let migratorPool: DatabasePool;
let directory: string;
let store: FilesystemBlobStore;
let service: InboxService;

const creator: TenantContext = {
  organizationId: 'org-1',
  role: 'owner',
  userId: 'user-1',
};
const reader: TenantContext = {
  organizationId: 'org-1',
  role: 'member',
  userId: 'user-2',
};
const stranger: TenantContext = {
  organizationId: 'org-2',
  role: 'owner',
  userId: 'user-3',
};
const allEntities = { legalEntityIds: null };

let ownedEntityId = '';
let otherEntityId = '';
let firstItemId = '';
let firstBlobId = '';
let documentId = '';

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

async function asTenant<T>(
  tenant: TenantContext,
  operation: (transaction: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await apiPool.connect();

  try {
    return await withTenantContext(client, tenant, operation);
  } finally {
    client.release();
  }
}

async function createLegalEntity(
  tenant: TenantContext,
  name: string,
): Promise<string> {
  return asTenant(tenant, async (transaction) => {
    const created = await transaction.query<{ id: string }>(
      `insert into app.legal_entity (organization_id, name, kind, created_by)
       values ($1, $2, 'company', $3)
       returning id`,
      [tenant.organizationId, name, tenant.userId],
    );
    return created.rows[0]?.id ?? '';
  });
}

async function stage(bytes: Buffer, name: string): Promise<string> {
  const path = join(store.temporaryDirectory(), name);
  await writeFile(path, bytes);
  return path;
}

function upload(tenant: TenantContext, bytes: Buffer, name: string) {
  return stage(bytes, name).then((path) =>
    service.upload({
      ...tenant,
      ...allEntities,
      file: { originalname: name, path, size: bytes.length },
    }),
  );
}

beforeAll(async () => {
  container = await new PostgreSqlContainer(postgresImage)
    .withDatabase('bap')
    .withUsername('postgres')
    .withPassword(testPassword)
    .start();
  const rootPool = createDatabasePool(configurationFor('postgres'));
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
  const migrator = await migratorPool.connect();

  try {
    await migrator.query('begin');
    await migrator.query('set local role bap_owner');
    await migrator.query(`
      insert into auth."user" (id, name, email, email_verified)
      values ('user-1', 'Creator', 'creator@example.test', true),
             ('user-2', 'Grantee', 'grantee@example.test', true),
             ('user-3', 'Stranger', 'stranger@example.test', true)
    `);
    await migrator.query(`
      insert into auth.organization (id, name, slug) values ('org-1', 'One', 'one'), ('org-2', 'Two', 'two')
    `);
    await migrator.query(`
      insert into auth.member (id, organization_id, user_id, role)
      values ('member-1', 'org-1', 'user-1', 'owner'),
             ('member-2', 'org-1', 'user-2', 'member'),
             ('member-3', 'org-2', 'user-3', 'owner')
    `);
    await migrator.query('commit');
  } finally {
    migrator.release();
  }

  await rootPool.end();
  apiPool = createDatabasePool(configurationFor('bap_api'));
  ownedEntityId = await createLegalEntity(creator, 'Placeholder Holding');
  otherEntityId = await createLegalEntity(creator, 'Placeholder Branch');

  directory = await mkdtemp(join(tmpdir(), 'bap-inbox-integration-'));
  await createBlobDirectories(directory);
  store = new FilesystemBlobStore(directory);
  // The service is exercised against the container pool through the same functions the Nest repository wraps.
  const repository: InboxRepository = {
    assignItem: (input) => assignItem(apiPool, input),
    discardItem: (input) => discardItem(apiPool, input),
    listItems: (input) => listItems(apiPool, input),
    readBlob: (input) => readBlob(apiPool, input),
    readItem: (input) => readItem(apiPool, input),
    readProviderInput: (input) => readProviderInput(apiPool, input),
    receiveUpload: (input) => receiveUpload(apiPool, input),
    recordExtraction: (input) => recordExtraction(apiPool, input),
    restoreItem: (input) => restoreItem(apiPool, input),
    routeToDocument: (input) => routeToDocument(apiPool, input),
    snoozeItem: (input) => snoozeItem(apiPool, input),
    undoRoute: (input) => undoRoute(apiPool, input),
    updateHints: (input) => updateHints(apiPool, input),
  };
  service = new InboxService(repository, store, QUOTA);
});

afterAll(async () => {
  await Promise.all([apiPool.end(), migratorPool.end()]);
  await container.stop();
  await rm(directory, { force: true, recursive: true });
});

describe('inbox intake', () => {
  it('receives a new upload as a needs_review item with its blob stored', async () => {
    const response = await upload(creator, fixtures.pdf(), 'placeholder.pdf');

    firstItemId = response.item.id;
    firstBlobId = response.files[0]?.blobId ?? '';
    expect(response.duplicateOfItemId).toBeNull();
    expect(response.item).toMatchObject({
      channelKind: 'upload',
      confidence: 1,
      detectedType: 'pdf',
      legalEntityId: null,
      payloadKind: 'file',
      status: 'needs_review',
    });
    expect(response.files).toHaveLength(1);
    expect(response.files[0]).toMatchObject({
      mediaType: 'application/pdf',
      originalFilename: 'placeholder.pdf',
      position: 1,
    });
    expect(await readdir(store.temporaryDirectory())).toEqual([]);
    expect(
      await readdir(join(directory, 'org', creator.organizationId)),
    ).toEqual([response.files[0]?.sha256]);

    const detail = await readItem(apiPool, {
      ...creator,
      ...allEntities,
      itemId: firstItemId,
    });
    expect(detail?.events.map((event) => event.kind)).toEqual([
      'received',
      'classified',
    ]);
    expect(detail?.extraction).toMatchObject({
      detectedType: 'pdf',
      issues: [],
      provider: 'sniff',
    });
  });

  it('discards an exact duplicate pointing at the earlier item, storing nothing new', async () => {
    const response = await upload(creator, fixtures.pdf(), 'again.pdf');

    expect(response.duplicateOfItemId).toBe(firstItemId);
    expect(response.item.status).toBe('discarded');
    expect(response.files[0]?.blobId).toBe(firstBlobId);
    expect(
      await readdir(join(directory, 'org', creator.organizationId)),
    ).toHaveLength(1);

    const detail = await readItem(apiPool, {
      ...creator,
      ...allEntities,
      itemId: response.item.id,
    });
    expect(detail?.extraction?.issues.map((issue) => issue.code)).toEqual([
      'duplicate_exact',
    ]);
    expect(detail?.events.map((event) => [event.kind, event.reason])).toEqual([
      ['received', null],
      ['classified', null],
      ['discarded', 'duplicate'],
    ]);

    // The same bytes in another organization are another blob.
    const foreign = await upload(stranger, fixtures.pdf(), 'theirs.pdf');
    expect(foreign.duplicateOfItemId).toBeNull();
    expect(foreign.files[0]?.blobId).not.toBe(firstBlobId);
  });

  it('refuses an upload over the quota and stores nothing', async () => {
    const before = await readdir(
      join(directory, 'org', creator.organizationId),
    );

    await expect(
      upload(creator, fixtures.padded(fixtures.PDF_MAGIC, QUOTA), 'huge.pdf'),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);

    expect(await readdir(store.temporaryDirectory())).toEqual([]);
    expect(
      await readdir(join(directory, 'org', creator.organizationId)),
    ).toEqual(before);
    const blobs = await asTenant(creator, (transaction) =>
      transaction.query('select 1 from app.blob'),
    );
    expect(blobs.rowCount).toBe(1);
  });

  it('refuses an upload from a restricted scope with 403 before any row or byte is written', async () => {
    const bytes = fixtures.text();
    const path = await stage(bytes, 'restricted.txt');

    await expect(
      service.upload({
        ...creator,
        file: { originalname: 'restricted.txt', path, size: bytes.length },
        legalEntityIds: [ownedEntityId],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(await readdir(store.temporaryDirectory())).toEqual([]);
    const blobs = await asTenant(creator, (transaction) =>
      transaction.query('select 1 from app.blob'),
    );
    expect(blobs.rowCount).toBe(1);
  });

  it('leaves no stored file when the intake fails after its rows are inserted', async () => {
    const bytes = fixtures.text();
    const path = await stage(bytes, 'orphan.txt');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const storageKey = blobStorageKey(creator.organizationId, sha256);
    const sniffed = sniffBytes(fixtures.toSniffInput(bytes));

    // The repository is called directly with a scope that cannot read the new item back, so it throws last.
    await expect(
      receiveUpload(apiPool, {
        ...creator,
        byteSize: bytes.length,
        legalEntityIds: [ownedEntityId],
        mediaType: sniffed.mediaType,
        originalFilename: 'orphan.txt',
        persist: () => store.put({ key: storageKey, temporaryPath: path }),
        quotaBytes: QUOTA,
        sha256,
        sniff: {
          output: toProviderOutput(sniffed),
          provider: SNIFF_PROVIDER,
          providerVersion: SNIFF_PROVIDER_VERSION,
        },
        storageKey,
      }),
    ).rejects.toThrow('not readable in its own scope');

    expect(await store.stat(storageKey)).toBeNull();
    expect((await stat(path)).isFile()).toBe(true);
    const blob = await asTenant(creator, (transaction) =>
      transaction.query('select 1 from app.blob where sha256 = $1', [sha256]),
    );
    expect(blob.rowCount).toBe(0);
    await store.deleteTemporary(path);
  });

  it('lists unrouted items for the unrestricted scope only', async () => {
    const unrestricted = await listItems(apiPool, {
      ...creator,
      ...allEntities,
      query: inboxItemListQuerySchema.parse({ status: 'needs_review' }),
    });
    expect(unrestricted.items.map((entry) => entry.id)).toEqual([firstItemId]);
    expect(unrestricted.items[0]).toMatchObject({
      fileCount: 1,
      primaryFilename: 'placeholder.pdf',
    });

    const restricted = await listItems(apiPool, {
      ...reader,
      legalEntityIds: [ownedEntityId],
      query: inboxItemListQuerySchema.parse({}),
    });
    expect(restricted.total).toBe(0);
    expect(
      await readItem(apiPool, {
        ...reader,
        legalEntityIds: [ownedEntityId],
        itemId: firstItemId,
      }),
    ).toBeNull();

    // Another organization never sees the item at all.
    expect(
      await readItem(apiPool, {
        ...stranger,
        ...allEntities,
        itemId: firstItemId,
      }),
    ).toBeNull();
  });

  it('refuses every inbox write to a member', async () => {
    await expect(
      updateHints(apiPool, {
        ...reader,
        ...allEntities,
        body: { hintText: 'note' },
        itemId: firstItemId,
      }),
    ).resolves.toBeNull();
  });

  it('records hints and lets them outrank the sniff on process', async () => {
    const hinted = await updateHints(apiPool, {
      ...creator,
      ...allEntities,
      body: { hintKind: 'payroll_sheet', hintLegalEntityId: ownedEntityId },
      itemId: firstItemId,
    });
    expect(hinted?.item).toMatchObject({
      hintKind: 'payroll_sheet',
      hintLegalEntityId: ownedEntityId,
    });

    const processed = await service.process({
      ...creator,
      ...allEntities,
      itemId: firstItemId,
    });
    expect(processed?.item).toMatchObject({
      confidence: 1,
      detectedType: 'payroll_sheet',
      status: 'needs_review',
    });
    expect(processed?.extraction).toMatchObject({
      detectedType: 'payroll_sheet',
      legalEntityId: ownedEntityId,
    });
    expect(processed?.extraction?.reasons.map((reason) => reason.step)).toEqual(
      ['sniff', 'hint', 'hint'],
    );
  });

  it('routes the item to a document inside one transaction', async () => {
    const routed = await service.routeToDocument({
      ...creator,
      ...allEntities,
      body: {
        document: {
          currencyCode: 'CZK',
          documentDate: '2026-09-14',
          kind: 'contract',
          legalEntityId: ownedEntityId,
          title: 'Placeholder contract',
        },
        fileBlobIds: [firstBlobId],
      },
      itemId: firstItemId,
    });

    documentId = routed?.item.documentId ?? '';
    expect(routed?.item).toMatchObject({
      decidedByKind: 'user',
      decidedByUserId: creator.userId,
      legalEntityId: ownedEntityId,
      status: 'routed',
    });
    expect(routed?.item.routedAt).not.toBeNull();
    expect(routed?.extraction?.provider).toBe('manual');
    expect(routed?.events.at(-1)?.kind).toBe('routed');

    const document = await readDocument(apiPool, {
      ...creator,
      ...allEntities,
      documentId,
    });
    expect(document?.document.source).toBe('upload');

    const files = await asTenant(creator, (transaction) =>
      transaction.query<{ blob_id: string; inbox_item_id: string }>(
        `select f.blob_id, d.inbox_item_id
           from app.document_file as f
           join app.document as d on d.id = f.document_id
          where f.document_id = $1`,
        [documentId],
      ),
    );
    expect(files.rows).toEqual([
      { blob_id: firstBlobId, inbox_item_id: firstItemId },
    ]);

    // A routed item can be neither routed again nor discarded.
    await expect(
      discardItem(apiPool, {
        ...creator,
        ...allEntities,
        itemId: firstItemId,
        reason: 'irrelevant',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    // A restricted member of the entity now sees the routed item.
    const restricted = await listItems(apiPool, {
      ...reader,
      legalEntityIds: [ownedEntityId],
      query: inboxItemListQuerySchema.parse({}),
    });
    expect(restricted.items.map((entry) => entry.id)).toEqual([firstItemId]);
  });

  it('undoes the route: the document is gone and the item is back in review', async () => {
    const undone = await undoRoute(apiPool, {
      ...creator,
      ...allEntities,
      itemId: firstItemId,
    });

    // The entity a person bound stays; only the decision is reset.
    expect(undone?.item).toMatchObject({
      decidedByKind: null,
      decidedByUserId: null,
      documentId: null,
      legalEntityId: ownedEntityId,
      routedAt: null,
      status: 'needs_review',
    });
    expect(undone?.events.at(-1)?.kind).toBe('unrouted');
    expect(
      await readDocument(apiPool, { ...creator, ...allEntities, documentId }),
    ).toBeNull();

    await expect(
      undoRoute(apiPool, { ...creator, ...allEntities, itemId: firstItemId }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('un-routes the item when the document is deleted from the documents side', async () => {
    const routed = await service.routeToDocument({
      ...creator,
      ...allEntities,
      body: {
        document: {
          currencyCode: 'CZK',
          documentDate: '2026-09-15',
          kind: 'agreement',
          legalEntityId: ownedEntityId,
          title: 'Placeholder agreement',
        },
        fileBlobIds: [firstBlobId],
      },
      itemId: firstItemId,
    });
    const routedDocumentId = routed?.item.documentId ?? '';

    // The plain delete refuses while the item points at the document.
    await expect(
      asTenant(creator, (transaction) =>
        transaction.query('delete from app.document where id = $1', [
          routedDocumentId,
        ]),
      ),
    ).rejects.toMatchObject({ code: '23001' });

    expect(
      await deleteDocument(apiPool, {
        ...creator,
        ...allEntities,
        documentId: routedDocumentId,
      }),
    ).toBe(true);

    const detail = await readItem(apiPool, {
      ...creator,
      ...allEntities,
      itemId: firstItemId,
    });
    expect(detail?.item).toMatchObject({
      documentId: null,
      legalEntityId: ownedEntityId,
      status: 'needs_review',
    });
    expect(detail?.events.at(-1)?.kind).toBe('unrouted');
  });

  it('assigns and snoozes an open item only', async () => {
    const assigned = await assignItem(apiPool, {
      ...creator,
      ...allEntities,
      assigneeId: reader.userId,
      itemId: firstItemId,
    });
    expect(assigned?.item.assigneeId).toBe(reader.userId);
    expect(assigned?.events.at(-1)?.kind).toBe('assigned');

    const snoozed = await snoozeItem(apiPool, {
      ...creator,
      ...allEntities,
      itemId: firstItemId,
      snoozedUntil: '2026-10-01T08:00:00.000Z',
    });
    expect(snoozed?.item.snoozedUntil).toBe('2026-10-01T08:00:00.000Z');

    const routed = await service.routeToDocument({
      ...creator,
      ...allEntities,
      body: {
        document: {
          currencyCode: 'CZK',
          documentDate: '2026-09-15',
          kind: 'agreement',
          legalEntityId: ownedEntityId,
          title: 'Placeholder agreement',
        },
        fileBlobIds: [firstBlobId],
      },
      itemId: firstItemId,
    });
    expect(routed?.item.status).toBe('routed');

    await expect(
      assignItem(apiPool, {
        ...creator,
        ...allEntities,
        assigneeId: null,
        itemId: firstItemId,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      snoozeItem(apiPool, {
        ...creator,
        ...allEntities,
        itemId: firstItemId,
        snoozedUntil: null,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    await undoRoute(apiPool, {
      ...creator,
      ...allEntities,
      itemId: firstItemId,
    });
  });

  it('discards with a reason and restores back to review', async () => {
    const discarded = await discardItem(apiPool, {
      ...creator,
      ...allEntities,
      itemId: firstItemId,
      reason: 'not_ours',
    });
    expect(discarded?.item.status).toBe('discarded');
    expect(discarded?.events.at(-1)).toMatchObject({
      kind: 'discarded',
      reason: 'not_ours',
    });
    await expect(
      assignItem(apiPool, {
        ...creator,
        ...allEntities,
        assigneeId: null,
        itemId: firstItemId,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      snoozeItem(apiPool, {
        ...creator,
        ...allEntities,
        itemId: firstItemId,
        snoozedUntil: null,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      restoreItem(apiPool, {
        ...stranger,
        ...allEntities,
        itemId: firstItemId,
      }),
    ).resolves.toBeNull();

    const restored = await restoreItem(apiPool, {
      ...creator,
      ...allEntities,
      itemId: firstItemId,
    });
    expect(restored?.item.status).toBe('needs_review');
    expect(restored?.events.at(-1)?.kind).toBe('restored');

    await expect(
      restoreItem(apiPool, { ...creator, ...allEntities, itemId: firstItemId }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('serves a blob only inside the scope that sees an item carrying it', async () => {
    const opened = await service.openBlob({
      ...creator,
      ...allEntities,
      blobId: firstBlobId,
      inline: true,
    });
    expect(opened.blob.mediaType).toBe('application/pdf');
    opened.stream.destroy();

    // The item keeps its bound entity after undo, so a member of another entity is the one outside the scope.
    await expect(
      service.openBlob({
        ...reader,
        blobId: firstBlobId,
        inline: false,
        legalEntityIds: [otherEntityId],
      }),
    ).rejects.toThrow();
    await expect(
      service.openBlob({
        ...stranger,
        ...allEntities,
        blobId: firstBlobId,
        inline: false,
      }),
    ).rejects.toThrow();
  });
});
