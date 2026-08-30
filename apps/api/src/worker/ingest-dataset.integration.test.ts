import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  bootstrapDatabaseRoles,
  createDatabasePool,
  runMigrations,
  withTenantContext,
} from '@bap/db';
import type { DatabaseConfiguration, DatabaseRole } from '@bap/db/config';
import type { DatabasePool } from '@bap/db/pool';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import type { PgBoss } from 'pg-boss';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { INGEST_DATASET_QUEUE } from '../ingestion/contract.js';
import { resolveStagedFilePath } from '../ingestion/staging.js';
import { ingestDataset } from './ingest-dataset.js';
import { createQueue, createQueueClientFromConfiguration } from './queue.js';
import { WorkerMetrics } from './worker-metrics.js';

const postgresImage =
  'pgvector/pgvector:pg18@sha256:2ba9ca5f2e7daa0f0e7723cba1ee9167bab54efd3640516a44ac1a928dd67e7a';
const testPassword = 'test-only-database-credential';
const organizationId = 'org-1';
const userId = 'user-1';

let apiPool: DatabasePool;
let boss: PgBoss;
let container: StartedPostgreSqlContainer;
let metrics: WorkerMetrics;
let migratorPool: DatabasePool;
let staging: string;
const outcomes = new Map<string, (result: Error | null) => void>();

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
  operation: (transaction: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await apiPool.connect();

  try {
    return await withTenantContext(
      client,
      { organizationId, userId },
      operation,
    );
  } finally {
    client.release();
  }
}

// Stages a file under the upload id and records the metadata row the worker will claim.
async function stageUpload(
  filename: string,
  content: Buffer | string,
): Promise<string> {
  const uploadId = await asTenant(async (transaction) => {
    const inserted = await transaction.query<{ id: string }>(
      `insert into app.upload (organization_id, filename, byte_size, status)
       values ($1, $2, $3, 'pending')
       returning id`,
      [organizationId, filename, Buffer.byteLength(content)],
    );
    return inserted.rows[0]?.id ?? '';
  });
  await writeFile(resolveStagedFilePath(staging, uploadId), content);
  return uploadId;
}

function awaitJob(uploadId: string): Promise<Error | null> {
  return new Promise<Error | null>((resolve) => {
    outcomes.set(uploadId, resolve);
  });
}

