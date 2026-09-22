import type { DatabasePool } from '@bap/db/pool';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';

import type { BlobStore } from '../blobs/blob-store.js';
import { INBOX_MAINTENANCE_QUEUE } from '../inbox/contract.js';
import type { SplitEmailItemJob } from '../inbox/contract.js';
import type { WorkerMetrics } from './worker-metrics.js';

export const INBOX_MAINTENANCE_CRON = '*/15 * * * *';
// One tick at a time across every worker replica; a tick that outlives the next one is expired, never retried.
export const INBOX_MAINTENANCE_SCHEDULE_OPTIONS = {
  expireInSeconds: 600,
  retryLimit: 0,
  singletonKey: 'inbox_maintenance',
} as const;
// Every task is bounded per tick; whatever is left waits for the next one.
export const MAINTENANCE_ROW_LIMIT = 500;
export const ORPHAN_FILE_LIMIT = 1000;
// The race guard of the sweep: an in-flight put renames and commits within seconds, never within an hour.
export const ORPHAN_GRACE_MS = 60 * 60 * 1000;
export const REAPER_STALE = '60 minutes';
export const REQUEUE_STALE = '10 minutes';

const CONTEXT = 'inbox_maintenance';

// The tick has no tenant and carries nothing: an empty strict object, never a jobPayloadSchema member.
const inboxMaintenancePayloadSchema = z.object({}).strict();

export interface MaintenanceLogger {
  debug(message: string, context?: string): void;
  error(message: string, trace?: string, context?: string): void;
  log(message: string, context?: string): void;
}

export interface InboxMaintenanceOptions {
  blobs: BlobStore;
  data: unknown;
  enqueueSplitEmailItem: (job: SplitEmailItemJob) => Promise<void>;
  logger: MaintenanceLogger;
  metrics: WorkerMetrics;
  pool: DatabasePool;
}

export interface InboxMaintenanceReport {
  failedTasks: string[];
  orphansRemoved: number;
  reapedItemIds: string[];
  requeuedItemIds: string[];
}

// Registered once at worker boot; pg-boss keys the schedule by queue and singleton key, so a restart replaces it.
export async function scheduleInboxMaintenance(
  queue: Pick<PgBoss, 'schedule'>,
): Promise<void> {
  await queue.schedule(
    INBOX_MAINTENANCE_QUEUE,
    INBOX_MAINTENANCE_CRON,
    {},
    INBOX_MAINTENANCE_SCHEDULE_OPTIONS,
  );
}

// Walks org/<id> on the volume and unlinks a file past the grace period whose hash has no blob row.
async function sweepOrphans(options: InboxMaintenanceOptions): Promise<number> {
  const olderThan = new Date(Date.now() - ORPHAN_GRACE_MS);
  let removed = 0;

  for (const organizationId of await options.blobs.listOrganizations()) {
    const stale = await options.blobs.listStale(
      organizationId,
      olderThan,
      ORPHAN_FILE_LIMIT,
    );

    if (stale.length === 0) {
      continue;
    }

    const known = await options.pool.query<{ list_blob_keys: string }>(
      'select list_blob_keys from app.list_blob_keys($1, $2::text[])',
      [organizationId, stale.map((file) => file.sha256)],
    );
    const tracked = new Set(known.rows.map((row) => row.list_blob_keys));

    for (const file of stale) {
      if (!tracked.has(file.sha256)) {
        await options.blobs.unlink(file.key);
        removed += 1;
      }
    }
  }

  return removed;
}

async function reapStalledItems(
  options: InboxMaintenanceOptions,
): Promise<string[]> {
  const reaped = await options.pool.query<{ id: string }>(
    'select id from app.reap_stalled_inbox_items($1::interval, $2)',
    [REAPER_STALE, MAINTENANCE_ROW_LIMIT],
  );

  return reaped.rows.map((row) => row.id);
}

// An email parent still received after the grace period lost its split enqueue; the exclusive queue drops a duplicate.
async function requeueStuckEmailItems(
  options: InboxMaintenanceOptions,
): Promise<string[]> {
  const stuck = await options.pool.query<{
    channel_id: string;
    item_id: string;
    organization_id: string;
  }>(
    'select item_id, channel_id, organization_id from app.list_stuck_email_items($1::interval, $2)',
    [REQUEUE_STALE, MAINTENANCE_ROW_LIMIT],
  );
  const requeued: string[] = [];

  for (const row of stuck.rows) {
    await options.enqueueSplitEmailItem({
      channelId: row.channel_id,
      itemId: row.item_id,
      organizationId: row.organization_id,
    });
    requeued.push(row.item_id);
  }

  return requeued;
}

// Three tasks, each on the pool outside any tenant context; a failing task is logged and the next one still runs.
export async function runInboxMaintenance(
  options: InboxMaintenanceOptions,
): Promise<InboxMaintenanceReport> {
  inboxMaintenancePayloadSchema.parse(options.data);
  const report: InboxMaintenanceReport = {
    failedTasks: [],
    orphansRemoved: 0,
    reapedItemIds: [],
    requeuedItemIds: [],
  };

  const attempt = async (task: string, work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      report.failedTasks.push(task);
      // Never the error message: a Node fs error carries the absolute path, a storage key.
      const code =
        typeof error === 'object' &&
        error !== null &&
        typeof (error as { code?: unknown }).code === 'string'
          ? (error as { code: string }).code
          : undefined;
      options.logger.error(
        code === undefined
          ? `Inbox maintenance task ${task} failed`
          : `Inbox maintenance task ${task} failed: ${code}`,
        error instanceof Error ? error.stack : undefined,
        CONTEXT,
      );
    }
  };

  await attempt('sweep_orphans', async () => {
    report.orphansRemoved = await sweepOrphans(options);
  });
  await attempt('reap_stalled_items', async () => {
    report.reapedItemIds = await reapStalledItems(options);
  });
  await attempt('requeue_stuck_email_items', async () => {
    report.requeuedItemIds = await requeueStuckEmailItems(options);
  });

  options.metrics.recordJob(
    INBOX_MAINTENANCE_QUEUE,
    report.failedTasks.length === 0 ? 'completed' : 'failed',
  );
  // Counts only on the info line; the ids at debug; never a storage key, a filename or an organization name.
  options.logger.log(
    `Inbox maintenance tick: ${report.orphansRemoved} orphaned files removed, ${report.reapedItemIds.length} stalled items reaped, ${report.requeuedItemIds.length} email items requeued, ${report.failedTasks.length} tasks failed`,
    CONTEXT,
  );
  options.logger.debug(
    `Inbox maintenance ids: reaped ${report.reapedItemIds.join(',')}; requeued ${report.requeuedItemIds.join(',')}`,
    CONTEXT,
  );

  return report;
}
