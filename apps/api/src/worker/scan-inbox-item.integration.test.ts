import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  blobStorageKey,
  createBlobDirectories,
  FilesystemBlobStore,
} from '../blobs/blob-store.js';
import type { RouteInboxItemJob } from '../inbox/contract.js';
import { readItem, receiveIntake } from '../inbox/inbox-repository.js';
import type { BlobScanner, ScanOutcome } from '../scanning/clamd-client.js';
import { endPools } from '../test-support/end-pools.js';
import { ScanInboxError, scanInboxItem } from './scan-inbox-item.js';
import { WorkerMetrics } from './worker-metrics.js';

const postgresImage =
  'pgvector/pgvector:pg18@sha256:2ba9ca5f2e7daa0f0e7723cba1ee9167bab54efd3640516a44ac1a928dd67e7a';
const testPassword = 'test-only-database-credential';
const QUOTA = 200_000_000;
const EICAR =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

let apiPool: DatabasePool;
let container: StartedPostgreSqlContainer;
let migratorPool: DatabasePool;
let directory: string;
let store: FilesystemBlobStore;

const owner: TenantContext = {
  organizationId: 'org-1',
  role: 'owner',
  userId: 'user-1',
};
const allEntities = { legalEntityIds: null };

// Answers like clamd would: FOUND for the EICAR string, OK otherwise, or ERROR when the test says so.
class FakeScanner implements BlobScanner {
  calls = 0;

  constructor(private readonly erroring = false) {}

