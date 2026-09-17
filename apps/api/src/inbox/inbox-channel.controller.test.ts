import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConflictException, NotFoundException } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  SubjectRateLimiter,
  type EntityScope,
  type ResourceJwtVerifier,
} from '@bap/security';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { configureApplication } from '../application.js';
import {
  createBlobDirectories,
  FilesystemBlobStore,
  BlobStore,
} from '../blobs/blob-store.js';
import { MembershipResolver } from '../membership-resolver.js';
import { ServiceMetrics } from '../metrics.js';
import {
  RESOURCE_JWT_VERIFIER,
  ResourceJwtGuard,
} from '../resource-jwt.guard.js';
import {
  SUBJECT_RATE_LIMITER,
  SubjectRateLimitGuard,
} from '../subject-rate-limit.guard.js';
import type { InboxChannel } from './contract.js';
import { InboxChannelController } from './inbox-channel.controller.js';
import { InboxRepository } from './inbox-repository.js';
import { InboxService } from './inbox.service.js';
import type { FileIntakeInput } from './inbox.service.js';

const CHANNEL_ID = '4a2b7c1e-9f5d-4c3a-8b21-6e0f7d5a4c39';
const OTHER_CHANNEL_ID = '6c4d9e30-1b7f-4e5c-ad43-801b9f7c6e51';
const UNKNOWN_CHANNEL_ID = '8e6f1052-3d9b-4a7e-8f65-a23db19e8073';
const ITEM_ID = '9f702163-4eac-4b8f-9076-b34ec2af9184';
const CREDENTIAL_ID = 'a0813274-5fbd-4c90-a187-c45fd3b0a295';
const UNKNOWN_CREDENTIAL_ID = 'b1924385-60ce-4da1-b298-d560e4c1b3a6';
const ENTITY_ID = 'c2a35496-71df-4eb2-8309-e671f5d2c4b7';
const SECRET = `bap_intake_${'A'.repeat(43)}`;

const channel: InboxChannel = {
  createdAt: '2026-09-17T06:00:00.000Z',
  credentials: [
    {
      createdAt: '2026-09-17T06:00:00.000Z',
      credentialId: CREDENTIAL_ID,
      displayPrefix: 'AAAAAAAA',
      lastUsedAt: null,
    },
  ],
  enabled: true,
  hintKind: null,
  id: CHANNEL_ID,
  itemCount: 0,
  kind: 'api',
  legalEntityId: null,
  name: 'ERP push',
  updatedAt: '2026-09-17T06:00:00.000Z',
};

const accepted = {
  duplicateOfItemId: null,
  itemId: ITEM_ID,
  status: 'needs_review',
};

