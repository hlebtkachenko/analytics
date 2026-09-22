import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BadRequestException } from '@nestjs/common';
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
import type { PgBoss } from 'pg-boss';
import type { PoolClient } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  createBlobDirectories,
  FilesystemBlobStore,
} from '../blobs/blob-store.js';
import { channelTenant } from '../channel-access.js';
import {
  createQueue,
  createQueueClientFromConfiguration,
} from '../worker/queue.js';
import { endPools } from '../test-support/end-pools.js';
import {
  ROUTE_INBOX_ITEM_QUEUE,
  RULE_PROVIDER,
  createInboxRuleRequestSchema,
} from './contract.js';
import type { RouteInboxItemJob } from './contract.js';
import { InboxService } from './inbox.service.js';
import { sendRouteInboxItem } from './inbox-queue.js';
import {
  adoptRule,
  approveItem,
  attachItem,
  applyInboxRules,
  assignItem,
  createChannel,
  createRule,
  deleteRoutingTarget,
  deleteRule,
  discardItem,
  insertExtraction,
  issueCredential,
  listChannels,
  listItems,
  listRoutingTargets,
  listRules,
  orderRules,
  putRoutingTarget,
  readBlob,
  readChannel,
  readChannelPrincipal,
  readInboxSettings,
  readItem,
  readProviderInput,
  readRule,
  receiveIntake,
  receiveIntakeInTransaction,
  recordExtraction,
  reopenEmailItem,
  restoreItem,
  revokeCredential,
  routeToDocument,
  snoozeItem,
  undoRoute,
  updateChannel,
  updateHints,
  updateInboxSettings,
  updateRule,
  type InboxRepository,
} from './inbox-repository.js';
import * as fixtures from './providers/__fixtures__/index.js';
import {
  SNIFF_PROVIDER,
  SNIFF_PROVIDER_VERSION,
  sniffBytes,
  toProviderOutput,
} from './providers/sniff.js';

const postgresImage =
  'pgvector/pgvector:pg18@sha256:2ba9ca5f2e7daa0f0e7723cba1ee9167bab54efd3640516a44ac1a928dd67e7a';
const testPassword = 'test-only-database-credential';
const QUOTA = 500_000;

let apiPool: DatabasePool;
let container: StartedPostgreSqlContainer;
let migratorPool: DatabasePool;
let boss: PgBoss;
let directory: string;
let store: FilesystemBlobStore;
let service: InboxService;

const owner: TenantContext = {
  organizationId: 'org-1',
  role: 'owner',
  userId: 'user-1',
};
const admin: TenantContext = {
  organizationId: 'org-1',
  role: 'admin',
  userId: 'user-2',
};
const allEntities = { legalEntityIds: null };

let entityA = '';
let entityB = '';
let counter = 0;

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

