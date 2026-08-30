import { assemblePrompt, describeModelCall, generateModelText } from '@bap/ai';
import type { AiRegistry, ModelCallAudit } from '@bap/ai';
import type { DatabasePool } from '@bap/db/pool';
import type { PoolClient } from 'pg';
import { z } from 'zod';

import type { AiRegistryProvider } from '../agents/ai-registry.js';
import {
  SUMMARIZE_DATASET_QUEUE,
  SUMMARY_MODEL_ROLE,
  summarizeDatasetJobSchema,
} from '../agents/contract.js';
import type { SummarizeDatasetJob } from '../agents/contract.js';
import { runTenantJob } from './job-context.js';
import type { WorkerMetrics } from './worker-metrics.js';

const MAX_SUMMARY_LENGTH = 500;
const MAX_OUTPUT_TOKENS = 200;

const SYSTEM_PROMPT =
  'You describe tabular datasets for an analytics catalogue. Answer with one plain sentence and no preamble.';

// Mirrors the ingestion sanitizer: a null byte or a lone surrogate would make PostgreSQL reject the update.
// The u flag makes the range match lone surrogates only, so a valid astral pair is kept.
// eslint-disable-next-line no-control-regex
const UNSTORABLE_TEXT = /[\u0000\uD800-\uDFFF]/gu;

// The model answer is external data, so it is sanitized, required to be non-empty, then bounded.
const summarySchema = z
  .string()
  .transform((value) => value.replace(UNSTORABLE_TEXT, '').trim())
  .pipe(z.string().min(1))
  .transform((value) => value.slice(0, MAX_SUMMARY_LENGTH));

export interface SummarizeDatasetOptions {
  data: unknown;
  metrics: WorkerMetrics;
  pool: DatabasePool;
  registry: AiRegistryProvider;
}

interface DatasetProfile {
  columns: string;
  name: string;
  rows: number;
}

// Schema only: column names, inferred types and a row count. No stored cell value reaches the provider.
async function loadProfile(
  transaction: PoolClient,
  datasetId: string,
): Promise<DatasetProfile> {
  const found = await transaction.query<{
    columns: string;
    name: string;
    rows: string;
  }>(
    `select d.name,
            coalesce((
              select string_agg(c.name || ' (' || c.inferred_type || ')', ', ' order by c.position)
              from app.dataset_column as c
              where c.dataset_id = d.id
            ), '') as columns,
            (select count(*) from app.dataset_row as r where r.dataset_id = d.id)::text as rows
     from app.dataset as d
     where d.id = $1 and d.status = 'ready'`,
    [datasetId],
  );
  const row = found.rows[0];

  if (row === undefined) {
    throw new Error(
      'The dataset named by the job is not readable or not ready.',
    );
  }

  return { columns: row.columns, name: row.name, rows: Number(row.rows) };
}

async function storeSummary(
  transaction: PoolClient,
  input: {
    audit: ModelCallAudit;
    datasetId: string;
    summary: string;
  },
): Promise<void> {
  const updated = await transaction.query(
    'update app.dataset set description = $2, updated_at = now() where id = $1',
    [input.datasetId, input.summary],
  );

  // The update policy matches only the creator, so a read grant leaves the description untouched.
  if (updated.rowCount === 0) {
    throw new Error('The dataset is not writable by the job subject.');
  }

  // Attribution is derived from the transaction context, so the audit call must run inside it.
  // Token counts and the model id only; neither the prompt nor the completion is copied.
  await transaction.query(
    "select app.record_audit('dataset.summarized', 'dataset', $1, $2::jsonb)",
    [input.datasetId, JSON.stringify(input.audit)],
  );
}

// No transaction is open here: the caller commits its read before this runs and opens its write after.
async function requestSummary(
  registry: AiRegistry,
  metrics: WorkerMetrics,
  profile: DatasetProfile,
): Promise<{ audit: ModelCallAudit; summary: string }> {
  const modelId = registry.modelId(SUMMARY_MODEL_ROLE);
  const prompt = assemblePrompt([
    { content: profile.name, title: 'Dataset name' },
    { content: profile.columns, title: 'Columns' },
    { content: String(profile.rows), title: 'Row count' },
  ]);

  try {
    const result = await generateModelText(registry, modelId, {
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      prompt,
      system: SYSTEM_PROMPT,
    });
    const summary = summarySchema.parse(result.text);
    // Recorded once the answer is known to be usable, so a rejected answer counts as an error only.
    metrics.recordModelCall('success');

    return {
      audit: describeModelCall({
        finishReason: result.finishReason,
        modelId,
        outcome: 'success',
        usage: result.usage,
      }),
      summary,
    };
  } catch (error) {
    metrics.recordModelCall('error');
    throw error;
  }
}

// Returns the parsed payload, which is what the embedding backfill is chained from.
export async function summarizeDataset(
  options: SummarizeDatasetOptions,
): Promise<SummarizeDatasetJob> {
  const job: SummarizeDatasetJob = summarizeDatasetJobSchema.parse(
    options.data,
  );
  const tenant = {
    organizationId: job.organizationId,
    userId: job.userId,
  };

  try {
    const registry = await options.registry();
    // Read transaction: it commits before the provider is called, so nothing is held open across the network.
    const profile = await runTenantJob({
      data: tenant,
      pool: options.pool,
      work: (transaction) => loadProfile(transaction, job.datasetId),
    });
    const generated = await requestSummary(registry, options.metrics, profile);

    // Write transaction: opened only after the provider answered, and it audits inside itself.
    await runTenantJob({
      data: tenant,
      pool: options.pool,
      work: (transaction) =>
        storeSummary(transaction, {
          audit: generated.audit,
          datasetId: job.datasetId,
          summary: generated.summary,
        }),
    });
    options.metrics.recordJob(SUMMARIZE_DATASET_QUEUE, 'completed');
    return job;
  } catch (error) {
    options.metrics.recordJob(SUMMARIZE_DATASET_QUEUE, 'failed');
    throw error;
  }
}
