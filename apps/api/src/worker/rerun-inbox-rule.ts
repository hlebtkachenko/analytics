import { text as readText } from 'node:stream/consumers';

import type { DatabasePool } from '@bap/db/pool';
import type { PoolClient } from 'pg';

import type { BlobStore } from '../blobs/blob-store.js';
import {
  HUMAN_TOUCH_EVENT_KINDS,
  RERUN_INBOX_RULE_QUEUE,
} from '../inbox/contract.js';
import type {
  InboxItem,
  RerunInboxRuleJob,
  RouteInboxItemJob,
} from '../inbox/contract.js';
import {
  applyInboxRules,
  loadItem,
  loadItemFiles,
  loadMatchedRuleIds,
} from '../inbox/inbox-repository.js';
import { rerunInboxRuleJobPayloadSchema, runTenantJob } from './job-context.js';
import type { RerunInboxRuleJobPayload } from './job-context.js';
import type { RouteJobLogger } from './route-inbox-item.js';
import type { WorkerMetrics } from './worker-metrics.js';

// The per-job cap: whatever is left after it goes to the continuation the job sends with its cursor.
export const RERUN_INBOX_RULE_BATCH_SIZE = 100;
const CONTEXT = 'rerun_inbox_rule';

export interface RerunInboxRuleOptions {
  // Tests walk with a smaller batch; production keeps the constant.
  batchSize?: number;
  blobs: BlobStore;
  data: unknown;
  enqueueRerunInboxRule: (job: RerunInboxRuleJob) => Promise<void>;
  enqueueRouteInboxItem: (job: RouteInboxItemJob) => Promise<void>;
  logger: RouteJobLogger;
  metrics: WorkerMetrics;
  pool: DatabasePool;
}

export interface RerunInboxRuleReport {
  appliedItemIds: string[];
  // The cursor of the continuation this job sent, or null when the walk is complete.
  cursor: RerunInboxRuleJob['cursor'] | null;
  routedItemIds: string[];
  skippedItemIds: string[];
}

interface Candidate {
  id: string;
  // ISO text with the microseconds Postgres stores: a Date would round the cursor and re-list its own item.
  receivedAt: string;
}

const RECEIVED_AT_ISO = `to_char(i.received_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

// Untouched: no event a person wrote. The walk orders by received_at with the id as the tiebreaker.
const UNTOUCHED = `not exists (
        select 1 from app.inbox_event as e
         where e.item_id = i.id and e.kind = any($1::text[]) and e.actor_user_id is not null)`;

async function listCandidates(
  transaction: PoolClient,
  payload: RerunInboxRuleJobPayload,
  limit: number,
): Promise<Candidate[]> {
  const result = await transaction.query<{ id: string; received_at: string }>(
    `select i.id, ${RECEIVED_AT_ISO} as received_at
       from app.inbox_item as i
      where i.status = 'needs_review'
        and ($2::timestamptz is null or (i.received_at, i.id) > ($2::timestamptz, $3::uuid))
        and ${UNTOUCHED}
      order by i.received_at, i.id
      limit $4`,
    [
      [...HUMAN_TOUCH_EVENT_KINDS],
      payload.cursor?.receivedAt ?? null,
      payload.cursor?.itemId ?? null,
      limit,
    ],
  );

  return result.rows.map((row) => ({
    id: row.id,
    receivedAt: row.received_at,
  }));
}

// The keyword source of a text item, the stored body the intake read from disk; already under MAX_TEXT_BYTES.
async function readItemText(
  transaction: PoolClient,
  blobs: BlobStore,
  item: InboxItem,
): Promise<string | null> {
  if (item.payloadKind !== 'text') {
    return null;
  }

  const file = (await loadItemFiles(transaction, item.id))[0];
  return file === undefined ? null : readText(blobs.open(file.storageKey));
}

// One item per transaction: the row lock re-checks review and untouched, the newest rule row skips a repeat.
async function applyToItem(
  options: RerunInboxRuleOptions,
  payload: RerunInboxRuleJobPayload,
  itemId: string,
): Promise<{ routeJob: RouteInboxItemJob | null; skipped: boolean }> {
  return runTenantJob({
    data: payload,
    pool: options.pool,
    work: async (transaction, _payload, tenant) => {
      const item = await loadItem(transaction, itemId, null, true);

      if (item === null || item.status !== 'needs_review') {
        return { routeJob: null, skipped: true };
      }

      const touched = await transaction.query(
        `select 1 from app.inbox_item as i where i.id = $2 and ${UNTOUCHED}`,
        [[...HUMAN_TOUCH_EVENT_KINDS], itemId],
      );
      const matched = await loadMatchedRuleIds(transaction, itemId);

      if (touched.rows.length === 0 || matched.includes(payload.ruleId)) {
        return { routeJob: null, skipped: true };
      }

      // The pass merges with the newest rule row itself: the earlier matches and their fields stay.
      const pass = await applyInboxRules(transaction, {
        ...tenant,
        itemId,
        ruleIds: [payload.ruleId],
        text: await readItemText(transaction, options.blobs, item),
      });

      // Only the rule itself asks for the route here; a target default asked at intake, or will at its own pass.
      return {
        routeJob:
          pass.routeJob?.ruleId === payload.ruleId ? pass.routeJob : null,
        skipped: !pass.matchedRuleIds.includes(payload.ruleId),
      };
    },
  });
}

export async function rerunInboxRule(
  options: RerunInboxRuleOptions,
): Promise<RerunInboxRuleReport> {
  const payload = rerunInboxRuleJobPayloadSchema.parse(options.data);
  const batchSize = options.batchSize ?? RERUN_INBOX_RULE_BATCH_SIZE;
  const report: RerunInboxRuleReport = {
    appliedItemIds: [],
    cursor: null,
    routedItemIds: [],
    skippedItemIds: [],
  };

  try {
    // One more than the cap tells whether a continuation is needed without a second count query.
    const candidates = await runTenantJob({
      data: payload,
      pool: options.pool,
      work: (transaction) =>
        listCandidates(transaction, payload, batchSize + 1),
    });
    const batch = candidates.slice(0, batchSize);

    for (const candidate of batch) {
      const applied = await applyToItem(options, payload, candidate.id);

      if (applied.skipped) {
        report.skippedItemIds.push(candidate.id);
        continue;
      }

      report.appliedItemIds.push(candidate.id);

      // Sent after the item's transaction has committed, the shape of the intake paths.
      if (applied.routeJob !== null) {
        await options.enqueueRouteInboxItem(applied.routeJob);
        report.routedItemIds.push(candidate.id);
      }
    }

    const last = batch.at(-1);

    if (candidates.length > batchSize && last !== undefined) {
      report.cursor = { itemId: last.id, receivedAt: last.receivedAt };
      await options.enqueueRerunInboxRule({
        cursor: report.cursor,
        organizationId: payload.organizationId,
        ruleId: payload.ruleId,
        userId: payload.userId,
      });
    }
  } catch (error) {
    options.metrics.recordJob(RERUN_INBOX_RULE_QUEUE, 'failed');
    throw error;
  }

  options.metrics.recordJob(RERUN_INBOX_RULE_QUEUE, 'completed');
  // Counts and the rule id only; the item ids stay out of the info line.
  options.logger.log(
    `Rerun inbox rule ${payload.ruleId}: ${report.appliedItemIds.length} applied, ${report.routedItemIds.length} routes enqueued, ${report.skippedItemIds.length} skipped, ${report.cursor === null ? 'walk complete' : 'continuation sent'}`,
    CONTEXT,
  );

  return report;
}
