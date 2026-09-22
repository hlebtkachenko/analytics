import type { DatabasePool } from '@bap/db/pool';
import type { PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlobStore } from '../blobs/blob-store.js';
import type {
  RerunInboxRuleJob,
  RouteInboxItemJob,
} from '../inbox/contract.js';
import {
  RERUN_INBOX_RULE_BATCH_SIZE,
  rerunInboxRule,
} from './rerun-inbox-rule.js';
import { WorkerMetrics } from './worker-metrics.js';

const repository = vi.hoisted(() => ({
  applyInboxRules: vi.fn(),
  loadItem: vi.fn(),
  loadItemFiles: vi.fn(async () => []),
  loadMatchedRuleIds: vi.fn<
    (transaction: unknown, itemId: string) => Promise<string[]>
  >(async () => []),
}));

vi.mock('../inbox/inbox-repository-support.js', () => repository);
vi.mock('../inbox/inbox-rule-repository.js', () => repository);

const ORGANIZATION = 'org_1';
const RULE_ID = '4a2b7c1e-9f5d-4c3a-8b21-6e0f7d5a4c39';
const OTHER_RULE_ID = '5b3c8d2f-0a6e-4d4b-9c32-7f1a8e6b5d40';
const FIRST = '9f702163-4eac-4b8f-9076-b34ec2af9184';
const SECOND = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const THIRD = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
const ITEMS = [FIRST, SECOND, THIRD];

interface RecordedQuery {
  text: string;
  values: unknown[];
}

interface Fixture {
  queries: RecordedQuery[];
  reruns: RerunInboxRuleJob[];
  routes: RouteInboxItemJob[];
  run: (
    batchSize?: number,
    cursor?: RerunInboxRuleJob['cursor'],
  ) => ReturnType<typeof rerunInboxRule>;
}

function fixture(candidates: string[], touched: string[] = []): Fixture {
  const queries: RecordedQuery[] = [];
  const reruns: RerunInboxRuleJob[] = [];
  const routes: RouteInboxItemJob[] = [];
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      queries.push({ text, values });

      if (text.includes('order by i.received_at, i.id')) {
        const limit = Number(values[3]);
        return {
          rows: candidates.slice(0, limit).map((id, index) => ({
            id,
            received_at: `2026-09-17T08:0${index}:00.000123Z`,
          })),
        };
      }

      if (text.includes('select 1 from app.inbox_item as i where i.id = $2')) {
        return { rows: touched.includes(String(values[1])) ? [] : [1] };
      }

      return { rows: [] };
    },
    release: () => undefined,
  } as unknown as PoolClient;
  const pool = {
    connect: async () => client,
    query: async () => ({ rows: [{ email_verified: true, role: 'owner' }] }),
  } as unknown as DatabasePool;

  return {
    queries,
    reruns,
    routes,
    run: (batchSize, cursor) =>
      rerunInboxRule({
        ...(batchSize === undefined ? {} : { batchSize }),
        blobs: {} as BlobStore,
        data: {
          ...(cursor === undefined ? {} : { cursor }),
          organizationId: ORGANIZATION,
          ruleId: RULE_ID,
          userId: 'user-1',
        },
        enqueueRerunInboxRule: async (job) => {
          reruns.push(job);
        },
        enqueueRouteInboxItem: async (job) => {
          routes.push(job);
        },
        logger: { log: () => undefined },
        metrics: new WorkerMetrics(),
        pool,
      }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  repository.loadItem.mockImplementation(async (_t, id: string) => ({
    id,
    status: 'needs_review',
  }));
  repository.loadMatchedRuleIds.mockResolvedValue([]);
  repository.applyInboxRules.mockImplementation(
    async (_t, input: { itemId: string }) => ({
      discarded: false,
      matchedRuleIds: [RULE_ID],
      routeJob: {
        itemId: input.itemId,
        organizationId: ORGANIZATION,
        ruleId: RULE_ID,
      },
    }),
  );
});

