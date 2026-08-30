import { organizationIdentifierSchema } from '@bap/security';
import { z } from 'zod';

import {
  subjectIdentifierSchema,
  tenantJobPayloadSchema,
} from '../worker/job-context.js';

export const BACKFILL_EMBEDDINGS_QUEUE = 'backfill_dataset_embeddings';
export const SUMMARIZE_DATASET_QUEUE = 'summarize_dataset';

// Roles the AI credential must name; the credential owns the model, the code owns the role.
export const EMBEDDING_MODEL_ROLE = 'embedding';
export const SUMMARY_MODEL_ROLE = 'summary';

export const datasetIdentifierSchema = z.string().uuid();

// pgboss.job has no row level security and bap_api reads every tenant's jobs.
// Both agent payloads therefore carry identifiers only: no dataset name, no column, no cell value, no prompt.
export const backfillEmbeddingsJobSchema = tenantJobPayloadSchema;

export type BackfillEmbeddingsJob = z.infer<typeof backfillEmbeddingsJobSchema>;

export const summarizeDatasetJobSchema = z
  .object({
    datasetId: datasetIdentifierSchema,
    organizationId: organizationIdentifierSchema,
    userId: subjectIdentifierSchema,
  })
  .strict();

export type SummarizeDatasetJob = z.infer<typeof summarizeDatasetJobSchema>;
