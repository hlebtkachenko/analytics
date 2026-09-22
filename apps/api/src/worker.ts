import { loadDatabaseConfiguration } from '@bap/db/config';
import { createDatabasePool } from '@bap/db/pool';

import {
  enqueueDatasetSummary,
  enqueueEmbeddingBackfill,
} from './agents/agent-queue.js';
import { createLazyAiRegistry } from './agents/ai-registry.js';
import {
  BACKFILL_EMBEDDINGS_QUEUE,
  SUMMARIZE_DATASET_QUEUE,
} from './agents/contract.js';
import { FilesystemBlobStore } from './blobs/blob-store.js';
import {
  INBOX_MAINTENANCE_QUEUE,
  RERUN_INBOX_RULE_QUEUE,
  ROUTE_INBOX_ITEM_QUEUE,
  SCAN_INBOX_ITEM_QUEUE,
  SPLIT_EMAIL_ITEM_QUEUE,
} from './inbox/contract.js';
import {
  sendRerunInboxRule,
  sendRouteInboxItem,
  sendScanInboxItem,
  sendSplitEmailItem,
} from './inbox/inbox-queue.js';
import { INGEST_DATASET_QUEUE } from './ingestion/contract.js';
import {
  createStagingDirectory,
  loadStagingDirectory,
} from './ingestion/staging.js';
import { ApplicationLogger } from './logger.js';
import { loadRuntimeConfiguration } from './runtime-configuration.js';
import { ClamdClient } from './scanning/clamd-client.js';
import { backfillDatasetEmbeddings } from './worker/backfill-embeddings.js';
import {
  runInboxMaintenance,
  scheduleInboxMaintenance,
} from './worker/inbox-maintenance.js';
import { ingestDataset } from './worker/ingest-dataset.js';
import { curateJobFailure } from './worker/job-failure.js';
import { rerunInboxRule } from './worker/rerun-inbox-rule.js';
import { routeInboxItem } from './worker/route-inbox-item.js';
import { scanInboxItem } from './worker/scan-inbox-item.js';
import { splitEmailItem } from './worker/split-email-item.js';
import { summarizeDataset } from './worker/summarize-dataset.js';
import { startObservabilityServer } from './worker/observability.js';
import {
  createQueue,
  createQueueClientFromConfiguration,
} from './worker/queue.js';
import { WorkerMetrics } from './worker/worker-metrics.js';

const SERVICE_NAME = 'worker';
const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

