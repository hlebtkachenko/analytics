import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { withTenantContext } from '@bap/db';
import { loadDatabaseConfiguration } from '@bap/db/config';
import { createDatabasePool } from '@bap/db/pool';
import type { DatabasePool } from '@bap/db/pool';
import type { PoolClient } from 'pg';

import { MAX_DATASET_LIST_SIZE } from './contract.js';

export type DatasetCellValue = boolean | number | string | null;

export interface TenantSelector {
  organizationId: string;
  userId: string;
}

export interface DatasetSummaryRecord {
  createdAt: string;
  description: string | null;
  id: string;
  name: string;
  rowCount: number;
  status: string;
  updatedAt: string;
}

export interface DatasetColumnRecord {
  inferredType: string;
  name: string;
  position: number;
}

export interface DatasetRowRecord {
  data: Record<string, DatasetCellValue>;
  rowNumber: number;
}

export interface DatasetRowPage {
  columns: DatasetColumnRecord[];
  rows: DatasetRowRecord[];
}

export interface ReadDatasetColumnsInput extends TenantSelector {
  datasetId: string;
}

export interface ReadDatasetRowPageInput extends ReadDatasetColumnsInput {
  after: number | null;
  pageSize: number;
}

export interface StreamDatasetRowsInput extends ReadDatasetColumnsInput {
  batchSize: number;
}

// Keyset paging starts before row_number 0, so the first page needs no separate statement.
const FIRST_ROW_CURSOR = -1;

const ROW_PAGE_QUERY = `select row_number, data
   from app.dataset_row
   where dataset_id = $1 and row_number > $2
   order by row_number
   limit $3`;

interface RowQueryRow {
  data: Record<string, DatasetCellValue>;
  row_number: number;
}

async function inTenantContext<T>(
  pool: DatabasePool,
  tenant: TenantSelector,
  operation: (transaction: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    return await withTenantContext(client, tenant, operation);
  } finally {
    client.release();
  }
}

// Returns null when row level security hides the dataset, so a stranger and a missing id look identical.
async function loadColumns(
  transaction: PoolClient,
  datasetId: string,
): Promise<DatasetColumnRecord[] | null> {
  const visible = await transaction.query<{ id: string }>(
    'select id from app.dataset where id = $1',
    [datasetId],
  );

  if (visible.rows.length === 0) {
    return null;
  }

  const columns = await transaction.query<{
    inferred_type: string;
    name: string;
    position: number;
  }>(
    `select name, position, inferred_type
     from app.dataset_column
     where dataset_id = $1
     order by position`,
    [datasetId],
  );

  return columns.rows.map((row) => ({
    inferredType: row.inferred_type,
    name: row.name,
    position: row.position,
  }));
}

function toRowRecords(rows: readonly RowQueryRow[]): DatasetRowRecord[] {
  return rows.map((row) => ({ data: row.data, rowNumber: row.row_number }));
}

// No authorization clause here on purpose: the dataset_select policy already resolves creator or grant.
export async function listDatasets(
  pool: DatabasePool,
  input: TenantSelector,
): Promise<DatasetSummaryRecord[]> {
  return inTenantContext(pool, input, async (transaction) => {
    const result = await transaction.query<{
      created_at: Date;
      description: string | null;
      id: string;
      name: string;
      row_count: string;
      status: string;
      updated_at: Date;
    }>(
      `select d.id,
              d.name,
              d.description,
              d.status,
              d.created_at,
              d.updated_at,
              (select count(*) from app.dataset_row as r where r.dataset_id = d.id) as row_count
       from app.dataset as d
       order by d.created_at desc, d.id desc
       limit $1`,
      [MAX_DATASET_LIST_SIZE],
    );

    return result.rows.map((row) => ({
      createdAt: row.created_at.toISOString(),
      description: row.description,
      id: row.id,
      name: row.name,
      // count(*) is a bigint, which pg hands over as a string.
      rowCount: Number(row.row_count),
      status: row.status,
      updatedAt: row.updated_at.toISOString(),
    }));
  });
}

export async function readDatasetColumns(
  pool: DatabasePool,
  input: ReadDatasetColumnsInput,
): Promise<DatasetColumnRecord[] | null> {
  return inTenantContext(pool, input, (transaction) =>
    loadColumns(transaction, input.datasetId),
  );
}

export async function readDatasetRowPage(
  pool: DatabasePool,
  input: ReadDatasetRowPageInput,
): Promise<DatasetRowPage | null> {
  return inTenantContext(pool, input, async (transaction) => {
    const columns = await loadColumns(transaction, input.datasetId);

    if (columns === null) {
      return null;
    }

    const rows = await transaction.query<RowQueryRow>(ROW_PAGE_QUERY, [
      input.datasetId,
      input.after ?? FIRST_ROW_CURSOR,
      input.pageSize,
    ]);

    return { columns, rows: toRowRecords(rows.rows) };
  });
}

// One bounded transaction per batch, mirroring the ingestion worker: tenant context cannot outlive its transaction.
export async function* streamDatasetRows(
  pool: DatabasePool,
  input: StreamDatasetRowsInput,
): AsyncGenerator<readonly DatasetRowRecord[]> {
  let cursor = FIRST_ROW_CURSOR;

  for (;;) {
    const batch = await inTenantContext(pool, input, async (transaction) => {
      const rows = await transaction.query<RowQueryRow>(ROW_PAGE_QUERY, [
        input.datasetId,
        cursor,
        input.batchSize,
      ]);

      return toRowRecords(rows.rows);
    });
    const last = batch.at(-1);

    if (last === undefined) {
      return;
    }

    cursor = last.rowNumber;
    yield batch;

    if (batch.length < input.batchSize) {
      return;
    }
  }
}

export abstract class DatasetRepository {
  abstract listDatasets(input: TenantSelector): Promise<DatasetSummaryRecord[]>;
  abstract readColumns(
    input: ReadDatasetColumnsInput,
  ): Promise<DatasetColumnRecord[] | null>;
  abstract readRowPage(
    input: ReadDatasetRowPageInput,
  ): Promise<DatasetRowPage | null>;
  abstract streamRows(
    input: StreamDatasetRowsInput,
  ): AsyncIterable<readonly DatasetRowRecord[]>;
}

@Injectable()
export class DatabaseDatasetRepository
  extends DatasetRepository
  implements OnModuleDestroy
{
  private poolPromise: Promise<DatabasePool> | undefined;

  async listDatasets(input: TenantSelector): Promise<DatasetSummaryRecord[]> {
    return listDatasets(await this.getPool(), input);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.poolPromise !== undefined) {
      await (await this.poolPromise).end();
    }
  }

  async readColumns(
    input: ReadDatasetColumnsInput,
  ): Promise<DatasetColumnRecord[] | null> {
    return readDatasetColumns(await this.getPool(), input);
  }

  async readRowPage(
    input: ReadDatasetRowPageInput,
  ): Promise<DatasetRowPage | null> {
    return readDatasetRowPage(await this.getPool(), input);
  }

  async *streamRows(
    input: StreamDatasetRowsInput,
  ): AsyncGenerator<readonly DatasetRowRecord[]> {
    yield* streamDatasetRows(await this.getPool(), input);
  }

  private getPool(): Promise<DatabasePool> {
    this.poolPromise ??= loadDatabaseConfiguration(process.env, {
      role: 'bap_api',
    }).then(createDatabasePool);
    return this.poolPromise;
  }
}
