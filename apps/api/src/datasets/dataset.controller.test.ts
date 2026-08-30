import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { SubjectRateLimiter, type ResourceJwtVerifier } from '@bap/security';
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
import { DATASET_EXPORT_BATCH_SIZE } from './contract.js';
import { DatasetController } from './dataset.controller.js';
import { DatasetRepository } from './dataset-repository.js';
import type {
  DatasetColumnRecord,
  DatasetRowRecord,
  ReadDatasetRowPageInput,
  StreamDatasetRowsInput,
} from './dataset-repository.js';

const DATASET_ID = '2f1c4a4e-6f0d-4f0a-9b3e-0d5b5c8a1e77';
const HIDDEN_DATASET_ID = '0b0f1d2e-3c4b-4a59-8d6e-7f8091a2b3c4';
// A neutral placeholder name carrying the characters a header injection would need.
const DATASET_NAME = 'placeholder "quoted"; name';

const columns: DatasetColumnRecord[] = [
  { inferredType: 'text', name: 'label', position: 0 },
  { inferredType: 'number', name: 'count', position: 1 },
];

const rows: DatasetRowRecord[] = Array.from({ length: 5 }, (_value, index) => ({
  data: { count: index, label: `row-${index}` },
  rowNumber: index,
}));

describe('application dataset routes', () => {
  let application: NestExpressApplication;
  const rowPageCalls: ReadDatasetRowPageInput[] = [];
  const streamCalls: StreamDatasetRowsInput[] = [];
  const streamPulls: number[] = [];
  const limiter = new SubjectRateLimiter({
    limit: 100,
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
    resolve: vi.fn(async (_subject, organizationId) =>
      organizationId === 'organization_1'
        ? { emailVerified: true, role: 'member' as const }
        : { emailVerified: false, role: null },
    ),
  };
  const datasets: DatasetRepository = {
    listDatasets: vi.fn(async () => [
      {
        createdAt: '2026-08-30T06:00:00.000Z',
        description: null,
        id: DATASET_ID,
        name: DATASET_NAME,
        rowCount: rows.length,
        status: 'ready',
        updatedAt: '2026-08-30T06:05:00.000Z',
      },
    ]),
    readColumns: vi.fn(async (input) =>
      input.datasetId === DATASET_ID ? columns : null,
    ),
    readRowPage: vi.fn(async (input) => {
      rowPageCalls.push(input);

      if (input.datasetId !== DATASET_ID) {
        return null;
      }

      const after = input.after ?? -1;
      return {
        columns,
        rows: rows
          .filter((row) => row.rowNumber > after)
          .slice(0, input.pageSize),
      };
    }),
    streamRows: vi.fn((input) => {
      streamCalls.push(input);

      return (async function* () {
        for (let index = 0; index < rows.length; index += 2) {
          streamPulls.push(index);
          yield rows.slice(index, index + 2);
        }
      })();
    }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [DatasetController],
      providers: [
        { provide: DatasetRepository, useValue: datasets },
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
  });

  beforeEach(() => {
    rowPageCalls.length = 0;
    streamCalls.length = 0;
    streamPulls.length = 0;
  });

  it('lists the datasets the caller can see', async () => {
    const response = await request(application.getHttpServer())
      .get('/v1/organizations/organization_1/datasets')
      .set('Authorization', 'Bearer member')
      .expect(200);

    expect(response.body).toEqual({
      datasets: [
        {
          createdAt: '2026-08-30T06:00:00.000Z',
          description: null,
          id: DATASET_ID,
          name: DATASET_NAME,
          rowCount: 5,
          status: 'ready',
          updatedAt: '2026-08-30T06:05:00.000Z',
        },
      ],
    });
  });

  it('refuses an invalid token and a subject without membership', async () => {
    await request(application.getHttpServer())
      .get('/v1/organizations/organization_1/datasets')
      .set('Authorization', 'Bearer forged')
      .expect(401);
    await request(application.getHttpServer())
      .get('/v1/organizations/organization_2/datasets')
      .set('Authorization', 'Bearer member')
      .expect(403);
  });

  it('returns the columns and one keyset page of rows', async () => {
    const first = await request(application.getHttpServer())
      .get(`/v1/organizations/organization_1/datasets/${DATASET_ID}/rows`)
      .query({ pageSize: 2 })
      .set('Authorization', 'Bearer member')
      .expect(200);

    expect(first.body).toEqual({
      columns: [
        { inferredType: 'text', name: 'label', position: 0 },
        { inferredType: 'number', name: 'count', position: 1 },
      ],
      datasetId: DATASET_ID,
      nextCursor: 1,
      pageSize: 2,
      rows: [
        { data: { count: 0, label: 'row-0' }, rowNumber: 0 },
        { data: { count: 1, label: 'row-1' }, rowNumber: 1 },
      ],
    });

    const last = await request(application.getHttpServer())
      .get(`/v1/organizations/organization_1/datasets/${DATASET_ID}/rows`)
      .query({ after: 3, pageSize: 2 })
      .set('Authorization', 'Bearer member')
      .expect(200);

    // A short page ends the walk, so no cursor invites an empty round trip.
    expect(last.body.rows).toHaveLength(1);
    expect(last.body.nextCursor).toBeNull();
    expect(rowPageCalls).toEqual([
      {
        after: null,
        datasetId: DATASET_ID,
        organizationId: 'organization_1',
        pageSize: 2,
        userId: 'user_1',
      },
      {
        after: 3,
        datasetId: DATASET_ID,
        organizationId: 'organization_1',
        pageSize: 2,
        userId: 'user_1',
      },
    ]);
  });

  it('rejects an oversized or malformed page size before reaching the repository', async () => {
    const oversized = await request(application.getHttpServer())
      .get(`/v1/organizations/organization_1/datasets/${DATASET_ID}/rows`)
      .query({ pageSize: 501 })
      .set('Authorization', 'Bearer member')
      .expect(400);
    await request(application.getHttpServer())
      .get(`/v1/organizations/organization_1/datasets/${DATASET_ID}/rows`)
      .query({ pageSize: 0 })
      .set('Authorization', 'Bearer member')
      .expect(400);
    await request(application.getHttpServer())
      .get(`/v1/organizations/organization_1/datasets/${DATASET_ID}/rows`)
      .query({ unexpected: 'value' })
      .set('Authorization', 'Bearer member')
      .expect(400);

    // Rejected, never clamped: nothing was read on the caller's behalf.
    expect(oversized.body).toMatchObject({ status: 400 });
    expect(rowPageCalls).toEqual([]);
  });

  it('hides a dataset the caller cannot read behind a not found answer', async () => {
    await request(application.getHttpServer())
      .get(
        `/v1/organizations/organization_1/datasets/${HIDDEN_DATASET_ID}/rows`,
      )
      .set('Authorization', 'Bearer member')
      .expect(404);
    await request(application.getHttpServer())
      .get(
        `/v1/organizations/organization_1/datasets/${HIDDEN_DATASET_ID}/export`,
      )
      .query({ format: 'csv' })
      .set('Authorization', 'Bearer member')
      .expect(404);
    await request(application.getHttpServer())
      .get('/v1/organizations/organization_1/datasets/not-a-uuid/rows')
      .set('Authorization', 'Bearer member')
      .expect(400);
  });

  it('streams a CSV named after the dataset id and reads it in batches', async () => {
    const response = await request(application.getHttpServer())
      .get(`/v1/organizations/organization_1/datasets/${DATASET_ID}/export`)
      .query({ format: 'csv' })
      .set('Authorization', 'Bearer member')
      .expect(200);

    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="dataset-${DATASET_ID}.csv"`,
    );
    expect(response.headers['content-disposition']).not.toContain(
      'placeholder',
    );
    expect(response.text).toBe(
      '\uFEFFlabel,count\r\nrow-0,0\r\nrow-1,1\r\nrow-2,2\r\nrow-3,3\r\nrow-4,4\r\n',
    );
    // Structural: the rows arrived as bounded batches, never as one resident result set.
    expect(streamPulls).toEqual([0, 2, 4]);
    expect(streamCalls).toEqual([
      {
        batchSize: DATASET_EXPORT_BATCH_SIZE,
        datasetId: DATASET_ID,
        organizationId: 'organization_1',
        userId: 'user_1',
      },
    ]);
  });

  it('streams an XLSX workbook and refuses any other format', async () => {
    const response = await request(application.getHttpServer())
      .get(`/v1/organizations/organization_1/datasets/${DATASET_ID}/export`)
      .query({ format: 'xlsx' })
      .responseType('blob')
      .set('Authorization', 'Bearer member')
      .expect(200);

    expect(response.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="dataset-${DATASET_ID}.xlsx"`,
    );
    // Every XLSX file is a zip archive, so the local file header signature opens it.
    expect(Buffer.from(response.body).subarray(0, 4)).toEqual(
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    );

    await request(application.getHttpServer())
      .get(`/v1/organizations/organization_1/datasets/${DATASET_ID}/export`)
      .query({ format: 'pdf' })
      .set('Authorization', 'Bearer member')
      .expect(400);
    await request(application.getHttpServer())
      .get(`/v1/organizations/organization_1/datasets/${DATASET_ID}/export`)
      .set('Authorization', 'Bearer member')
      .expect(400);
  });

  it('publishes only the versioned dataset routes in OpenAPI', () => {
    const document = SwaggerModule.createDocument(
      application,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );

    expect(Object.keys(document.paths).sort()).toEqual([
      '/v1/organizations/{organizationId}/datasets',
      '/v1/organizations/{organizationId}/datasets/{datasetId}/export',
      '/v1/organizations/{organizationId}/datasets/{datasetId}/rows',
    ]);
    expect(
      document.paths['/v1/organizations/{organizationId}/datasets']?.get
        ?.responses['200'],
    ).toBeDefined();
  });
});
