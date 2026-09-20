import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  bootstrapDatabaseRoles,
  createDatabasePool,
  readEntityScope,
  runInTenantContext,
  runMigrations,
} from '@bap/db';
import type { TenantContext } from '@bap/db';
import { resolveMembership } from '@bap/db/access';
import type { DatabaseConfiguration, DatabaseRole } from '@bap/db/config';
import type { DatabasePool } from '@bap/db/pool';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createBlobDirectories,
  FilesystemBlobStore,
} from '../blobs/blob-store.js';
import { channelTenant, resolveChannelAccess } from '../channel-access.js';
import type { MembershipResolver } from '../membership-resolver.js';
import { resolveTenantAccess } from '../tenant-access.js';
import type { SplitEmailItemJob } from './contract.js';
import { InboxService } from './inbox.service.js';
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
} from './inbox-repository.js';
import * as fixtures from './providers/__fixtures__/index.js';

const postgresImage =
  'pgvector/pgvector:pg18@sha256:2ba9ca5f2e7daa0f0e7723cba1ee9167bab54efd3640516a44ac1a928dd67e7a';
const testPassword = 'test-only-database-credential';
const QUOTA = 50_000;

let apiPool: DatabasePool;
let authPool: DatabasePool;
let container: StartedPostgreSqlContainer;
let migratorPool: DatabasePool;
let directory: string;
let store: FilesystemBlobStore;
let service: InboxService;
let memberships: MembershipResolver;

const owner: TenantContext = {
  organizationId: 'org-1',
  role: 'owner',
  userId: 'user-1',
};
const stranger: TenantContext = {
  organizationId: 'org-2',
  role: 'owner',
  userId: 'user-3',
};
const allEntities = { legalEntityIds: null };

const INTAKE_DOMAIN = 'in.bap.invalid';
const enqueued: SplitEmailItemJob[] = [];

let entityId = '';
let channelId = '';
let firstSecret = '';
let firstCredentialId = '';
let fileItemId = '';
let structuredItemId = '';

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

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function stage(bytes: Buffer, name: string): Promise<string> {
  const path = join(store.temporaryDirectory(), name);
  await writeFile(path, bytes);
  return path;
}

