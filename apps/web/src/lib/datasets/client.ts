import { z } from 'zod';

// Mirrors the dataset contract the BFF already validated, so the browser trusts nothing twice.
export const datasetSummarySchema = z.object({
  createdAt: z.string().min(1),
  description: z.string().nullable(),
  id: z.string().min(1),
  name: z.string(),
  rowCount: z.number().int().min(0),
  status: z.enum(['importing', 'ready', 'failed']),
  updatedAt: z.string().min(1),
});

export const datasetListSchema = z.object({
  datasets: z.array(datasetSummarySchema),
});

export const datasetColumnSchema = z.object({
  inferredType: z.string(),
  name: z.string(),
  position: z.number().int().min(0),
});

// The parser stores only JSON scalars, so a cell can hold nothing else.
export const datasetCellSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const datasetRowSchema = z.object({
  data: z.record(z.string(), datasetCellSchema),
  rowNumber: z.number().int().min(0),
});

export const datasetRowPageSchema = z.object({
  columns: z.array(datasetColumnSchema),
  datasetId: z.string().min(1),
  // The row number to send back as `after`, or null once the dataset is exhausted.
  nextCursor: z.number().int().min(0).nullable(),
  pageSize: z.number().int().min(1),
  rows: z.array(datasetRowSchema),
});

export type DatasetCell = z.infer<typeof datasetCellSchema>;
export type DatasetColumn = z.infer<typeof datasetColumnSchema>;
export type DatasetRow = z.infer<typeof datasetRowSchema>;
export type DatasetRowPage = z.infer<typeof datasetRowPageSchema>;
export type DatasetSummary = z.infer<typeof datasetSummarySchema>;

// Well inside the 500 row ceiling the server refuses to exceed, and small enough to read.
export const DATASET_PAGE_SIZE = 25;

export function organizationPath(organizationId: string): string {
  return `/api/bff/application/organizations/${encodeURIComponent(organizationId)}`;
}

export function datasetsPath(organizationId: string): string {
  return `${organizationPath(organizationId)}/datasets`;
}

export function datasetPath(organizationId: string, datasetId: string): string {
  return `${datasetsPath(organizationId)}/${encodeURIComponent(datasetId)}`;
}

export function uploadsPath(organizationId: string): string {
  return `${organizationPath(organizationId)}/uploads`;
}

export async function getJson(
  path: string,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetch(path, { cache: 'no-store', signal });
  if (!response.ok) {
    throw new Error('Request failed.');
  }
  return await response.json();
}

// An aborted effect is an ordinary unmount, not a failure the operator should see.
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
