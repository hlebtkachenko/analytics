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
    if (this.clientPromise !== undefined) {
      await (await this.clientPromise).stop({ graceful: true });
    }
  }

  // Started on first use, like the membership pool, so the service still boots without the queue.
  private getClient(): Promise<PgBoss> {
    this.clientPromise ??= loadDatabaseConfiguration(process.env, {
      role: 'bap_api',
    }).then(async (configuration) => {
      const client = createQueueClientFromConfiguration(configuration);
      client.on('error', () => undefined);
      await client.start();
      await createQueue(client, INGEST_DATASET_QUEUE);
      return client;
    });
    return this.clientPromise;
  }
}
