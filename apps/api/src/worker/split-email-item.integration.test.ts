import {
  mkdtemp,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

import { ConflictException } from '@nestjs/common';
import {
  bootstrapDatabaseRoles,
  createDatabasePool,
  runInTenantContext,
  runMigrations,
} from '@bap/db';
import type { TenantContext } from '@bap/db';
import type { DatabaseConfiguration, DatabaseRole } from '@bap/db/config';
import type { DatabasePool } from '@bap/db/pool';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import type * as Mailparser from 'mailparser';
import type { ParsedMail, SimpleParserOptions } from 'mailparser';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  blobStorageKey,
  createBlobDirectories,
  FilesystemBlobStore,
} from '../blobs/blob-store.js';
import { channelTenant } from '../channel-access.js';
import type {
  RouteInboxItemJob,
  SplitEmailItemJob,
} from '../inbox/contract.js';
import { InboxService } from '../inbox/inbox.service.js';
import {
  adoptRule,
  approveItem,
  attachItem,
  assignItem,
  createChannel,
  createRule,
  deleteRule,
  listRules,
  orderRules,
  readRule,
  updateRule,
  deleteRoutingTarget,
  discardItem,
  issueCredential,
  listChannels,
  listItems,
  listRoutingTargets,
  putRoutingTarget,
  readBlob,
  readChannel,
  readChannelPrincipal,
  readInboxSettings,
  readItem,
  readProviderInput,
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
  type InboxRepository,
} from '../inbox/inbox-repository.js';
import * as fixtures from '../inbox/providers/__fixtures__/index.js';
import type { BlobScanner, ScanOutcome } from '../scanning/clamd-client.js';
import { endPools } from '../test-support/end-pools.js';
import {
  runInboxMaintenance,
  type InboxMaintenanceReport,
} from './inbox-maintenance.js';
import {
  MAX_ATTACHMENT_BYTES,
  splitEmailItem,
  SplitEmailError,
  textFromHtml,
} from './split-email-item.js';
import { WorkerMetrics } from './worker-metrics.js';

// mailparser rejects no byte sequence, so a nested part carrying this header stands in for a parser failure.
const UNPARSABLE_MARKER = 'X-BAP-Test: unparsable';

vi.mock('mailparser', async (importOriginal) => {
  const actual = await importOriginal<typeof Mailparser>();
  // The worker only uses the promise overload, so the stand-in narrows to it.
  const simpleParser = (
    input: Parameters<typeof actual.simpleParser>[0],
    options?: SimpleParserOptions,
  ): Promise<ParsedMail> =>
    Buffer.isBuffer(input) && input.includes(UNPARSABLE_MARKER)
      ? Promise.reject(new Error('unparsable nested message'))
      : actual.simpleParser(input, options);
  return { ...actual, simpleParser };
});

const postgresImage =
  'pgvector/pgvector:pg18@sha256:2ba9ca5f2e7daa0f0e7723cba1ee9167bab54efd3640516a44ac1a928dd67e7a';
const testPassword = 'test-only-database-credential';
const QUOTA = 200_000_000;
const INTAKE_DOMAIN = 'in.bap.invalid';
const EICAR =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

let apiPool: DatabasePool;
let container: StartedPostgreSqlContainer;
let migratorPool: DatabasePool;
let directory: string;
let store: FilesystemBlobStore;
let service: InboxService;
let channelId = '';
const enqueued: SplitEmailItemJob[] = [];
const routeJobs: RouteInboxItemJob[] = [];

const owner: TenantContext = {
  organizationId: 'org-1',
  role: 'owner',
  userId: 'user-1',
};
const allEntities = { legalEntityIds: null };

// Answers like clamd would: FOUND for the EICAR string, OK otherwise, or ERROR when the test says so.
class FakeScanner implements BlobScanner {
  calls = 0;
  failOnCall: number | null = null;

  async scan(source: Readable): Promise<ScanOutcome> {
    this.calls += 1;
    const chunks: Buffer[] = [];
    for await (const chunk of source) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    if (this.failOnCall !== null && this.calls >= this.failOnCall) {
      return { outcome: 'error', reason: 'stream: Scan failed. ERROR' };
    }
    return Buffer.concat(chunks).toString('latin1').includes(EICAR)
      ? { outcome: 'infected', signature: 'Win.Test.EICAR_HDB-1' }
      : { outcome: 'clean' };
  }
}

interface MimePart {
  content: Buffer;
  contentType: string;
  filename?: string;
}