describe('application inbox channel routes', () => {
  let application: NestExpressApplication;
  let blobDirectory: string;
  let entityScope: EntityScope = { mode: 'all' };
  const calls: Record<string, unknown[]> = {};
  const limiter = new SubjectRateLimiter({
    limit: 400,
    maxEntries: 8,
    windowMs: 60_000,
  });
  const verifier: ResourceJwtVerifier = {
    verifyAuthorizationHeader: vi.fn(async (header) => {
      if (header === 'Bearer owner') {
        return { issuedAt: 1_800_000_000, subject: 'user_1' };
      }
      if (header === 'Bearer channel') {
        return { issuedAt: 1_800_000_000, subject: `channel_${CHANNEL_ID}` };
      }
      throw new Error('invalid');
    }),
    verifyToken: vi.fn(),
  };
  const memberships: MembershipResolver = {
    checkReadiness: vi.fn(async () => true),
    getPoolStatistics: vi.fn(() => ({ idle: 0, total: 0, waiting: 0 })),
    readEntityScope: vi.fn(async () => entityScope),
    resolve: vi.fn(async (_subject: string, organizationId: string) => {
      if (organizationId === 'organization_1') {
        return { emailVerified: true, role: 'owner' as const };
      }
      if (organizationId === 'organization_3') {
        return { emailVerified: true, role: 'admin' as const };
      }
      return { emailVerified: false, role: null };
    }),
  };

  function record<T>(name: string, answer: (input: T) => unknown) {
    return vi.fn(async (input: T) => {
      (calls[name] ??= []).push(input);
      return answer(input);
    });
  }

  const byChannel = (input: { channelId: string }) =>
    input.channelId === CHANNEL_ID ? channel : null;

  const service = {
    createChannel: record(
      'createChannel',
      (input: { body: { legalEntityId?: string } }) =>
        input.body.legalEntityId === undefined ? channel : null,
    ),
    intakeFile: record('intakeFile', async (input: FileIntakeInput) => {
      if (input.file?.path !== undefined) {
        await rm(input.file.path, { force: true });
      }
      return accepted;
    }),
    intakeStructured: record('intakeStructured', () => ({
      ...accepted,
      status: 'received',
    })),
    issueCredential: record(
      'issueCredential',
      (input: { channelId: string }) => {
        if (input.channelId === OTHER_CHANNEL_ID) {
          throw new ConflictException();
        }
        if (input.channelId === UNKNOWN_CHANNEL_ID) {
          throw new NotFoundException();
        }
        return {
          credentialId: CREDENTIAL_ID,
          displayPrefix: 'AAAAAAAA',
          secret: SECRET,
        };
      },
    ),
    listChannels: record('listChannels', () => [channel]),
    readChannel: record('readChannel', byChannel),
    revokeCredential: record(
      'revokeCredential',
      (input: { credentialId: string }) => input.credentialId === CREDENTIAL_ID,
    ),
    updateChannel: record('updateChannel', byChannel),
  };
  const channels = {
    readChannelPrincipal: record(
      'readChannelPrincipal',
      (input: { channelId: string; organizationId: string }) =>
        input.organizationId === 'organization_1' &&
        input.channelId === CHANNEL_ID,
    ),
  };

  beforeAll(async () => {
    blobDirectory = await mkdtemp(join(tmpdir(), 'bap-inbox-channels-'));
    await createBlobDirectories(blobDirectory);
    vi.stubEnv('BAP_BLOB_STORAGE_DIR', blobDirectory);
    const module = await Test.createTestingModule({
      controllers: [InboxChannelController],
      providers: [
        { provide: InboxService, useValue: service },
        { provide: InboxRepository, useValue: channels },
        {
          provide: BlobStore,
          useValue: new FilesystemBlobStore(blobDirectory),
        },
        { provide: MembershipResolver, useValue: memberships },
        { provide: RESOURCE_JWT_VERIFIER, useValue: verifier },
        { provide: SUBJECT_RATE_LIMITER, useValue: limiter },
        ServiceMetrics,
        ResourceJwtGuard,
        SubjectRateLimitGuard,
      ],
    }).compile();

    application = module.createNestApplication<NestExpressApplication>();
    configureApplication(application);
    await application.init();
  });

  afterAll(async () => {
    await application.close();
    vi.unstubAllEnvs();
    await rm(blobDirectory, { force: true, recursive: true });
  });

  beforeEach(() => {
    entityScope = { mode: 'all' };
    for (const key of Object.keys(calls)) {
      delete calls[key];
    }
  });

  const as = (
    bearer: 'channel' | 'owner' | 'invalid',
    method: 'delete' | 'get' | 'patch' | 'post',
    path: string,
    organizationId = 'organization_1',
  ) =>
    request(application.getHttpServer())
      [method](`/v1/organizations/${organizationId}${path}`)
      .set('Authorization', `Bearer ${bearer}`);

  const itemsPath = `/inbox/channels/${CHANNEL_ID}/items`;

  it('accepts a file from the channel token with its external id and origin header', async () => {
    const response = await as('channel', 'post', itemsPath)
      .set('X-BAP-Intake-Origin', 'AAAAAAAA')
      .field('externalId', 'erp-42')
      .attach('file', Buffer.from('placeholder bytes'), {
        filename: 'invoice.pdf',
      })
      .expect(202);

    expect(response.body).toEqual(accepted);
    expect(calls.intakeFile?.[0]).toMatchObject({
      channelId: CHANNEL_ID,
      externalId: 'erp-42',
      file: { originalname: 'invoice.pdf', size: 17 },
      organizationId: 'organization_1',
      origin: 'AAAAAAAA',
      role: 'channel',
      userId: `channel_${CHANNEL_ID}`,
    });
    expect(calls.readChannelPrincipal?.[0]).toEqual({
      channelId: CHANNEL_ID,
      organizationId: 'organization_1',
    });
  });

  it('accepts a structured payload from the channel token and an owner alike', async () => {
    const body = { externalId: 'erp-43', payload: { total: 1, lines: [{}] } };

    const response = await as('channel', 'post', itemsPath)
      .send(body)
      .expect(202);
    expect(response.body).toEqual({ ...accepted, status: 'received' });
    expect(calls.intakeStructured?.[0]).toMatchObject({
      ...body,
      origin: null,
      role: 'channel',
    });

    await as('owner', 'post', itemsPath).send(body).expect(202);
    expect(calls.intakeStructured?.[1]).toMatchObject({
      origin: 'user_1',
      role: 'owner',
      userId: 'user_1',
    });
  });

  it('rejects an unusable intake body, a malformed origin, and a restricted admin', async () => {
    for (const body of [
      { payload: {} },
      { externalId: 'x' },
      { externalId: 'x', payload: [] },
      { externalId: '', payload: {} },
      { externalId: 'x', payload: {}, extra: 1 },
    ]) {
      await as('channel', 'post', itemsPath).send(body).expect(400);
    }

    await as('channel', 'post', itemsPath)
      .set('X-BAP-Intake-Origin', 'short')
      .send({ externalId: 'x', payload: {} })
      .expect(400);

    entityScope = { legalEntityIds: [ENTITY_ID], mode: 'restricted' };
    await as('owner', 'post', itemsPath, 'organization_3')
      .send({ externalId: 'x', payload: {} })
      .expect(403);

    expect(calls.intakeStructured).toBeUndefined();
    expect(calls.intakeFile).toBeUndefined();
  });

  it('answers 404 for a channel token on another channel, a foreign organization or a disabled channel', async () => {
    const strangerItems = `/inbox/channels/${OTHER_CHANNEL_ID}/items`;

    await as('channel', 'post', strangerItems)
      .attach('file', Buffer.from('placeholder bytes'), { filename: 'a.pdf' })
      .expect(404);
    await as('channel', 'post', itemsPath, 'organization_2')
      .send({ externalId: 'x', payload: {} })
      .expect(404);
    await as('invalid', 'post', itemsPath)
      .send({ externalId: 'x', payload: {} })
      .expect(401);

    // The refused multipart request leaves no temporary file behind.
    expect(await readdir(join(blobDirectory, 'tmp'))).toEqual([]);
    expect(calls.intakeFile).toBeUndefined();
    expect(calls.intakeStructured).toBeUndefined();
  });

  it('refuses a channel token on every management route with 403', async () => {
    await as('channel', 'get', '/inbox/channels').expect(403);
    await as('channel', 'post', '/inbox/channels')
      .send({ kind: 'api', name: 'x' })
      .expect(403);
    await as('channel', 'get', `/inbox/channels/${CHANNEL_ID}`).expect(403);
    await as('channel', 'patch', `/inbox/channels/${CHANNEL_ID}`)
      .send({ name: 'x' })
      .expect(403);
    await as(
      'channel',
      'post',
      `/inbox/channels/${CHANNEL_ID}/credentials`,
    ).expect(403);
    await as(
      'channel',
      'delete',
      `/inbox/channels/${CHANNEL_ID}/credentials/${CREDENTIAL_ID}`,
    ).expect(403);

    expect(Object.keys(calls)).toEqual([]);
    expect(memberships.resolve).not.toHaveBeenCalledWith(
      `channel_${CHANNEL_ID}`,
      expect.anything(),
    );
  });

  it('lists, creates, reads and patches channels for an owner only', async () => {
    const list = await as('owner', 'get', '/inbox/channels').expect(200);
    expect(list.body).toEqual({ channels: [channel] });

    const created = await as('owner', 'post', '/inbox/channels')
      .send({ kind: 'api', name: ' ERP push ', hintKind: 'isdoc_invoice' })
      .expect(201);
    expect(created.body).toEqual(channel);
    expect(calls.createChannel?.[0]).toMatchObject({
      body: { hintKind: 'isdoc_invoice', kind: 'api', name: 'ERP push' },
      role: 'owner',
    });

    // Email channels arrive in Phase 1a-email; a foreign entity is not visible.
    await as('owner', 'post', '/inbox/channels')
      .send({ kind: 'email', name: 'mail' })
      .expect(400);
    await as('owner', 'post', '/inbox/channels')
      .send({ kind: 'api', name: 'x', legalEntityId: ENTITY_ID })
      .expect(404);

    await as('owner', 'get', `/inbox/channels/${CHANNEL_ID}`).expect(200);
    await as('owner', 'get', `/inbox/channels/${UNKNOWN_CHANNEL_ID}`).expect(
      404,
    );
    await as('owner', 'get', '/inbox/channels/not-a-uuid').expect(400);

    await as('owner', 'patch', `/inbox/channels/${CHANNEL_ID}`)
      .send({ deleted: true, enabled: false })
      .expect(200);
    expect(calls.updateChannel?.[0]).toMatchObject({
      body: { deleted: true, enabled: false },
      channelId: CHANNEL_ID,
    });
    for (const body of [
      {},
      { deleted: true },
      { deleted: false },
      { unknown: 1 },
    ]) {
      await as('owner', 'patch', `/inbox/channels/${CHANNEL_ID}`)
        .send(body)
        .expect(400);
    }
    await as('owner', 'patch', `/inbox/channels/${UNKNOWN_CHANNEL_ID}`)
      .send({ enabled: false })
      .expect(404);

    // An admin holds manageDocuments but not manageOrganization; a stranger holds nothing.
    await as('owner', 'get', '/inbox/channels', 'organization_3').expect(403);
    await as('owner', 'get', '/inbox/channels', 'organization_9').expect(403);
  });

  it('issues a credential once and revokes it, mapping the definer verdicts', async () => {
    const issued = await as(
      'owner',
      'post',
      `/inbox/channels/${CHANNEL_ID}/credentials`,
    ).expect(201);
    expect(issued.body).toEqual({
      credentialId: CREDENTIAL_ID,
      displayPrefix: 'AAAAAAAA',
      secret: SECRET,
    });

    await as(
      'owner',
      'post',
      `/inbox/channels/${OTHER_CHANNEL_ID}/credentials`,
    ).expect(409);
    await as(
      'owner',
      'post',
      `/inbox/channels/${UNKNOWN_CHANNEL_ID}/credentials`,
    ).expect(404);

    await as(
      'owner',
      'delete',
      `/inbox/channels/${CHANNEL_ID}/credentials/${CREDENTIAL_ID}`,
    ).expect(204);
    expect(calls.revokeCredential?.[0]).toMatchObject({
      channelId: CHANNEL_ID,
      credentialId: CREDENTIAL_ID,
    });
    await as(
      'owner',
      'delete',
      `/inbox/channels/${CHANNEL_ID}/credentials/${UNKNOWN_CREDENTIAL_ID}`,
    ).expect(404);
  });

  it('publishes the channel routes in OpenAPI', () => {
    const document = SwaggerModule.createDocument(
      application,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );

    expect(Object.keys(document.paths).sort()).toEqual([
      '/v1/organizations/{organizationId}/inbox/channels',
      '/v1/organizations/{organizationId}/inbox/channels/{channelId}',
      '/v1/organizations/{organizationId}/inbox/channels/{channelId}/credentials',
      '/v1/organizations/{organizationId}/inbox/channels/{channelId}/credentials/{credentialId}',
      '/v1/organizations/{organizationId}/inbox/channels/{channelId}/items',
    ]);
  });
});
