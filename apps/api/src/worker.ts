import { loadDatabaseConfiguration } from '@bap/db/config';
import { createDatabasePool } from '@bap/db/pool';

import { ApplicationLogger } from './logger.js';
import { startObservabilityServer } from './worker/observability.js';
import { createQueueClientFromConfiguration } from './worker/queue.js';
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

  await queue.start();

  // Phase 2 registers the first queue handler; the worker only supervises pg-boss for now.
  logger.log('Worker started', SERVICE_NAME);

  let stopping = false;

  const shutdown = async (): Promise<void> => {
    if (stopping) {
      return;
    }

    stopping = true;
    logger.log('Worker shutting down', SERVICE_NAME);
    await queue.stop({ graceful: true });
    await observability.close();
    await pool.end();
  };

  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => {
      shutdown().catch(() => {
        logger.error('Worker shutdown failed', undefined, SERVICE_NAME);
        process.exitCode = 1;
      });
    });
  }
}

await bootstrap();