function requestFor(subject: string) {
  return {
    headers: {},
    method: 'GET',
    resourcePrincipal: { issuedAt: 1, subject },
    url: '/',
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
      values ('user-1', 'Owner', 'owner@example.test', true),
             ('user-3', 'Stranger', 'stranger@example.test', true)
    `);
    await migrator.query(`
      insert into auth.organization (id, name, slug) values ('org-1', 'One', 'one'), ('org-2', 'Two', 'two')
    `);
    await migrator.query(`
      insert into auth.member (id, organization_id, user_id, role)
      values ('member-1', 'org-1', 'user-1', 'owner'),
             ('member-3', 'org-2', 'user-3', 'owner')
    `);
    await migrator.query('commit');
  } finally {
    migrator.release();
  }

  await rootPool.end();
  apiPool = createDatabasePool(configurationFor('bap_api'));
  authPool = createDatabasePool(configurationFor('bap_auth'));
  entityId = await runInTenantContext(apiPool, owner, async (transaction) => {
    const created = await transaction.query<{ id: string }>(
      `insert into app.legal_entity (organization_id, name, kind, created_by)
       values ($1, 'Placeholder Holding', 'company', $2)
       returning id`,
      [owner.organizationId, owner.userId],
    );
    return created.rows[0]?.id ?? '';
  });

  directory = await mkdtemp(join(tmpdir(), 'bap-inbox-channels-integration-'));
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
  // The real membership path, so a channel subject is refused exactly as the routes refuse it.
  memberships = {
    checkReadiness: async () => true,
    getPoolStatistics: () => ({ idle: 0, total: 0, waiting: 0 }),
    readEntityScope: (tenant) =>
      runInTenantContext(apiPool, tenant, (transaction) =>
        readEntityScope(transaction, tenant),
      ),
    resolve: async (subjectId, organizationId) =>
      (await resolveMembership(apiPool, { organizationId, subjectId })) ?? {
        emailVerified: false,
        role: null,
      },
  };
});

afterAll(async () => {
  await Promise.all([apiPool.end(), authPool.end(), migratorPool.end()]);
  await container.stop();
  await rm(directory, { force: true, recursive: true });
});

describe('inbox channels', () => {
  it('lets an owner create an API channel bound to an entity and lists it without credentials', async () => {
    const created = await service.createChannel({
      ...owner,
      body: {
        hintKind: 'isdoc_invoice',
        kind: 'api',
        legalEntityId: entityId,
        name: 'ERP push',
      },
    });

    expect(created).toMatchObject({
      credentials: [],
      enabled: true,
      hintKind: 'isdoc_invoice',
      itemCount: 0,
      kind: 'api',
      legalEntityId: entityId,
      name: 'ERP push',
    });
    channelId = created?.id ?? '';

    expect(await service.listChannels(owner)).toEqual([created]);
    expect(await service.listChannels(stranger)).toEqual([]);
    expect(await service.readChannel({ ...stranger, channelId })).toBeNull();

    // An entity of another organization fails the composite key and is not visible.
    expect(
      await service.createChannel({
        ...stranger,
        body: { kind: 'api', legalEntityId: entityId, name: 'Theirs' },
      }),
    ).toBeNull();
  });

  it('issues at most two credentials, lists them by prefix and shows the secret once', async () => {
    const first = await service.issueCredential({ ...owner, channelId });
    expect(first.secret).toMatch(/^bap_intake_[A-Za-z0-9_-]{43}$/);
    expect(first.displayPrefix).toBe(first.secret.slice(11, 19));
    firstSecret = first.secret;
    firstCredentialId = first.credentialId;

    const second = await service.issueCredential({ ...owner, channelId });
    expect(second.secret).not.toBe(first.secret);

    await expect(
      service.issueCredential({ ...owner, channelId }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.issueCredential({ ...stranger, channelId }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const channel = await service.readChannel({ ...owner, channelId });
    expect(
      channel?.credentials.map((credential) => [
        credential.credentialId,
        credential.displayPrefix,
      ]),
    ).toEqual([
      [first.credentialId, first.displayPrefix],
      [second.credentialId, second.displayPrefix],
    ]);
    expect(JSON.stringify(channel)).not.toContain(first.secret);

    // The web's lookup binds the secret to the channel and the organization.
    const resolved = await authPool.query(
      'select organization_id, channel_id, kind from auth.resolve_channel_credential($1)',
      [sha256Hex(first.secret)],
    );
    expect(resolved.rows).toEqual([
      { channel_id: channelId, kind: 'api_token', organization_id: 'org-1' },
    ]);
  });

  it('resolves the channel principal for its own row only', async () => {
    const request = requestFor(`channel_${channelId}`);

    await expect(
      resolveChannelAccess({
        channelId,
        channels: {
          readChannelPrincipal: (input) => readChannelPrincipal(apiPool, input),
        },
        organizationId: 'org-1',
        request,
      }),
    ).resolves.toEqual({
      channelId,
      organizationId: 'org-1',
      subject: `channel_${channelId}`,
    });
    await expect(
      resolveChannelAccess({
        channelId,
        channels: {
          readChannelPrincipal: (input) => readChannelPrincipal(apiPool, input),
        },
        organizationId: 'org-2',
        request,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('receives a file under the channel token with the entity, the hint and no actor', async () => {
    const bytes = fixtures.pdf();
    const path = await stage(bytes, 'channel.pdf');
    const tenant = channelTenant('org-1', channelId);

    const response = await service.intakeFile({
      ...tenant,
      channelId,
      externalId: 'erp-1',
      file: { originalname: 'channel.pdf', path, size: bytes.length },
      origin: firstSecret.slice(11, 19),
    });

    expect(response.status).toBe('needs_review');
    expect(response.duplicateOfItemId).toBeNull();
    fileItemId = response.itemId;
    expect(await readdir(store.temporaryDirectory())).toEqual([]);

    const detail = await readItem(apiPool, {
      ...owner,
      ...allEntities,
      itemId: fileItemId,
    });
    expect(detail?.item).toMatchObject({
      channelId,
      channelKind: 'api',
      hintKind: 'isdoc_invoice',
      legalEntityId: entityId,
      origin: firstSecret.slice(11, 19),
      payloadKind: 'file',
      status: 'needs_review',
    });
    expect(
      detail?.events.map((event) => [event.kind, event.actorUserId]),
    ).toEqual([
      ['received', null],
      ['classified', null],
    ]);
    expect(detail?.files[0]).toMatchObject({
      mediaType: 'application/pdf',
      originalFilename: 'channel.pdf',
      position: 1,
    });

    const audit = await runInTenantContext(apiPool, owner, (transaction) =>
      transaction.query<{ metadata: Record<string, unknown>; user_id: string }>(
        `select user_id, metadata from app.audit_log
          where resource_id = $1 and action = 'inbox_item.received'`,
        [fileItemId],
      ),
    );
    expect(audit.rows).toEqual([
      {
        metadata: {
          channelId,
          channelKind: 'api',
          duplicate: false,
          payloadKind: 'file',
        },
        user_id: `channel_${channelId}`,
      },
    ]);
  });

  it('receives a structured payload as a JSON file and replays the external id idempotently', async () => {
    const tenant = channelTenant('org-1', channelId);
    const payload = { lines: [{ amount: '10.00' }], total: '10.00' };

    const response = await service.intakeStructured({
      ...tenant,
      channelId,
      externalId: 'erp-2',
      origin: null,
      payload,
    });
    structuredItemId = response.itemId;
    expect(response.status).toBe('needs_review');

    const detail = await readItem(apiPool, {
      ...owner,
      ...allEntities,
      itemId: structuredItemId,
    });
    expect(detail?.item).toMatchObject({
      channelId,
      legalEntityId: entityId,
      origin: null,
      payloadKind: 'structured',
    });
    expect(detail?.files[0]).toMatchObject({
      byteSize: Buffer.byteLength(JSON.stringify(payload)),
      mediaType: 'application/json',
      originalFilename: null,
      position: 1,
    });

    const replayed = await service.intakeStructured({
      ...tenant,
      channelId,
      externalId: 'erp-2',
      origin: null,
      payload: { total: '99.00' },
    });
    expect(replayed).toEqual(response);
    expect(await readdir(store.temporaryDirectory())).toEqual([]);

    const bytes = fixtures.pdf();
    const replayedFile = await service.intakeFile({
      ...tenant,
      channelId,
      externalId: 'erp-1',
      file: {
        originalname: 'again.pdf',
        path: await stage(bytes, 'again.pdf'),
        size: bytes.length,
      },
      origin: null,
    });
    expect(replayedFile.itemId).toBe(fileItemId);

    const count = await runInTenantContext(apiPool, owner, (transaction) =>
      transaction.query<{ total: number }>(
        'select count(*)::int as total from app.inbox_item where channel_id = $1',
        [channelId],
      ),
    );
    expect(count.rows[0]?.total).toBe(2);
    expect(
      (await service.readChannel({ ...owner, channelId }))?.itemCount,
    ).toBe(2);
  });

  it('refuses the channel subject on every membership route', async () => {
    await expect(
      resolveTenantAccess({
        capability: 'readDocuments',
        memberships,
        organizationId: 'org-1',
        request: requestFor(`channel_${channelId}`),
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // The list scope of the owner still shows the channel items.
    const page = await listItems(apiPool, {
      ...owner,
      ...allEntities,
      query: { page: 1, pageSize: 25 },
    });
    expect(page.items.map((item) => item.channelId)).toEqual([
      channelId,
      channelId,
    ]);
  });

  it('keys the replay per channel: another channel with the same external id gets its own item', async () => {
    const second = await service.createChannel({
      ...owner,
      body: { kind: 'api', name: 'Second ERP push' },
    });
    const secondChannelId = second?.id ?? '';
    const tenant = channelTenant('org-1', secondChannelId);

    const response = await service.intakeStructured({
      ...tenant,
      channelId: secondChannelId,
      externalId: 'erp-2',
      origin: null,
      payload: { total: '1.00' },
    });
    expect(response.itemId).not.toBe(structuredItemId);
    expect(
      (
        await readItem(apiPool, {
          ...owner,
          ...allEntities,
          itemId: response.itemId,
        })
      )?.item,
    ).toMatchObject({ channelId: secondChannelId });

    // The replay is answered by the item of the channel that asks, not the first one with that id.
    const replayed = await service.intakeStructured({
      ...tenant,
      channelId: secondChannelId,
      externalId: 'erp-2',
      origin: null,
      payload: { total: '2.00' },
    });
    expect(replayed).toEqual(response);
    expect(
      (await service.readChannel({ ...owner, channelId }))?.itemCount,
    ).toBe(2);
    expect(
      (await service.readChannel({ ...owner, channelId: secondChannelId }))
        ?.itemCount,
    ).toBe(1);

    // Soft deleted so the later list assertions see the first channel only.
    await service.updateChannel({
      ...owner,
      body: { deleted: true, enabled: false },
      channelId: secondChannelId,
    });
  });

  it('revokes a credential so the web lookup finds nothing, only from its own channel', async () => {
    expect(
      await service.revokeCredential({
        ...owner,
        channelId: structuredItemId,
        credentialId: firstCredentialId,
      }),
    ).toBe(false);
    expect(
      await service.revokeCredential({
        ...owner,
        channelId,
        credentialId: firstCredentialId,
      }),
    ).toBe(true);
    expect(
      await service.revokeCredential({
        ...owner,
        channelId,
        credentialId: firstCredentialId,
      }),
    ).toBe(false);

    const resolved = await authPool.query(
      'select channel_id from auth.resolve_channel_credential($1)',
      [sha256Hex(firstSecret)],
    );
    expect(resolved.rows).toEqual([]);
    expect(
      (await service.readChannel({ ...owner, channelId }))?.credentials,
    ).toHaveLength(1);
  });

  it('answers not found for a disabled channel and hides a soft deleted one', async () => {
    const disabled = await service.updateChannel({
      ...owner,
      body: { enabled: false },
      channelId,
    });
    expect(disabled?.enabled).toBe(false);
    expect(
      await readChannelPrincipal(apiPool, {
        channelId,
        organizationId: 'org-1',
      }),
    ).toBe(false);

    const bytes = fixtures.text();
    const path = await stage(bytes, 'disabled.txt');
    await expect(
      service.intakeFile({
        ...channelTenant('org-1', channelId),
        channelId,
        externalId: null,
        file: { originalname: 'disabled.txt', path, size: bytes.length },
        origin: null,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await readdir(store.temporaryDirectory())).toEqual([]);
    // A replay does not bypass the channel state: the known external id is refused as well.
    await expect(
      service.intakeStructured({
        ...channelTenant('org-1', channelId),
        channelId,
        externalId: 'erp-2',
        origin: null,
        payload: { total: '10.00' },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const deleted = await service.updateChannel({
      ...owner,
      body: { deleted: true, enabled: false },
      channelId,
    });
    expect(deleted?.enabled).toBe(false);
    expect(await service.readChannel({ ...owner, channelId })).toBeNull();
    expect(await service.listChannels(owner)).toEqual([]);
    await expect(
      service.issueCredential({ ...owner, channelId }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(
      await service.updateChannel({
        ...owner,
        body: { enabled: true },
        channelId,
      }),
    ).toBeNull();

    // The items keep pointing at the channel row.
    const item = await readItem(apiPool, {
      ...owner,
      ...allEntities,
      itemId: fileItemId,
    });
    expect(item?.item.channelId).toBe(channelId);
  });
});
