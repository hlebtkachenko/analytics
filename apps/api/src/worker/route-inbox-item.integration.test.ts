import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
import { createDocumentRequestSchema } from '../documents/contract.js';
import { createDocumentInTransaction } from '../documents/document-repository.js';
import {
  RERUN_INBOX_RULE_QUEUE,
  ROUTE_INBOX_ITEM_QUEUE,
  RULE_PROVIDER,
  createInboxRuleRequestSchema,
} from '../inbox/contract.js';
import type {
  InboxItemDetail,
  RerunInboxRuleJob,
  RouteInboxItemJob,
} from '../inbox/contract.js';
import { InboxService } from '../inbox/inbox.service.js';
import {
  sendRerunInboxRule,
  sendRouteInboxItem,
} from '../inbox/inbox-queue.js';
import {
  adoptRule,
  approveItem,
  attachItem,
  assignItem,
  createChannel,
  createRule,
  deleteRoutingTarget,
  deleteRule,
  discardItem,
  finishRouteInTransaction,
  issueCredential,
  listChannels,
  listItems,
  listRoutingTargets,
  listRules,
  loadItem,
  loadItemFiles,
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
} from '../inbox/inbox-repository.js';
import * as fixtures from '../inbox/providers/__fixtures__/index.js';
import { endPools } from '../test-support/end-pools.js';
import { createQueue, createQueueClientFromConfiguration } from './queue.js';
import { rerunInboxRule } from './rerun-inbox-rule.js';
import { AUTO_ROUTE_PROVIDER, routeInboxItem } from './route-inbox-item.js';
import type { RouteInboxItemOutcome } from './route-inbox-item.js';
import { WorkerMetrics } from './worker-metrics.js';

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
const logger = { log: () => undefined };

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