async function bootstrap(): Promise<void> {
  // The worker shares the blob volume with the API and must leave the same group-readable modes behind.
  process.umask(0o007);
  const logger = new ApplicationLogger(undefined, SERVICE_NAME);
  const configuration = await loadDatabaseConfiguration(process.env, {
    role: 'bap_api',
  });
  const pool = createDatabasePool(configuration);
  const metrics = new WorkerMetrics();
  const observability = await startObservabilityServer({
    env: process.env,
    metrics,
    pool,
  });
  const queue = createQueueClientFromConfiguration(configuration);

  // pg-boss re-emits every supervisor failure here; without a listener Node would exit.
  queue.on('error', (error: unknown) => {
    metrics.recordQueueError();
    logger.error(
      error instanceof Error ? error.message : 'Queue supervisor failed',
      error instanceof Error ? error.stack : undefined,
      SERVICE_NAME,
    );
  });

  await queue.start();

  // Resolved on first agent job, so a missing or placeholder AI credential cannot stop the worker booting.
  const registry = createLazyAiRegistry(process.env);
  const chain = { queue, registry };

  // A completed job is never redone, so a queue failure while chaining must not fail it retroactively.
  const chainNext = async (enqueue: () => Promise<boolean>): Promise<void> => {
    try {
      await enqueue();
    } catch (error) {
      logger.error(
        error instanceof Error ? error.message : 'Chaining an agent failed',
        error instanceof Error ? error.stack : undefined,
        SERVICE_NAME,
      );
    }
  };

  const stagingDirectory = loadStagingDirectory(process.env);
  await createStagingDirectory(stagingDirectory);
  await createQueue(queue, INGEST_DATASET_QUEUE);
  await createQueue(queue, BACKFILL_EMBEDDINGS_QUEUE);
  await createQueue(queue, SUMMARIZE_DATASET_QUEUE);
  // Keyed queues: the item id and the tick name are singleton keys, which pg-boss honours only under exclusive.
  const warnQueue = (message: string): void =>
    logger.warn(message, SERVICE_NAME);
  await createQueue(
    queue,
    SPLIT_EMAIL_ITEM_QUEUE,
    { policy: 'exclusive' },
    warnQueue,
  );
  await createQueue(
    queue,
    SCAN_INBOX_ITEM_QUEUE,
    { policy: 'exclusive' },
    warnQueue,
  );
  await createQueue(
    queue,
    INBOX_MAINTENANCE_QUEUE,
    { policy: 'exclusive' },
    warnQueue,
  );
  await createQueue(
    queue,
    ROUTE_INBOX_ITEM_QUEUE,
    { policy: 'exclusive' },
    warnQueue,
  );
  await createQueue(
    queue,
    RERUN_INBOX_RULE_QUEUE,
    { policy: 'exclusive' },
    warnQueue,
  );
  // The real error is logged here; only the curated one reaches pgboss.job.output.
  const runJob = async (work: () => Promise<void>): Promise<void> => {
    try {
      await work();
    } catch (error) {
      logger.error(
        error instanceof Error ? error.message : 'Job failed',
        error instanceof Error ? error.stack : undefined,
        SERVICE_NAME,
      );
      throw curateJobFailure(error);
    }
  };

  await queue.work<unknown, void>(INGEST_DATASET_QUEUE, async (jobs) => {
    for (const job of jobs) {
      await runJob(async () => {
        const ingested = await ingestDataset({
          data: job.data,
          metrics,
          pool,
          stagingDirectory,
        });

        // A ready dataset is what makes the agents applicable, so ingestion is their trigger.
        if (ingested !== undefined) {
          await chainNext(async () => {
            const summarizing = await enqueueDatasetSummary(chain, ingested);

            // Without a summary the description will not change, so the backfill runs straight away.
            return summarizing || enqueueEmbeddingBackfill(chain, ingested);
          });
        }
      });
    }
  });

  await queue.work<unknown, void>(BACKFILL_EMBEDDINGS_QUEUE, async (jobs) => {
    for (const job of jobs) {
      await runJob(() =>
        backfillDatasetEmbeddings({
          data: job.data,
          metrics,
          pool,
          registry,
        }),
      );
    }
  });
  await queue.work<unknown, void>(SUMMARIZE_DATASET_QUEUE, async (jobs) => {
    for (const job of jobs) {
      await runJob(async () => {
        const summarized = await summarizeDataset({
          data: job.data,
          metrics,
          pool,
          registry,
        });

        // The summary wrote the description the embedded document quotes, so the backfill follows it.
        await chainNext(() => enqueueEmbeddingBackfill(chain, summarized));
      });
    }
  });

  // The split parses hostile MIME in-process, so one message at a time per worker; the scanner is one clamd session per blob.
  const runtime = loadRuntimeConfiguration(process.env);
  const blobs = new FilesystemBlobStore(runtime.blob.storageDirectory);
  const scanner = new ClamdClient(runtime.clamav);
  await queue.work<
    unknown,
    void,
    { includeMetadata: true; localConcurrency: 1 }
  >(
    SPLIT_EMAIL_ITEM_QUEUE,
    { includeMetadata: true, localConcurrency: 1 },
    async (jobs) => {
      for (const job of jobs) {
        await runJob(() =>
          splitEmailItem({
            blobs,
            data: job.data,
            enqueueRouteInboxItem: (route) => sendRouteInboxItem(queue, route),
            metrics,
            pool,
            quotaBytes: runtime.blob.quotaBytesPerOrganization,
            retry: { count: job.retryCount, limit: job.retryLimit },
            scanner,
          }),
        );
      }
    },
  );

  // A direct upload and an API push are scanned here; the bytes are already stored, so a few run side by side.
  await queue.work<
    unknown,
    void,
    { includeMetadata: true; localConcurrency: 2 }
  >(
    SCAN_INBOX_ITEM_QUEUE,
    { includeMetadata: true, localConcurrency: 2 },
    async (jobs) => {
      for (const job of jobs) {
        await runJob(() =>
          scanInboxItem({
            blobs,
            data: job.data,
            enqueueRouteInboxItem: (route) => sendRouteInboxItem(queue, route),
            metrics,
            pool,
            retry: { count: job.retryCount, limit: job.retryLimit },
            scanner,
          }),
        );
      }
    },
  );

  // The platform's first cron: one organization-less tick every quarter hour, never through runTenantJob.
  await scheduleInboxMaintenance(queue);
  await queue.work<unknown, void, { localConcurrency: 1 }>(
    INBOX_MAINTENANCE_QUEUE,
    { localConcurrency: 1 },
    async (jobs) => {
      for (const job of jobs) {
        await runJob(async () => {
          await runInboxMaintenance({
            blobs,
            data: job.data,
            enqueueScanInboxItem: (scan) => sendScanInboxItem(queue, scan),
            enqueueSplitEmailItem: (split) => sendSplitEmailItem(queue, split),
            logger,
            metrics,
            pool,
          });
        });
      }
    },
  );

  // Each route locks its own item row, so a few may run side by side; a rerun walks many rows, so one at a time.
  await queue.work<unknown, void, { localConcurrency: 4 }>(
    ROUTE_INBOX_ITEM_QUEUE,
    { localConcurrency: 4 },
    async (jobs) => {
      for (const job of jobs) {
        await runJob(async () => {
          await routeInboxItem({ data: job.data, logger, metrics, pool });
        });
      }
    },
  );
  await queue.work<unknown, void, { localConcurrency: 1 }>(
    RERUN_INBOX_RULE_QUEUE,
    { localConcurrency: 1 },
    async (jobs) => {
      for (const job of jobs) {
        await runJob(async () => {
          await rerunInboxRule({
            blobs,
            data: job.data,
            enqueueRerunInboxRule: (rerun) => sendRerunInboxRule(queue, rerun),
            enqueueRouteInboxItem: (route) => sendRouteInboxItem(queue, route),
            logger,
            metrics,
            pool,
          });
        });
      }
    },
  );

  logger.log('Worker started', SERVICE_NAME);

  let stopping = false;

  const shutdown = async (): Promise<void> => {
    if (stopping) {
      return;
    }

    stopping = true;
    logger.log('Worker shutting down', SERVICE_NAME);

    // Every step runs even when an earlier one fails, or the listener would keep the process alive.
    for (const step of [
      () => queue.stop({ graceful: true }),
      () => observability.close(),
      () => pool.end(),
    ]) {
      try {
        await step();
      } catch (error) {
        process.exitCode = 1;
        logger.error(
          error instanceof Error
            ? error.message
            : 'Worker shutdown step failed',
          error instanceof Error ? error.stack : undefined,
          SERVICE_NAME,
        );
      }
    }
  };

  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => {
      void shutdown();
    });
  }
}

await bootstrap();