// Pools for one role; the guard mirrors the database suites.
function poolFor(role: DatabaseRole): DatabasePool {
  const pool = createDatabasePool(configurationFor(role));
  // pg emits 'error' on idle clients when the backend dies at teardown; swallow it so the container shutdown race is not an unhandled error.
  pool.on('error', () => undefined);
  return pool;
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

async function asMigrator(sql: string): Promise<void> {
  const migrator = await migratorPool.connect();

  try {
    await migrator.query('begin');
    await migrator.query('set local role bap_owner');
    await migrator.query(sql);
    await migrator.query('commit');
  } finally {
    migrator.release();
  }
}

async function createLegalEntity(name: string): Promise<string> {
  return asTenant(owner, async (transaction) => {
    const created = await transaction.query<{ id: string }>(
      `insert into app.legal_entity (organization_id, name, kind, created_by)
       values ($1, $2, 'company', $3)
       returning id`,
      [owner.organizationId, name, owner.userId],
    );
    return created.rows[0]?.id ?? '';
  });
}

// Unique bytes per upload so no upload is the exact duplicate of an earlier one.
function uniquePdf(): Buffer {
  counter += 1;
  return Buffer.concat([
    fixtures.pdf(),
    Buffer.from(`\n%% rule-test ${counter}\n`),
  ]);
}

async function upload(tenant: TenantContext, bytes: Buffer, name: string) {
  const path = join(store.temporaryDirectory(), `${counter}-${name}`);
  await writeFile(path, bytes);
  return service.upload({
    ...tenant,
    ...allEntities,
    file: { originalname: name, path, size: bytes.length },
  });
}

function rule(body: Record<string, unknown>, tenant: TenantContext = owner) {
  return createRule(apiPool, {
    ...tenant,
    ...allEntities,
    body: createInboxRuleRequestSchema.parse(body),
  });
}

async function clearRules(): Promise<void> {
  for (const existing of await listRules(apiPool, owner)) {
    await deleteRule(apiPool, { ...owner, ruleId: existing.id });
  }
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
  await asMigrator(`
    insert into auth."user" (id, name, email, email_verified)
    values ('user-1', 'Owner', 'owner@example.test', true),
           ('user-2', 'Admin', 'admin@example.test', true);
    insert into auth.organization (id, name, slug) values ('org-1', 'One', 'one');
    insert into auth.member (id, organization_id, user_id, role)
    values ('member-1', 'org-1', 'user-1', 'owner'),
           ('member-2', 'org-1', 'user-2', 'admin');
  `);
  await rootPool.end();
  apiPool = poolFor('bap_api');
  boss = createQueueClientFromConfiguration(configurationFor('bap_api'));
  await boss.start();
  await createQueue(boss, ROUTE_INBOX_ITEM_QUEUE, { policy: 'exclusive' });
  entityA = await createLegalEntity('Placeholder Holding');
  entityB = await createLegalEntity('Placeholder Branch');

  directory = await mkdtemp(join(tmpdir(), 'bap-inbox-rules-integration-'));
  await createBlobDirectories(directory);
  store = new FilesystemBlobStore(directory);
  const repository: InboxRepository = {
    adoptRule: (input) => adoptRule(apiPool, input),
    approveItem: (input) => approveItem(apiPool, input),
    attachItem: (input) => attachItem(apiPool, input),
    assignItem: (input) => assignItem(apiPool, input),
    createChannel: (input) => createChannel(apiPool, input),
    createRule: (input) => createRule(apiPool, input),
    deleteRoutingTarget: (input) => deleteRoutingTarget(apiPool, input),
    deleteRule: (input) => deleteRule(apiPool, input),
    discardItem: (input) => discardItem(apiPool, input),
    issueCredential: (input) => issueCredential(apiPool, input),
    listChannels: (input) => listChannels(apiPool, input),
    listItems: (input) => listItems(apiPool, input),
    listRoutingTargets: (input) => listRoutingTargets(apiPool, input),
    listRules: (input) => listRules(apiPool, input),
    orderRules: (input) => orderRules(apiPool, input),
    putRoutingTarget: (input) => putRoutingTarget(apiPool, input),
    readBlob: (input) => readBlob(apiPool, input),
    readChannel: (input) => readChannel(apiPool, input),
    readChannelPrincipal: (input) => readChannelPrincipal(apiPool, input),
    readInboxSettings: (input) => readInboxSettings(apiPool, input),
    readItem: (input) => readItem(apiPool, input),
    readProviderInput: (input) => readProviderInput(apiPool, input),
    readRule: (input) => readRule(apiPool, input),
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
    updateRule: (input) => updateRule(apiPool, input),
  };
  // The route job goes to the real pg-boss client so the test can read it back; nothing dequeues it.
  service = new InboxService(repository, store, QUOTA, 'intake.invalid', {
    enqueueRerunInboxRule: async () => undefined,
    enqueueRouteInboxItem: (job: RouteInboxItemJob) =>
      sendRouteInboxItem(boss, job),
    enqueueSplitEmailItem: async () => undefined,
  });
});

afterAll(async () => {
  await boss.stop({ graceful: false });
  await endPools(apiPool, migratorPool);
  await container.stop();
  await rm(directory, { force: true, recursive: true });
});

