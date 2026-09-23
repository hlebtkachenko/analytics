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
import {
  RERUN_INBOX_RULE_QUEUE,
  ROUTE_INBOX_ITEM_QUEUE,
} from '../inbox/contract.js';
import type {
  InboxItemDetail,
  ParseInboxItemJob,
  RerunInboxRuleJob,
  RouteInboxItemJob,
  ScanInboxItemJob,
} from '../inbox/contract.js';
import { InboxService } from '../inbox/inbox.service.js';
import {
  sendRerunInboxRule,
  sendRouteInboxItem,
} from '../inbox/inbox-queue.js';
import {
  createChannel,
  issueCredential,
  listChannels,
  readChannel,
  readChannelPrincipal,
  revokeCredential,
  updateChannel,
} from '../inbox/inbox-channel-repository.js';
import { loadItem } from '../inbox/inbox-repository-support.js';
import {
  approveItem,
  attachItem,
  assignItem,
  discardItem,
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
} from '../inbox/inbox-repository.js';
import {
  adoptRule,
  createRule,
  deleteRule,
  listRules,
  orderRules,
  readRule,
  updateRule,
} from '../inbox/inbox-rule-repository.js';
import {
  deleteRoutingTarget,
  listRoutingTargets,
  putRoutingTarget,
  readInboxSettings,
  updateInboxSettings,
} from '../inbox/inbox-settings-repository.js';
import * as fixtures from '../inbox/providers/__fixtures__/index.js';
import { endPools } from '../test-support/end-pools.js';
import { createQueue, createQueueClientFromConfiguration } from './queue.js';
import { channelTenant } from '../channel-access.js';
import { routeInboxItemToDocumentRequestSchema } from '../inbox/contract.js';
import { parseInboxItem } from './parse-inbox-item.js';
import { AUTO_ROUTE_PROVIDER, routeInboxItem } from './route-inbox-item.js';
import type { RouteInboxItemOutcome } from './route-inbox-item.js';
import { scanInboxItem } from './scan-inbox-item.js';
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
const scanJobs: ScanInboxItemJob[] = [];
const parseJobs: ParseInboxItemJob[] = [];

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
let partnerId = '';

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

async function upload(tenant: TenantContext, bytes: Buffer, name: string) {
  const path = join(store.temporaryDirectory(), name);
  await writeFile(path, bytes);
  const response = await service.upload({
    ...tenant,
    ...allEntities,
    file: { originalname: name, path, size: bytes.length },
  });
  // The scan job stands between the intake and the route now: an upload routes only after a clean verdict.
  await runScan(response.item.id);
  return response;
}

// The worker's scan handler on the job the intake enqueued, against a scanner that finds nothing.
async function runScan(itemId: string): Promise<void> {
  const data = scanJobs.find((job) => job.itemId === itemId);

  if (data === undefined) {
    return;
  }

  await scanInboxItem({
    blobs: store,
    data,
    enqueueParseInboxItem: async (job) => {
      parseJobs.push(job);
    },
    enqueueRouteInboxItem: (job) => sendRouteInboxItem(boss, job),
    metrics: new WorkerMetrics(),
    pool: apiPool,
    retry: { count: 0, limit: 3 },
    scanner: { scan: async () => ({ outcome: 'clean' }) },
  });
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
  await createQueue(boss, RERUN_INBOX_RULE_QUEUE, { policy: 'exclusive' });
  entityA = await createLegalEntity('Placeholder Holding');
  // The customer IČO of every fixture names entity A.
  await asTenant(owner, (transaction) =>
    transaction.query(
      'update app.legal_entity set registration_number = $2 where id = $1',
      [entityA, fixtures.CUSTOMER_ICO],
    ),
  );
  partnerId = await asTenant(owner, async (transaction) => {
    const created = await transaction.query<{ id: string }>(
      `insert into app.partner (organization_id, name, registration_number, default_line_category, created_by)
       values ($1, 'Placeholder Supplier', $2, 'services', $3)
       returning id`,
      [owner.organizationId, fixtures.SUPPLIER_ICO, owner.userId],
    );
    return created.rows[0]?.id ?? '';
  });

  directory = await mkdtemp(join(tmpdir(), 'bap-parse-inbox-integration-'));
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
    enqueueParseInboxItem: async () => undefined,
    enqueueRerunInboxRule: (job: RerunInboxRuleJob) =>
      sendRerunInboxRule(boss, job),
    enqueueRouteInboxItem: (job: RouteInboxItemJob) =>
      sendRouteInboxItem(boss, job),
    enqueueScanInboxItem: async (job) => {
      scanJobs.push(job);
    },
    enqueueSplitEmailItem: async () => undefined,
  });
});

