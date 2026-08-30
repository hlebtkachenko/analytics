import type { DatabasePool } from '@bap/db/pool';
import type { PoolClient } from 'pg';

import {
  INGEST_DATASET_QUEUE,
  ingestDatasetJobSchema,
} from '../ingestion/contract.js';
import type { IngestDatasetJob } from '../ingestion/contract.js';
import {
  DatasetParseError,
  inferColumnTypes,
  openDataset,
  resolveDatasetFormat,
} from '../ingestion/parser.js';
import type { DatasetValue, InferredColumnType } from '../ingestion/parser.js';
import {
  deleteStagedFile,
  resolveStagedFilePath,
} from '../ingestion/staging.js';
import { runTenantJob } from './job-context.js';
import type { WorkerMetrics } from './worker-metrics.js';

// Batching is forced by the tenant context contract: it cannot outlive its transaction.
const ROW_BATCH_SIZE = 500;
const MAX_ROWS = 1_000_000;
const MAX_ERROR_LENGTH = 500;

export interface IngestDatasetOptions {
  data: unknown;
  metrics: WorkerMetrics;
  pool: DatabasePool;
  stagingDirectory: string;
}

interface TenantIdentity {
  organizationId: string;
  userId: string;
}

interface ClaimedUpload {
  filename: string;
}

function toRecords(
  columns: readonly string[],
  batch: readonly (readonly DatasetValue[])[],
): string[] {
  return batch.map((values) =>
    JSON.stringify(
      Object.fromEntries(
        columns.map((column, index) => [column, values[index] ?? null]),
      ),
    ),
  );
}

// A retry discards the partially built dataset and starts over, which is cheap while it is importing.
async function claimUpload(
  transaction: PoolClient,
  uploadId: string,
): Promise<ClaimedUpload | null> {
  const found = await transaction.query<{
    dataset_id: string | null;
    filename: string;
    status: string;
  }>('select dataset_id, filename, status from app.upload where id = $1', [
    uploadId,
  ]);
  const row = found.rows[0];

  if (row === undefined) {
    throw new Error('The upload named by the job does not exist.');
  }

  if (row.status === 'completed') {
    return null;
  }

  if (row.dataset_id !== null) {
    await transaction.query('delete from app.dataset where id = $1', [
      row.dataset_id,
    ]);
  }

  await transaction.query(
    "update app.upload set status = 'processing', error = null, dataset_id = null, updated_at = now() where id = $1",
    [uploadId],
  );
  return { filename: row.filename };
}

async function insertRows(
  transaction: PoolClient,
  datasetId: string,
  organizationId: string,
  offset: number,
  columns: readonly string[],
  batch: readonly (readonly DatasetValue[])[],
): Promise<void> {
  await transaction.query(
    `insert into app.dataset_row (dataset_id, organization_id, row_number, data)
     select $1, $2, position_number, row_data
     from unnest($3::int[], $4::jsonb[]) as staged(position_number, row_data)`,
    [
      datasetId,
      organizationId,
      batch.map((_row, index) => offset + index),
      toRecords(columns, batch),
    ],
  );
}

async function createDataset(
  transaction: PoolClient,
  input: {
    columns: readonly string[];
    first: readonly (readonly DatasetValue[])[];
    inferred: readonly InferredColumnType[];
    name: string;
    organizationId: string;
    uploadId: string;
    userId: string;
  },
): Promise<string> {
  const created = await transaction.query<{ id: string }>(
    `insert into app.dataset (organization_id, name, status, created_by)
     values ($1, $2, 'importing', $3)
     returning id`,
    [input.organizationId, input.name, input.userId],
  );
  const datasetId = created.rows[0]?.id;

  if (datasetId === undefined) {
    throw new Error('The dataset insert returned no identifier.');
  }

  await transaction.query(
    `insert into app.dataset_column (dataset_id, name, position, inferred_type)
     select $1, column_name, column_position, column_type
     from unnest($2::text[], $3::int[], $4::text[])
       as staged(column_name, column_position, column_type)`,
    [
      datasetId,
      [...input.columns],
      input.columns.map((_column, index) => index),
      [...input.inferred],
    ],
  );

  if (input.first.length > 0) {
    await insertRows(
      transaction,
      datasetId,
      input.organizationId,
      0,
      input.columns,
      input.first,
    );
  }

  await transaction.query(
    'update app.upload set dataset_id = $1, updated_at = now() where id = $2',
    [datasetId, input.uploadId],
  );
  return datasetId;
}