describe('inbox rules', () => {
  afterEach(clearRules);

  it('sets the entity and the kind on an upload with a rule_matched extraction and reasons', async () => {
    const created = await rule({
      detectedType: 'pdf',
      name: 'PDF contracts',
      setDocumentKind: 'contract',
      setLegalEntityId: entityA,
    });
    expect(created).toMatchObject({ paused: false, priority: 1 });

    const response = await upload(owner, uniquePdf(), 'contract.pdf');
    expect(response.item).toMatchObject({
      legalEntityId: entityA,
      status: 'needs_review',
    });

    const detail = await readItem(apiPool, {
      ...owner,
      ...allEntities,
      itemId: response.item.id,
    });
    expect(detail?.events.map((event) => event.kind)).toEqual([
      'received',
      'classified',
      'rule_matched',
    ]);
    expect(detail?.extraction).toMatchObject({
      legalEntityId: entityA,
      provider: RULE_PROVIDER,
      providerVersion: '2026-09-17.1',
    });
    expect(detail?.extraction?.draft).toMatchObject({
      kind: 'contract',
      matchedRuleIds: [created?.id],
    });
    expect(
      detail?.extraction?.reasons.map((reason) => reason.evidence),
    ).toEqual([
      `rule 1: type pdf sets legal entity ${entityA}`,
      'rule 1: type pdf sets kind contract',
    ]);
    expect(detail?.extraction?.reasons.every((r) => r.step === 'rule')).toBe(
      true,
    );
  });

  it('writes nothing when no rule matches', async () => {
    await rule({
      detectedType: 'image',
      name: 'Images',
      discardReason: 'spam',
    });
    const response = await upload(owner, uniquePdf(), 'plain.pdf');
    const detail = await readItem(apiPool, {
      ...owner,
      ...allEntities,
      itemId: response.item.id,
    });

    expect(detail?.events.map((event) => event.kind)).toEqual([
      'received',
      'classified',
    ]);
    expect(detail?.extraction?.provider).toBe(SNIFF_PROVIDER);
  });

  it('lets the standing channel hint outrank the rule per field', async () => {
    const channel = await createChannel(apiPool, {
      ...owner,
      body: {
        hintKind: 'agreement',
        kind: 'api',
        legalEntityId: entityA,
        name: 'Hinted channel',
      },
    });
    await rule({
      channelId: channel?.id,
      name: 'Channel rule',
      setDocumentKind: 'contract',
      setLegalEntityId: entityB,
    });
    const bytes = uniquePdf();
    const path = join(store.temporaryDirectory(), 'channel.pdf');
    await writeFile(path, bytes);
    const response = await service.intakeFile({
      ...channelTenant(owner.organizationId, channel?.id ?? ''),
      channelId: channel?.id ?? '',
      externalId: 'hinted-1',
      file: { originalname: 'channel.pdf', path, size: bytes.length },
      origin: 'abcdef01',
    });
    const detail = await readItem(apiPool, {
      ...owner,
      ...allEntities,
      itemId: response.itemId,
    });

    expect(detail?.item).toMatchObject({
      hintKind: 'agreement',
      legalEntityId: entityA,
    });
    expect(detail?.extraction).toMatchObject({
      detectedType: 'agreement',
      legalEntityId: entityA,
      provider: RULE_PROVIDER,
    });
    expect(detail?.extraction?.draft).toMatchObject({ kind: 'agreement' });
    expect(
      detail?.extraction?.reasons.map((reason) => reason.evidence),
    ).toEqual([
      `rule 1: channel ${channel?.id} would set legal entity ${entityB}, kept the earlier value`,
      `rule 1: channel ${channel?.id} would set kind contract, kept the earlier value`,
    ]);
  });

  it('sets the entity and writes the rule_matched row on an API channel intake', async () => {
    const channel = await createChannel(apiPool, {
      ...owner,
      body: { kind: 'api', name: 'Plain API channel' },
    });
    const channelId = channel?.id ?? '';
    const created = await rule({
      channelId,
      name: 'API channel rule',
      setDocumentKind: 'contract',
      setLegalEntityId: entityA,
    });
    const bytes = uniquePdf();
    const path = join(store.temporaryDirectory(), `${counter}-api-rule.pdf`);
    await writeFile(path, bytes);
    const response = await service.intakeFile({
      ...channelTenant(owner.organizationId, channelId),
      channelId,
      externalId: 'api-rule-1',
      file: { originalname: 'api-rule.pdf', path, size: bytes.length },
      origin: 'abcdef02',
    });
    const detail = await readItem(apiPool, {
      ...owner,
      ...allEntities,
      itemId: response.itemId,
    });

    expect(detail?.item.legalEntityId).toBe(entityA);
    expect(detail?.extraction).toMatchObject({
      legalEntityId: entityA,
      provider: RULE_PROVIDER,
    });
    expect(detail?.extraction?.draft).toMatchObject({
      kind: 'contract',
      matchedRuleIds: [created?.id],
    });
    expect(
      detail?.events.map((event) => [event.kind, event.actorUserId]),
    ).toEqual([
      ['received', null],
      ['classified', null],
      ['rule_matched', null],
    ]);
  });

  it('enqueues the route for a target default an API channel intake sees through the definer, with no rule', async () => {
    const channel = await createChannel(apiPool, {
      ...owner,
      body: { kind: 'api', name: 'Target default channel' },
    });
    const channelId = channel?.id ?? '';
    await putRoutingTarget(apiPool, {
      ...owner,
      body: {
        auto: 'always',
        autoThreshold: null,
        defaultAssigneeId: null,
        defaultLegalEntityId: entityB,
        destination: 'documents',
        documentKind: 'other',
        partnerPolicy: 'match_only',
        requiredFields: [],
      },
      detectedType: 'pdf',
    });

    try {
      const bytes = uniquePdf();
      const path = join(store.temporaryDirectory(), `${counter}-target.pdf`);
      await writeFile(path, bytes);
      const response = await service.intakeFile({
        ...channelTenant(owner.organizationId, channelId),
        channelId,
        externalId: 'target-default-1',
        file: { originalname: 'target.pdf', path, size: bytes.length },
        origin: 'abcdef03',
      });
      const detail = await readItem(apiPool, {
        ...owner,
        ...allEntities,
        itemId: response.itemId,
      });

      // No rule row: the sniff stays the newest extraction and the target default alone asked for the route.
      expect(detail?.extraction?.provider).toBe(SNIFF_PROVIDER);
      expect(detail?.routingTarget.defaultLegalEntityId).toBe(entityB);
      const jobs = await apiPool.query<{ data: RouteInboxItemJob }>(
        'select data from pgboss.job where name = $1 and singleton_key = $2',
        [ROUTE_INBOX_ITEM_QUEUE, response.itemId],
      );
      expect(jobs.rows.map((row) => row.data)).toEqual([
        {
          itemId: response.itemId,
          organizationId: owner.organizationId,
          ruleId: null,
        },
      ]);
    } finally {
      await deleteRoutingTarget(apiPool, { ...owner, detectedType: 'pdf' });
    }
  });

  it('discards synchronously on a discard rule with the rule as the decider', async () => {
    const created = await rule({
      keyword: 'newsletter',
      name: 'Newsletters',
      discardReason: 'irrelevant',
    });
    const response = await upload(owner, uniquePdf(), 'Newsletter-09.pdf');

    expect(response.item).toMatchObject({
      decidedByKind: 'rule',
      decidedByRuleId: created?.id,
      decidedByUserId: null,
      status: 'discarded',
    });
    const detail = await readItem(apiPool, {
      ...owner,
      ...allEntities,
      itemId: response.item.id,
    });
    expect(detail?.events.map((event) => [event.kind, event.reason])).toEqual([
      ['received', null],
      ['classified', null],
      ['rule_matched', null],
      ['discarded', 'irrelevant'],
    ]);
    expect(detail?.corrections).toEqual([]);
  });

  it('pauses the rule of a demoted author and lists it as paused', async () => {
    const created = await rule(
      { detectedType: 'pdf', name: 'Admin rule', setLegalEntityId: entityB },
      admin,
    );
    expect(created?.paused).toBe(false);

    await asMigrator(
      "update auth.member set role = 'member' where id = 'member-2'",
    );
    const listed = await listRules(apiPool, owner);
    expect(listed.map((r) => [r.id, r.paused])).toEqual([[created?.id, true]]);

    const response = await upload(owner, uniquePdf(), 'paused.pdf');
    expect(response.item.legalEntityId).toBeNull();
    const detail = await readItem(apiPool, {
      ...owner,
      ...allEntities,
      itemId: response.item.id,
    });
    expect(detail?.events.map((event) => event.kind)).toEqual([
      'received',
      'classified',
    ]);

    // Adoption moves the author to the caller, so the rule runs again.
    const adopted = await adoptRule(apiPool, {
      ...owner,
      ...allEntities,
      ruleId: created?.id ?? '',
    });
    expect(adopted).toMatchObject({ createdBy: owner.userId, paused: false });
    const again = await upload(owner, uniquePdf(), 'adopted.pdf');
    expect(again.item.legalEntityId).toBe(entityB);

    await asMigrator(
      "update auth.member set role = 'admin' where id = 'member-2'",
    );
  });

  it('runs the pass for an email child under the channel principal', async () => {
    const channel = await createChannel(apiPool, {
      ...owner,
      body: { kind: 'email', name: 'Mail' },
    });
    const channelId = channel?.id ?? '';
    const created = await rule({
      name: 'Supplier mail',
      senderPattern: '@dodavatel.cz',
      setAssigneeId: 'user-2',
      setLegalEntityId: entityA,
    });
    const tenant = channelTenant(owner.organizationId, channelId);
    const bytes = uniquePdf();
    const sniffed = sniffBytes({
      byteSize: bytes.length,
      head: bytes,
      tail: bytes,
    });
    const itemId = await asTenant(tenant, async (transaction) => {
      const result = await receiveIntakeInTransaction(transaction, {
        ...tenant,
        byteSize: bytes.length,
        channelId,
        channelKind: 'email',
        externalId: 'parent:1',
        legalEntityIds: null,
        mediaType: 'application/pdf',
        origin: null,
        originalFilename: 'attachment.pdf',
        parentItemId: null,
        payloadKind: 'file',
        persist: async () => undefined,
        quotaBytes: QUOTA,
        sender: 'Billing@Dodavatel.cz',
        sha256: `${'0'.repeat(60)}${String(counter).padStart(4, '0')}`,
        sniff: null,
        storageKey: `org/org-1/child-${counter}`,
      });
      await insertExtraction(transaction, tenant, result.item.id, {
        output: toProviderOutput(sniffed),
        provider: SNIFF_PROVIDER,
        providerVersion: SNIFF_PROVIDER_VERSION,
      });
      const pass = await applyInboxRules(transaction, {
        ...tenant,
        itemId: result.item.id,
        text: null,
      });
      expect(pass).toEqual({
        discarded: false,
        matchedRuleIds: [created?.id],
        routeJob: null,
      });
      return result.item.id;
    });

    const detail = await readItem(apiPool, {
      ...owner,
      ...allEntities,
      itemId,
    });
    expect(detail?.item).toMatchObject({
      assigneeId: 'user-2',
      legalEntityId: entityA,
    });
    expect(
      detail?.events.map((event) => [event.kind, event.actorUserId]),
    ).toEqual([
      ['received', null],
      ['classified', null],
      ['rule_matched', null],
    ]);
  });

  it('never enqueues an invoice kind and writes the reason on the rule row', async () => {
    await rule({
      detectedType: 'pdf',
      name: 'Invoice PDFs',
      setDocumentKind: 'received_invoice',
      setLegalEntityId: entityA,
    });
    await putRoutingTarget(apiPool, {
      ...owner,
      body: {
        auto: 'always',
        autoThreshold: null,
        defaultAssigneeId: null,
        defaultLegalEntityId: null,
        destination: 'documents',
        documentKind: 'other',
        partnerPolicy: 'match_only',
        requiredFields: [],
      },
      detectedType: 'pdf',
    });
    const response = await upload(owner, uniquePdf(), 'invoice.pdf');
    const detail = await readItem(apiPool, {
      ...owner,
      ...allEntities,
      itemId: response.item.id,
    });

    expect(detail?.item.status).toBe('needs_review');
    expect(detail?.extraction?.reasons.at(-1)?.evidence).toBe(
      'Auto-route waits: an invoice kind needs the ISDOC parser on the connections track.',
    );
    const jobs = await apiPool.query(
      'select 1 from pgboss.job where name = $1 and singleton_key = $2',
      [ROUTE_INBOX_ITEM_QUEUE, response.item.id],
    );
    expect(jobs.rows).toEqual([]);
    await deleteRoutingTarget(apiPool, { ...owner, detectedType: 'pdf' });
  });

  it('enqueues route_inbox_item for a non-invoice auto_route rule with the item as singleton key', async () => {
    const created = await rule({
      autoRoute: true,
      detectedType: 'pdf',
      name: 'Auto contracts',
      setDocumentKind: 'contract',
      setLegalEntityId: entityA,
    });
    const response = await upload(owner, uniquePdf(), 'auto.pdf');

    expect(response.item.status).toBe('needs_review');
    const jobs = await apiPool.query<{
      data: RouteInboxItemJob;
      retry_delay: number;
      retry_limit: number;
      singleton_key: string;
      state: string;
    }>(
      'select data, singleton_key, retry_limit, retry_delay, state from pgboss.job where name = $1 and singleton_key = $2',
      [ROUTE_INBOX_ITEM_QUEUE, response.item.id],
    );
    expect(jobs.rows).toEqual([
      {
        data: {
          itemId: response.item.id,
          organizationId: owner.organizationId,
          ruleId: created?.id,
        },
        retry_delay: 60,
        retry_limit: 3,
        singleton_key: response.item.id,
        state: 'created',
      },
    ]);
  });

  it('records a correction for each suggested field a manual route changed', async () => {
    await rule({
      detectedType: 'pdf',
      name: 'Suggest contracts',
      setDocumentKind: 'contract',
      setLegalEntityId: entityA,
    });
    const response = await upload(owner, uniquePdf(), 'corrected.pdf');
    const routed = await service.routeToDocument({
      ...owner,
      ...allEntities,
      body: {
        correctionReasons: { kind: 'It is an agreement, not a contract.' },
        document: {
          currencyCode: 'CZK',
          documentDate: response.item.receivedAt.slice(0, 10),
          kind: 'agreement',
          legalEntityId: entityA,
          title: 'corrected.pdf',
        },
        fileBlobIds: response.files.map((file) => file.blobId),
      },
      itemId: response.item.id,
    });

    expect(routed?.item.status).toBe('routed');
    expect(routed?.corrections).toEqual([
      expect.objectContaining({
        createdBy: owner.userId,
        field: 'kind',
        finalValue: 'agreement',
        reason: 'It is an agreement, not a contract.',
        source: 'rule',
        suggestedValue: 'contract',
      }),
    ]);
  });

  it('swaps priorities in one transaction and refuses a partial list', async () => {
    const first = await rule({
      detectedType: 'pdf',
      name: 'First',
      setDocumentKind: 'other',
    });
    const second = await rule({
      detectedType: 'image',
      name: 'Second',
      setDocumentKind: 'other',
    });
    expect([first?.priority, second?.priority]).toEqual([1, 2]);

    const ordered = await orderRules(apiPool, {
      ...owner,
      ruleIds: [second?.id ?? '', first?.id ?? ''],
    });
    expect(ordered.map((r) => [r.id, r.priority])).toEqual([
      [second?.id, 1],
      [first?.id, 2],
    ]);
    await expect(
      orderRules(apiPool, { ...owner, ruleIds: [first?.id ?? ''] }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // A soft delete frees the slot and the row stays for provenance.
    expect(
      await deleteRule(apiPool, { ...owner, ruleId: first?.id ?? '' }),
    ).toBe(true);
    expect(
      await deleteRule(apiPool, { ...owner, ruleId: first?.id ?? '' }),
    ).toBe(false);
    expect((await listRules(apiPool, owner)).map((r) => r.id)).toEqual([
      second?.id,
    ]);
  });

  it('answers null for an entity outside the caller scope and refuses a member', async () => {
    const restricted = await createRule(apiPool, {
      ...admin,
      body: createInboxRuleRequestSchema.parse({
        detectedType: 'pdf',
        name: 'Out of scope',
        setLegalEntityId: entityB,
      }),
      legalEntityIds: [entityA],
    });
    expect(restricted).toBeNull();

    await expect(
      createRule(apiPool, {
        ...owner,
        ...allEntities,
        role: 'member',
        userId: 'user-9',
        body: createInboxRuleRequestSchema.parse({
          detectedType: 'pdf',
          name: 'Member rule',
          setDocumentKind: 'other',
        }),
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
