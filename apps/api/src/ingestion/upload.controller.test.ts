import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
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
import { MAX_UPLOAD_BYTES } from './contract.js';
import type { IngestDatasetJob } from './contract.js';
import { IngestionQueue } from './ingestion-queue.js';
import { UploadController } from './upload.controller.js';
import { UploadRepository } from './upload-repository.js';
import type { RecordUploadInput } from './upload-repository.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEGAL_ENTITY_ID = '4a2b7c1e-9f5d-4c3a-8b21-6e0f7d5a4c39';
const OTHER_LEGAL_ENTITY_ID = '5b3c8d2f-0a6e-4d4b-9c32-7f1a8e6b5d40';

describe('application upload route', () => {
  let application: NestExpressApplication;
  let entityScope: EntityScope = { mode: 'all' };
  let staging: string;
  const enqueued: IngestDatasetJob[] = [];
  const recorded: RecordUploadInput[] = [];
  const limiter = new SubjectRateLimiter({
    limit: 50,
    maxEntries: 8,
    windowMs: 60_000,
  });
  const verifier: ResourceJwtVerifier = {
    verifyAuthorizationHeader: vi.fn(async (header) => {
      if (header === 'Bearer member') {
        return { issuedAt: 1_800_000_000, subject: 'user_1' };
      }
      throw new Error('invalid');
    }),
    verifyToken: vi.fn(),
  };
  const memberships: MembershipResolver = {
    checkReadiness: vi.fn(async () => true),
    getPoolStatistics: vi.fn(() => ({ idle: 0, total: 0, waiting: 0 })),
    readEntityScope: vi.fn(async () => entityScope),
    resolve: vi.fn(async (_subject, organizationId) => {
      if (organizationId === 'organization_1') {
        return { emailVerified: true, role: 'admin' as const };
      }
      // A read-only member holds no uploadData capability at all.
      if (organizationId === 'organization_3') {
        return { emailVerified: true, role: 'member' as const };
      }
      return { emailVerified: false, role: null };
    }),
  };
  const uploads: UploadRepository = {
    fail: vi.fn(async () => undefined),
    record: vi.fn(async (input: RecordUploadInput) => {
      recorded.push(input);
      // The repository resolves the entity through row level security; an unknown id records nothing.
      return input.legalEntityId !== OTHER_LEGAL_ENTITY_ID;
    }),
  };
  const queue: IngestionQueue = {
    enqueue: vi.fn(async (job: IngestDatasetJob) => {
      enqueued.push(job);
    }),
  };

  const upload = (
    filename: string,
    body: Buffer | string,
    contentType: string,
    organizationId = 'organization_1',
    authorization = 'Bearer member',
    legalEntityId: string | null = LEGAL_ENTITY_ID,
  ) => {
    const pending = request(application.getHttpServer())
      .post(`/v1/organizations/${organizationId}/uploads`)
      .set('Authorization', authorization);

    if (legalEntityId !== null) {
      void pending.field('legalEntityId', legalEntityId);
    }

    return pending.attach(
      'file',
      Buffer.isBuffer(body) ? body : Buffer.from(body),
      { contentType, filename },
    );
  };

  beforeAll(async () => {
    staging = await mkdtemp(join(tmpdir(), 'bap-upload-'));
    vi.stubEnv('BAP_UPLOAD_STAGING_DIR', staging);
    const module = await Test.createTestingModule({
      controllers: [UploadController],
      providers: [
        { provide: IngestionQueue, useValue: queue },
        { provide: MembershipResolver, useValue: memberships },
        { provide: RESOURCE_JWT_VERIFIER, useValue: verifier },
        { provide: SUBJECT_RATE_LIMITER, useValue: limiter },
        { provide: UploadRepository, useValue: uploads },
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
    await rm(staging, { force: true, recursive: true });
  });

  beforeEach(() => {
    entityScope = { mode: 'all' };
    enqueued.length = 0;
    recorded.length = 0;
  });

  it('stages a CSV under the generated upload id and enqueues identifiers only', async () => {
    const response = await upload('report.csv', 'label\nfirst\n', 'text/csv');

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('accepted');
    expect(response.body.uploadId).toMatch(UUID);
    expect(enqueued).toEqual([
      {
        organizationId: 'organization_1',
        uploadId: response.body.uploadId,
        userId: 'user_1',
      },
    ]);
    // pgboss.job is cross-tenant readable, so the payload must hold no name, path or content.
    const payload = JSON.stringify(enqueued[0]);
    expect(payload).not.toContain('report.csv');
    expect(payload).not.toContain('label');
    expect(payload).not.toContain(staging);
    expect(recorded).toEqual([
      {
        byteSize: 12,
        filename: 'report.csv',
        legalEntityId: LEGAL_ENTITY_ID,
        organizationId: 'organization_1',
        role: 'admin',
        uploadId: response.body.uploadId,
        userId: 'user_1',
      },
    ]);
    await expect(
      readFile(join(staging, String(response.body.uploadId)), 'utf8'),
    ).resolves.toBe('label\nfirst\n');
  });

  it('stages a traversal filename under the upload id and records it as a label', async () => {
    const response = await upload(
      '../../etc/passwd.csv',
      'label\nfirst\n',
      'text/csv',
    );

    expect(response.status).toBe(201);
    // The staged name is the upload id, so the claimed name never reaches the filesystem.
    await expect(readdir(staging)).resolves.toContain(
      String(response.body.uploadId),
    );
    await expect(readdir(staging)).resolves.not.toContain('passwd.csv');
    expect(recorded[0]?.filename).not.toContain('/');
    expect(recorded[0]?.filename).toBe('passwd.csv');
  });

  it('decodes a non-ASCII multipart filename as UTF-8 and stores it unchanged', async () => {
    const filename = 'přehled-2026.csv';
    const response = await upload(filename, 'label\nfirst\n', 'text/csv');

    // Decoded as latin1 the same bytes carry U+0099, which SAFE_FILENAME rejects with a bare 400.
    expect(response.status).toBe(201);
    expect(recorded[0]?.filename).toBe(filename);
    expect(enqueued).toHaveLength(1);
  });

  it('rejects a filename carrying a bidirectional override', async () => {
    const before = await readdir(staging);
    const response = await upload(
      'repor\u202Evsc.csv',
      'label\nfirst\n',
      'text/csv',
    );

    expect(response.status).toBe(400);
    await expect(readdir(staging)).resolves.toEqual(before);
    expect(enqueued).toEqual([]);
  });

  it('rejects an unsupported extension and a mismatched media type', async () => {
    const before = await readdir(staging);
    const executable = await upload('payload.exe', 'binary', 'text/csv');
    const mismatched = await upload('report.csv', 'label\n', 'image/png');

    expect([executable.status, mismatched.status]).toEqual([400, 400]);
    await expect(readdir(staging)).resolves.toEqual(before);
    expect(enqueued).toEqual([]);
  });

  it('rejects an upload larger than the edge limit by the bytes it received', async () => {
    const before = await readdir(staging);
    const response = await upload(
      'large.csv',
      Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x61),
      'text/csv',
    );

    expect(response.status).toBe(413);
    expect(response.body).toMatchObject({
      status: 413,
      title: 'Payload too large',
    });
    await expect(readdir(staging)).resolves.toEqual(before);
    expect(enqueued).toEqual([]);
    expect(recorded).toEqual([]);
  });

  it('refuses a missing, malformed or out-of-scope legal entity field', async () => {
    const before = await readdir(staging);
    const missing = await upload(
      'report.csv',
      'label\n',
      'text/csv',
      'organization_1',
      'Bearer member',
      null,
    );
    const malformed = await upload(
      'report.csv',
      'label\n',
      'text/csv',
      'organization_1',
      'Bearer member',
      'not-a-uuid',
    );
    entityScope = { legalEntityIds: [LEGAL_ENTITY_ID], mode: 'restricted' };
    const outOfScope = await upload(
      'report.csv',
      'label\n',
      'text/csv',
      'organization_1',
      'Bearer member',
      OTHER_LEGAL_ENTITY_ID,
    );

    expect([missing.status, malformed.status, outOfScope.status]).toEqual([
      400, 400, 400,
    ]);
    await expect(readdir(staging)).resolves.toEqual(before);
    expect(enqueued).toEqual([]);
    expect(recorded).toEqual([]);
  });

  it('answers an unknown legal entity exactly like an out-of-scope one', async () => {
    const before = await readdir(staging);
    const response = await upload(
      'report.csv',
      'label\n',
      'text/csv',
      'organization_1',
      'Bearer member',
      OTHER_LEGAL_ENTITY_ID,
    );

    expect(response.status).toBe(400);
    expect(recorded).toHaveLength(1);
    expect(enqueued).toEqual([]);
    // The staged file is removed again once the entity turns out to be unknown.
    await expect(readdir(staging)).resolves.toEqual(before);
  });

  it('denies a read-only member and removes the staged file', async () => {
    const before = await readdir(staging);
    const response = await upload(
      'report.csv',
      'label\n',
      'text/csv',
      'organization_3',
    );

    expect(response.status).toBe(403);
    await expect(readdir(staging)).resolves.toEqual(before);
    expect(enqueued).toEqual([]);
    expect(recorded).toEqual([]);
  });

  it('refuses an unauthenticated request before staging anything', async () => {
    const before = await readdir(staging);
    const response = await upload(
      'report.csv',
      'label\n',
      'text/csv',
      'organization_1',
      'Bearer forged',
    );

    expect(response.status).toBe(401);
    await expect(readdir(staging)).resolves.toEqual(before);
  });

  it('denies a subject without membership and removes the staged file', async () => {
    const before = await readdir(staging);
    const response = await upload(
      'report.csv',
      'label\n',
      'text/csv',
      'organization_2',
    );

    expect(response.status).toBe(403);
    await expect(readdir(staging)).resolves.toEqual(before);
    expect(enqueued).toEqual([]);
  });
});
