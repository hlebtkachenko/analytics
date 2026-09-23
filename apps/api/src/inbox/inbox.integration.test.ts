import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
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
import { BadRequestException } from '@nestjs/common';
import {
  createDocumentRequestSchema,
  documentListQuerySchema,
} from '../documents/contract.js';
import type { CreateDocumentRequest } from '../documents/contract.js';
import {
  deleteDocument,
  listDocuments,
  readDocument,
} from '../documents/document-repository.js';
import { createPartner } from '../documents/partner-repository.js';
import { endPools } from '../test-support/end-pools.js';
import { DETECTED_TYPES, inboxItemListQuerySchema } from './contract.js';
import type {
  PutInboxRoutingTargetRequest,
  RouteInboxItemJob,
  ScanInboxItemJob,
} from './contract.js';
import { InboxService } from './inbox.service.js';
import {
  SNIFF_PROVIDER,
  SNIFF_PROVIDER_VERSION,
  sniffBytes,
  toProviderOutput,
} from './providers/sniff.js';
import {
  createChannel,
  issueCredential,
  listChannels,
  readChannel,
  readChannelPrincipal,
  revokeCredential,
  updateChannel,
} from './inbox-channel-repository.js';
import {
  approveItem,
  attachItem,
  assignItem,
  discardItem,
  findDuplicateCandidates,
  listItems,
  readBlob,
  readItem,
  readProviderInput,
  receiveIntake,
  recordExtraction,
  reopenEmailItem,
  restoreItem,
  routeToDocument,
  snoozeItem,
  undoRoute,
  updateHints,
  type InboxRepository,
} from './inbox-repository.js';
import {
  adoptRule,
  createRule,
  deleteRule,
  listRules,
  orderRules,
  readRule,
  updateRule,
} from './inbox-rule-repository.js';
import {
  deleteRoutingTarget,
  listRoutingTargets,
  putRoutingTarget,
  readInboxSettings,
  updateInboxSettings,
} from './inbox-settings-repository.js';
import * as fixtures from './providers/__fixtures__/index.js';
import { routingTargetFor } from './routing-targets.js';

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
const routeJobs: RouteInboxItemJob[] = [];
const scanJobs: ScanInboxItemJob[] = [];

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

// Pools for one role.
function poolFor(role: DatabaseRole): DatabasePool {
  return createDatabasePool(configurationFor(role));
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
  const rootPool = poolFor('postgres');
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

  migratorPool = poolFor('bap_migrator');
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
  apiPool = poolFor('bap_api');
  ownedEntityId = await createLegalEntity(creator, 'Placeholder Holding');
  otherEntityId = await createLegalEntity(creator, 'Placeholder Branch');

  directory = await mkdtemp(join(tmpdir(), 'bap-inbox-integration-'));
  await createBlobDirectories(directory);
  store = new FilesystemBlobStore(directory);
  // The service is exercised against the container pool through the same functions the Nest repository wraps.
  const repository: InboxRepository = {
    adoptRule: (input) => adoptRule(apiPool, input),
    approveItem: (input) => approveItem(apiPool, input),
    attachItem: (input) => attachItem(apiPool, input),
    assignItem: (input) => assignItem(apiPool, input),
    createRule: (input) => createRule(apiPool, input),
    deleteRule: (input) => deleteRule(apiPool, input),
    listRules: (input) => listRules(apiPool, input),
    orderRules: (input) => orderRules(apiPool, input),
    readRule: (input) => readRule(apiPool, input),
    updateRule: (input) => updateRule(apiPool, input),
    createChannel: (input) => createChannel(apiPool, input),
    deleteRoutingTarget: (input) => deleteRoutingTarget(apiPool, input),
    discardItem: (input) => discardItem(apiPool, input),
    issueCredential: (input) => issueCredential(apiPool, input),
    listChannels: (input) => listChannels(apiPool, input),
    listItems: (input) => listItems(apiPool, input),
    listRoutingTargets: (input) => listRoutingTargets(apiPool, input),
    putRoutingTarget: (input) => putRoutingTarget(apiPool, input),
    readBlob: (input) => readBlob(apiPool, input),
    readChannel: (input) => readChannel(apiPool, input),
    readChannelPrincipal: (input) => readChannelPrincipal(apiPool, input),
    readInboxSettings: (input) => readInboxSettings(apiPool, input),
    readItem: (input) => readItem(apiPool, input),
    readProviderInput: (input) => readProviderInput(apiPool, input),
    receiveIntake: (input) => receiveIntake(apiPool, input),
    recordExtraction: (input) => recordExtraction(apiPool, input),
    reopenEmailItem: (input) => reopenEmailItem(apiPool, input),
    restoreItem: (input) => restoreItem(apiPool, input),
    revokeCredential: (input) => revokeCredential(apiPool, input),
    routeToDocument: (input) => routeToDocument(apiPool, input),
    snoozeItem: (input) => snoozeItem(apiPool, input),
    undoRoute: (input) => undoRoute(apiPool, input),
    updateChannel: (input) => updateChannel(apiPool, input),
    updateHints: (input) => updateHints(apiPool, input),
    updateInboxSettings: (input) => updateInboxSettings(apiPool, input),
  };
  service = new InboxService(repository, store, QUOTA, 'intake.invalid', {
    enqueueRerunInboxRule: async () => undefined,
    enqueueRouteInboxItem: async (job) => {
      routeJobs.push(job);
    },
    enqueueScanInboxItem: async (job) => {
      scanJobs.push(job);
    },
    enqueueSplitEmailItem: async () => undefined,
  });
});

