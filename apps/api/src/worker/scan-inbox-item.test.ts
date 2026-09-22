import { Readable } from 'node:stream';

import type { DatabasePool } from '@bap/db/pool';
import type { PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RouteInboxItemJob } from '../inbox/contract.js';
import type { BlobScanner, ScanOutcome } from '../scanning/clamd-client.js';
import { ScanInboxError, scanInboxItem } from './scan-inbox-item.js';
import { WorkerMetrics } from './worker-metrics.js';

const repository = vi.hoisted(() => ({
  appendEvent: vi.fn(async () => undefined),
}));

vi.mock('../inbox/inbox-repository-support.js', () => repository);

const ORGANIZATION = 'organization_1';
const CHANNEL_ID = 'c2a35496-71df-4eb2-8309-e671f5d2c4b7';
const ITEM_ID = '9f702163-4eac-4b8f-9076-b34ec2af9184';
const BLOB_ID = '7d1c8a44-3d29-4b4a-9d9b-1f0c3e2a5b6c';
const STORAGE_KEY = `org/${ORGANIZATION}/a`.padEnd(20, 'b');

interface RecordedQuery {
  text: string;
  values: unknown[];
}

interface FixtureOptions {
  retry?: { count: number; limit: number };
  // The route the intake deferred; absent means it asked for none.
  routeRuleId?: string | null;
  status?: string;
  unscanned?: boolean;
  verdict?: ScanOutcome;
}

interface Fixture {
  metrics: WorkerMetrics;
  queries: RecordedQuery[];
  routed: RouteInboxItemJob[];
  run: () => Promise<void>;
  scanned: number[];
}

function fixture(options: FixtureOptions = {}): Fixture {
  const queries: RecordedQuery[] = [];
  const routed: RouteInboxItemJob[] = [];
  const scanned: number[] = [];
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      queries.push({ text, values });

      if (text.includes('from app.inbox_channel')) {
        return { rows: [{ '?column?': 1 }] };
      }

      if (text.includes('from app.inbox_item as i')) {
        return {
          rows: [
            {
              blob_id: options.unscanned === false ? null : BLOB_ID,
              byte_size: '11',
              status: options.status ?? 'needs_review',
              storage_key: options.unscanned === false ? null : STORAGE_KEY,
            },
          ],
        };
      }

      return { rowCount: 1, rows: [] };
    },
    release: () => undefined,
  } as unknown as PoolClient;
  const pool = { connect: async () => client } as unknown as DatabasePool;
  const scanner: BlobScanner = {
    scan: async (stream, byteSize) => {
      stream.destroy();
      scanned.push(byteSize);
      return options.verdict ?? { outcome: 'clean' };
    },
  };
  const metrics = new WorkerMetrics();

  return {
    metrics,
    queries,
    routed,
    run: () =>
      scanInboxItem({
        blobs: {
          open: () => Readable.from(['placeholder']),
        } as never,
        data: {
          channelId: CHANNEL_ID,
          itemId: ITEM_ID,
          organizationId: ORGANIZATION,
          ...('routeRuleId' in options
            ? { routeRuleId: options.routeRuleId }
            : {}),
        },
        enqueueRouteInboxItem: async (job) => {
          routed.push(job);
        },
        metrics,
        pool,
        retry: options.retry ?? { count: 0, limit: 3 },
        scanner,
      }),
    scanned,
  };
}

function verdicts(queries: RecordedQuery[]): unknown[][] {
  return queries
    .filter((query) => query.text.includes('app.record_blob_scan'))
    .map((query) => query.values);
}