beforeAll(async () => {
  staging = await mkdtemp(join(tmpdir(), 'bap-ingest-'));
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
      values ('user-1', 'Member', 'member@example.test', true)
    `);
    await migrator.query(`
      insert into auth.organization (id, name, slug) values ('org-1', 'One', 'one')
    `);
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
  metrics = new WorkerMetrics();
  boss = createQueueClientFromConfiguration(configurationFor('bap_api'));
  boss.on('error', () => undefined);
  await boss.start();
  await createQueue(boss, INGEST_DATASET_QUEUE);
});

afterAll(async () => {
  await boss.stop({ graceful: false });
  await Promise.all([apiPool.end(), migratorPool.end()]);
  await container.stop();
  await rm(staging, { force: true, recursive: true });
});

describe('dataset ingestion through the real queue', () => {
  it('carries identifiers only in the queued payload', async () => {
    const uploadId = await stageUpload(
      'measurements.csv',
      'label,amount\nalpha,1\n',
    );
    await boss.send(
      INGEST_DATASET_QUEUE,
      { organizationId, uploadId, userId },
      { retryLimit: 0 },
    );

    const queued = await apiPool.query<{ data: Record<string, unknown> }>(
      'select data from pgboss.job where name = $1',
      [INGEST_DATASET_QUEUE],
    );

    expect(queued.rows).toHaveLength(1);
    expect(Object.keys(queued.rows[0]?.data ?? {}).sort()).toEqual([
      'organizationId',
      'uploadId',
      'userId',
    ]);
    const payload = JSON.stringify(queued.rows[0]?.data);
    expect(payload).not.toContain('measurements.csv');
    expect(payload).not.toContain('alpha');
    expect(payload).not.toContain(staging);

    const settled = awaitJob(uploadId);
    // The handler is registered only now, so the payload above is the one a peer tenant could read.
    await boss.work<unknown, void>(
      INGEST_DATASET_QUEUE,
      { pollingIntervalSeconds: 1 },
      async (jobs) => {
        for (const job of jobs) {
          const data = job.data as { uploadId?: string };
          const settle = outcomes.get(data.uploadId ?? '');

          try {
            await ingestDataset({
              data: job.data,
              metrics,
              pool: apiPool,
              stagingDirectory: staging,
            });
            settle?.(null);
          } catch (error) {
            settle?.(error as Error);
            throw error;
          }
        }
      },
    );

    await expect(settled).resolves.toBeNull();

    const stored = await asTenant(async (transaction) => {
      const dataset = await transaction.query<{
        id: string;
        name: string;
        status: string;
      }>(
        'select id, name, status from app.dataset where id = (select dataset_id from app.upload where id = $1)',
        [uploadId],
      );
      const columns = await transaction.query<{
        inferred_type: string;
        name: string;
        position: number;
      }>(
        'select inferred_type, name, position from app.dataset_column where dataset_id = $1 order by position',
        [dataset.rows[0]?.id],
      );
      const rows = await transaction.query<{
        data: Record<string, unknown>;
        row_number: number;
      }>(
        'select data, row_number from app.dataset_row where dataset_id = $1 order by row_number',
        [dataset.rows[0]?.id],
      );
      const upload = await transaction.query<{
        error: string | null;
        status: string;
      }>('select error, status from app.upload where id = $1', [uploadId]);
      const audit = await transaction.query<{
        action: string;
        user_id: string;
      }>('select action, user_id from app.audit_log order by created_at');
      return { audit, columns, dataset, rows, upload };
    });

    expect(stored.dataset.rows[0]).toMatchObject({
      name: 'measurements.csv',
      status: 'ready',
    });
    expect(stored.columns.rows).toEqual([
      { inferred_type: 'text', name: 'label', position: 0 },
      { inferred_type: 'number', name: 'amount', position: 1 },
    ]);
    expect(stored.rows.rows).toEqual([
      { data: { amount: '1', label: 'alpha' }, row_number: 0 },
    ]);
    expect(stored.upload.rows[0]).toEqual({ error: null, status: 'completed' });
    expect(stored.audit.rows).toEqual([
      { action: 'dataset.ingested', user_id: userId },
    ]);
    // The staged file is deleted on the success path.
    await expect(readdir(staging)).resolves.not.toContain(uploadId);
  });

  it('fails the upload with a bounded message when the content contradicts the extension', async () => {
    const uploadId = await stageUpload(
      'workbook.xlsx',
      'label,amount\nalpha,1\n',
    );
    const settled = awaitJob(uploadId);
    await boss.send(
      INGEST_DATASET_QUEUE,
      { organizationId, uploadId, userId },
      { retryLimit: 0 },
    );

    await expect(settled).resolves.toBeInstanceOf(Error);

    const stored = await asTenant(async (transaction) => {
      const upload = await transaction.query<{
        dataset_id: string | null;
        error: string | null;
        status: string;
      }>('select dataset_id, error, status from app.upload where id = $1', [
        uploadId,
      ]);
      const audit = await transaction.query<{ action: string }>(
        'select action from app.audit_log where resource_id = $1',
        [uploadId],
      );
      return { audit, upload };
    });

    expect(stored.upload.rows[0]).toEqual({
      dataset_id: null,
      error: 'The file is declared as XLSX but is not a workbook.',
      status: 'failed',
    });
    expect(stored.audit.rows).toEqual([{ action: 'dataset.ingestion_failed' }]);
    // The staged file is deleted on the failure path too.
    await expect(readdir(staging)).resolves.not.toContain(uploadId);
  });

  it('exports ingestion counters without an identifier label', async () => {
    const output = await metrics.render();

    expect(output).toContain(
      'bap_worker_jobs_total{outcome="completed",queue="ingest_dataset"} 1',
    );
    expect(output).toContain(
      'bap_worker_jobs_total{outcome="failed",queue="ingest_dataset"} 1',
    );
    expect(output).toContain('bap_worker_ingested_rows_total 1');
    expect(output).not.toContain(organizationId);
    expect(output).not.toContain(userId);
  });
});
