import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { loadDatabaseConfiguration } from '@bap/db/config';
import type { PgBoss } from 'pg-boss';

import {
  createQueue,
  createQueueClientFromConfiguration,
} from '../worker/queue.js';
import { SPLIT_EMAIL_ITEM_QUEUE } from './contract.js';
import type { SplitEmailItemJob } from './contract.js';

// pg-boss options of the split job: three retries a minute apart. The item id is the singleton key, which holds
// only because the queue is exclusive: at most one job per key across created, retry and active.
export const SPLIT_EMAIL_ITEM_RETRY_LIMIT = 3;
export const SPLIT_EMAIL_ITEM_RETRY_DELAY_SECONDS = 60;

// The one way a split job is sent, shared by the intake and the maintenance requeue.
export async function sendSplitEmailItem(
  client: PgBoss,
  job: SplitEmailItemJob,
): Promise<void> {
  await client.send(SPLIT_EMAIL_ITEM_QUEUE, job, {
    retryDelay: SPLIT_EMAIL_ITEM_RETRY_DELAY_SECONDS,
    retryLimit: SPLIT_EMAIL_ITEM_RETRY_LIMIT,
    singletonKey: job.itemId,
  });
}

export abstract class InboxQueue {
  abstract enqueueSplitEmailItem(job: SplitEmailItemJob): Promise<void>;
}

@Injectable()
export class PgBossInboxQueue extends InboxQueue implements OnModuleDestroy {
  private clientPromise: Promise<PgBoss> | undefined;

  async enqueueSplitEmailItem(job: SplitEmailItemJob): Promise<void> {
    await sendSplitEmailItem(await this.getClient(), job);
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

  // Started on first use, like the ingestion queue, so the service still boots without the queue.
  private getClient(): Promise<PgBoss> {
    if (this.clientPromise === undefined) {
      const started = this.startClient();
      this.clientPromise = started;
      // A failed start is dropped, so the next intake retries instead of replaying the rejection.
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
      await createQueue(client, SPLIT_EMAIL_ITEM_QUEUE, {
        policy: 'exclusive',
      });
    } catch (error) {
      // A retry builds a new client, so this one must not keep its connection pool open.
      await client.stop({ graceful: false }).catch(() => undefined);
      throw error;
    }

    return client;
  }
}
