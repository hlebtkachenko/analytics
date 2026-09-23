import type { DatabasePool } from '@bap/db/pool';
import type { PoolClient } from 'pg';

import type { BlobStore } from '../blobs/blob-store.js';
import {
  SCAN_INBOX_ITEM_QUEUE,
  scanInboxItemJobSchema,
} from '../inbox/contract.js';
import type {
  ParseInboxItemJob,
  RouteInboxItemJob,
  ScanInboxItemJob,
} from '../inbox/contract.js';
import { appendEvent } from '../inbox/inbox-repository-support.js';
import {
  ISDOC_DETECTED_TYPE,
  ISDOC_PROVIDER,
} from '../inbox/providers/isdoc.js';
import { SNIFF_PROVIDER } from '../inbox/providers/sniff.js';
import type { BlobScanner } from '../scanning/clamd-client.js';
import { recordScan, setItemStatus } from './blob-scan.js';
import { runTenantJob } from './job-context.js';
import type { WorkerMetrics } from './worker-metrics.js';

// A decided item keeps its blobs where they are; every other status is scanned, a routed one included.
const SETTLED_STATUSES = ['discarded', 'failed'];

export interface ScanInboxItemOptions {
  blobs: BlobStore;
  data: unknown;
  // Sent instead of the route after a clean verdict when the sniff named an ISDOC, under the same principal.
  enqueueParseInboxItem: (job: ParseInboxItemJob) => Promise<void>;
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
  // The newest sniff verdict and whether a parse row already exists, so a resend never parses twice.
  parsed: boolean;
  sniffedType: string | null;
  status: string;
}

// The item and every blob of it the scanner has not answered for yet; null when the item is already settled.
async function loadPending(
  transaction: PoolClient,
  itemId: string,
): Promise<PendingItem | null> {
  const result = await transaction.query<{
    blob_id: string | null;
    byte_size: string | null;
    parsed: boolean;
    sniffed_type: string | null;
    status: string;
    storage_key: string | null;
  }>(
    `select i.status, b.id as blob_id, b.byte_size::text as byte_size, b.storage_key,
            (select x.detected_type from app.inbox_item_extraction as x
              where x.item_id = i.id and x.provider = $2
              order by x.created_at desc, x.id desc limit 1) as sniffed_type,
            exists (select 1 from app.inbox_item_extraction as x
                     where x.item_id = i.id and x.provider = $3) as parsed
       from app.inbox_item as i
       left join app.inbox_item_file as f on f.item_id = i.id
       left join app.blob as b on b.id = f.blob_id and b.scan_status = 'not_scanned'
      where i.id = $1
      order by f.position`,
    [itemId, SNIFF_PROVIDER, ISDOC_PROVIDER],
  );
  const status = result.rows[0]?.status;

  if (status === undefined || SETTLED_STATUSES.includes(status)) {
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
    parsed: result.rows[0]?.parsed ?? false,
    sniffedType: result.rows[0]?.sniffed_type ?? null,
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

    // Discarded or failed: the job is a committed no-op and the blobs stay where they are.
    if (pending === null) {
      options.metrics.recordJob(SCAN_INBOX_ITEM_QUEUE, 'completed');
      return;
    }

    const routed = pending.status === 'routed';

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

      await runTenantJob({
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

          // A routed item keeps its decision: the verdict alone is recorded, and the blob routes stop serving it.
          if (verdict.outcome !== 'infected' || routed) {
            return;
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
        },
      });

      // Nothing else runs on an infected item: the rest of its blobs stay unscanned and unreadable.
      if (verdict.outcome === 'infected') {
        options.metrics.recordJob(SCAN_INBOX_ITEM_QUEUE, 'completed');
        return;
      }
    }

    // Every blob is clean: an ISDOC is parsed first, under the same principal; the parse decides the route itself.
    if (
      !routed &&
      pending.sniffedType === ISDOC_DETECTED_TYPE &&
      !pending.parsed
    ) {
      await options.enqueueParseInboxItem(
        'userId' in payload
          ? {
              itemId: payload.itemId,
              organizationId: payload.organizationId,
              userId: payload.userId,
            }
          : {
              channelId: payload.channelId,
              itemId: payload.itemId,
              organizationId: payload.organizationId,
            },
      );
    } else if (!routed && payload.routeRuleId !== undefined) {
      // The route the intake deferred is sent; a routed item and a swept one carry none.
      await options.enqueueRouteInboxItem({
        itemId: payload.itemId,
        organizationId: payload.organizationId,
        ruleId: payload.routeRuleId,
      });
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