afterAll(async () => {
  await boss.stop({ graceful: false });
  await endPools(apiPool, migratorPool);
  await container.stop();
  await rm(directory, { force: true, recursive: true });
});

async function putIsdocTarget(auto: 'always' | 'never'): Promise<void> {
  await putRoutingTarget(apiPool, {
    ...owner,
    body: {
      auto,
      autoThreshold: null,
      defaultAssigneeId: null,
      defaultLegalEntityId: null,
      destination: 'documents',
      documentKind: 'received_invoice',
      partnerPolicy: 'match_only',
      requiredFields: [],
    },
    detectedType: 'isdoc_invoice',
  });
}

function runParse(data: ParseInboxItemJob) {
  return parseInboxItem({
    blobs: store,
    data,
    enqueueRouteInboxItem: (job) => sendRouteInboxItem(boss, job),
    logger,
    metrics: new WorkerMetrics(),
    pool: apiPool,
  });
}

function parseJobFor(itemId: string): ParseInboxItemJob {
  const job = parseJobs.find((candidate) => candidate.itemId === itemId);

  if (job === undefined) {
    throw new Error('No parse job was enqueued.');
  }

  return job;
}

async function isdocRows(itemId: string) {
  return asTenant(owner, async (transaction) => {
    const rows = await transaction.query<{
      created_by: string;
      draft: Record<string, unknown>;
      id: string;
      issues: { code: string }[];
      legal_entity_id: string | null;
    }>(
      `select id, created_by, draft, issues, legal_entity_id from app.inbox_item_extraction
        where item_id = $1 and provider = 'isdoc' order by created_at, id`,
      [itemId],
    );
    return rows.rows;
  });
}

async function itemEntity(itemId: string): Promise<string | null> {
  return asTenant(owner, async (transaction) => {
    const item = await loadItem(transaction, itemId, null);
    return item?.legalEntityId ?? null;
  });
}