// A minimal multipart/mixed builder: enough MIME for mailparser, nothing a mail client would add.
function buildMime(input: {
  attachments?: MimePart[];
  from?: string;
  text?: string;
}): Buffer {
  const boundary = `----bap-${Math.random().toString(16).slice(2)}`;
  const lines: string[] = [
    `From: ${input.from ?? 'Sender <sender@example.org>'}`,
    'To: in-0123456789abcdef0123456789abcdef@in.bap.invalid',
    'Subject: Invoice',
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    input.text ?? '',
  ];

  for (const attachment of input.attachments ?? []) {
    lines.push(
      `--${boundary}`,
      attachment.filename === undefined
        ? `Content-Type: ${attachment.contentType}`
        : `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
      attachment.contentType === 'message/rfc822'
        ? 'Content-Transfer-Encoding: 8bit'
        : 'Content-Transfer-Encoding: base64',
      attachment.filename === undefined
        ? 'Content-Disposition: attachment'
        : `Content-Disposition: attachment; filename="${attachment.filename}"`,
      '',
      attachment.contentType === 'message/rfc822'
        ? attachment.content.toString('utf8')
        : attachment.content.toString('base64'),
    );
  }

  lines.push(`--${boundary}--`, '');
  return Buffer.from(lines.join('\r\n'), 'utf8');
}

// A multipart/related HTML body with one cid-referenced image and, optionally, a real attachment beside them.
function buildRelatedMime(input: {
  attachments?: MimePart[];
  html: string;
  image: Buffer;
}): Buffer {
  const related = `----bap-related-${Math.random().toString(16).slice(2)}`;
  const mixed = `----bap-mixed-${Math.random().toString(16).slice(2)}`;
  const lines: string[] = [
    'From: Sender <sender@example.org>',
    'To: in-0123456789abcdef0123456789abcdef@in.bap.invalid',
    'Subject: Invoice',
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    '',
    `--${mixed}`,
    `Content-Type: multipart/related; boundary="${related}"`,
    '',
    `--${related}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    input.html,
    `--${related}`,
    'Content-Type: image/png; name="logo.png"',
    'Content-Transfer-Encoding: base64',
    'Content-ID: <logo@bap.invalid>',
    'Content-Disposition: inline; filename="logo.png"',
    '',
    input.image.toString('base64'),
    `--${related}--`,
  ];

  for (const attachment of input.attachments ?? []) {
    lines.push(
      `--${mixed}`,
      `Content-Type: ${attachment.contentType}; name="${attachment.filename ?? 'part'}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${attachment.filename ?? 'part'}"`,
      '',
      attachment.content.toString('base64'),
    );
  }

  lines.push(`--${mixed}--`, '');
  return Buffer.from(lines.join('\r\n'), 'utf8');
}

function nestedMessage(depth: number): Buffer {
  return depth === 0
    ? buildMime({ text: 'innermost' })
    : buildMime({
        attachments: [
          { content: nestedMessage(depth - 1), contentType: 'message/rfc822' },
        ],
        text: `level ${depth}`,
      });
}

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

async function intake(bytes: Buffer, externalId: string): Promise<string> {
  const path = join(store.temporaryDirectory(), `stage-${externalId}`);
  await writeFile(path, bytes);
  const response = await service.intakeEmail({
    ...channelTenant('org-1', channelId),
    channelId,
    externalId,
    origin: 'abcdef01',
    size: bytes.length,
    temporaryPath: path,
  });
  return response.itemId;
}

function run(
  itemId: string,
  scanner: BlobScanner,
  retry = { count: 0, limit: 3 },
): Promise<void> {
  return splitEmailItem({
    blobs: store,
    data: { channelId, itemId, organizationId: 'org-1' },
    enqueueRouteInboxItem: async (job) => {
      routeJobs.push(job);
    },
    metrics: new WorkerMetrics(),
    pool: apiPool,
    quotaBytes: QUOTA,
    retry,
    scanner,
  });
}

async function children(parentId: string) {
  const rows = await runInTenantContext(apiPool, owner, (transaction) =>
    transaction.query<{
      external_id: string;
      id: string;
      payload_kind: string;
      scan_status: string;
      sender: string | null;
      status: string;
    }>(
      `select i.id, i.external_id, i.payload_kind, i.status, i.sender, b.scan_status
         from app.inbox_item as i
         join app.inbox_item_file as f on f.item_id = i.id
         join app.blob as b on b.id = f.blob_id
        where i.parent_item_id = $1
        order by i.external_id`,
      [parentId],
    ),
  );
  return rows.rows;
}

async function parentState(itemId: string) {
  const detail = await readItem(apiPool, {
    ...owner,
    ...allEntities,
    itemId,
  });
  const row = await runInTenantContext(apiPool, owner, (transaction) =>
    transaction.query<{ scan_status: string; sender: string | null }>(
      `select i.sender, b.scan_status
         from app.inbox_item as i
         join app.inbox_item_file as f on f.item_id = i.id
         join app.blob as b on b.id = f.blob_id
        where i.id = $1`,
      [itemId],
    ),
  );
  return {
    events: detail?.events.map((event) => [event.kind, event.reason]) ?? [],
    issues: detail?.extraction?.issues.map((issue) => issue.code) ?? [],
    scanStatus: row.rows[0]?.scan_status,
    sender: row.rows[0]?.sender ?? null,
    status: detail?.item.status,
  };
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
      values ('user-1', 'Owner', 'owner@example.test', true)
    `);
    await migrator.query(
      "insert into auth.organization (id, name, slug) values ('org-1', 'One', 'one')",
    );
    await migrator.query(`
      insert into auth.member (id, organization_id, user_id, role)
      values ('member-1', 'org-1', 'user-1', 'owner')
    `);
    await migrator.query('commit');
  } finally {
    migrator.release();
  }

  await rootPool.end();
  apiPool = createDatabasePool(configurationFor('bap_api'));
  directory = await mkdtemp(join(tmpdir(), 'bap-split-email-'));
  await createBlobDirectories(directory);
  store = new FilesystemBlobStore(directory);
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
  service = new InboxService(repository, store, QUOTA, INTAKE_DOMAIN, {
    enqueueRerunInboxRule: async () => undefined,
    enqueueRouteInboxItem: async () => undefined,
    enqueueSplitEmailItem: async (job) => {
      enqueued.push(job);
    },
  });
});

afterAll(async () => {
  await endPools(apiPool, migratorPool);
  await container.stop();
  await rm(directory, { force: true, recursive: true });
});

describe('email channel', () => {
  it('creates an email channel and issues its one address under the intake domain', async () => {
    const created = await service.createChannel({
      ...owner,
      body: { hintKind: 'isdoc_invoice', kind: 'email', name: 'Mail' },
    });
    channelId = created?.id ?? '';
    expect(created).toMatchObject({ emailAddress: null, kind: 'email' });

    const issued = await service.issueCredential({ ...owner, channelId });
    expect(issued.secret).toMatch(/^in-[0-9a-f]{32}@in\.bap\.invalid$/);
    expect(issued.displayPrefix).toBe(issued.secret.slice(3, 11));

    const channel = await service.readChannel({ ...owner, channelId });
    expect(channel?.emailAddress).toBe(issued.secret);
    expect(channel?.credentials).toHaveLength(1);

    // One active address at a time; a reissue needs a revoke first.
    await expect(
      service.issueCredential({ ...owner, channelId }),
    ).rejects.toBeInstanceOf(ConflictException);
    await service.revokeCredential({
      ...owner,
      channelId,
      credentialId: issued.credentialId,
    });
    expect(
      (await service.readChannel({ ...owner, channelId }))?.emailAddress,
    ).toBeNull();
    const reissued = await service.issueCredential({ ...owner, channelId });
    expect(reissued.secret).not.toBe(issued.secret);
  });

  it('stores an email as a received message/rfc822 item, enqueues the split and replays by token', async () => {
    const bytes = buildMime({ text: 'hello' });
    const itemId = await intake(bytes, 'token-replay');

    const detail = await readItem(apiPool, {
      ...owner,
      ...allEntities,
      itemId,
    });
    expect(detail?.item).toMatchObject({
      channelId,
      channelKind: 'email',
      hintKind: 'isdoc_invoice',
      origin: 'abcdef01',
      payloadKind: 'email',
      status: 'received',
    });
    expect(detail?.files[0]).toMatchObject({
      byteSize: bytes.length,
      mediaType: 'message/rfc822',
      position: 1,
    });
    expect(detail?.extraction).toBeNull();
    expect(detail?.events.map((event) => event.kind)).toEqual(['received']);
    expect(enqueued).toEqual([{ channelId, itemId, organizationId: 'org-1' }]);
    expect(await readdir(store.temporaryDirectory())).toEqual([]);

    // The same token again answers the same item and does not enqueue twice past received.
    enqueued.length = 0;
    expect(await intake(buildMime({ text: 'other' }), 'token-replay')).toBe(
      itemId,
    );
    expect(enqueued).toEqual([{ channelId, itemId, organizationId: 'org-1' }]);

    // The same bytes under another token are an exact duplicate, discarded on the spot.
    const duplicateId = await intake(bytes, 'token-duplicate');
    expect((await parentState(duplicateId)).status).toBe('discarded');
  });
});

describe('splitEmailItem', () => {
  it('splits two attachments into scanned, sniffed children and settles the parent', async () => {
    const scanner = new FakeScanner();
    const itemId = await intake(
      buildMime({
        attachments: [
          {
            content: fixtures.pdf(),
            contentType: 'application/pdf',
            filename: 'invoice.pdf',
          },
          {
            content: fixtures.text(),
            contentType: 'text/plain',
            filename: 'note.txt',
          },
        ],
        text: 'see attached',
      }),
      'token-two',
    );

    await run(itemId, scanner);

    expect(await parentState(itemId)).toMatchObject({
      events: [
        ['received', null],
        ['scanned', null],
        ['classified', null],
      ],
      scanStatus: 'clean',
      sender: 'sender@example.org',
      status: 'needs_review',
    });
    const parts = await children(itemId);
    expect(parts).toMatchObject([
      {
        external_id: `${itemId}:1`,
        payload_kind: 'file',
        scan_status: 'clean',
        sender: 'sender@example.org',
        status: 'needs_review',
      },
      {
        external_id: `${itemId}:2`,
        payload_kind: 'file',
        scan_status: 'clean',
        status: 'needs_review',
      },
    ]);
    const first = await readItem(apiPool, {
      ...owner,
      ...allEntities,
      itemId: parts[0]?.id ?? '',
    });
    expect(first?.item).toMatchObject({
      channelId,
      channelKind: 'email',
      detectedType: 'pdf',
      hintKind: 'isdoc_invoice',
      origin: 'abcdef01',
    });
    expect(first?.files[0]).toMatchObject({
      mediaType: 'application/pdf',
      originalFilename: 'invoice.pdf',
    });
    expect(first?.events.map((event) => event.kind)).toEqual([
      'received',
      'scanned',
      'classified',
    ]);
    // Parent, two children: three scans, no more.
    expect(scanner.calls).toBe(3);
    expect(await readdir(store.temporaryDirectory())).toEqual([]);

    // Running again is a no-op: the parent is settled and no child is created twice.
    await run(itemId, scanner);
    expect((await children(itemId)).length).toBe(2);
    expect(scanner.calls).toBe(3);
  });

  it('makes a text child when there is no attachment and none when the message is empty', async () => {
    const textId = await intake(
      buildMime({ text: 'Invoice 42 is attached in the next mail.' }),
      'token-text',
    );
    await run(textId, new FakeScanner());
    expect(await children(textId)).toMatchObject([
      { payload_kind: 'text', scan_status: 'clean', status: 'needs_review' },
    ]);
    const blob = await readItem(apiPool, {
      ...owner,
      ...allEntities,
      itemId: (await children(textId))[0]?.id ?? '',
    });
    expect(blob?.files[0]?.mediaType).toBe('text/plain');

    const emptyId = await intake(
      buildMime({ from: 'nobody', text: '   ' }),
      'token-empty',
    );
    await run(emptyId, new FakeScanner());
    expect(await children(emptyId)).toEqual([]);
    expect(await parentState(emptyId)).toMatchObject({
      events: [
        ['received', null],
        ['scanned', null],
        ['classified', null],
      ],
      issues: ['empty'],
      sender: null,
      status: 'needs_review',
    });
  });

  it('discards a cid-referenced inline image as decoration and keeps the body text beside a real attachment', async () => {
    const scanner = new FakeScanner();
    const itemId = await intake(
      buildRelatedMime({
        attachments: [
          {
            content: Buffer.from('the invoice beside the logo'),
            contentType: 'text/plain',
            filename: 'invoice.txt',
          },
        ],
        html: '<html><body><p>Invoice attached</p><img src="cid:logo@bap.invalid"></body></html>',
        image: fixtures.png(),
      }),
      'token-inline-image',
    );

    await run(itemId, scanner);

    const parts = await children(itemId);
    expect(parts).toMatchObject([
      {
        external_id: `${itemId}:1`,
        payload_kind: 'file',
        scan_status: 'clean',
        status: 'discarded',
      },
      {
        external_id: `${itemId}:2`,
        payload_kind: 'file',
        scan_status: 'clean',
        status: 'needs_review',
      },
    ]);
    const image = await readItem(apiPool, {
      ...owner,
      ...allEntities,
      itemId: parts[0]?.id ?? '',
    });
    // Stored under its declared image type with its blob scanned, never sniffed, discarded as decoration.
    expect(image?.files[0]).toMatchObject({
      mediaType: 'image/png',
      originalFilename: 'logo.png',
      scanStatus: 'clean',
    });
    expect(image?.extraction).toBeNull();
    expect(image?.events.map((event) => [event.kind, event.reason])).toEqual([
      ['received', null],
      ['scanned', null],
      ['discarded', 'decorative_image'],
    ]);
    expect(image?.item.detectedType).toBeNull();
    // Parent, image, attachment: every blob is scanned.
    expect(scanner.calls).toBe(3);
    expect((await parentState(itemId)).status).toBe('needs_review');

    // With nothing but decoration around it, the HTML body becomes the text child.
    const bodyOnlyId = await intake(
      buildRelatedMime({
        html: '<html><body><p>Invoice &amp; receipt follow</p><img src="cid:logo@bap.invalid"></body></html>',
        image: fixtures.png(),
      }),
      'token-inline-image-only',
    );
    await run(bodyOnlyId, new FakeScanner());
    const bodyParts = await children(bodyOnlyId);
    expect(bodyParts).toMatchObject([
      { payload_kind: 'file', status: 'discarded' },
      { payload_kind: 'text', status: 'needs_review' },
    ]);
    const text = await readItem(apiPool, {
      ...owner,
      ...allEntities,
      itemId: bodyParts[1]?.id ?? '',
    });
    expect(text?.files[0]?.mediaType).toBe('text/plain');
    expect(
      (
        await store.stat(
          (
            await readBlob(apiPool, {
              ...owner,
              ...allEntities,
              blobId: text?.files[0]?.blobId ?? '',
            })
          )?.storageKey ?? '',
        )
      )?.byteSize,
    ).toBe(Buffer.byteLength('Invoice & receipt follow'));
  });

  it('derives the text child of an HTML-only message from a bounded tag strip', async () => {
    const boundary = '----bap-alt';
    const bytes = Buffer.from(
      [
        'From: Sender <sender@example.org>',
        'To: in-0123456789abcdef0123456789abcdef@in.bap.invalid',
        'Subject: Invoice',
        'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/html; charset=utf-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        '<html><head><style>p { color: red }</style></head>',
        '<body><h1>Invoice   42</h1>\n<p>Amount: 10 &lt; 20 &amp; &quot;paid&quot; &#39;now&#39;</p>',
        '<script>alert(1)</script><img src="x" onerror="alert(1)"></body></html>',
        `--${boundary}--`,
        '',
      ].join('\r\n'),
      'utf8',
    );
    const itemId = await intake(bytes, 'token-html-only');

    await run(itemId, new FakeScanner());

    const parts = await children(itemId);
    expect(parts).toMatchObject([
      { payload_kind: 'text', scan_status: 'clean', status: 'needs_review' },
    ]);
    const blob = await readBlob(apiPool, {
      ...owner,
      ...allEntities,
      blobId:
        (
          await readItem(apiPool, {
            ...owner,
            ...allEntities,
            itemId: parts[0]?.id ?? '',
          })
        )?.files[0]?.blobId ?? '',
    });
    expect(blob?.mediaType).toBe('text/plain');
    const stored: Buffer[] = [];
    for await (const chunk of store.open(blob?.storageKey ?? '')) {
      stored.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    expect(Buffer.concat(stored).toString('utf8')).toBe(
      'Invoice 42 Amount: 10 < 20 & "paid" \'now\'',
    );
  });

  it('strips tags within the first megabyte only and decodes just the five basic entities', () => {
    expect(textFromHtml('<p>a &nbsp; &copy; b</p>')).toBe('a &nbsp; &copy; b');
    expect(textFromHtml('&lt;b&gt;bold&lt;/b&gt;')).toBe('<b>bold</b>');
    const oversize = `<p>${'x'.repeat(1_000_000)}<b>tail</b></p>`;
    // The cut lands inside the text, so the unclosed tail never reaches the strip.
    expect(textFromHtml(oversize)).toHaveLength(1_000_000 - '<p>'.length);
  });

  it('keeps the first twenty attachments and marks the parent too_large past the cap', async () => {
    const attachments = Array.from({ length: 21 }, (_, index) => ({
      content: Buffer.from(`attachment number ${index + 1}\n`),
      contentType: 'text/plain',
      filename: `part-${index + 1}.txt`,
    }));
    const itemId = await intake(buildMime({ attachments }), 'token-21');

    await run(itemId, new FakeScanner());

    expect((await children(itemId)).length).toBe(20);
    expect(await parentState(itemId)).toMatchObject({
      events: [
        ['received', null],
        ['scanned', null],
        ['failed', 'too_large'],
        ['classified', null],
      ],
      status: 'needs_review',
    });
  });

  it('refuses an oversize attachment and a message nested past ten levels', async () => {
    const oversizeId = await intake(
      buildMime({
        attachments: [
          {
            content: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 1),
            contentType: 'application/octet-stream',
            filename: 'huge.bin',
          },
        ],
      }),
      'token-oversize',
    );
    await run(oversizeId, new FakeScanner());
    expect(await children(oversizeId)).toEqual([]);
    expect((await parentState(oversizeId)).events).toContainEqual([
      'failed',
      'too_large',
    ]);

    const nestedId = await intake(nestedMessage(11), 'token-nested');
    await run(nestedId, new FakeScanner());
    expect(await children(nestedId)).toEqual([]);
    expect((await parentState(nestedId)).events).toContainEqual([
      'failed',
      'too_large',
    ]);

    // Ten levels are within the cap: the nested message is a child like any attachment.
    const withinId = await intake(nestedMessage(10), 'token-nested-ok');
    await run(withinId, new FakeScanner());
    expect((await children(withinId)).length).toBe(1);
  });

  it('refuses a child blob that would exceed a tightened organization quota, though the platform quota alone would admit it', async () => {
    const attachmentBytes = 5000;
    const marker = 'quota-guard-content';
    const content = Buffer.concat([
      Buffer.from(marker),
      Buffer.alloc(attachmentBytes - marker.length, 7),
    ]);

    // Intake first, at the wide platform quota, so the parent .eml blob is already committed and counted.
    const itemId = await intake(
      buildMime({
        attachments: [
          {
            content,
            contentType: 'application/octet-stream',
            filename: 'quota-check.bin',
          },
        ],
      }),
      'token-quota',
    );

    const before = await readInboxSettings(apiPool, {
      ...owner,
      platformQuotaBytes: QUOTA,
    });
    // Tightened just below what the child attachment needs; QUOTA (the platform env value) is far above it.
    const tightQuota = before.usedBytes + attachmentBytes - 1;
    await updateInboxSettings(apiPool, {
      ...owner,
      blobQuotaBytes: tightQuota,
      platformQuotaBytes: QUOTA,
    });

    try {
      // The last attempt, the same as the too_large and oversize cases: the refusal is what gets recorded.
      await expect(
        run(itemId, new FakeScanner(), { count: 3, limit: 3 }),
      ).rejects.toMatchObject({ code: 'store_failed' });
      expect(await children(itemId)).toEqual([]);
      expect((await parentState(itemId)).status).toBe('failed');
    } finally {
      await updateInboxSettings(apiPool, {
        ...owner,
        blobQuotaBytes: null,
        platformQuotaBytes: QUOTA,
      });
    }
  });

  it('fails with parse_failed when a nested message/rfc822 part does not parse', async () => {
    const itemId = await intake(
      buildMime({
        attachments: [
          {
            content: Buffer.from(
              `${UNPARSABLE_MARKER}\r\nSubject: broken\r\n\r\nbody`,
            ),
            contentType: 'message/rfc822',
          },
        ],
        text: 'forwarded',
      }),
      'token-nested-broken',
    );

    await expect(
      run(itemId, new FakeScanner(), { count: 3, limit: 3 }),
    ).rejects.toMatchObject({ code: 'parse_failed' });
    expect(await children(itemId)).toEqual([]);
    expect(await parentState(itemId)).toMatchObject({
      scanStatus: 'clean',
      status: 'failed',
    });
    expect(await readdir(store.temporaryDirectory())).toEqual([]);
  });

  it('is a no-op for a parent a person discarded or decided before the split ran', async () => {
    const scanner = new FakeScanner();
    const itemId = await intake(
      buildMime({ text: 'discarded before the worker got to it' }),
      'token-user-discarded',
    );
    const discarded = await service.discardItem({
      ...owner,
      ...allEntities,
      itemId,
      reason: 'irrelevant',
    });
    expect(discarded?.item.status).toBe('discarded');

    // The channel update policy refuses a row a person decided, whatever the statement says.
    const refused = await runInTenantContext(
      apiPool,
      channelTenant('org-1', channelId),
      (transaction) =>
        transaction.query(
          "update app.inbox_item set status = 'processing', updated_at = now() where id = $1",
          [itemId],
        ),
    );
    expect(refused.rowCount).toBe(0);

    // A discarded parent is past received: nothing scanned, nothing created, no event added.
    await run(itemId, scanner);
    expect(scanner.calls).toBe(0);
    expect(await children(itemId)).toEqual([]);
    expect(await parentState(itemId)).toMatchObject({
      events: [
        ['received', null],
        ['discarded', 'irrelevant'],
      ],
      scanStatus: 'not_scanned',
      status: 'discarded',
    });

    // A row a person decided is invisible to the channel's FOR UPDATE read, whatever its status says.
    const decidedId = await intake(
      buildMime({ text: 'decided before the worker got to it' }),
      'token-user-decided',
    );
    const root = createDatabasePool(configurationFor('postgres'));
    try {
      await root.query(
        `update app.inbox_item
            set decided_by_kind = 'user', decided_by_user_id = 'user-1'
          where id = $1`,
        [decidedId],
      );
    } finally {
      await root.end();
    }
    await run(decidedId, scanner);
    expect(scanner.calls).toBe(0);
    expect(await children(decidedId)).toEqual([]);
    expect(await parentState(decidedId)).toMatchObject({
      events: [['received', null]],
      scanStatus: 'not_scanned',
      status: 'received',
    });
  });

  it('quarantines an infected attachment as a discarded child and an infected message as a discarded parent', async () => {
    const childId = await intake(
      buildMime({
        attachments: [
          {
            content: Buffer.from(EICAR),
            contentType: 'application/octet-stream',
            filename: 'eicar.com',
          },
          {
            content: Buffer.from('a harmless note beside the test file'),
            contentType: 'text/plain',
            filename: 'ok.txt',
          },
        ],
      }),
      'token-eicar-child',
    );
    await run(childId, new FakeScanner());
    const parts = await children(childId);
    expect(parts).toMatchObject([
      { scan_status: 'infected', status: 'discarded' },
      { scan_status: 'clean', status: 'needs_review' },
    ]);
    const infected = await readItem(apiPool, {
      ...owner,
      ...allEntities,
      itemId: parts[0]?.id ?? '',
    });
    expect(infected?.events.map((event) => [event.kind, event.reason])).toEqual(
      [
        ['received', null],
        ['scanned', null],
        ['discarded', 'policy_rejected'],
      ],
    );
    expect(infected?.extraction).toBeNull();

    // The blob routes refuse the quarantined bytes.
    await expect(
      service.openBlob({
        ...owner,
        ...allEntities,
        blobId: infected?.files[0]?.blobId ?? '',
        inline: false,
      }),
    ).rejects.toMatchObject({ message: 'blob_quarantined', status: 409 });

    const parentId = await intake(
      buildMime({ text: `payload ${EICAR}` }),
      'token-eicar-parent',
    );
    await run(parentId, new FakeScanner());
    expect(await children(parentId)).toEqual([]);
    expect(await parentState(parentId)).toMatchObject({
      events: [
        ['received', null],
        ['scanned', null],
        ['discarded', 'policy_rejected'],
      ],
      scanStatus: 'infected',
      status: 'discarded',
    });
  });

  it('retries on a scanner error without a verdict, resumes a partial split and fails on the last attempt', async () => {
    const scanner = new FakeScanner();
    scanner.failOnCall = 3;
    const itemId = await intake(
      buildMime({
        attachments: [
          {
            content: Buffer.from('first'),
            contentType: 'text/plain',
            filename: 'a.txt',
          },
          {
            content: Buffer.from('second'),
            contentType: 'text/plain',
            filename: 'b.txt',
          },
        ],
      }),
      'token-retry',
    );

    // The parent and the first child scan; the second child's scan fails and the job throws its code only.
    await expect(run(itemId, scanner)).rejects.toMatchObject({
      code: 'scan_failed',
      message: 'split_email_item failed: scan_failed',
    });
    expect((await children(itemId)).length).toBe(1);
    expect(await parentState(itemId)).toMatchObject({
      scanStatus: 'clean',
      status: 'processing',
    });
    expect(await readdir(store.temporaryDirectory())).toEqual([]);

    // A retry resumes: the parent is not scanned again and the first child is not created twice.
    const retry = new FakeScanner();
    await run(itemId, retry, { count: 1, limit: 3 });
    expect((await children(itemId)).length).toBe(2);
    expect(retry.calls).toBe(1);
    expect((await parentState(itemId)).status).toBe('needs_review');

    // On the last attempt an unanswered parent scan is recorded as failed on the blob and the item.
    const exhausted = new FakeScanner();
    exhausted.failOnCall = 1;
    const failedId = await intake(
      buildMime({ text: 'never scanned' }),
      'token-exhausted',
    );
    await expect(
      run(failedId, exhausted, { count: 3, limit: 3 }),
    ).rejects.toBeInstanceOf(SplitEmailError);
    expect(await parentState(failedId)).toMatchObject({
      events: [
        ['received', null],
        ['failed', null],
      ],
      scanStatus: 'failed',
      status: 'failed',
    });
    await expect(
      service.openBlob({
        ...owner,
        ...allEntities,
        blobId:
          (
            await readItem(apiPool, {
              ...owner,
              ...allEntities,
              itemId: failedId,
            })
          )?.files[0]?.blobId ?? '',
        inline: false,
      }),
    ).rejects.toMatchObject({ message: 'blob_quarantined' });
  });

  it('fails the job for a disabled channel before touching the item', async () => {
    const itemId = await intake(buildMime({ text: 'late' }), 'token-disabled');
    await service.updateChannel({
      ...owner,
      body: { enabled: false },
      channelId,
    });

    await expect(run(itemId, new FakeScanner())).rejects.toMatchObject({
      code: 'channel_unavailable',
    });
    expect((await parentState(itemId)).status).toBe('received');
  });
});

describe('inbox maintenance', () => {
  const quiet = {
    debug: () => undefined,
    error: () => undefined,
    log: () => undefined,
  };
  const requeued: SplitEmailItemJob[] = [];

  function tick(): Promise<InboxMaintenanceReport> {
    return runInboxMaintenance({
      blobs: store,
      data: {},
      enqueueSplitEmailItem: async (job) => {
        requeued.push(job);
      },
      logger: quiet,
      metrics: new WorkerMetrics(),
      pool: apiPool,
    });
  }

  async function backdate(
    itemId: string,
    column: 'received_at' | 'updated_at',
  ) {
    const root = createDatabasePool(configurationFor('postgres'));
    try {
      await root.query(
        `update app.inbox_item set ${column} = now() - interval '2 hours' where id = $1`,
        [itemId],
      );
    } finally {
      await root.end();
    }
  }

  it('raises inside a tenant transaction and runs only from the organization-less pool', async () => {
    await service.updateChannel({
      ...owner,
      body: { enabled: true },
      channelId,
    });
    await expect(
      runInTenantContext(apiPool, owner, (transaction) =>
        transaction.query(
          "select app.reap_stalled_inbox_items('60 minutes', 1)",
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    const report = await tick();
    expect(report.failedTasks).toEqual([]);
  });

  it('reaps a stale processing item and the guarded split update leaves it failed', async () => {
    // A fresh processing item is never reaped: the clock starts at the first attempt.
    const freshId = await intake(buildMime({ text: 'fresh' }), 'token-fresh');
    const reaper = new FakeScanner();
    reaper.failOnCall = 1;
    await expect(run(freshId, reaper)).rejects.toMatchObject({
      code: 'scan_failed',
    });
    expect((await parentState(freshId)).status).toBe('processing');
    expect((await tick()).reapedItemIds).not.toContain(freshId);

    // The reaper runs while the split is mid-flight: the scan hook backdates the item and ticks.
    const itemId = await intake(
      buildMime({ text: 'stalled' }),
      'token-stalled',
    );
    const reaped: string[] = [];
    const scanner = new FakeScanner();
    const scan = scanner.scan.bind(scanner);
    // The parent scan and the child scan both run the hook; the second tick finds the item already failed.
    scanner.scan = async (source) => {
      const verdict = await scan(source);
      await backdate(itemId, 'updated_at');
      reaped.push(...(await tick()).reapedItemIds);
      return verdict;
    };

    await expect(run(itemId, scanner)).rejects.toMatchObject({
      code: 'item_unavailable',
    });
    expect(reaped).toEqual([itemId]);
    expect(await parentState(itemId)).toMatchObject({
      // The tick ran inside the scan hook, before the verdict was recorded.
      events: [
        ['received', null],
        ['failed', 'stalled'],
        ['scanned', null],
      ],
      status: 'failed',
    });
    const actor = await runInTenantContext(apiPool, owner, (transaction) =>
      transaction.query<{ actor_user_id: string | null }>(
        "select actor_user_id from app.inbox_event where item_id = $1 and reason = 'stalled'",
        [itemId],
      ),
    );
    expect(actor.rows).toEqual([{ actor_user_id: null }]);
    // The child the split created before the guard fired survives; the parent is not resurrected.
    expect((await children(itemId)).map((child) => child.status)).toEqual([
      'needs_review',
    ]);
    await run(itemId, new FakeScanner());
    expect((await parentState(itemId)).status).toBe('failed');
  });

  it('requeues a received email parent past the grace period with the item id as its key', async () => {
    requeued.length = 0;
    const stuckId = await intake(buildMime({ text: 'stuck' }), 'token-stuck');
    const youngId = await intake(buildMime({ text: 'young' }), 'token-young');
    await backdate(stuckId, 'received_at');

    const report = await tick();
    expect(report.requeuedItemIds).toEqual([stuckId]);
    expect(requeued).toEqual([
      { channelId, itemId: stuckId, organizationId: 'org-1' },
    ]);
    expect(report.requeuedItemIds).not.toContain(youngId);

    // A disabled channel stops the requeue too.
    await service.updateChannel({
      ...owner,
      body: { enabled: false },
      channelId,
    });
    expect((await tick()).requeuedItemIds).toEqual([]);
    await service.updateChannel({
      ...owner,
      body: { enabled: true },
      channelId,
    });
  });

  it('removes an old untracked file, keeps a young one and one with a blob row', async () => {
    const organization = join(directory, 'org', 'org-1');
    const tracked = (await readdir(organization))[0] ?? '';
    expect(tracked).toMatch(/^[0-9a-f]{64}$/);
    const orphan = 'e'.repeat(64);
    const young = 'f'.repeat(64);
    await writeFile(join(organization, orphan), 'orphaned bytes');
    await writeFile(join(organization, young), 'in-flight bytes');
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(join(organization, orphan), twoHoursAgo, twoHoursAgo);
    await utimes(join(organization, tracked), twoHoursAgo, twoHoursAgo);

    const report = await tick();
    expect(report.orphansRemoved).toBe(1);
    await expect(stat(join(organization, orphan))).rejects.toThrow();
    expect((await stat(join(organization, young))).isFile()).toBe(true);
    expect(await store.stat(blobStorageKey('org-1', tracked))).not.toBeNull();
    expect((await tick()).orphansRemoved).toBe(0);
  });
});