afterAll(async () => {
  await endPools(apiPool, migratorPool);
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
      receiveIntake(apiPool, {
        ...creator,
        byteSize: bytes.length,
        channelId: null,
        channelKind: 'upload',
        externalId: null,
        legalEntityIds: [ownedEntityId],
        mediaType: sniffed.mediaType,
        origin: null,
        originalFilename: 'orphan.txt',
        parentItemId: null,
        payloadKind: 'file',
        persist: () => store.put({ key: storageKey, temporaryPath: path }),
        quotaBytes: QUOTA,
        sender: null,
        senderAuthenticated: false,
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
      senderAuthenticated: false,
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
    expect(discarded?.item).toMatchObject({
      decidedByKind: 'user',
      decidedByUserId: creator.userId,
      status: 'discarded',
    });
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
    expect(restored?.item).toMatchObject({
      decidedByKind: null,
      decidedByUserId: null,
      status: 'needs_review',
    });
    expect(restored?.events.at(-1)?.kind).toBe('restored');

    await expect(
      restoreItem(apiPool, { ...creator, ...allEntities, itemId: firstItemId }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('serves a blob only inside the scope that sees an item carrying it', async () => {
    // Only a clean verdict is served, so the scan job's verdict is recorded first, as the job records it.
    await asTenant(creator, (transaction) =>
      transaction.query('select app.record_blob_scan($1, $2)', [
        firstBlobId,
        'clean',
      ]),
    );

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

describe('routing targets', () => {
  const target: PutInboxRoutingTargetRequest = {
    auto: 'above_threshold',
    autoThreshold: 0.85,
    defaultAssigneeId: 'user-2',
    defaultLegalEntityId: null,
    destination: 'documents',
    documentKind: 'contract',
    partnerPolicy: 'match_only',
    requiredFields: ['documentDate', 'title'],
  };

  it('merges one organization row over the platform constant and shows it on the item', async () => {
    const before = await listRoutingTargets(apiPool, creator);
    expect(before.map((entry) => entry.detectedType)).toEqual([
      ...DETECTED_TYPES,
    ]);
    expect(before.every((entry) => entry.source === 'platform')).toBe(true);

    const saved = await putRoutingTarget(apiPool, {
      ...creator,
      body: { ...target, defaultLegalEntityId: ownedEntityId },
      detectedType: 'pdf',
    });
    expect(saved).toEqual({
      ...target,
      defaultLegalEntityId: ownedEntityId,
      detectedType: 'pdf',
      source: 'organization',
    });

    const after = await listRoutingTargets(apiPool, creator);
    expect(after.find((entry) => entry.detectedType === 'pdf')).toEqual(saved);
    expect(
      after.filter((entry) => entry.source === 'organization'),
    ).toHaveLength(1);
    expect(after.find((entry) => entry.detectedType === 'text')).toEqual(
      routingTargetFor('text'),
    );

    // The first item was routed as an agreement, a kind outside the list that resolves to unknown; an unknown row shows on it.
    const unknownTarget = await putRoutingTarget(apiPool, {
      ...creator,
      body: { ...target, destination: 'discard', documentKind: null },
      detectedType: 'unknown',
    });
    const detail = await readItem(apiPool, {
      ...creator,
      ...allEntities,
      itemId: firstItemId,
    });
    expect(detail?.item.detectedType).toBe('agreement');
    expect(detail?.routingTarget).toEqual(unknownTarget);
    expect(detail?.routingTarget).toMatchObject({
      destination: 'discard',
      detectedType: 'unknown',
      source: 'organization',
    });
    await expect(
      deleteRoutingTarget(apiPool, { ...creator, detectedType: 'unknown' }),
    ).resolves.toBe(true);
    expect(
      (await listRoutingTargets(apiPool, stranger)).every(
        (entry) => entry.source === 'platform',
      ),
    ).toBe(true);

    // A second PUT replaces the whole row and refreshes who saved it.
    const replaced = await putRoutingTarget(apiPool, {
      ...creator,
      body: {
        ...target,
        auto: 'never',
        autoThreshold: null,
        requiredFields: [],
      },
      detectedType: 'pdf',
    });
    expect(replaced).toMatchObject({ auto: 'never', requiredFields: [] });
    const row = await asTenant(creator, (transaction) =>
      transaction.query<{ count: number; updated_by: string }>(
        'select count(*)::int as count, min(updated_by) as updated_by from app.inbox_routing_target',
      ),
    );
    expect(row.rows[0]).toEqual({ count: 1, updated_by: creator.userId });
  });

  it('refuses a foreign legal entity and a member, and deletes back to the platform default', async () => {
    const foreignEntityId = await createLegalEntity(stranger, 'Theirs');
    await expect(
      putRoutingTarget(apiPool, {
        ...creator,
        body: { ...target, defaultLegalEntityId: foreignEntityId },
        detectedType: 'text',
      }),
    ).resolves.toBeNull();
    await expect(
      putRoutingTarget(apiPool, {
        ...reader,
        body: target,
        detectedType: 'text',
      }),
    ).resolves.toBeNull();
    await expect(
      deleteRoutingTarget(apiPool, { ...reader, detectedType: 'pdf' }),
    ).resolves.toBe(false);

    await expect(
      deleteRoutingTarget(apiPool, { ...creator, detectedType: 'pdf' }),
    ).resolves.toBe(true);
    await expect(
      deleteRoutingTarget(apiPool, { ...creator, detectedType: 'pdf' }),
    ).resolves.toBe(false);
    expect(
      (await listRoutingTargets(apiPool, creator)).find(
        (entry) => entry.detectedType === 'pdf',
      ),
    ).toEqual(routingTargetFor('pdf'));
  });
});

describe('inbox settings', () => {
  it('reads the platform value until an owner tightens it', async () => {
    const settings = await service.readSettings(creator);
    expect(settings).toMatchObject({
      blobQuotaBytes: null,
      platformQuotaBytes: QUOTA,
    });
    expect(settings.usedBytes).toBeGreaterThan(0);
    expect(settings.usedBytes).toBeLessThan(QUOTA);

    // A member never writes the row; the definer-free policy refuses it and the caller sees null.
    await expect(
      service.updateSettings({ ...reader, body: { blobQuotaBytes: 1 } }),
    ).resolves.toBeNull();
    await expect(
      service.updateSettings({
        ...creator,
        body: { blobQuotaBytes: QUOTA + 1 },
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('refuses an upload past the tightened quota while the platform cap alone admits it', async () => {
    const used = (await service.readSettings(creator)).usedBytes;
    const bytes = fixtures.padded(fixtures.PDF_MAGIC, 2_000);
    expect(used + bytes.length).toBeLessThan(QUOTA);

    const tightened = await service.updateSettings({
      ...creator,
      body: { blobQuotaBytes: used + bytes.length - 1 },
    });
    expect(tightened?.blobQuotaBytes).toBe(used + bytes.length - 1);
    await expect(
      upload(creator, bytes, 'tightened.pdf'),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(await readdir(store.temporaryDirectory())).toEqual([]);

    // Reset to the platform value and the same bytes are admitted.
    const reset = await service.updateSettings({
      ...creator,
      body: { blobQuotaBytes: null },
    });
    expect(reset?.blobQuotaBytes).toBeNull();
    const admitted = await upload(creator, bytes, 'admitted.pdf');
    expect(admitted.item.status).toBe('needs_review');
    expect((await service.readSettings(creator)).usedBytes).toBe(
      used + bytes.length,
    );
  });
});

describe('inbox actions', () => {
  let partnerId = '';
  let alphaItemId = '';
  let alphaBlobId = '';
  let betaItemId = '';
  let firstVersionId = '';
  let secondVersionId = '';

  // Parsed at the boundary the way the controller does, so the line defaults are filled in.
  const invoiceBody = (
    reference: string,
    overrides: Record<string, unknown> = {},
  ): CreateDocumentRequest =>
    createDocumentRequestSchema.parse({
      currencyCode: 'CZK',
      documentDate: '2026-09-10',
      invoice: {
        lines: [
          {
            baseAmount: '1000.0000',
            category: 'services',
            description: 'placeholder service line',
            vatAmount: '210.0000',
            vatMode: 'standard',
            vatRate: '21.00',
          },
        ],
      },
      kind: 'received_invoice',
      legalEntityId: ownedEntityId,
      partnerId,
      reference,
      title: 'Placeholder supplier invoice',
      ...overrides,
    });

  async function route(
    itemId: string,
    document: CreateDocumentRequest,
    extra: {
      acknowledgeDuplicateOf?: string;
      supersedesDocumentId?: string;
    } = {},
  ) {
    const files = await readItem(apiPool, {
      ...creator,
      ...allEntities,
      itemId,
    });
    return service.routeToDocument({
      ...creator,
      ...allEntities,
      body: {
        ...extra,
        document,
        fileBlobIds: (files?.files ?? []).map((file) => file.blobId),
      },
      itemId,
    });
  }

  async function conflictOf(pending: Promise<unknown>): Promise<unknown> {
    try {
      await pending;
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      return (error as ConflictException).getResponse();
    }
    throw new Error('expected a conflict');
  }

  beforeAll(async () => {
    const partner = await createPartner(apiPool, {
      defaultLineCategory: null,
      ...creator,
      ...allEntities,
      countryCode: 'CZ',
      legalEntityId: null,
      name: 'Placeholder Supplier',
      registrationNumber: 'CD-654321',
      vatNumber: 'CZ87654321',
    });
    partnerId = partner?.id ?? '';
    const alpha = await upload(
      creator,
      Buffer.from('alpha invoice bytes'),
      'alpha.txt',
    );
    alphaItemId = alpha.item.id;
    alphaBlobId = alpha.files[0]?.blobId ?? '';
    betaItemId = (
      await upload(creator, Buffer.from('beta invoice bytes'), 'beta.txt')
    ).item.id;
  });

  it('refuses a taken reference with the current document, records the issue, then versions on request', async () => {
    const first = await route(alphaItemId, invoiceBody('SUP-2026-1'));
    firstVersionId = first?.item.documentId ?? '';
    expect(firstVersionId).not.toBe('');

    const conflict = await conflictOf(
      route(betaItemId, invoiceBody('SUP-2026-1')),
    );
    expect(conflict).toEqual({
      code: 'reference_conflict',
      documentId: firstVersionId,
    });

    // The refusal row is committed on its own: the item stays in review and its newest extraction names the issue.
    const refused = await readItem(apiPool, {
      ...creator,
      ...allEntities,
      itemId: betaItemId,
    });
    expect(refused?.item.status).toBe('needs_review');
    expect(refused?.extraction?.issues).toEqual([
      expect.objectContaining({
        code: 'reference_conflict',
        message: expect.stringContaining(firstVersionId),
      }),
    ]);

    await expect(
      route(betaItemId, invoiceBody('SUP-2026-1'), {
        supersedesDocumentId: betaItemId,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const second = await route(betaItemId, invoiceBody('SUP-2026-1'), {
      supersedesDocumentId: firstVersionId,
    });
    secondVersionId = second?.item.documentId ?? '';
    expect(second?.item.status).toBe('routed');

    const newer = await readDocument(apiPool, {
      ...creator,
      ...allEntities,
      documentId: secondVersionId,
    });
    expect(newer?.document).toMatchObject({
      hasEvent: true,
      isCurrent: true,
      version: 2,
    });
    expect(newer?.supersedesDocumentId).toBe(firstVersionId);
    expect(newer?.supersededByDocumentId).toBeNull();
    expect(newer?.inboxItems.map((entry) => entry.id)).toEqual([betaItemId]);

    const older = await readDocument(apiPool, {
      ...creator,
      ...allEntities,
      documentId: firstVersionId,
    });
    expect(older?.document).toMatchObject({
      hasEvent: false,
      isCurrent: false,
      version: 1,
    });
    expect(older?.event).toBeNull();
    expect(older?.supersededByDocumentId).toBe(secondVersionId);
    expect(older?.files.map((file) => file.blobId)).toEqual([alphaBlobId]);

    // The list hides the superseded row by default and shows it on request.
    const current = await listDocuments(apiPool, {
      ...creator,
      ...allEntities,
      query: documentListQuerySchema.parse({ partnerId }),
    });
    expect(current.documents.map((entry) => entry.id)).toEqual([
      secondVersionId,
    ]);
    const all = await listDocuments(apiPool, {
      ...creator,
      ...allEntities,
      query: documentListQuerySchema.parse({ current: 'all', partnerId }),
    });
    expect(all.documents.map((entry) => entry.id).sort()).toEqual(
      [firstVersionId, secondVersionId].sort(),
    );

    const audit = await asTenant(creator, (transaction) =>
      transaction.query<{ metadata: { supersedesDocumentId: string | null } }>(
        `select metadata from app.audit_log
          where action = 'inbox_item.routed' and resource_id = $1
          order by created_at desc limit 1`,
        [betaItemId],
      ),
    );
    expect(audit.rows[0]?.metadata.supersedesDocumentId).toBe(firstVersionId);
  });

  it('refuses undo and delete on a superseded row, and undo of the version restores it', async () => {
    await expect(
      undoRoute(apiPool, { ...creator, ...allEntities, itemId: alphaItemId }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      deleteDocument(apiPool, {
        ...creator,
        ...allEntities,
        documentId: firstVersionId,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const undone = await undoRoute(apiPool, {
      ...creator,
      ...allEntities,
      itemId: betaItemId,
    });
    expect(undone?.item.status).toBe('needs_review');
    expect(
      await readDocument(apiPool, {
        ...creator,
        ...allEntities,
        documentId: secondVersionId,
      }),
    ).toBeNull();

    const restored = await readDocument(apiPool, {
      ...creator,
      ...allEntities,
      documentId: firstVersionId,
    });
    expect(restored?.document).toMatchObject({
      hasEvent: true,
      isCurrent: true,
      version: 1,
    });
    expect(restored?.supersededByDocumentId).toBeNull();
    expect(restored?.event?.lines.length).toBeGreaterThan(0);
  });

  it('rolls back a version route when the new document cannot be created', async () => {
    const gamma = await upload(
      creator,
      Buffer.from('gamma invoice bytes'),
      'gamma.txt',
    );
    // A distinct total so the duplicate-by-amount check never matches another test's fixture.
    const original = await route(
      gamma.item.id,
      invoiceBody('SUP-2026-99', {
        invoice: {
          lines: [
            {
              baseAmount: '7000.0000',
              category: 'services',
              description: 'placeholder service line',
              vatAmount: '1470.0000',
              vatMode: 'standard',
              vatRate: '21.00',
            },
          ],
        },
      }),
    );
    const originalDocumentId = original?.item.documentId ?? '';
    expect(originalDocumentId).not.toBe('');

    // A partner that exists but belongs to another organization, invisible to this tenant context.
    const foreignPartner = await createPartner(apiPool, {
      defaultLineCategory: null,
      ...stranger,
      ...allEntities,
      countryCode: 'CZ',
      legalEntityId: null,
      name: 'Foreign Supplier',
      registrationNumber: 'CD-000000',
      vatNumber: 'CZ00000000',
    });

    const delta = await upload(
      creator,
      Buffer.from('delta invoice bytes'),
      'delta.txt',
    );

    await expect(
      route(
        delta.item.id,
        invoiceBody('SUP-2026-99', { partnerId: foreignPartner?.id ?? '' }),
        { supersedesDocumentId: originalDocumentId },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    // The old document was flipped to superseded before the failed create; the rollback must undo that too.
    const stillCurrent = await readDocument(apiPool, {
      ...creator,
      ...allEntities,
      documentId: originalDocumentId,
    });
    expect(stillCurrent?.document).toMatchObject({
      hasEvent: true,
      isCurrent: true,
      version: 1,
    });
    expect(stillCurrent?.supersededByDocumentId).toBeNull();
    expect(stillCurrent?.event?.lines.length).toBeGreaterThan(0);
  });

  it('flags a probable duplicate by partner and lets an acknowledged route proceed', async () => {
    // Same partner and total within three days, another reference and kind: a hit by the second rule.
    const nearby = invoiceBody('SUP-2026-2', {
      documentDate: '2026-09-12',
      kind: 'issued_invoice',
    });
    const duplicate = await conflictOf(route(betaItemId, nearby));
    expect(duplicate).toEqual({
      candidates: [
        {
          documentDate: '2026-09-10',
          id: firstVersionId,
          reference: 'SUP-2026-1',
          totalAmount: '1210.0000',
        },
      ],
      code: 'duplicate_probable',
    });
    const refused = await readItem(apiPool, {
      ...creator,
      ...allEntities,
      itemId: betaItemId,
    });
    expect(refused?.extraction?.issues).toEqual([
      expect.objectContaining({ code: 'duplicate_probable' }),
    ]);
    // The list filter reads the newest extraction, which is the refusal row just committed.
    const flagged = await listItems(apiPool, {
      ...creator,
      ...allEntities,
      query: inboxItemListQuerySchema.parse({ issue: 'duplicate_probable' }),
    });
    expect(flagged.items.map((entry) => entry.id)).toEqual([betaItemId]);

    // Outside the window, and without a partner, nothing matches.
    await asTenant(creator, async (transaction) => {
      const base = {
        excludeDocumentId: null,
        legalEntityIds: null,
        organizationId: creator.organizationId,
        partnerId,
        reference: null,
        totalAmount: '1210.0000',
      };
      expect(
        await findDuplicateCandidates(transaction, {
          ...base,
          documentDate: '2026-09-14',
        }),
      ).toEqual([]);
      expect(
        await findDuplicateCandidates(transaction, {
          ...base,
          documentDate: '2026-09-13',
        }),
      ).toHaveLength(1);
      // The caller's entities bound the search; the superseded row is excluded by id.
      expect(
        await findDuplicateCandidates(transaction, {
          ...base,
          documentDate: '2026-09-13',
          legalEntityIds: [otherEntityId],
        }),
      ).toEqual([]);
      expect(
        await findDuplicateCandidates(transaction, {
          ...base,
          documentDate: '2026-09-13',
          excludeDocumentId: firstVersionId,
        }),
      ).toEqual([]);
    });
    const noPartner = await route(
      betaItemId,
      createDocumentRequestSchema.parse({
        currencyCode: 'CZK',
        documentDate: '2026-09-12',
        kind: 'other',
        legalEntityId: ownedEntityId,
        reference: 'SUP-2026-2',
        title: 'Placeholder without partner',
        totalAmount: '1210.0000',
      }),
    );
    expect(noPartner?.item.status).toBe('routed');
    await undoRoute(apiPool, {
      ...creator,
      ...allEntities,
      itemId: betaItemId,
    });

    await expect(
      route(betaItemId, nearby, { acknowledgeDuplicateOf: betaItemId }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const acknowledged = await route(betaItemId, nearby, {
      acknowledgeDuplicateOf: firstVersionId,
    });
    expect(acknowledged?.item.status).toBe('routed');
    await undoRoute(apiPool, {
      ...creator,
      ...allEntities,
      itemId: betaItemId,
    });
  });

  it('attaches an item to an existing document and undo removes only its rows', async () => {
    await expect(
      service.attachItem({
        ...creator,
        ...allEntities,
        documentId: alphaItemId,
        itemId: betaItemId,
      }),
    ).resolves.toBeNull();

    const attached = await service.attachItem({
      ...creator,
      ...allEntities,
      documentId: firstVersionId,
      itemId: betaItemId,
    });
    expect(attached?.item).toMatchObject({
      decidedByKind: 'user',
      decidedByUserId: creator.userId,
      documentId: firstVersionId,
      legalEntityId: ownedEntityId,
      status: 'routed',
    });
    expect(attached?.events.at(-1)?.kind).toBe('attached');

    const document = await readDocument(apiPool, {
      ...creator,
      ...allEntities,
      documentId: firstVersionId,
    });
    expect(document?.files.map((file) => file.position)).toEqual([1, 2]);
    expect(document?.inboxItems.map((entry) => entry.id).sort()).toEqual(
      [alphaItemId, betaItemId].sort(),
    );

    // The same blob twice on one document is refused; the second item's rows go on undo, the document stays.
    await expect(
      service.attachItem({
        ...creator,
        ...allEntities,
        documentId: firstVersionId,
        itemId: betaItemId,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const undone = await undoRoute(apiPool, {
      ...creator,
      ...allEntities,
      itemId: betaItemId,
    });
    expect(undone?.item).toMatchObject({
      documentId: null,
      status: 'needs_review',
    });
    expect(undone?.events.at(-1)?.kind).toBe('unrouted');
    const after = await readDocument(apiPool, {
      ...creator,
      ...allEntities,
      documentId: firstVersionId,
    });
    expect(after?.files.map((file) => file.blobId)).toEqual([alphaBlobId]);
    expect(after?.inboxItems.map((entry) => entry.id)).toEqual([alphaItemId]);
  });

  it('runs a bulk action per id and approves from the composed draft', async () => {
    const gamma = (
      await upload(creator, Buffer.from('gamma bytes'), 'gamma.txt')
    ).item.id;
    const assigned = await service.bulk({
      ...creator,
      ...allEntities,
      body: {
        action: 'assign',
        assigneeId: reader.userId,
        itemIds: [betaItemId, alphaItemId, gamma],
      },
    });
    expect(assigned.results).toEqual([
      { itemId: betaItemId, status: 'ok' },
      { code: 'not_open', itemId: alphaItemId, status: 'refused' },
      { itemId: gamma, status: 'ok' },
    ]);

    // Text has no default document kind, so approve cannot fill the draft until a hint names one.
    const approved = await service.bulk({
      ...creator,
      ...allEntities,
      body: { action: 'approve', itemIds: [gamma] },
    });
    expect(approved.results).toEqual([
      { code: 'missing_required_field', itemId: gamma, status: 'refused' },
    ]);
    await updateHints(apiPool, {
      ...creator,
      ...allEntities,
      body: { hintKind: 'other', hintLegalEntityId: ownedEntityId },
      itemId: gamma,
    });
    const routed = await service.bulk({
      ...creator,
      ...allEntities,
      body: { action: 'approve', itemIds: [gamma] },
    });
    expect(routed.results).toEqual([{ itemId: gamma, status: 'ok' }]);
    const detail = await readItem(apiPool, {
      ...creator,
      ...allEntities,
      itemId: gamma,
    });
    expect(detail?.item).toMatchObject({
      decidedByKind: 'user',
      status: 'routed',
    });
    expect(detail?.extraction?.provider).toBe('manual');
  });

  it('deletes a current version directly: the predecessor is restored, its stale issue clears, and an attached item un-routes', async () => {
    const epsilon = await upload(
      creator,
      Buffer.from('epsilon invoice bytes'),
      'epsilon.txt',
    );
    // A distinct total so the duplicate-by-amount check never matches another test's fixture.
    const distinctInvoice = {
      invoice: {
        lines: [
          {
            baseAmount: '5000.0000',
            category: 'services',
            description: 'placeholder service line',
            vatAmount: '1050.0000',
            vatMode: 'standard',
            vatRate: '21.00',
          },
        ],
      },
    };
    const first = await route(
      epsilon.item.id,
      invoiceBody('SUP-2026-77', distinctInvoice),
    );
    const predecessorId = first?.item.documentId ?? '';
    expect(predecessorId).not.toBe('');

    // An unresolved issue on the predecessor, the way a rule run might leave one.
    await asTenant(creator, (transaction) =>
      transaction.query(
        `insert into app.data_issue (organization_id, document_id, code, severity)
         values ($1, $2, 'total_mismatch', 'warning')`,
        [creator.organizationId, predecessorId],
      ),
    );

    const zeta = await upload(
      creator,
      Buffer.from('zeta invoice bytes'),
      'zeta.txt',
    );
    const second = await route(
      zeta.item.id,
      invoiceBody('SUP-2026-77', distinctInvoice),
      { supersedesDocumentId: predecessorId },
    );
    const supersedingId = second?.item.documentId ?? '';
    expect(supersedingId).not.toBe('');

    const clearedIssues = await asTenant(creator, (transaction) =>
      transaction.query(
        `select 1 from app.data_issue where document_id = $1 and resolved_at is null`,
        [predecessorId],
      ),
    );
    expect(clearedIssues.rowCount).toBe(0);

    const eta = await upload(
      creator,
      Buffer.from('eta invoice bytes'),
      'eta.txt',
    );
    await service.attachItem({
      ...creator,
      ...allEntities,
      documentId: supersedingId,
      itemId: eta.item.id,
    });

    const deleted = await deleteDocument(apiPool, {
      ...creator,
      ...allEntities,
      documentId: supersedingId,
    });
    expect(deleted).toBe(true);

    const restored = await readDocument(apiPool, {
      ...creator,
      ...allEntities,
      documentId: predecessorId,
    });
    expect(restored?.document).toMatchObject({
      hasEvent: true,
      isCurrent: true,
      version: 1,
    });
    expect(restored?.supersededByDocumentId).toBeNull();
    expect(restored?.event?.lines.length).toBeGreaterThan(0);

    const creatorItem = await readItem(apiPool, {
      ...creator,
      ...allEntities,
      itemId: zeta.item.id,
    });
    expect(creatorItem?.item).toMatchObject({
      documentId: null,
      status: 'needs_review',
    });

    const attachedItem = await readItem(apiPool, {
      ...creator,
      ...allEntities,
      itemId: eta.item.id,
    });
    expect(attachedItem?.item).toMatchObject({
      documentId: null,
      status: 'needs_review',
    });
  });

  it('filters the list by issue, assignee and confidence band and reports the human touch', async () => {
    const query = (overrides: Record<string, unknown>) =>
      listItems(apiPool, {
        ...creator,
        ...allEntities,
        query: inboxItemListQuerySchema.parse(overrides),
      });

    // The newest extraction of every item is clean by now.
    const byIssue = await query({ issue: 'duplicate_probable' });
    expect(byIssue.items).toEqual([]);
    const byAssignee = await query({ assigneeId: reader.userId });
    expect(byAssignee.items.map((entry) => entry.id)).toContain(betaItemId);
    expect(byAssignee.items.every((entry) => entry.humanTouched)).toBe(true);
    const unassigned = await query({ assigneeId: 'none' });
    expect(unassigned.items.map((entry) => entry.id)).not.toContain(betaItemId);
    const high = await query({ confidence: 'high' });
    expect(high.items.map((entry) => entry.id)).toContain(betaItemId);
    const unknown = await query({ confidence: 'unknown' });
    expect(unknown.items.every((entry) => entry.confidence === null)).toBe(
      true,
    );

    // The event actor decides: a route or attach by a person is a decision, not a touch.
    const untouched = await query({ status: 'routed' });
    expect(
      untouched.items.find((entry) => entry.id === alphaItemId)?.humanTouched,
    ).toBe(false);
  });
});

describe('inbox list counts, sender and deciding rule name', () => {
  let ruleId = '';
  let futureItemId = '';
  let ruleItemId = '';

  // The same scope predicate and count definitions the repository uses, read straight from the table.
  const expectedCounts = (legalEntityIds: readonly string[] | null) =>
    asTenant(creator, async (transaction) => {
      const result = await transaction.query<{
        all_count: number;
        discarded_count: number;
        filed_count: number;
        to_review: number;
      }>(
        `select count(*)::int as all_count,
                count(*) filter (where status = 'routed')::int as filed_count,
                count(*) filter (where status = 'discarded')::int as discarded_count,
                count(*) filter (
                  where status in ('needs_review', 'received', 'failed', 'processing')
                    and (snoozed_until is null or snoozed_until <= now())
                )::int as to_review
           from app.inbox_item
          where ($1::uuid[] is null
                 or (legal_entity_id is not null and legal_entity_id = any($1::uuid[])))`,
        [legalEntityIds === null ? null : [...legalEntityIds]],
      );
      const row = result.rows[0];

      return {
        all: row?.all_count ?? 0,
        discarded: row?.discarded_count ?? 0,
        filed: row?.filed_count ?? 0,
        toReview: row?.to_review ?? 0,
      };
    });

  const list = (
    overrides: Record<string, unknown>,
    scope: { legalEntityIds: readonly string[] | null } = allEntities,
  ) =>
    listItems(apiPool, {
      ...creator,
      ...scope,
      query: inboxItemListQuerySchema.parse(overrides),
    });

  beforeAll(async () => {
    ruleId = await asTenant(creator, async (transaction) => {
      const created = await transaction.query<{ id: string }>(
        `insert into app.inbox_rule
           (organization_id, name, priority, created_by, detected_type, discard_reason)
         select 'org-1', 'Counts rule', coalesce(max(priority), 0) + 1, 'user-1',
                'money_s3_export', 'spam'
           from app.inbox_rule where organization_id = 'org-1'
         returning id`,
      );
      return created.rows[0]?.id ?? '';
    });
    futureItemId = await asTenant(creator, async (transaction) => {
      const created = await transaction.query<{ id: string }>(
        `insert into app.inbox_item
           (organization_id, channel_kind, payload_kind, status, legal_entity_id, sender,
            snoozed_until, created_by)
         values ('org-1', 'upload', 'file', 'needs_review', $1, 'future@snooze.example',
                 now() + interval '30 days', 'user-1')
         returning id`,
        [ownedEntityId],
      );
      return created.rows[0]?.id ?? '';
    });
    ruleItemId = await asTenant(creator, async (transaction) => {
      const created = await transaction.query<{ id: string }>(
        `insert into app.inbox_item
           (organization_id, channel_kind, payload_kind, status, legal_entity_id,
            decided_by_kind, decided_by_rule_id, created_by)
         values ('org-1', 'upload', 'file', 'discarded', $1, 'rule', $2, 'user-1')
         returning id`,
        [otherEntityId, ruleId],
      );
      return created.rows[0]?.id ?? '';
    });
  });

  it('computes the tab counts on the caller scope, excluding future-snoozed from To review', async () => {
    const unrestricted = await list({});
    expect(unrestricted.counts).toEqual(await expectedCounts(null));

    const restricted = await list({}, { legalEntityIds: [ownedEntityId] });
    expect(restricted.counts).toEqual(await expectedCounts([ownedEntityId]));
    // A narrower scope yields fewer items, so the counts follow the scope, not the whole organization.
    expect(restricted.counts.all).toBeLessThan(unrestricted.counts.all);

    // The future-snoozed needs_review item is in All but never in the To review predicate.
    const included = await list({ status: 'needs_review' });
    expect(included.items.map((entry) => entry.id)).toContain(futureItemId);
    const excluded = await list({ snoozed: 'exclude', status: 'needs_review' });
    expect(excluded.items.map((entry) => entry.id)).not.toContain(futureItemId);
  });

  it('carries the sender on a list entry, null when there is none', async () => {
    const review = await list({ status: 'needs_review' });
    expect(
      review.items.find((entry) => entry.id === futureItemId)?.sender,
    ).toBe('future@snooze.example');
    const discarded = await list({ status: 'discarded' });
    expect(
      discarded.items.find((entry) => entry.id === ruleItemId)?.sender,
    ).toBeNull();
  });

  it('resolves the deciding rule name on the list entry and the detail, null otherwise', async () => {
    const discarded = await list({ status: 'discarded' });
    expect(
      discarded.items.find((entry) => entry.id === ruleItemId)
        ?.decidedByRuleName,
    ).toBe('Counts rule');
    const ruleDetail = await readItem(apiPool, {
      ...creator,
      ...allEntities,
      itemId: ruleItemId,
    });
    expect(ruleDetail?.item.decidedByRuleName).toBe('Counts rule');

    const review = await list({ status: 'needs_review' });
    expect(
      review.items.find((entry) => entry.id === futureItemId)
        ?.decidedByRuleName,
    ).toBeNull();
    const futureDetail = await readItem(apiPool, {
      ...creator,
      ...allEntities,
      itemId: futureItemId,
    });
    expect(futureDetail?.item.decidedByRuleName).toBeNull();
  });
});