describe('parse_inbox_item', () => {
  afterEach(() => putIsdocTarget('never'));

  it('scans, parses and auto-routes an upload to a received invoice with lines, deductions and rounding', async () => {
    await putIsdocTarget('always');
    const uploaded = await upload(
      owner,
      fixtures.pohodaStyleIsdoc(),
      'invoice.isdoc',
    );
    const itemId = uploaded.item.id;
    // The scan hands an ISDOC to the parse under the uploader, and never routes it directly.
    const job = parseJobFor(itemId);
    expect(job).toMatchObject({
      itemId,
      organizationId: 'org-1',
      userId: owner.userId,
    });
    // Only the scan carries the deferred route; the parse decides it again.
    expect(job).not.toHaveProperty('routeRuleId');

    const outcome = await runParse(job);
    expect(outcome).toEqual({ issues: [], kind: 'parsed', routed: true });

    const [row] = await isdocRows(itemId);
    expect(row).toMatchObject({
      created_by: owner.userId,
      issues: [],
      legal_entity_id: entityA,
    });
    expect(row?.draft).toMatchObject({ kind: 'received_invoice', partnerId });
    // The parsed entity stays on the extraction row; the item's own entity is never written by the parse.
    expect(await itemEntity(itemId)).toBeNull();
    const events = (await detail(itemId))?.events.map((event) => event.kind);
    expect(events).toContain('extracted');

    const routed = await runRoute(await enqueuedRouteJob(itemId));
    expect(routed.kind).toBe('routed');
    const documentId = routed.kind === 'routed' ? routed.documentId : '';
    const invoice = await asTenant(owner, async (transaction) => {
      const lines = await transaction.query<{
        base_amount: string;
        category: string | null;
        line_kind: string;
        vat_mode: string;
      }>(
        `select base_amount::text, category, line_kind, vat_mode from app.invoice_line
          where document_id = $1 order by line_no`,
        [documentId],
      );
      const header = await transaction.query<{
        amount_due: string;
        rounding_amount: string;
      }>(
        'select rounding_amount::text, amount_due::text from app.invoice where document_id = $1',
        [documentId],
      );
      const document = await transaction.query<{
        kind: string;
        legal_entity_id: string;
        partner_id: string;
        reference: string;
      }>(
        'select kind, legal_entity_id, partner_id, reference from app.document where id = $1',
        [documentId],
      );
      return {
        document: document.rows[0],
        header: header.rows[0],
        lines: lines.rows,
      };
    });

    expect(invoice.document).toEqual({
      kind: 'received_invoice',
      legal_entity_id: entityA,
      partner_id: partnerId,
      reference: '260100001',
    });
    expect(invoice.lines).toEqual([
      {
        base_amount: '3000.0000',
        category: 'services',
        line_kind: 'item',
        vat_mode: 'standard',
      },
      {
        base_amount: '99.5000',
        category: 'services',
        line_kind: 'item',
        vat_mode: 'standard',
      },
      {
        base_amount: '1000.0000',
        category: null,
        line_kind: 'advance_deduction',
        vat_mode: 'standard',
      },
      {
        base_amount: '500.0000',
        category: null,
        line_kind: 'advance_deduction',
        vat_mode: 'outside_scope',
      },
    ]);
    // Generated by the database: gross 3741.44, rounding -0.44, advances 1710.
    expect(invoice.header).toEqual({
      amount_due: '2031.0000',
      rounding_amount: '-0.4400',
    });

    const autoRoute = (await extractionsOf(itemId)).find(
      (extraction) => extraction.provider === AUTO_ROUTE_PROVIDER,
    );
    expect(autoRoute?.issues).toEqual([]);
  });

  it('resolves a channel item and writes the parse as the channel', async () => {
    const channel = await createChannel(apiPool, {
      ...owner,
      body: { kind: 'api', name: 'Placeholder ERP' },
    });
    const channelId = channel?.id ?? '';
    const tenant = channelTenant('org-1', channelId);
    const bytes = fixtures.isdocInvoice({ id: 'FV-CHANNEL-1' });
    const path = join(store.temporaryDirectory(), 'channel.isdoc');
    await writeFile(path, bytes);
    const response = await service.intakeFile({
      ...tenant,
      channelId,
      externalId: 'erp-isdoc-1',
      file: { originalname: 'channel.isdoc', path, size: bytes.length },
      origin: null,
    });

    await runScan(response.itemId);
    const job = parseJobFor(response.itemId);
    expect(job).toMatchObject({ channelId, itemId: response.itemId });
    expect(job).not.toHaveProperty('userId');
    expect(await runParse(job)).toMatchObject({
      issues: [],
      kind: 'parsed',
      routed: false,
    });

    const [row] = await isdocRows(response.itemId);
    expect(row).toMatchObject({
      created_by: tenant.userId,
      legal_entity_id: entityA,
    });
    // Entities and partners came from the read-only system_automation pass, which a channel could never read.
    expect(row?.draft).toMatchObject({ kind: 'received_invoice', partnerId });
    const extracted = (await detail(response.itemId))?.events.find(
      (event) => event.kind === 'extracted',
    );
    expect(extracted?.actorUserId).toBeNull();
  });

  it('fails a demoted uploader before anything is written', async () => {
    const uploaded = await upload(
      admin,
      fixtures.isdocInvoice({ id: 'FV-DEMOTED-1' }),
      'demoted.isdoc',
    );
    const job = parseJobFor(uploaded.item.id);
    await asMigrator(
      "update auth.member set role = 'member' where id = 'member-2'",
    );

    try {
      await expect(runParse(job)).rejects.toThrow(/can no longer write/);
      expect(await isdocRows(uploaded.item.id)).toEqual([]);
    } finally {
      await asMigrator(
        "update auth.member set role = 'admin' where id = 'member-2'",
      );
    }
  });

  it('refuses to process an unscanned blob', async () => {
    const bytes = fixtures.isdocInvoice({ id: 'FV-UNSCANNED-1' });
    const path = join(store.temporaryDirectory(), 'unscanned.isdoc');
    await writeFile(path, bytes);
    const response = await service.upload({
      ...owner,
      ...allEntities,
      file: { originalname: 'unscanned.isdoc', path, size: bytes.length },
    });

    await expect(
      service.process({ ...owner, ...allEntities, itemId: response.item.id }),
    ).rejects.toMatchObject({ status: 409 });
    expect(parseJobs.some((job) => job.itemId === response.item.id)).toBe(
      false,
    );
  });

  it('copies the invoice from the named stored row and refuses a client invoice block', async () => {
    const uploaded = await upload(
      owner,
      fixtures.isdocInvoice({ id: 'FV-MANUAL-1' }),
      'manual.isdoc',
    );
    const itemId = uploaded.item.id;
    await runParse(parseJobFor(itemId));
    const parsedId = (await detail(itemId))?.parsed?.id ?? '';
    const document = {
      currencyCode: 'CZK',
      documentDate: '2026-09-01',
      kind: 'received_invoice' as const,
      legalEntityId: entityA,
      partnerId,
      title: 'Placeholder supplier invoice',
    };
    const clientInvoice = {
      lines: [
        {
          baseAmount: '1',
          category: 'goods' as const,
          description: 'Typed by a client',
          lineKind: 'item' as const,
          vatAmount: '0',
          vatMode: 'exempt' as const,
          vatRate: '0',
        },
      ],
      roundingAmount: '0',
    };
    const route = (body: Record<string, unknown>) =>
      service.routeToDocument({
        ...owner,
        ...allEntities,
        body: routeInboxItemToDocumentRequestSchema.parse({
          fileBlobIds: [uploaded.files[0]?.blobId],
          ...body,
        }),
        itemId,
      });

    expect(
      routeInboxItemToDocumentRequestSchema.safeParse({
        document: { ...document, invoice: clientInvoice },
        fileBlobIds: [uploaded.files[0]?.blobId],
        parsedExtractionId: parsedId,
      }).success,
    ).toBe(false);
    await expect(
      route({ document: { ...document, invoice: clientInvoice } }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      route({
        document,
        parsedExtractionId: '00000000-0000-4000-8000-000000000999',
      }),
    ).rejects.toMatchObject({ status: 422 });

    const routed = await route({
      document,
      lineCategory: 'goods',
      parsedExtractionId: parsedId,
    });
    expect(routed?.item.status).toBe('routed');
    const lines = await asTenant(owner, async (transaction) => {
      const result = await transaction.query<{
        category: string;
        description: string;
      }>(
        'select category, description from app.invoice_line where document_id = $1 order by line_no',
        [routed?.item.documentId],
      );
      return result.rows;
    });
    expect(lines).toEqual([
      { category: 'goods', description: 'Placeholder service' },
      { category: 'goods', description: 'Placeholder goods' },
    ]);
  });
});