function unique(bytes: Buffer): Buffer {
  counter += 1;
  return Buffer.concat([bytes, Buffer.from(`\n%% route-test ${counter}\n`)]);
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

async function enqueuedRouteJob(itemId: string): Promise<RouteInboxItemJob> {
  const jobs = await apiPool.query<{ data: RouteInboxItemJob }>(
    'select data from pgboss.job where name = $1 and singleton_key = $2',
    [ROUTE_INBOX_ITEM_QUEUE, itemId],
  );
  const job = jobs.rows[0]?.data;

  if (job === undefined) {
    throw new Error('No route job was enqueued.');
  }

  return job;
}

// Runs the handler exactly as the worker would, on the job the intake enqueued or on an explicit payload.
function runRoute(data: RouteInboxItemJob): Promise<RouteInboxItemOutcome> {
  return routeInboxItem({
    data,
    logger,
    metrics: new WorkerMetrics(),
    pool: apiPool,
  });
}

function detail(itemId: string): Promise<InboxItemDetail | null> {
  return readItem(apiPool, { ...owner, ...allEntities, itemId });
}

async function extractionsOf(itemId: string) {
  return asTenant(owner, async (transaction) => {
    const rows = await transaction.query<{
      created_by: string;
      issues: { code: string; field?: string }[];
      provider: string;
      reasons: { evidence: string }[];
    }>(
      `select provider, created_by, issues, reasons from app.inbox_item_extraction
        where item_id = $1 order by created_at, id`,
      [itemId],
    );
    return rows.rows;
  });
}

async function auditOf(itemId: string) {
  return asTenant(owner, async (transaction) => {
    const rows = await transaction.query<{
      action: string;
      metadata: Record<string, unknown>;
      user_id: string;
    }>(
      'select action, user_id, metadata from app.audit_log where resource_id = $1 order by created_at, id',
      [itemId],
    );
    return rows.rows;
  });
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
  apiPool = createDatabasePool(configurationFor('bap_api'));
  boss = createQueueClientFromConfiguration(configurationFor('bap_api'));
  await boss.start();
  await createQueue(boss, ROUTE_INBOX_ITEM_QUEUE, { policy: 'exclusive' });
  await createQueue(boss, RERUN_INBOX_RULE_QUEUE, { policy: 'exclusive' });
  entityA = await createLegalEntity('Placeholder Holding');
  entityB = await createLegalEntity('Placeholder Branch');

  directory = await mkdtemp(join(tmpdir(), 'bap-route-inbox-integration-'));
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
  service = new InboxService(repository, store, QUOTA, 'intake.invalid', {
    enqueueRerunInboxRule: (job: RerunInboxRuleJob) =>
      sendRerunInboxRule(boss, job),
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

describe('route_inbox_item', () => {
  afterEach(clearRules);

  it('routes as the rule author with decided_by_kind rule, an auto_route row and the audit entry', async () => {
    // The rule author routes under their own entity scope, which now denies by default.
    await asTenant(owner, (transaction) =>
      transaction.query(
        `insert into app.member_entity_scope (organization_id, user_id, mode, updated_by)
         values ($1, $2, 'all', $3)`,
        [owner.organizationId, admin.userId, owner.userId],
      ),
    );

    try {
      const created = await rule(
        {
          autoRoute: true,
          detectedType: 'pdf',
          name: 'Auto contracts',
          setDocumentKind: 'contract',
          setLegalEntityId: entityA,
        },
        admin,
      );
      const response = await upload(owner, unique(fixtures.pdf()), 'auto.pdf');
      const job = await enqueuedRouteJob(response.item.id);
      expect(job.ruleId).toBe(created?.id);

      const outcome = await runRoute(job);
      expect(outcome.kind).toBe('routed');

      const after = await detail(response.item.id);
      expect(after?.item).toMatchObject({
        decidedByKind: 'rule',
        decidedByRuleId: created?.id,
        decidedByUserId: null,
        legalEntityId: entityA,
        status: 'routed',
      });
      expect(after?.item.documentId).not.toBeNull();
      expect(after?.corrections).toEqual([]);
      expect(
        after?.events.map((event) => [event.kind, event.actorUserId]),
      ).toEqual([
        ['received', owner.userId],
        ['classified', owner.userId],
        ['rule_matched', owner.userId],
        ['classified', admin.userId],
        ['routed', admin.userId],
      ]);

      const document = await asTenant(owner, (transaction) =>
        transaction.query<{ created_by: string; kind: string; source: string }>(
          'select created_by, kind, source from app.document where id = $1',
          [after?.item.documentId],
        ),
      );
      expect(document.rows).toEqual([
        { created_by: admin.userId, kind: 'contract', source: 'upload' },
      ]);
      const files = await asTenant(owner, (transaction) =>
        transaction.query<{ created_by: string }>(
          'select created_by from app.document_file where document_id = $1',
          [after?.item.documentId],
        ),
      );
      expect(files.rows).toEqual([{ created_by: admin.userId }]);

      const extractions = await extractionsOf(response.item.id);
      expect(extractions.map((row) => [row.provider, row.created_by])).toEqual([
        ['sniff', owner.userId],
        [RULE_PROVIDER, owner.userId],
        [AUTO_ROUTE_PROVIDER, admin.userId],
      ]);
      expect(extractions[2]?.reasons).toEqual(extractions[1]?.reasons);
      expect(extractions[2]?.issues).toEqual([]);
      expect(after?.extraction?.draft).toMatchObject({
        kind: 'contract',
        legalEntityId: entityA,
        title: 'auto.pdf',
      });

      const audit = await auditOf(response.item.id);
      expect(audit.at(-1)).toMatchObject({
        action: 'inbox_item.routed',
        metadata: {
          decidedByKind: 'rule',
          kind: 'contract',
          ruleId: created?.id,
        },
        user_id: admin.userId,
      });
    } finally {
      await asTenant(owner, (transaction) =>
        transaction.query(
          'delete from app.member_entity_scope where user_id = $1',
          [admin.userId],
        ),
      );
    }
  });

  it('leaves the item in review with a rule_author_unavailable event when the author was demoted', async () => {
    await rule(
      {
        autoRoute: true,
        detectedType: 'pdf',
        name: 'Demoted author',
        setDocumentKind: 'contract',
        setLegalEntityId: entityA,
      },
      admin,
    );
    const response = await upload(owner, unique(fixtures.pdf()), 'demoted.pdf');
    const job = await enqueuedRouteJob(response.item.id);
    await asMigrator(
      "update auth.member set role = 'member' where id = 'member-2'",
    );

    try {
      expect(await runRoute(job)).toEqual({ kind: 'author_unavailable' });
    } finally {
      await asMigrator(
        "update auth.member set role = 'admin' where id = 'member-2'",
      );
    }

    const after = await detail(response.item.id);
    expect(after?.item).toMatchObject({
      decidedByKind: null,
      documentId: null,
      status: 'needs_review',
    });
    expect(after?.events.at(-1)).toMatchObject({
      actorUserId: null,
      kind: 'failed',
      reason: 'rule_author_unavailable',
    });
    expect(
      (await extractionsOf(response.item.id)).map((row) => row.provider),
    ).toEqual(['sniff', RULE_PROVIDER]);
    // The automation subject wrote no audit row; the item's audit trail is the intake's alone.
    expect((await auditOf(response.item.id)).map((row) => row.action)).toEqual([
      'inbox_item.received',
    ]);
  });

  it('records the skip when the author scope excludes the draft entity', async () => {
    await rule(
      {
        autoRoute: true,
        detectedType: 'pdf',
        name: 'Restricted author',
        setDocumentKind: 'contract',
        setLegalEntityId: entityA,
      },
      admin,
    );
    const response = await upload(owner, unique(fixtures.pdf()), 'scope.pdf');
    const job = await enqueuedRouteJob(response.item.id);
    await asTenant(owner, async (transaction) => {
      await transaction.query(
        `insert into app.member_entity_scope (organization_id, user_id, mode, updated_by)
         values ($1, $2, 'restricted', $3)`,
        [owner.organizationId, admin.userId, owner.userId],
      );
      await transaction.query(
        `insert into app.legal_entity_access (organization_id, user_id, legal_entity_id, created_by)
         values ($1, $2, $3, $4)`,
        [owner.organizationId, admin.userId, entityB, owner.userId],
      );
    });

    try {
      expect(await runRoute(job)).toEqual({ kind: 'author_unavailable' });
    } finally {
      await asTenant(owner, async (transaction) => {
        await transaction.query(
          'delete from app.legal_entity_access where user_id = $1',
          [admin.userId],
        );
        await transaction.query(
          'delete from app.member_entity_scope where user_id = $1',
          [admin.userId],
        );
      });
    }

    const after = await detail(response.item.id);
    expect(after?.item.status).toBe('needs_review');
    expect(after?.events.at(-1)).toMatchObject({
      actorUserId: null,
      kind: 'failed',
      reason: 'rule_author_unavailable',
    });
  });

  it('commits missing_required_field once, then allows exactly one more attempt per human touch', async () => {
    await rule({
      autoRoute: true,
      detectedType: 'pdf',
      name: 'Needs a reference',
      setDocumentKind: 'contract',
      setLegalEntityId: entityA,
    });
    const response = await upload(owner, unique(fixtures.pdf()), 'touch.pdf');
    const job = await enqueuedRouteJob(response.item.id);
    // The target changes after the enqueue, so the dequeue finds a required field the draft cannot fill.
    await putRoutingTarget(apiPool, {
      ...owner,
      body: {
        auto: 'never',
        autoThreshold: null,
        defaultAssigneeId: null,
        defaultLegalEntityId: null,
        destination: 'documents',
        documentKind: 'other',
        partnerPolicy: 'match_only',
        requiredFields: ['reference'],
      },
      detectedType: 'pdf',
    });

    try {
      expect(await runRoute(job)).toEqual({
        field: 'reference',
        issue: 'missing_required_field',
        kind: 'failed',
      });
      expect(await runRoute(job)).toEqual({
        kind: 'refused',
        reason: 'already_attempted',
      });

      // A person's touch opens one more attempt, and only one.
      await assignItem(apiPool, {
        ...owner,
        ...allEntities,
        assigneeId: admin.userId,
        itemId: response.item.id,
      });
      expect(await runRoute(job)).toMatchObject({ kind: 'failed' });
      expect(await runRoute(job)).toEqual({
        kind: 'refused',
        reason: 'already_attempted',
      });
    } finally {
      await deleteRoutingTarget(apiPool, { ...owner, detectedType: 'pdf' });
    }

    const extractions = await extractionsOf(response.item.id);
    expect(
      extractions
        .filter((row) => row.provider === AUTO_ROUTE_PROVIDER)
        .map((row) => row.issues),
    ).toEqual([
      [
        expect.objectContaining({
          code: 'missing_required_field',
          field: 'reference',
        }),
      ],
      [
        expect.objectContaining({
          code: 'missing_required_field',
          field: 'reference',
        }),
      ],
    ]);
    expect((await detail(response.item.id))?.item.status).toBe('needs_review');

    // With the target back to normal a fresh touch lets the route through.
    await assignItem(apiPool, {
      ...owner,
      ...allEntities,
      assigneeId: null,
      itemId: response.item.id,
    });
    expect(await runRoute(job)).toMatchObject({ kind: 'routed' });
  });

  it('refuses after a person routed the item under the row lock', async () => {
    await rule({
      autoRoute: true,
      detectedType: 'pdf',
      name: 'Raced',
      setDocumentKind: 'contract',
      setLegalEntityId: entityA,
    });
    const response = await upload(owner, unique(fixtures.pdf()), 'race.pdf');
    const job = await enqueuedRouteJob(response.item.id);

    // The person holds the lock first; the job blocks on FOR UPDATE and sees the routed row after the commit.
    const person = await apiPool.connect();
    let racing: Promise<RouteInboxItemOutcome> | undefined;

    try {
      await person.query('begin');
      await person.query(
        "select set_config('bap.user_id', $1, true), set_config('bap.organization_id', $2, true), set_config('bap.role', 'owner', true)",
        [owner.userId, owner.organizationId],
      );
      const locked = await loadItem(person, response.item.id, null, true);
      expect(locked).not.toBeNull();
      racing = runRoute(job);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const files = await loadItemFiles(person, response.item.id);
      const created = await createDocumentInTransaction(person, {
        ...owner,
        ...allEntities,
        body: createDocumentRequestSchema.parse({
          documentDate: response.item.receivedAt.slice(0, 10),
          kind: 'agreement',
          legalEntityId: entityB,
          title: 'race.pdf',
        }),
        inbox: { itemId: response.item.id, source: 'upload' },
      });
      await finishRouteInTransaction(
        person,
        owner,
        locked ?? response.item,
        created?.document ?? { id: '', kind: '', legalEntityId: '' },
        files.map((file) => file.blobId),
        { kind: 'user', userId: owner.userId },
      );
      await person.query('commit');
    } catch (error) {
      await person.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      person.release();
    }

    expect(await racing).toEqual({ kind: 'refused', reason: 'status' });
    const after = await detail(response.item.id);
    expect(after?.item).toMatchObject({
      decidedByKind: 'user',
      decidedByUserId: owner.userId,
      legalEntityId: entityB,
      status: 'routed',
    });
    expect(
      (await extractionsOf(response.item.id)).map((row) => row.provider),
    ).toEqual(['sniff', RULE_PROVIDER]);
  });

  it('refuses a discarded item and a snoozed item without writing', async () => {
    await rule({
      autoRoute: true,
      detectedType: 'pdf',
      name: 'Discarded',
      setDocumentKind: 'contract',
      setLegalEntityId: entityA,
    });
    const discarded = await upload(owner, unique(fixtures.pdf()), 'gone.pdf');
    const discardedJob = await enqueuedRouteJob(discarded.item.id);
    await discardItem(apiPool, {
      ...owner,
      ...allEntities,
      itemId: discarded.item.id,
      reason: 'irrelevant',
    });
    expect(await runRoute(discardedJob)).toEqual({
      kind: 'refused',
      reason: 'item_unavailable',
    });

    const snoozed = await upload(owner, unique(fixtures.pdf()), 'later.pdf');
    const snoozedJob = await enqueuedRouteJob(snoozed.item.id);
    await snoozeItem(apiPool, {
      ...owner,
      ...allEntities,
      itemId: snoozed.item.id,
      snoozedUntil: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(await runRoute(snoozedJob)).toEqual({
      kind: 'refused',
      reason: 'snoozed',
    });
    expect(
      (await extractionsOf(snoozed.item.id)).map((row) => row.provider),
    ).toEqual(['sniff', RULE_PROVIDER]);
  });

  it('routes a target default with auto always as the account that saved the target, with no rule at all', async () => {
    // The target author routes under their own entity scope, which now denies by default.
    await asTenant(owner, (transaction) =>
      transaction.query(
        `insert into app.member_entity_scope (organization_id, user_id, mode, updated_by)
         values ($1, $2, 'all', $3)`,
        [owner.organizationId, admin.userId, owner.userId],
      ),
    );
    await putRoutingTarget(apiPool, {
      ...admin,
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
      detectedType: 'image',
    });

    try {
      const response = await upload(owner, unique(fixtures.png()), 'scan.png');
      const job = await enqueuedRouteJob(response.item.id);
      expect(job.ruleId).toBeNull();
      // No rule matched, so the intake wrote no rule row; the target default asked on its own.
      expect(
        (await extractionsOf(response.item.id)).map((row) => row.provider),
      ).toEqual(['sniff']);

      expect(await runRoute(job)).toMatchObject({ kind: 'routed' });
      const after = await detail(response.item.id);
      expect(after?.item).toMatchObject({
        decidedByKind: 'target_default',
        decidedByRuleId: null,
        decidedByUserId: admin.userId,
        legalEntityId: entityB,
        status: 'routed',
      });
      const document = await asTenant(owner, (transaction) =>
        transaction.query<{ created_by: string; kind: string }>(
          'select created_by, kind from app.document where id = $1',
          [after?.item.documentId],
        ),
      );
      expect(document.rows).toEqual([
        { created_by: admin.userId, kind: 'other' },
      ]);
      expect((await auditOf(response.item.id)).at(-1)?.metadata).toMatchObject({
        decidedByKind: 'target_default',
        ruleId: null,
      });
    } finally {
      await deleteRoutingTarget(apiPool, { ...owner, detectedType: 'image' });
      await asTenant(owner, (transaction) =>
        transaction.query(
          'delete from app.member_entity_scope where user_id = $1',
          [admin.userId],
        ),
      );
    }
  });
});

describe('rerun_inbox_rule', () => {
  afterEach(clearRules);

  async function runRerun(
    data: RerunInboxRuleJob,
    batchSize: number,
  ): Promise<ReturnType<typeof rerunInboxRule>> {
    return rerunInboxRule({
      batchSize,
      blobs: store,
      data,
      enqueueRerunInboxRule: (job) => sendRerunInboxRule(boss, job),
      enqueueRouteInboxItem: (job) => sendRouteInboxItem(boss, job),
      logger,
      metrics: new WorkerMetrics(),
      pool: apiPool,
    });
  }

  // The earlier tests leave items in review; the walk must start from this test's own three.
  async function discardEverythingInReview(): Promise<void> {
    const pending = await asTenant(owner, (transaction) =>
      transaction.query<{ id: string }>(
        "select id from app.inbox_item where status = 'needs_review'",
      ),
    );

    for (const row of pending.rows) {
      await discardItem(apiPool, {
        ...owner,
        ...allEntities,
        itemId: row.id,
        reason: 'irrelevant',
      });
    }
  }

  it('applies a new rule to untouched items only, skips matched ones and self-requeues past the cap', async () => {
    await discardEverythingInReview();
    const items: string[] = [];

    for (const name of ['first.pdf', 'second.pdf', 'third.pdf']) {
      items.push((await upload(owner, unique(fixtures.pdf()), name)).item.id);
    }

    // The second item was touched by a person, so the rerun leaves it alone.
    await assignItem(apiPool, {
      ...owner,
      ...allEntities,
      assigneeId: admin.userId,
      itemId: items[1] ?? '',
    });
    const created = await rule({
      autoRoute: true,
      detectedType: 'pdf',
      name: 'Backfill',
      setDocumentKind: 'contract',
      setLegalEntityId: entityA,
    });
    const job: RerunInboxRuleJob = {
      organizationId: owner.organizationId,
      ruleId: created?.id ?? '',
      userId: owner.userId,
    };

    const first = await runRerun(job, 1);
    expect(first).toMatchObject({
      appliedItemIds: [items[0]],
      routedItemIds: [items[0]],
      skippedItemIds: [],
    });
    expect(first.cursor).toMatchObject({ itemId: items[0] });

    const continuation = await apiPool.query<{
      data: RerunInboxRuleJob;
      singleton_key: string;
    }>(
      'select data, singleton_key from pgboss.job where name = $1 order by created_on',
      [RERUN_INBOX_RULE_QUEUE],
    );
    expect(continuation.rows).toEqual([
      {
        data: { ...job, cursor: first.cursor },
        singleton_key: `${job.ruleId}:${items[0]}`,
      },
    ]);
    expect((await enqueuedRouteJob(items[0] ?? '')).ruleId).toBe(created?.id);

    const second = await runRerun(
      { ...job, cursor: first.cursor ?? undefined },
      1,
    );
    expect(second).toMatchObject({
      appliedItemIds: [items[2]],
      cursor: null,
      skippedItemIds: [],
    });

    const untouched = await detail(items[2] ?? '');
    expect(untouched?.item.legalEntityId).toBe(entityA);
    expect(untouched?.extraction?.draft).toMatchObject({
      kind: 'contract',
      matchedRuleIds: [created?.id],
    });
    const touched = await detail(items[1] ?? '');
    expect(touched?.item.legalEntityId).toBeNull();
    expect(touched?.extraction?.provider).toBe('sniff');

    // A second walk from the start finds every untouched item already matched.
    const again = await runRerun(job, 10);
    expect(again.appliedItemIds).toEqual([]);
    expect(again.skippedItemIds).toEqual([items[0], items[2]]);
  });

  it('keeps the intake matches and their kind when a later rule reruns on the same item', async () => {
    await discardEverythingInReview();
    const first = await rule({
      detectedType: 'pdf',
      name: 'Contracts first',
      setDocumentKind: 'contract',
    });
    const itemId = (await upload(owner, unique(fixtures.pdf()), 'both.pdf'))
      .item.id;
    const second = await rule({
      detectedType: 'pdf',
      name: 'Entity later',
      setDocumentKind: 'agreement',
      setLegalEntityId: entityA,
    });

    const report = await runRerun(
      {
        organizationId: owner.organizationId,
        ruleId: second?.id ?? '',
        userId: owner.userId,
      },
      10,
    );
    expect(report.appliedItemIds).toEqual([itemId]);

    const after = await detail(itemId);
    expect(after?.item.legalEntityId).toBe(entityA);
    expect(after?.extraction?.draft).toMatchObject({
      kind: 'contract',
      matchedRuleIds: [first?.id, second?.id],
    });
  });
});
