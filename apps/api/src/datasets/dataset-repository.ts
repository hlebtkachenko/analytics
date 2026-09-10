import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { runInTenantContext } from '@bap/db';
import type { TenantContext } from '@bap/db';
import { loadDatabaseConfiguration } from '@bap/db/config';
import { createDatabasePool } from '@bap/db/pool';
import type { DatabasePool } from '@bap/db/pool';
import type { PoolClient } from 'pg';

import { MAX_DATASET_LIST_SIZE } from './contract.js';

export type DatasetCellValue = boolean | number | string | null;

export type { TenantContext };

// null is the absence of an entity filter; an empty array is a caller who may see nothing.
export interface EntityScopeSelector extends TenantContext {
  legalEntityIds: readonly string[] | null;
}

export interface DatasetSummaryRecord {
  createdAt: string;
  description: string | null;
  id: string;
  legalEntityId: string;
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

export interface ReadDatasetColumnsInput extends EntityScopeSelector {
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

// Returns null when row level security hides the dataset or the entity is out of scope, so a stranger, a restricted member and a missing id all get the same answer.
async function loadColumns(
  transaction: PoolClient,
  datasetId: string,
  legalEntityIds: readonly string[] | null,
): Promise<DatasetColumnRecord[] | null> {
  const visible = await transaction.query<{ id: string }>(
    `select id
     from app.dataset
     where id = $1
       and ($2::uuid[] is null or legal_entity_id = any($2::uuid[]))`,
    [datasetId, legalEntityIds === null ? null : [...legalEntityIds]],
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

// Row level security decides the organization; the entity list is the application scope filter ADR 0011 requires.
export async function listDatasets(
  pool: DatabasePool,
  input: EntityScopeSelector,
): Promise<DatasetSummaryRecord[]> {
  return runInTenantContext(pool, input, async (transaction) => {
    const result = await transaction.query<{
      created_at: Date;
      description: string | null;
      id: string;
      legal_entity_id: string;
      name: string;
      row_count: string;
      status: string;
      updated_at: Date;
    }>(
      `select d.id,
              d.name,
              d.description,
              d.status,
              d.legal_entity_id,
              d.created_at,
              d.updated_at,
              (select count(*) from app.dataset_row as r where r.dataset_id = d.id) as row_count
       from app.dataset as d
       where ($1::uuid[] is null or d.legal_entity_id = any($1::uuid[]))
       order by d.created_at desc, d.id desc
       limit $2`,
      [
        input.legalEntityIds === null ? null : [...input.legalEntityIds],
        MAX_DATASET_LIST_SIZE,
      ],
    );

    return result.rows.map((row) => ({
      createdAt: row.created_at.toISOString(),
      description: row.description,
      id: row.id,
      legalEntityId: row.legal_entity_id,
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
  return runInTenantContext(pool, input, (transaction) =>
    loadColumns(transaction, input.datasetId, input.legalEntityIds),
  );
}

export async function readDatasetRowPage(
  pool: DatabasePool,
  input: ReadDatasetRowPageInput,
): Promise<DatasetRowPage | null> {
  return runInTenantContext(pool, input, async (transaction) => {
    const columns = await loadColumns(
      transaction,
      input.datasetId,
      input.legalEntityIds,
    );

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
    const batch = await runInTenantContext(pool, input, async (transaction) => {
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
  abstract listDatasets(
    input: EntityScopeSelector,
  ): Promise<DatasetSummaryRecord[]>;
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

  async listDatasets(
    input: EntityScopeSelector,
  ): Promise<DatasetSummaryRecord[]> {
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
