import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { loadDatabaseConfiguration } from '@bap/db/config';
import type { PgBoss } from 'pg-boss';

import {
  createQueue,
  createQueueClientFromConfiguration,
} from '../worker/queue.js';
import { INGEST_DATASET_QUEUE } from './contract.js';
import type { IngestDatasetJob } from './contract.js';

export abstract class IngestionQueue {
  abstract enqueue(job: IngestDatasetJob): Promise<void>;
}

@Injectable()
export class PgBossIngestionQueue
  extends IngestionQueue
  implements OnModuleDestroy
{
  private clientPromise: Promise<PgBoss> | undefined;

  async enqueue(job: IngestDatasetJob): Promise<void> {
    const client = await this.getClient();
    // No retry: the worker deletes the staged file on the failure path, so a second attempt has no bytes.
    await client.send(INGEST_DATASET_QUEUE, job, { retryLimit: 0 });
  }

  async onModuleDestroy(): Promise<void> {
    const started = this.clientPromise;

    if (started === undefined) {
      return;
    }

    // A client that never started has nothing to stop, and its rejection must not fail shutdown.
    const client = await started.catch(() => undefined);
    await client?.stop({ graceful: true });
  }

  // Started on first use, like the membership pool, so the service still boots without the queue.
  private getClient(): Promise<PgBoss> {
    if (this.clientPromise === undefined) {
      const started = this.startClient();
      this.clientPromise = started;
      // A failed start is dropped, so the next upload retries instead of replaying the rejection.
      void started.catch(() => {
        if (this.clientPromise === started) {
          this.clientPromise = undefined;
        }
      });
    }

    return this.clientPromise;
  }

  private async startClient(): Promise<PgBoss> {
    const configuration = await loadDatabaseConfiguration(process.env, {
      role: 'bap_api',
    });
    const client = createQueueClientFromConfiguration(configuration);
    client.on('error', () => undefined);

    try {
      await client.start();
      await createQueue(client, INGEST_DATASET_QUEUE);
    } catch (error) {
      // A retry builds a new client, so this one must not keep its connection pool open.
      await client.stop({ graceful: false }).catch(() => undefined);
      throw error;
    }

    return client;
  }
}
