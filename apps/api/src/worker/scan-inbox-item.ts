import type { DatabasePool } from '@bap/db/pool';
import type { PoolClient } from 'pg';

import type { BlobStore } from '../blobs/blob-store.js';
import {
  SCAN_INBOX_ITEM_QUEUE,
  scanInboxItemJobSchema,
} from '../inbox/contract.js';
import type { RouteInboxItemJob, ScanInboxItemJob } from '../inbox/contract.js';
import { appendEvent, routeJobForItem } from '../inbox/inbox-repository.js';
import type { BlobScanner } from '../scanning/clamd-client.js';
import { recordScan, setItemStatus } from './blob-scan.js';
import { runTenantJob } from './job-context.js';
import type { WorkerMetrics } from './worker-metrics.js';

// An item is scanned while it still waits for a person; anything else was decided and keeps its blobs where they are.
const SCANNABLE_STATUSES = ['received', 'needs_review'];

export interface ScanInboxItemOptions {
  blobs: BlobStore;
  data: unknown;
  // Sent after the last blob came back clean, carrying the route decision the intake already took.
  enqueueRouteInboxItem: (job: RouteInboxItemJob) => Promise<void>;
  metrics: WorkerMetrics;
  pool: DatabasePool;
  // pg-boss metadata of this attempt: the failed verdict is recorded on the last one only.
  retry: { count: number; limit: number };
  scanner: BlobScanner;
}

// The only error shape that leaves the handler: a code, never a path, a filename or a row value.
export class ScanInboxError extends Error {
  constructor(
    readonly code: 'item_unavailable' | 'scan_failed' | 'store_failed',
  ) {
    super(`scan_inbox_item failed: ${code}`);
    this.name = 'ScanInboxError';
  }
}

interface PendingBlob {
  byteSize: number;
  id: string;
  storageKey: string;
}

interface PendingItem {
  blobs: PendingBlob[];
  status: string;
}

// The item and every blob of it the scanner has not answered for yet; null when the item is past review.
async function loadPending(
  transaction: PoolClient,
  itemId: string,
): Promise<PendingItem | null> {
  const result = await transaction.query<{
    blob_id: string | null;
    byte_size: string | null;
    status: string;
    storage_key: string | null;
  }>(
    `select i.status, b.id as blob_id, b.byte_size::text as byte_size, b.storage_key
       from app.inbox_item as i
       left join app.inbox_item_file as f on f.item_id = i.id
       left join app.blob as b on b.id = f.blob_id and b.scan_status = 'not_scanned'
      where i.id = $1
      order by f.position`,
    [itemId],
  );
  const status = result.rows[0]?.status;

  if (status === undefined || !SCANNABLE_STATUSES.includes(status)) {
    return null;
  }

  return {
    blobs: result.rows.flatMap((row) =>
      row.blob_id === null || row.storage_key === null
        ? []
        : [
            {
              byteSize: Number(row.byte_size),
              id: row.blob_id,
              storageKey: row.storage_key,
            },
          ],
    ),
    status,
  };
}

export async function scanInboxItem(
  options: ScanInboxItemOptions,
): Promise<void> {
  const payload: ScanInboxItemJob = scanInboxItemJobSchema.parse(options.data);

  try {
    const pending = await runTenantJob({
      data: payload,
      pool: options.pool,
      work: (transaction) => loadPending(transaction, payload.itemId),
    });

    // Discarded, failed or already routed: the job is a committed no-op and the blobs stay where they are.
    if (pending === null) {
      options.metrics.recordJob(SCAN_INBOX_ITEM_QUEUE, 'completed');
      return;
    }

    for (const blob of pending.blobs) {
      // The scan is a network call on the stored bytes, so it stays outside the transaction.
      const verdict = await options.scanner.scan(
        options.blobs.open(blob.storageKey),
        blob.byteSize,
      );

      // A clamd that errors or cannot be reached retries; the last attempt leaves the failed verdict behind.
      if (verdict.outcome === 'error') {
        if (options.retry.count < options.retry.limit) {
          throw new ScanInboxError('scan_failed');
        }

        await runTenantJob({
          data: payload,
          pool: options.pool,
          work: (transaction, _job, tenant) =>
            recordScan(transaction, tenant, payload.itemId, blob.id, 'failed'),
        });
        options.metrics.recordJob(SCAN_INBOX_ITEM_QUEUE, 'completed');
        return;
      }

      const infected = await runTenantJob({
        data: payload,
        pool: options.pool,
        work: async (transaction, _job, tenant) => {
          await recordScan(
            transaction,
            tenant,
            payload.itemId,
            blob.id,
            verdict.outcome,
          );

          if (verdict.outcome !== 'infected') {
            return false;
          }

          if (
            !(await setItemStatus(
              transaction,
              payload.itemId,
              'discarded',
              pending.status,
            ))
          ) {
            throw new ScanInboxError('item_unavailable');
          }

          await appendEvent(
            transaction,
            tenant,
            payload.itemId,
            'discarded',
            'policy_rejected',
          );
          return true;
        },
      });

      // Nothing else runs on an infected item: the rest of its blobs stay unscanned and unreadable.
      if (infected) {
        options.metrics.recordJob(SCAN_INBOX_ITEM_QUEUE, 'completed');
        return;
      }
    }

    // Every blob is clean, so the route the intake computed is re-read and sent after its transaction.
    const routeJob = await runTenantJob({
      data: payload,
      pool: options.pool,
      work: (transaction) =>
        routeJobForItem(transaction, {
          itemId: payload.itemId,
          organizationId: payload.organizationId,
        }),
    });

    if (routeJob !== null) {
      await options.enqueueRouteInboxItem(routeJob);
    }

    options.metrics.recordJob(SCAN_INBOX_ITEM_QUEUE, 'completed');
  } catch (error) {
    options.metrics.recordJob(SCAN_INBOX_ITEM_QUEUE, 'failed');
    // Anything else is wrapped before it reaches runJob, so the worker never logs a path or a row value.
    throw error instanceof ScanInboxError
      ? error
      : new ScanInboxError('store_failed');
  }
}