describe('rerunInboxRule', () => {
  it('keeps the production cap at 100', () => {
    expect(RERUN_INBOX_RULE_BATCH_SIZE).toBe(100);
  });

  it('applies the rule alone to every untouched item and enqueues the routes it asks for', async () => {
    const context = fixture(ITEMS);
    const report = await context.run();

    expect(report).toEqual({
      appliedItemIds: ITEMS,
      cursor: null,
      routedItemIds: ITEMS,
      skippedItemIds: [],
    });
    expect(context.routes.map((job) => job.itemId)).toEqual(ITEMS);
    expect(context.reruns).toEqual([]);
    expect(repository.applyInboxRules).toHaveBeenCalledWith(expect.anything(), {
      itemId: FIRST,
      organizationId: ORGANIZATION,
      role: 'owner',
      ruleIds: [RULE_ID],
      text: null,
      userId: 'user-1',
    });
    // The listing carries the human touch kinds, no cursor, and one more than the cap.
    const listing = context.queries.find((query) =>
      query.text.includes('order by i.received_at, i.id'),
    );
    expect(listing?.values).toEqual([
      ['hint_added', 'assigned', 'restored', 'reopened', 'unrouted'],
      null,
      null,
      RERUN_INBOX_RULE_BATCH_SIZE + 1,
    ]);
    // Every item is locked in its own transaction before the pass.
    expect(repository.loadItem.mock.calls.map((call) => call.slice(1))).toEqual(
      ITEMS.map((id) => [id, null, true]),
    );
  });

  it('skips an item whose newest rule extraction already names the rule', async () => {
    repository.loadMatchedRuleIds.mockImplementation(async (_t, id) =>
      id === SECOND ? [OTHER_RULE_ID, RULE_ID] : [OTHER_RULE_ID],
    );
    const context = fixture(ITEMS);
    const report = await context.run();

    expect(report.skippedItemIds).toEqual([SECOND]);
    expect(report.appliedItemIds).toEqual([FIRST, THIRD]);
    expect(repository.applyInboxRules).toHaveBeenCalledTimes(2);
  });

  it('skips an item a person touched or decided between the listing and the lock', async () => {
    repository.loadItem.mockImplementation(async (_t, id: string) => ({
      id,
      status: id === THIRD ? 'routed' : 'needs_review',
    }));
    const context = fixture(ITEMS, [FIRST]);
    const report = await context.run();

    expect(report.skippedItemIds).toEqual([FIRST, THIRD]);
    expect(report.appliedItemIds).toEqual([SECOND]);
  });

  it('enqueues no route when the rule itself did not ask for one', async () => {
    repository.applyInboxRules.mockResolvedValue({
      discarded: false,
      matchedRuleIds: [RULE_ID],
      routeJob: {
        itemId: FIRST,
        organizationId: ORGANIZATION,
        ruleId: null,
      },
    });
    const context = fixture([FIRST]);
    const report = await context.run();

    expect(report.appliedItemIds).toEqual([FIRST]);
    expect(report.routedItemIds).toEqual([]);
    expect(context.routes).toEqual([]);
  });

  it('counts a non-matching item as skipped', async () => {
    repository.applyInboxRules.mockResolvedValue({
      discarded: false,
      matchedRuleIds: [],
      routeJob: null,
    });
    const report = await fixture([FIRST]).run();

    expect(report.skippedItemIds).toEqual([FIRST]);
  });

  it('self-requeues with the cursor of the last processed item past the cap', async () => {
    const context = fixture(ITEMS);
    const report = await context.run(2);

    expect(report.appliedItemIds).toEqual([FIRST, SECOND]);
    expect(report.cursor).toEqual({
      itemId: SECOND,
      receivedAt: '2026-09-17T08:01:00.000123Z',
    });
    expect(context.reruns).toEqual([
      {
        cursor: { itemId: SECOND, receivedAt: '2026-09-17T08:01:00.000123Z' },
        organizationId: ORGANIZATION,
        ruleId: RULE_ID,
        userId: 'user-1',
      },
    ]);
  });

  it('resumes from the payload cursor and sends no continuation on the last batch', async () => {
    const cursor = { itemId: FIRST, receivedAt: '2026-09-17T08:00:00.000Z' };
    const context = fixture([SECOND, THIRD]);
    const report = await context.run(2, cursor);

    expect(report.cursor).toBeNull();
    expect(context.reruns).toEqual([]);
    const listing = context.queries.find((query) =>
      query.text.includes('order by i.received_at, i.id'),
    );
    expect(listing?.values.slice(1)).toEqual([
      cursor.receivedAt,
      cursor.itemId,
      3,
    ]);
  });

  it('refuses a payload without the rule', async () => {
    await expect(
      rerunInboxRule({
        blobs: {} as BlobStore,
        data: { organizationId: ORGANIZATION, userId: 'user-1' },
        enqueueRerunInboxRule: async () => undefined,
        enqueueRouteInboxItem: async () => undefined,
        logger: { log: () => undefined },
        metrics: new WorkerMetrics(),
        pool: {} as DatabasePool,
      }),
    ).rejects.toThrow();
  });
});
