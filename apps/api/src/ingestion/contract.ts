import { organizationIdentifierSchema } from '@bap/security';
import { z } from 'zod';

import { subjectIdentifierSchema } from '../worker/job-context.js';

export const INGEST_DATASET_QUEUE = 'ingest_dataset';

// The same number Caddy enforces at the edge; 25MB adapts to 25000000 decimal bytes.
export const MAX_UPLOAD_BYTES = 25_000_000;

export const uploadIdentifierSchema = z.string().uuid();

// pgboss.job has no row level security and bap_api reads every tenant's jobs.
// The payload therefore carries identifiers only: no path, no filename, no cell value.
export const ingestDatasetJobSchema = z
  .object({
    organizationId: organizationIdentifierSchema,
    uploadId: uploadIdentifierSchema,
    userId: subjectIdentifierSchema,
  })
  .strict();

export type IngestDatasetJob = z.infer<typeof ingestDatasetJobSchema>;

export const uploadAcceptedResponseSchema = z
  .object({
    status: z.literal('accepted'),
    uploadId: uploadIdentifierSchema,
  })
  .strict();

export type UploadAcceptedResponse = z.infer<
  typeof uploadAcceptedResponseSchema
>;
