import type { AiRegistryProvider } from './ai-registry.js';
import {
  BACKFILL_EMBEDDINGS_QUEUE,
  EMBEDDING_MODEL_ROLE,
  SUMMARIZE_DATASET_QUEUE,
  SUMMARY_MODEL_ROLE,
} from './contract.js';
import type { BackfillEmbeddingsJob, SummarizeDatasetJob } from './contract.js';

// Only sending is needed here, so a test double satisfies this without a queue client.
export interface AgentJobSender {
  send(name: string, data: object): Promise<string | null>;
}

export interface AgentChain {
  queue: AgentJobSender;
  registry: AiRegistryProvider;
}

// A credential that names no model for the role leaves that agent off, so its queue stays empty.
// A missing, placeholder or unreadable credential is the same answer: nothing is enqueued.
async function namesModel(
  registry: AiRegistryProvider,
  role: string,
): Promise<boolean> {
  try {
    (await registry()).modelId(role);
    return true;
  } catch {
    return false;
  }
}

// Identifiers only, exactly like the ingestion payload: pgboss.job is cross-tenant readable.
// Membership is not checked here; every agent job re-resolves it at dequeue through runTenantJob.
export async function enqueueDatasetSummary(
  chain: AgentChain,
  job: SummarizeDatasetJob,
): Promise<boolean> {
  if (!(await namesModel(chain.registry, SUMMARY_MODEL_ROLE))) {
    return false;
  }

  await chain.queue.send(SUMMARIZE_DATASET_QUEUE, {
    datasetId: job.datasetId,
    organizationId: job.organizationId,
    userId: job.userId,
  });
  return true;
}

// One backfill per subject: the job sweeps every dataset that subject owns and skips unchanged text.
export async function enqueueEmbeddingBackfill(
  chain: AgentChain,
  job: BackfillEmbeddingsJob,
): Promise<boolean> {
  if (!(await namesModel(chain.registry, EMBEDDING_MODEL_ROLE))) {
    return false;
  }

  await chain.queue.send(BACKFILL_EMBEDDINGS_QUEUE, {
    organizationId: job.organizationId,
    userId: job.userId,
  });
  return true;
}