async function completeDataset(
  transaction: PoolClient,
  input: {
    columnCount: number;
    datasetId: string;
    rowCount: number;
    uploadId: string;
  },
): Promise<void> {
  await transaction.query(
    "update app.dataset set status = 'ready', updated_at = now() where id = $1",
    [input.datasetId],
  );
  await transaction.query(
    "update app.upload set status = 'completed', error = null, updated_at = now() where id = $1",
    [input.uploadId],
  );
  // Attribution is derived from the transaction context, so this must run inside it.
  await transaction.query(
    "select app.record_audit('dataset.ingested', 'dataset', $1, $2::jsonb)",
    [
      input.datasetId,
      JSON.stringify({ columns: input.columnCount, rows: input.rowCount }),
    ],
  );
}

async function recordFailure(
  options: IngestDatasetOptions,
  job: IngestDatasetJob,
  tenant: TenantIdentity,
  error: unknown,
): Promise<void> {
  // Only curated parse messages reach the database; anything else could quote file content.
  const message =
    error instanceof DatasetParseError
      ? error.message.slice(0, MAX_ERROR_LENGTH)
      : 'Ingestion failed.';

  await runTenantJob({
    data: tenant,
    pool: options.pool,
    work: async (transaction) => {
      await transaction.query(
        `update app.dataset set status = 'failed', updated_at = now()
         where id in (select dataset_id from app.upload where id = $1 and dataset_id is not null)`,
        [job.uploadId],
      );
      await transaction.query(
        "update app.upload set status = 'failed', error = $2, updated_at = now() where id = $1",
        [job.uploadId, message],
      );
      await transaction.query(
        "select app.record_audit('dataset.ingestion_failed', 'upload', $1, '{}'::jsonb)",
        [job.uploadId],
      );
    },
  });
}

async function parseAndStore(
  options: IngestDatasetOptions,
  job: IngestDatasetJob,
  tenant: TenantIdentity,
  stagedPath: string,
  upload: ClaimedUpload,
): Promise<number> {
  const format = resolveDatasetFormat(upload.filename);

  if (format === null) {
    throw new DatasetParseError('The upload is not a CSV or XLSX file.');
  }

  const dataset = await openDataset(stagedPath, format);
  const iterator = dataset.rows[Symbol.asyncIterator]();

  const takeBatch = async (): Promise<(readonly DatasetValue[])[]> => {
    const batch: (readonly DatasetValue[])[] = [];

    while (batch.length < ROW_BATCH_SIZE) {
      const next = await iterator.next();

      if (next.done === true) {
        break;
      }

      batch.push(next.value);
    }

    return batch;
  };

  try {
    const first = await takeBatch();
    const inferred = inferColumnTypes(first, dataset.columns.length);
    const datasetId = await runTenantJob({
      data: tenant,
      pool: options.pool,
      work: (transaction) =>
        createDataset(transaction, {
          columns: dataset.columns,
          first,
          inferred,
          name: upload.filename,
          organizationId: tenant.organizationId,
          uploadId: job.uploadId,
          userId: tenant.userId,
        }),
    });
    let total = first.length;

    for (;;) {
      const batch = await takeBatch();

      if (batch.length === 0) {
        break;
      }

      if (total + batch.length > MAX_ROWS) {
        throw new DatasetParseError('The file has more rows than supported.');
      }

      const offset = total;
      await runTenantJob({
        data: tenant,
        pool: options.pool,
        work: (transaction) =>
          insertRows(
            transaction,
            datasetId,
            tenant.organizationId,
            offset,
            dataset.columns,
            batch,
          ),
      });
      total += batch.length;
    }

    await runTenantJob({
      data: tenant,
      pool: options.pool,
      work: (transaction) =>
        completeDataset(transaction, {
          columnCount: dataset.columns.length,
          datasetId,
          rowCount: total,
          uploadId: job.uploadId,
        }),
    });
    return total;
  } finally {
    await iterator.return?.();
  }
}

export async function ingestDataset(
  options: IngestDatasetOptions,
): Promise<void> {
  const job = ingestDatasetJobSchema.parse(options.data);
  const stagedPath = resolveStagedFilePath(
    options.stagingDirectory,
    job.uploadId,
  );
  const tenant: TenantIdentity = {
    organizationId: job.organizationId,
    userId: job.userId,
  };

  try {
    const upload = await runTenantJob({
      data: tenant,
      pool: options.pool,
      work: (transaction) => claimUpload(transaction, job.uploadId),
    });

    if (upload !== null) {
      const rows = await parseAndStore(
        options,
        job,
        tenant,
        stagedPath,
        upload,
      );
      options.metrics.recordIngestedRows(rows);
    }

    options.metrics.recordJob(INGEST_DATASET_QUEUE, 'completed');
  } catch (error) {
    // Recording the failure needs the same tenant gate, which a revoked membership refuses.
    await recordFailure(options, job, tenant, error).catch(() => undefined);
    options.metrics.recordJob(INGEST_DATASET_QUEUE, 'failed');
    throw error;
  } finally {
    await deleteStagedFile(stagedPath);
  }
}