  async scan(source: Readable): Promise<ScanOutcome> {
    this.calls += 1;
    const chunks: Buffer[] = [];
    for await (const chunk of source) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    if (this.erroring) {
      return { outcome: 'error', reason: 'stream: Scan failed. ERROR' };
    }

    return Buffer.concat(chunks).toString('latin1').includes(EICAR)
      ? { outcome: 'infected', signature: 'Win.Test.EICAR_HDB-1' }
      : { outcome: 'clean' };
  }
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

function poolFor(role: DatabaseRole): DatabasePool {
  return createDatabasePool(configurationFor(role));
}

// One direct upload, stored exactly as the intake stores it: one blob, no sniff, nothing scanned yet.
async function upload(bytes: Buffer, name: string): Promise<string> {
  const temporaryPath = join(store.temporaryDirectory(), `stage-${name}`);
  await writeFile(temporaryPath, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const storageKey = blobStorageKey('org-1', sha256);
  const result = await receiveIntake(apiPool, {
    ...owner,
    ...allEntities,
    byteSize: bytes.length,
    channelId: null,
    channelKind: 'upload',
    externalId: null,
    mediaType: 'application/octet-stream',
    origin: null,
    originalFilename: `${name}.bin`,
    parentItemId: null,
    payloadKind: 'file',
    persist: async () => {
      await store.put({ key: storageKey, temporaryPath });
    },
    quotaBytes: QUOTA,
    sender: null,
    senderAuthenticated: false,
    sha256,
    sniff: null,
    storageKey,
  });
  return result.item.id;
}

function run(
  itemId: string,
  scanner: BlobScanner,
  retry = { count: 0, limit: 3 },
  route: { routeRuleId?: string | null } = {},
): Promise<RouteInboxItemJob[]> {
  const routeJobs: RouteInboxItemJob[] = [];
  return scanInboxItem({
    blobs: store,
    data: { ...route, itemId, organizationId: 'org-1', userId: 'user-1' },
    enqueueRouteInboxItem: async (job) => {
      routeJobs.push(job);
    },
    metrics: new WorkerMetrics(),
    pool: apiPool,
    retry,
    scanner,
  }).then(() => routeJobs);
}

async function itemState(itemId: string) {
  const detail = await readItem(apiPool, { ...owner, ...allEntities, itemId });
  const row = await runInTenantContext(apiPool, owner, (transaction) =>
    transaction.query<{ scan_status: string }>(
      `select b.scan_status
         from app.inbox_item_file as f
         join app.blob as b on b.id = f.blob_id
        where f.item_id = $1`,
      [itemId],
    ),
  );
  return {
    events: detail?.events.map((event) => [event.kind, event.reason]) ?? [],
    scanStatus: row.rows[0]?.scan_status,
    status: detail?.item.status,
  };
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
  apiPool = poolFor('bap_api');
  directory = await mkdtemp(join(tmpdir(), 'bap-scan-inbox-'));
  await createBlobDirectories(directory);
  store = new FilesystemBlobStore(directory);
});

afterAll(async () => {
  await endPools(apiPool, migratorPool);
  await container.stop();
  await rm(directory, { force: true, recursive: true });
});

describe('scan_inbox_item', () => {
  it('records a clean verdict, leaves the item in review and sends the deferred route', async () => {
    const itemId = await upload(Buffer.from('placeholder bytes'), 'clean');

    expect(await itemState(itemId)).toMatchObject({
      scanStatus: 'not_scanned',
      status: 'received',
    });

    const routeJobs = await run(itemId, new FakeScanner(), undefined, {
      routeRuleId: null,
    });

    expect(await itemState(itemId)).toMatchObject({
      events: [
        ['received', null],
        ['scanned', null],
      ],
      scanStatus: 'clean',
      status: 'received',
    });
    // The intake deferred a target-default route, so the clean verdict is what sends it.
    expect(routeJobs).toEqual([
      { itemId, organizationId: 'org-1', ruleId: null },
    ]);

    // A second attempt finds nothing left to scan and scans no byte twice.
    const scanner = new FakeScanner();
    expect(await run(itemId, scanner)).toEqual([]);
    expect(scanner.calls).toBe(0);
  });

  it('records the verdict of an already routed item without deciding or routing it again', async () => {
    const itemId = await upload(Buffer.from('routed bytes'), 'routed');
    await runInTenantContext(apiPool, owner, async (transaction) => {
      const partner = await transaction.query<{ id: string }>(
        `insert into app.partner (organization_id, name, created_by)
         values ('org-1', 'Placeholder Partner', 'user-1')
         returning id`,
      );
      await transaction.query(
        "update app.inbox_item set status = 'routed', partner_id = $2 where id = $1",
        [itemId, partner.rows[0]?.id],
      );
    });

    const routeJobs = await run(itemId, new FakeScanner(), undefined, {
      routeRuleId: null,
    });

    expect(await itemState(itemId)).toMatchObject({
      events: [
        ['received', null],
        ['scanned', null],
      ],
      scanStatus: 'clean',
      status: 'routed',
    });
    expect(routeJobs).toEqual([]);
  });

  it('quarantines the blob of a routed item without discarding the item', async () => {
    const itemId = await upload(
      Buffer.from(`routed ${EICAR}`, 'latin1'),
      'routed-infected',
    );
    await runInTenantContext(apiPool, owner, async (transaction) => {
      const partner = await transaction.query<{ id: string }>(
        `insert into app.partner (organization_id, name, created_by)
         values ('org-1', 'Placeholder Partner', 'user-1')
         returning id`,
      );
      await transaction.query(
        "update app.inbox_item set status = 'routed', partner_id = $2 where id = $1",
        [itemId, partner.rows[0]?.id],
      );
    });

    await run(itemId, new FakeScanner());

    // The decision stands; only the blob is refused from here on.
    expect(await itemState(itemId)).toMatchObject({
      events: [
        ['received', null],
        ['scanned', null],
      ],
      scanStatus: 'infected',
      status: 'routed',
    });
  });

  it('discards an infected item with policy_rejected and quarantines its blob', async () => {
    const itemId = await upload(Buffer.from(EICAR, 'latin1'), 'infected');

    const routeJobs = await run(itemId, new FakeScanner());

    expect(await itemState(itemId)).toMatchObject({
      events: [
        ['received', null],
        ['scanned', null],
        ['discarded', 'policy_rejected'],
      ],
      scanStatus: 'infected',
      status: 'discarded',
    });
    expect(routeJobs).toEqual([]);
  });

  it('retries a scanner error and records failed on the last attempt only', async () => {
    const itemId = await upload(Buffer.from('unscannable bytes'), 'failed');

    await expect(
      run(itemId, new FakeScanner(true), { count: 0, limit: 3 }),
    ).rejects.toBeInstanceOf(ScanInboxError);
    // A retry must see the blob untouched, or the next attempt would skip it.
    expect(await itemState(itemId)).toMatchObject({
      scanStatus: 'not_scanned',
      status: 'received',
    });

    await run(itemId, new FakeScanner(true), { count: 3, limit: 3 });

    expect(await itemState(itemId)).toMatchObject({
      events: [
        ['received', null],
        ['scanned', null],
      ],
      scanStatus: 'failed',
      status: 'received',
    });
  });
});
