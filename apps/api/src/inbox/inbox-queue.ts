import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { loadDatabaseConfiguration } from '@bap/db/config';
import type { PgBoss } from 'pg-boss';

import {
  createQueue,
  createQueueClientFromConfiguration,
} from '../worker/queue.js';
import {
  PARSE_INBOX_ITEM_QUEUE,
  RERUN_INBOX_RULE_QUEUE,
  ROUTE_INBOX_ITEM_QUEUE,
  SCAN_INBOX_ITEM_QUEUE,
  SPLIT_EMAIL_ITEM_QUEUE,
} from './contract.js';
import type {
  ParseInboxItemJob,
  RerunInboxRuleJob,
  RouteInboxItemJob,
  ScanInboxItemJob,
  SplitEmailItemJob,
} from './contract.js';

// pg-boss options of the split job: three retries a minute apart. The item id is the singleton key, which holds
// only because the queue is exclusive: at most one job per key across created, retry and active.
export const SPLIT_EMAIL_ITEM_RETRY_LIMIT = 3;
export const SPLIT_EMAIL_ITEM_RETRY_DELAY_SECONDS = 60;

// The route and rerun jobs share the split's shape; every inbox queue is exclusive so the singleton key holds.
export const INBOX_QUEUES = [
  SPLIT_EMAIL_ITEM_QUEUE,
  SCAN_INBOX_ITEM_QUEUE,
  ROUTE_INBOX_ITEM_QUEUE,
  RERUN_INBOX_RULE_QUEUE,
  PARSE_INBOX_ITEM_QUEUE,
] as const;

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

// The one way a scan job is sent, shared by the intake and the maintenance resend; one per item at a time.
export async function sendScanInboxItem(
  client: PgBoss,
  job: ScanInboxItemJob,
): Promise<void> {
  await client.send(SCAN_INBOX_ITEM_QUEUE, job, {
    retryDelay: SPLIT_EMAIL_ITEM_RETRY_DELAY_SECONDS,
    retryLimit: SPLIT_EMAIL_ITEM_RETRY_LIMIT,
    singletonKey: job.itemId,
  });
}

// One parse per item at a time, sent after a clean verdict by the scan, the split or a person's process.
export async function sendParseInboxItem(
  client: PgBoss,
  job: ParseInboxItemJob,
): Promise<void> {
  await client.send(PARSE_INBOX_ITEM_QUEUE, job, {
    retryDelay: SPLIT_EMAIL_ITEM_RETRY_DELAY_SECONDS,
    retryLimit: SPLIT_EMAIL_ITEM_RETRY_LIMIT,
    singletonKey: job.itemId,
  });
}

// One route job per item at a time: the item id is the singleton key.
export async function sendRouteInboxItem(
  client: PgBoss,
  job: RouteInboxItemJob,
): Promise<void> {
  await client.send(ROUTE_INBOX_ITEM_QUEUE, job, {
    retryDelay: SPLIT_EMAIL_ITEM_RETRY_DELAY_SECONDS,
    retryLimit: SPLIT_EMAIL_ITEM_RETRY_LIMIT,
    singletonKey: job.itemId,
  });
}

// One walk per rule at a time. The exclusive policy would drop a same-key send while the job is still active,
// so a continuation keys on the cursor it resumes from: each batch sends its own successor exactly once.
export function rerunInboxRuleSingletonKey(job: RerunInboxRuleJob): string {
  return job.cursor === undefined
    ? job.ruleId
    : `${job.ruleId}:${job.cursor.itemId}`;
}

export async function sendRerunInboxRule(
  client: PgBoss,
  job: RerunInboxRuleJob,
): Promise<void> {
  await client.send(RERUN_INBOX_RULE_QUEUE, job, {
    retryDelay: SPLIT_EMAIL_ITEM_RETRY_DELAY_SECONDS,
    retryLimit: SPLIT_EMAIL_ITEM_RETRY_LIMIT,
    singletonKey: rerunInboxRuleSingletonKey(job),
  });
}

export abstract class InboxQueue {
  abstract enqueueParseInboxItem(job: ParseInboxItemJob): Promise<void>;
  abstract enqueueRerunInboxRule(job: RerunInboxRuleJob): Promise<void>;
  abstract enqueueRouteInboxItem(job: RouteInboxItemJob): Promise<void>;
  abstract enqueueScanInboxItem(job: ScanInboxItemJob): Promise<void>;
  abstract enqueueSplitEmailItem(job: SplitEmailItemJob): Promise<void>;
}

@Injectable()
export class PgBossInboxQueue extends InboxQueue implements OnModuleDestroy {
  private clientPromise: Promise<PgBoss> | undefined;
  private readonly logger = new Logger(PgBossInboxQueue.name);

  async enqueueParseInboxItem(job: ParseInboxItemJob): Promise<void> {
    await sendParseInboxItem(await this.getClient(), job);
  }

  async enqueueRerunInboxRule(job: RerunInboxRuleJob): Promise<void> {
    await sendRerunInboxRule(await this.getClient(), job);
  }

  async enqueueRouteInboxItem(job: RouteInboxItemJob): Promise<void> {
    await sendRouteInboxItem(await this.getClient(), job);
  }

  async enqueueScanInboxItem(job: ScanInboxItemJob): Promise<void> {
    await sendScanInboxItem(await this.getClient(), job);
  }

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

      for (const queue of INBOX_QUEUES) {
        await createQueue(client, queue, { policy: 'exclusive' }, (message) =>
          this.logger.warn(message),
        );
      }
    } catch (error) {
      // A retry builds a new client, so this one must not keep its connection pool open.
      await client.stop({ graceful: false }).catch(() => undefined);
      throw error;
    }

    return client;
  }
}