async function jobCount(
  metrics: WorkerMetrics,
  outcome: string,
): Promise<number> {
  const line = (await metrics.render())
    .split('\n')
    .find(
      (candidate) =>
        candidate.includes('scan_inbox_item') && candidate.includes(outcome),
    );
  return line === undefined ? 0 : Number(line.split(' ').at(-1));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('scanInboxItem', () => {
  it('records a clean verdict and sends the route the intake deferred', async () => {
    const context = fixture({ routeRuleId: null });

    await context.run();

    expect(context.scanned).toEqual([11]);
    expect(verdicts(context.queries)).toEqual([[BLOB_ID, 'clean']]);
    expect(repository.appendEvent).toHaveBeenCalledWith(
      expect.anything(),
      {
        organizationId: ORGANIZATION,
        role: 'channel',
        userId: `channel_${CHANNEL_ID}`,
      },
      ITEM_ID,
      'scanned',
    );
    expect(context.routed).toEqual([
      { itemId: ITEM_ID, organizationId: ORGANIZATION, ruleId: null },
    ]);
    expect(await jobCount(context.metrics, 'completed')).toBe(1);
  });

  it('discards the item on an infected verdict and routes nothing', async () => {
    const context = fixture({
      verdict: { outcome: 'infected', signature: 'Eicar-Test-Signature' },
    });

    await context.run();

    expect(verdicts(context.queries)).toEqual([[BLOB_ID, 'infected']]);
    const discarded = context.queries.find((query) =>
      query.text.includes('update app.inbox_item set status'),
    );
    expect(discarded?.values).toEqual([ITEM_ID, 'discarded', 'needs_review']);
    expect(repository.appendEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      ITEM_ID,
      'discarded',
      'policy_rejected',
    );
    expect(context.routed).toEqual([]);
  });

  it('retries a scanner error until the last attempt records the failed verdict', async () => {
    const retrying = fixture({
      retry: { count: 0, limit: 3 },
      verdict: { outcome: 'error', reason: 'unreachable' },
    });

    await expect(retrying.run()).rejects.toBeInstanceOf(ScanInboxError);
    expect(verdicts(retrying.queries)).toEqual([]);
    expect(await jobCount(retrying.metrics, 'failed')).toBe(1);

    const last = fixture({
      retry: { count: 3, limit: 3 },
      verdict: { outcome: 'error', reason: 'unreachable' },
    });
    await last.run();

    expect(verdicts(last.queries)).toEqual([[BLOB_ID, 'failed']]);
    expect(last.routed).toEqual([]);
    expect(await jobCount(last.metrics, 'completed')).toBe(1);
  });

  it('scans nothing for an item that was already settled', async () => {
    for (const status of ['discarded', 'failed']) {
      const context = fixture({ status });

      await context.run();

      expect(context.scanned).toEqual([]);
      expect(verdicts(context.queries)).toEqual([]);
      expect(context.routed).toEqual([]);
      expect(await jobCount(context.metrics, 'completed')).toBe(1);
    }
  });

  it('records the verdict of a routed item without deciding or routing it again', async () => {
    const clean = fixture({ routeRuleId: null, status: 'routed' });

    await clean.run();

    expect(verdicts(clean.queries)).toEqual([[BLOB_ID, 'clean']]);
    // The item keeps the decision a person or a rule already took.
    expect(
      clean.queries.filter((query) =>
        query.text.includes('update app.inbox_item set status'),
      ),
    ).toEqual([]);
    expect(clean.routed).toEqual([]);

    const infected = fixture({
      status: 'routed',
      verdict: { outcome: 'infected', signature: 'Eicar-Test-Signature' },
    });
    await infected.run();

    expect(verdicts(infected.queries)).toEqual([[BLOB_ID, 'infected']]);
    expect(
      infected.queries.filter((query) =>
        query.text.includes('update app.inbox_item set status'),
      ),
    ).toEqual([]);
    expect(repository.appendEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      ITEM_ID,
      'discarded',
      'policy_rejected',
    );
  });

  it('sends the deferred route even when every blob already carries a verdict', async () => {
    const context = fixture({ routeRuleId: null, unscanned: false });

    await context.run();

    expect(context.scanned).toEqual([]);
    expect(context.routed).toEqual([
      { itemId: ITEM_ID, organizationId: ORGANIZATION, ruleId: null },
    ]);
  });

  it('sends no route when the intake asked for none', async () => {
    const context = fixture();

    await context.run();

    expect(verdicts(context.queries)).toEqual([[BLOB_ID, 'clean']]);
    expect(context.routed).toEqual([]);
  });
});
