import { loadDatabaseConfiguration } from '@bap/db/config';
import { createDatabasePool } from '@bap/db/pool';

import { INGEST_DATASET_QUEUE } from './ingestion/contract.js';
import {
  createStagingDirectory,
  loadStagingDirectory,
} from './ingestion/staging.js';
import { ApplicationLogger } from './logger.js';
import { ingestDataset } from './worker/ingest-dataset.js';
import { startObservabilityServer } from './worker/observability.js';
import {
  createQueue,
  createQueueClientFromConfiguration,
} from './worker/queue.js';
import { WorkerMetrics } from './worker/worker-metrics.js';

const SERVICE_NAME = 'worker';
const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

async function bootstrap(): Promise<void> {
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

  const stagingDirectory = loadStagingDirectory(process.env);
  await createStagingDirectory(stagingDirectory);
  await createQueue(queue, INGEST_DATASET_QUEUE);
  await queue.work<unknown, void>(INGEST_DATASET_QUEUE, async (jobs) => {
    for (const job of jobs) {
      await ingestDataset({
        data: job.data,
        metrics,
        pool,
        stagingDirectory,
      });
    }
  });

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
