import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import {
  ConflictException,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
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
import type {
  InboxItem,
  InboxItemDetail,
  InboxItemFile,
  InboxItemListEntry,
} from './contract.js';
import { InboxController } from './inbox.controller.js';
import { InboxService } from './inbox.service.js';
import type { OpenedBlob, UploadInput } from './inbox.service.js';
import { routingTargetFor } from './routing-targets.js';

const ENTITY_ID = '4a2b7c1e-9f5d-4c3a-8b21-6e0f7d5a4c39';
const ITEM_ID = '6c4d9e30-1b7f-4e5c-ad43-801b9f7c6e51';
const UNKNOWN_ITEM_ID = '8e6f1052-3d9b-4a7e-8f65-a23db19e8073';
const BLOB_ID = '9f702163-4eac-4b8f-9076-b34ec2af9184';
const PDF_BLOB_ID = 'a0813274-5fbd-4c90-a187-c45fd3b0a295';
const UNKNOWN_BLOB_ID = 'b1924385-60ce-4da1-b298-d560e4c1b3a6';
const PNG_BLOB_ID = 'c2a35496-71df-4eb2-8309-e671f5d2c4b7';
const QUARANTINED_BLOB_ID = 'd3b46507-82e0-4fc3-9410-f782a6e3d5c8';
const SHA256 = 'c'.repeat(64);
const DOCUMENT_ID = 'e4c57618-93f1-4ad4-a521-093c7b4e6d09';

const item: InboxItem = {
  assigneeId: null,
  channelId: null,
  channelKind: 'upload',
  confidence: 1,
  createdAt: '2026-09-16T06:00:00.000Z',
  datasetId: null,
  decidedByKind: null,
  decidedByRuleId: null,
  decidedByUserId: null,
  detectedType: 'pdf',
  documentId: null,
  duplicateOfItemId: null,
  hintKind: null,
  hintLegalEntityId: null,
  hintLinkDocumentId: null,
  hintPartnerId: null,
  hintText: null,
  humanTouched: false,
  id: ITEM_ID,
  legalEntityId: null,
  origin: null,
  partnerId: null,
  payloadKind: 'file',
  receivedAt: '2026-09-16T06:00:00.000Z',
  routedAt: null,
  snoozedUntil: null,
  status: 'needs_review',
  updatedAt: '2026-09-16T06:00:00.000Z',
};

const file: InboxItemFile = {
  blobId: BLOB_ID,
  byteSize: 17,
  mediaType: 'text/plain',
  originalFilename: 'placeholder.txt',
  position: 1,
  scanStatus: 'clean',
  sha256: SHA256,
};

const listEntry: InboxItemListEntry = {
  ...item,
  fileCount: 2,
  primaryFilename: file.originalFilename,
};

const detail: InboxItemDetail = {
  corrections: [],
  events: [
    {
      actorUserId: 'user_1',
      createdAt: '2026-09-16T06:00:00.000Z',
      id: 'c2035496-71df-4eb2-8349-e671f5d2c4b7',
      kind: 'received',
      reason: null,
    },
  ],
  extraction: {
    confidence: 1,
    createdAt: '2026-09-16T06:00:00.000Z',
    detectedType: 'pdf',
    draft: {},
    fieldConfidences: {},
    id: 'd3146507-82e0-4fc3-9450-f782061e3d5c',
    issues: [],
    legalEntityId: null,
    provider: 'sniff',
    providerVersion: '2026-09-16.1',
    reasons: [{ evidence: 'placeholder', step: 'sniff', weight: 1 }],
  },
  files: [file],
  item: { ...item, sender: null },
  routingTarget: routingTargetFor('pdf'),
};

const documentBody = {
  documentDate: '2026-09-14',
  kind: 'contract',
  legalEntityId: ENTITY_ID,
  title: 'Placeholder contract',
};

describe('application inbox routes', () => {
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
      if (header === 'Bearer caller') {
        return { issuedAt: 1_800_000_000, subject: 'user_1' };
      }
      if (header === 'Bearer channel') {
        return { issuedAt: 1_800_000_000, subject: `channel_${ITEM_ID}` };
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
        return { emailVerified: true, role: 'member' as const };
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

  const byItem = (input: { itemId: string }) =>
    input.itemId === ITEM_ID ? detail : null;

  const service = {
    assignItem: record('assignItem', byItem),
    attachItem: record('attachItem', byItem),
    bulk: record('bulk', (input: { body: { itemIds: string[] } }) => ({
      results: input.body.itemIds.map((itemId) =>
        itemId === ITEM_ID
          ? { itemId, status: 'ok' }
          : { code: 'not_found', itemId, status: 'refused' },
      ),
    })),
    discardItem: record('discardItem', byItem),
    listItems: record('listItems', () => ({
      items: [listEntry],
      page: 1,
      pageSize: 25,
      total: 1,
    })),
    openBlob: record(
      'openBlob',
      (input: { blobId: string; inline: boolean }): OpenedBlob => {
        if (input.blobId === UNKNOWN_BLOB_ID) {
          throw new NotFoundException();
        }
        if (input.blobId === QUARANTINED_BLOB_ID) {
          throw new ConflictException('blob_quarantined');
        }
        const pdf = input.blobId === PDF_BLOB_ID;
        const png = input.blobId === PNG_BLOB_ID;
        if (input.inline && !pdf && !png) {
          throw new UnsupportedMediaTypeException();
        }
        return {
          blob: {
            byteSize: 17,
            id: input.blobId,
            scanStatus: 'not_scanned' as const,
            mediaType: pdf
              ? 'application/pdf'
              : png
                ? 'image/png'
                : 'text/plain',
            originalFilename: pdf ? 'invoice "1"; ../x.pdf' : null,
            sha256: SHA256,
            storageKey: `org/organization_1/${SHA256}`,
          },
          stream: Readable.from([Buffer.from('placeholder bytes')]),
        };
      },
    ),
    process: record('process', byItem),
    readItem: record('readItem', byItem),
    restoreItem: record('restoreItem', byItem),
    routeToDocument: record(
      'routeToDocument',
      (input: {
        body: { document: { reference?: string } };
        itemId: string;
      }) => {
        if (input.body.document.reference === 'taken') {
          throw new ConflictException({
            code: 'reference_conflict',
            documentId: DOCUMENT_ID,
          });
        }
        if (input.body.document.reference === 'seen') {
          throw new ConflictException({
            candidates: [
              {
                documentDate: '2026-09-01',
                id: DOCUMENT_ID,
                reference: 'seen',
                totalAmount: '10.00',
              },
            ],
            code: 'duplicate_probable',
          });
        }
        return byItem(input);
      },
    ),
    snoozeItem: record('snoozeItem', byItem),
    undoRoute: record('undoRoute', byItem),
    updateHints: record('updateHints', byItem),
    upload: record('upload', async (input: UploadInput) => {
      // The real service always deletes the temporary file; the stub mimics that so the directory check holds.
      if (input.file?.path !== undefined) {
        await rm(input.file.path, { force: true });
      }
      return { duplicateOfItemId: null, files: [file], item };
    }),
  };

  beforeAll(async () => {
    blobDirectory = await mkdtemp(join(tmpdir(), 'bap-inbox-'));
    await createBlobDirectories(blobDirectory);
    vi.stubEnv('BAP_BLOB_STORAGE_DIR', blobDirectory);
    const module = await Test.createTestingModule({
      controllers: [InboxController],
      providers: [
        { provide: InboxService, useValue: service },
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

  const authorized = (method: 'get' | 'patch' | 'post', path: string) =>
    request(application.getHttpServer())
      [method](`/v1/organizations/organization_1${path}`)
      .set('Authorization', 'Bearer caller');

  it('receives an upload as a file part and answers the item', async () => {
    const response = await request(application.getHttpServer())
      .post('/v1/organizations/organization_1/inbox/uploads')
      .set('Authorization', 'Bearer caller')
      .attach('file', Buffer.from('placeholder bytes'), {
        contentType: 'application/octet-stream',
        filename: 'placeholder.txt',
      })
      .expect(201);

    expect(response.body).toEqual({
      duplicateOfItemId: null,
      files: [file],
      item,
    });
    expect(calls.upload?.[0]).toMatchObject({
      file: { originalname: 'placeholder.txt', size: 17 },
      legalEntityIds: null,
      organizationId: 'organization_1',
      role: 'owner',
      userId: 'user_1',
    });
    expect((calls.upload?.[0] as UploadInput).file?.path).toContain(
      join(blobDirectory, 'tmp'),
    );
  });

  it('refuses an upload from a member and leaves no temporary file behind', async () => {
    await request(application.getHttpServer())
      .post('/v1/organizations/organization_3/inbox/uploads')
      .set('Authorization', 'Bearer caller')
      .attach('file', Buffer.from('placeholder bytes'), {
        filename: 'placeholder.txt',
      })
      .expect(403);

    expect(calls.upload).toBeUndefined();
    expect(await readdir(join(blobDirectory, 'tmp'))).toEqual([]);
  });

  it('lists items with the scope and parses the filters', async () => {
    const response = await authorized('get', '/inbox/items')
      .query({
        assigneeId: 'none',
        confidence: 'low',
        detectedType: 'pdf',
        issue: 'duplicate_probable',
        page: '2',
        pageSize: '10',
        status: 'needs_review,routed',
      })
      .expect(200);

    expect(response.body).toEqual({
      items: [listEntry],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    expect(calls.listItems?.[0]).toMatchObject({
      legalEntityIds: null,
      query: {
        assigneeId: 'none',
        confidence: 'low',
        detectedType: 'pdf',
        issue: 'duplicate_probable',
        page: 2,
        pageSize: 10,
        status: ['needs_review', 'routed'],
      },
    });
    await authorized('get', '/inbox/items')
      .query({ confidence: '0.5' })
      .expect(400);
    await authorized('get', '/inbox/items').query({ issue: 'x' }).expect(400);

    entityScope = { legalEntityIds: [ENTITY_ID], mode: 'restricted' };
    await request(application.getHttpServer())
      .get('/v1/organizations/organization_3/inbox/items')
      .set('Authorization', 'Bearer caller')
      .expect(200);
    expect(calls.listItems?.[1]).toMatchObject({
      legalEntityIds: [ENTITY_ID],
      role: 'member',
    });
  });

  it('rejects a list query outside the fixed contract', async () => {
    for (const query of [
      { pageSize: '101' },
      { page: '0' },
      { page: '401', pageSize: '25' },
      { status: 'deleted' },
      { detectedType: 'Not-A-Token' },
      { unknownFilter: 'x' },
    ]) {
      await authorized('get', '/inbox/items').query(query).expect(400);
    }

    expect(calls.listItems).toBeUndefined();
  });

  it('reads one item and answers not found for an unknown one', async () => {
    const response = await authorized('get', `/inbox/items/${ITEM_ID}`).expect(
      200,
    );

    expect(response.body).toEqual(detail);
    // The effective target rides on the detail so the setting is visible on the item the day it lands.
    expect(response.body.routingTarget).toMatchObject({
      detectedType: 'pdf',
      documentKind: 'other',
      source: 'platform',
    });
    await authorized('get', `/inbox/items/${UNKNOWN_ITEM_ID}`).expect(404);
    await authorized('get', '/inbox/items/not-a-uuid').expect(400);
  });

  it('patches hints, clears them with null and refuses an empty patch', async () => {
    await authorized('patch', `/inbox/items/${ITEM_ID}/hints`)
      .send({
        hintKind: 'payroll_sheet',
        hintLegalEntityId: null,
        hintText: ' note ',
      })
      .expect(200);

    expect(calls.updateHints?.[0]).toMatchObject({
      body: {
        hintKind: 'payroll_sheet',
        hintLegalEntityId: null,
        hintText: 'note',
      },
      itemId: ITEM_ID,
    });

    await authorized('patch', `/inbox/items/${ITEM_ID}/hints`)
      .send({})
      .expect(400);
    await authorized('patch', `/inbox/items/${ITEM_ID}/hints`)
      .send({ hintKind: 'Bad Kind' })
      .expect(400);
    await authorized('patch', `/inbox/items/${UNKNOWN_ITEM_ID}/hints`)
      .send({ hintText: 'x' })
      .expect(404);
  });

  it('routes to a document with the exact create body and the blob order', async () => {
    await authorized('post', `/inbox/items/${ITEM_ID}/route/document`)
      .send({ document: documentBody, fileBlobIds: [BLOB_ID] })
      .expect(200);

    expect(calls.routeToDocument?.[0]).toMatchObject({
      body: {
        document: { ...documentBody, currencyCode: 'CZK' },
        fileBlobIds: [BLOB_ID],
      },
      itemId: ITEM_ID,
    });

    await authorized('post', `/inbox/items/${ITEM_ID}/route/document`)
      .send({
        acknowledgeDuplicateOf: DOCUMENT_ID,
        document: documentBody,
        fileBlobIds: [BLOB_ID],
        supersedesDocumentId: DOCUMENT_ID,
      })
      .expect(200);
    expect(calls.routeToDocument?.[1]).toMatchObject({
      body: {
        acknowledgeDuplicateOf: DOCUMENT_ID,
        supersedesDocumentId: DOCUMENT_ID,
      },
    });

    // The two refusals carry their code and detail in the problem body, so the browser can offer a choice.
    const conflict = await authorized(
      'post',
      `/inbox/items/${ITEM_ID}/route/document`,
    )
      .send({
        document: { ...documentBody, reference: 'taken' },
        fileBlobIds: [BLOB_ID],
      })
      .expect(409);
    expect(conflict.body).toMatchObject({
      code: 'reference_conflict',
      documentId: DOCUMENT_ID,
      status: 409,
    });
    const duplicate = await authorized(
      'post',
      `/inbox/items/${ITEM_ID}/route/document`,
    )
      .send({
        document: { ...documentBody, reference: 'seen' },
        fileBlobIds: [BLOB_ID],
      })
      .expect(409);
    expect(duplicate.body).toMatchObject({
      candidates: [{ id: DOCUMENT_ID, reference: 'seen' }],
      code: 'duplicate_probable',
    });

    for (const body of [
      { document: documentBody },
      { document: documentBody, fileBlobIds: [] },
      {
        document: documentBody,
        fileBlobIds: [BLOB_ID],
        supersedesDocumentId: 'not-a-uuid',
      },
      { document: documentBody, fileBlobIds: [BLOB_ID, BLOB_ID] },
      {
        document: { ...documentBody, kind: 'issued_invoice' },
        fileBlobIds: [BLOB_ID],
      },
      { document: { ...documentBody, unknown: 1 }, fileBlobIds: [BLOB_ID] },
    ]) {
      await authorized('post', `/inbox/items/${ITEM_ID}/route/document`)
        .send(body)
        .expect(400);
    }
  });

  it('answers process, undo, restore, discard, assign and snooze with the detail', async () => {
    await authorized('post', `/inbox/items/${ITEM_ID}/process`).expect(200);
    await authorized('post', `/inbox/items/${ITEM_ID}/route/undo`).expect(200);
    await authorized('post', `/inbox/items/${ITEM_ID}/restore`).expect(200);
    await authorized('post', `/inbox/items/${ITEM_ID}/discard`)
      .send({ reason: 'irrelevant' })
      .expect(200);
    await authorized('post', `/inbox/items/${ITEM_ID}/discard`)
      .send({ reason: 'unsupported_type' })
      .expect(400);
    await authorized('post', `/inbox/items/${ITEM_ID}/assign`)
      .send({ assigneeId: 'user_2' })
      .expect(200);
    await authorized('post', `/inbox/items/${ITEM_ID}/snooze`)
      .send({ snoozedUntil: '2026-10-01T00:00:00.000Z' })
      .expect(200);
    await authorized('post', `/inbox/items/${ITEM_ID}/snooze`)
      .send({ snoozedUntil: 'tomorrow' })
      .expect(400);

    expect(calls.discardItem?.[0]).toMatchObject({ reason: 'irrelevant' });
    expect(calls.assignItem?.[0]).toMatchObject({ assigneeId: 'user_2' });
    expect(calls.snoozeItem?.[0]).toMatchObject({
      snoozedUntil: '2026-10-01T00:00:00.000Z',
    });
  });

  it('attaches to a document and runs a bulk action with per-id results', async () => {
    await authorized('post', `/inbox/items/${ITEM_ID}/attach`)
      .send({ documentId: DOCUMENT_ID })
      .expect(200);
    expect(calls.attachItem?.[0]).toMatchObject({
      documentId: DOCUMENT_ID,
      itemId: ITEM_ID,
    });
    await authorized('post', `/inbox/items/${ITEM_ID}/attach`)
      .send({})
      .expect(400);
    await authorized('post', `/inbox/items/${UNKNOWN_ITEM_ID}/attach`)
      .send({ documentId: DOCUMENT_ID })
      .expect(404);

    const bulk = await authorized('post', '/inbox/items/bulk')
      .send({
        action: 'assign',
        assigneeId: 'user_2',
        itemIds: [ITEM_ID, UNKNOWN_ITEM_ID],
      })
      .expect(200);
    expect(bulk.body).toEqual({
      results: [
        { itemId: ITEM_ID, status: 'ok' },
        { code: 'not_found', itemId: UNKNOWN_ITEM_ID, status: 'refused' },
      ],
    });
    await authorized('post', '/inbox/items/bulk')
      .send({ action: 'approve', itemIds: [ITEM_ID] })
      .expect(200);

    // The field of the action is required and every other one refused; the id list is bounded and distinct.
    for (const body of [
      { action: 'assign', itemIds: [ITEM_ID] },
      { action: 'approve', assigneeId: null, itemIds: [ITEM_ID] },
      { action: 'snooze', itemIds: [ITEM_ID], reason: 'spam' },
      { action: 'discard', itemIds: [ITEM_ID], snoozedUntil: null },
      { action: 'discard', itemIds: [ITEM_ID, ITEM_ID], reason: 'spam' },
      { action: 'discard', itemIds: [], reason: 'spam' },
      {
        action: 'discard',
        itemIds: Array.from({ length: 101 }, (_, index) =>
          UNKNOWN_ITEM_ID.replace(/.{3}$/, String(index).padStart(3, '0')),
        ),
        reason: 'spam',
      },
    ]) {
      await authorized('post', '/inbox/items/bulk').send(body).expect(400);
    }
  });

  it('refuses a channel subject on every write route with 403', async () => {
    const channel = (method: 'patch' | 'post', path: string) =>
      request(application.getHttpServer())
        [method](`/v1/organizations/organization_1${path}`)
        .set('Authorization', 'Bearer channel');

    await channel('patch', `/inbox/items/${ITEM_ID}/hints`)
      .send({ hintText: 'x' })
      .expect(403);
    await channel('post', `/inbox/items/${ITEM_ID}/process`).expect(403);
    await channel('post', `/inbox/items/${ITEM_ID}/route/document`)
      .send({ document: documentBody, fileBlobIds: [BLOB_ID] })
      .expect(403);
    await channel('post', `/inbox/items/${ITEM_ID}/route/undo`).expect(403);
    await channel('post', `/inbox/items/${ITEM_ID}/attach`)
      .send({ documentId: DOCUMENT_ID })
      .expect(403);
    await channel('post', '/inbox/items/bulk')
      .send({ action: 'approve', itemIds: [ITEM_ID] })
      .expect(403);
    await channel('post', `/inbox/items/${ITEM_ID}/discard`)
      .send({ reason: 'spam' })
      .expect(403);
    await channel('post', `/inbox/items/${ITEM_ID}/assign`)
      .send({ assigneeId: null })
      .expect(403);
    await channel('post', `/inbox/items/${ITEM_ID}/snooze`)
      .send({ snoozedUntil: null })
      .expect(403);
    expect(Object.keys(calls)).toEqual([]);
  });

  it('refuses every write to a member and every route to a stranger', async () => {
    const member = (method: 'patch' | 'post', path: string) =>
      request(application.getHttpServer())
        [method](`/v1/organizations/organization_3${path}`)
        .set('Authorization', 'Bearer caller');

    await member('patch', `/inbox/items/${ITEM_ID}/hints`)
      .send({ hintText: 'x' })
      .expect(403);
    await member('post', `/inbox/items/${ITEM_ID}/process`).expect(403);
    await member('post', `/inbox/items/${ITEM_ID}/route/document`)
      .send({ document: documentBody, fileBlobIds: [BLOB_ID] })
      .expect(403);
    await member('post', `/inbox/items/${ITEM_ID}/route/undo`).expect(403);
    await member('post', `/inbox/items/${ITEM_ID}/attach`)
      .send({ documentId: DOCUMENT_ID })
      .expect(403);
    await member('post', '/inbox/items/bulk')
      .send({ action: 'approve', itemIds: [ITEM_ID] })
      .expect(403);
    await member('post', `/inbox/items/${ITEM_ID}/discard`)
      .send({ reason: 'spam' })
      .expect(403);
    await member('post', `/inbox/items/${ITEM_ID}/restore`).expect(403);
    await member('post', `/inbox/items/${ITEM_ID}/assign`)
      .send({ assigneeId: null })
      .expect(403);
    await member('post', `/inbox/items/${ITEM_ID}/snooze`)
      .send({ snoozedUntil: null })
      .expect(403);

    // A member may read.
    await request(application.getHttpServer())
      .get(`/v1/organizations/organization_3/inbox/items/${ITEM_ID}`)
      .set('Authorization', 'Bearer caller')
      .expect(200);

    // organization_9 resolves to no membership at all.
    await request(application.getHttpServer())
      .get('/v1/organizations/organization_9/inbox/items')
      .set('Authorization', 'Bearer caller')
      .expect(403);
    await request(application.getHttpServer())
      .get(`/v1/organizations/organization_9/inbox/blobs/${BLOB_ID}/download`)
      .set('Authorization', 'Bearer caller')
      .expect(403);
    await request(application.getHttpServer())
      .get('/v1/organizations/organization_1/inbox/items')
      .set('Authorization', 'Bearer invalid')
      .expect(401);
    expect(Object.keys(calls).sort()).toEqual(['readItem']);
  });

  it('downloads a blob as an attachment with nosniff and the sniffed type', async () => {
    const response = await authorized('get', `/inbox/blobs/${BLOB_ID}/download`)
      .buffer()
      .expect(200);

    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="${SHA256}"`,
    );
    expect(response.headers['content-type']).toBe('text/plain');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-length']).toBe('17');
    expect(response.text).toBe('placeholder bytes');
    expect(calls.openBlob?.[0]).toMatchObject({
      blobId: BLOB_ID,
      inline: false,
    });

    await authorized('get', `/inbox/blobs/${UNKNOWN_BLOB_ID}/download`).expect(
      404,
    );

    // A quarantined blob answers 409 with its code on both blob routes.
    for (const route of ['download', 'inline']) {
      const quarantined = await authorized(
        'get',
        `/inbox/blobs/${QUARANTINED_BLOB_ID}/${route}`,
      ).expect(409);
      expect(quarantined.body).toMatchObject({
        code: 'blob_quarantined',
        status: 409,
      });
    }
  });

  it('renders an image inline under a sandbox policy, a PDF without it, and refuses any other type', async () => {
    const response = await authorized(
      'get',
      `/inbox/blobs/${PDF_BLOB_ID}/inline`,
    )
      .buffer()
      .expect(200);

    // The stored filename is sanitised: no quote, no separator, no semicolon.
    expect(response.headers['content-disposition']).toBe(
      'inline; filename="invoice 1 ..x.pdf"',
    );
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    // A sandboxed context has no plugins, so the PDF viewer would render blank; helmet's default policy stays.
    expect(response.headers['content-security-policy']).not.toBe('sandbox');

    const image = await authorized('get', `/inbox/blobs/${PNG_BLOB_ID}/inline`)
      .buffer()
      .expect(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.headers['x-content-type-options']).toBe('nosniff');
    expect(image.headers['content-security-policy']).toBe('sandbox');

    await authorized('get', `/inbox/blobs/${BLOB_ID}/inline`).expect(415);
    const download = await authorized(
      'get',
      `/inbox/blobs/${BLOB_ID}/download`,
    ).expect(200);
    expect(download.headers['content-security-policy']).not.toBe('sandbox');
  });

  it('publishes only the versioned inbox routes in OpenAPI', () => {
    const document = SwaggerModule.createDocument(
      application,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );

    expect(Object.keys(document.paths).sort()).toEqual([
      '/v1/organizations/{organizationId}/inbox/blobs/{blobId}/download',
      '/v1/organizations/{organizationId}/inbox/blobs/{blobId}/inline',
      '/v1/organizations/{organizationId}/inbox/items',
      '/v1/organizations/{organizationId}/inbox/items/bulk',
      '/v1/organizations/{organizationId}/inbox/items/{itemId}',
      '/v1/organizations/{organizationId}/inbox/items/{itemId}/assign',
      '/v1/organizations/{organizationId}/inbox/items/{itemId}/attach',
      '/v1/organizations/{organizationId}/inbox/items/{itemId}/discard',
      '/v1/organizations/{organizationId}/inbox/items/{itemId}/hints',
      '/v1/organizations/{organizationId}/inbox/items/{itemId}/process',
      '/v1/organizations/{organizationId}/inbox/items/{itemId}/restore',
      '/v1/organizations/{organizationId}/inbox/items/{itemId}/route/document',
      '/v1/organizations/{organizationId}/inbox/items/{itemId}/route/undo',
      '/v1/organizations/{organizationId}/inbox/items/{itemId}/snooze',
      '/v1/organizations/{organizationId}/inbox/uploads',
    ]);

    const list = document.paths[
      '/v1/organizations/{organizationId}/inbox/items'
    ]?.get?.responses['200'] as unknown as {
      content: Record<string, { schema: { required: string[] } }>;
    };

    expect(list.content['application/json']?.schema.required).toEqual([
      'items',
      'page',
      'pageSize',
      'total',
    ]);
  });
});
