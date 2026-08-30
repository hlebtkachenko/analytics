import { embedTexts } from '@bap/ai';
import type { AiModelId, AiRegistry } from '@bap/ai';
import type { DatabasePool } from '@bap/db/pool';

import type { AiRegistryProvider } from '../agents/ai-registry.js';
import {
  BACKFILL_EMBEDDINGS_QUEUE,
  backfillEmbeddingsJobSchema,
  EMBEDDING_MODEL_ROLE,
} from '../agents/contract.js';
import { hashDocument, renderDatasetDocument } from '../agents/document.js';
import {
  EMBEDDING_DIMENSIONS,
  FIRST_DATASET_CURSOR,
  loadEmbeddingCandidates,
  storeDatasetEmbeddings,
} from '../agents/embedding-repository.js';
import type {
  EmbeddingCandidate,
  StoredEmbedding,
} from '../agents/embedding-repository.js';
import { runTenantJob } from './job-context.js';
import type { WorkerMetrics } from './worker-metrics.js';

// One provider call per page, so the page size is also the batch size the model sees.
const PAGE_SIZE = 32;

// Bounds a single run; a tenant beyond this keeps its remaining datasets for the next enqueue.
const MAX_DATASETS = 5_000;

export interface BackfillDatasetEmbeddingsOptions {
  data: unknown;
  metrics: WorkerMetrics;
  pool: DatabasePool;
  registry: AiRegistryProvider;
}

interface PendingDocument {
  contentHash: string;
  datasetId: string;
  document: string;
}

function selectPending(
  candidates: readonly EmbeddingCandidate[],
  modelId: string,
): PendingDocument[] {
  return candidates
    .map((candidate) => {
      const document = renderDatasetDocument({
        columns: candidate.columns,
        description: candidate.description,
        name: candidate.name,
      });

      return {
        contentHash: hashDocument(document),
        datasetId: candidate.datasetId,
        document,
        stored: candidate,
      };
    })
    .filter(
      (entry) =>
        entry.stored.model !== modelId ||
        entry.stored.contentHash !== entry.contentHash,
    )
    .map((entry) => ({
      contentHash: entry.contentHash,
      datasetId: entry.datasetId,
      document: entry.document,
    }));
}

// No transaction is open here: the caller commits its read before this runs and opens its write after.
async function embedPending(
  registry: AiRegistry,
  modelId: AiModelId,
  metrics: WorkerMetrics,
  pending: readonly PendingDocument[],
): Promise<StoredEmbedding[]> {
  try {
    const result = await embedTexts(registry, modelId, {
      // The stored column is vector(1536), so the reduced width is requested, not assumed.
      dimensions: EMBEDDING_DIMENSIONS,
      values: pending.map((entry) => entry.document),
    });
    const stored = pending.map((entry, index) => {
      const embedding = result.embeddings[index];

      if (embedding === undefined) {
        throw new Error(
          'The embedding model returned fewer vectors than sent.',
        );
      }

      return {
        contentHash: entry.contentHash,
        datasetId: entry.datasetId,
        embedding,
      };
    });
    // Recorded once the answer is known to be usable, so a short answer counts as an error only.
    metrics.recordModelCall('success');

    return stored;
  } catch (error) {
    metrics.recordModelCall('error');
    throw error;
  }
}

export async function backfillDatasetEmbeddings(
  options: BackfillDatasetEmbeddingsOptions,
): Promise<void> {
  const job = backfillEmbeddingsJobSchema.parse(options.data);

  try {
    const registry = await options.registry();
    const modelId = registry.modelId(EMBEDDING_MODEL_ROLE);
    let cursor = FIRST_DATASET_CURSOR;
    let examined = 0;
    let embedded = 0;

    for (;;) {
      // Read transaction: it commits before the provider is called, so nothing is held open across the network.
      const candidates = await runTenantJob({
        data: job,
        pool: options.pool,
        work: (transaction) =>
          loadEmbeddingCandidates(transaction, {
            afterDatasetId: cursor,
            limit: PAGE_SIZE,
            userId: job.userId,
          }),
      });

      if (candidates.length === 0) {
        break;
      }

      // The cursor advances over every examined dataset, including the ones that needed no new vector.
      cursor = candidates[candidates.length - 1]?.datasetId ?? cursor;
      examined += candidates.length;
      const pending = selectPending(candidates, modelId);

      if (pending.length > 0) {
        const stored = await embedPending(
          registry,
          modelId,
          options.metrics,
          pending,
        );
        // Write transaction: opened only after the provider answered, and it audits inside itself.
        embedded += await runTenantJob({
          data: job,
          pool: options.pool,
          work: (transaction) =>
            storeDatasetEmbeddings(transaction, {
              embeddings: stored,
              model: modelId,
              organizationId: job.organizationId,
            }),
        });
      }

      if (candidates.length < PAGE_SIZE || examined >= MAX_DATASETS) {
        break;
      }
    }

    options.metrics.recordEmbeddedDatasets(embedded);
    options.metrics.recordJob(BACKFILL_EMBEDDINGS_QUEUE, 'completed');
  } catch (error) {
    options.metrics.recordJob(BACKFILL_EMBEDDINGS_QUEUE, 'failed');
    throw error;
  }
}
