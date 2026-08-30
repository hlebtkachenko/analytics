import { z } from 'zod';

import { datasetIdentifierSchema } from '../agents/contract.js';

// The whole list is bounded on the server; no client parameter widens it.
export const MAX_DATASET_LIST_SIZE = 200;

// The hard bound on one page of rows. A larger client value is rejected with 400, never clamped.
export const MAX_DATASET_ROW_PAGE_SIZE = 500;
export const DEFAULT_DATASET_ROW_PAGE_SIZE = 100;

// One export slice: a tenant transaction cannot outlive itself, so rows leave PostgreSQL in batches.
export const DATASET_EXPORT_BATCH_SIZE = 500;

export const datasetStatusSchema = z.enum(['importing', 'ready', 'failed']);

export const datasetExportFormatSchema = z.enum(['csv', 'xlsx']);

export type DatasetExportFormat = z.infer<typeof datasetExportFormatSchema>;

// Keyset paging on app.dataset_row(dataset_id, row_number), which is unique, so no OFFSET is needed.
export const datasetRowQuerySchema = z
  .object({
    after: z.coerce.number().int().min(0).optional(),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_DATASET_ROW_PAGE_SIZE)
      .default(DEFAULT_DATASET_ROW_PAGE_SIZE),
  })
  .strict();

export type DatasetRowQuery = z.infer<typeof datasetRowQuerySchema>;

export const datasetExportQuerySchema = z
  .object({ format: datasetExportFormatSchema })
  .strict();

export type DatasetExportQuery = z.infer<typeof datasetExportQuerySchema>;

export const datasetSummarySchema = z
  .object({
    createdAt: z.iso.datetime(),
    description: z.string().nullable(),
    id: datasetIdentifierSchema,
    name: z.string(),
    rowCount: z.number().int().min(0),
    status: datasetStatusSchema,
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const datasetListResponseSchema = z
  .object({ datasets: z.array(datasetSummarySchema) })
  .strict();

export type DatasetListResponse = z.infer<typeof datasetListResponseSchema>;

export const datasetColumnSchema = z
  .object({
    inferredType: z.string(),
    name: z.string(),
    position: z.number().int().min(0),
  })
  .strict();

// The parser stores only JSON scalars, so a cell can hold nothing else.
export const datasetCellSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const datasetRowSchema = z
  .object({
    data: z.record(z.string(), datasetCellSchema),
    rowNumber: z.number().int().min(0),
  })
  .strict();

export const datasetRowPageResponseSchema = z
  .object({
    columns: z.array(datasetColumnSchema),
    datasetId: datasetIdentifierSchema,
    // The row_number to pass back as `after`, or null when the dataset has no further rows.
    nextCursor: z.number().int().min(0).nullable(),
    pageSize: z.number().int().min(1).max(MAX_DATASET_ROW_PAGE_SIZE),
    rows: z.array(datasetRowSchema),
  })
  .strict();

export type DatasetRowPageResponse = z.infer<
  typeof datasetRowPageResponseSchema
>;

export const DATASET_EXPORT_MEDIA_TYPES: Readonly<
  Record<DatasetExportFormat, string>
> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

// Derived from the validated dataset id, never from app.dataset.name, so stored text cannot steer the header.
export function datasetExportFilename(
  datasetId: string,
  format: DatasetExportFormat,
): string {
  return `dataset-${datasetIdentifierSchema.parse(datasetId)}.${datasetExportFormatSchema.parse(format)}`;
}
