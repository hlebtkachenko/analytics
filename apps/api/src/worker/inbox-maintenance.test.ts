import type { DatabasePool } from '@bap/db/pool';
import { describe, expect, it, vi } from 'vitest';

import type { BlobStore, StaleBlob } from '../blobs/blob-store.js';
import type { SplitEmailItemJob } from '../inbox/contract.js';
import {
  INBOX_MAINTENANCE_CRON,
  INBOX_MAINTENANCE_SCHEDULE_OPTIONS,
  MAINTENANCE_ROW_LIMIT,
  ORPHAN_FILE_LIMIT,
  runInboxMaintenance,
  scheduleInboxMaintenance,
} from './inbox-maintenance.js';
import { WorkerMetrics } from './worker-metrics.js';

const ORGANIZATION = 'organization_1';
const TRACKED = 'a'.repeat(64);
const ORPHAN = 'b'.repeat(64);
const ITEM_ID = '6c4d9e30-1b7f-4e5c-ad43-801b9f7c6e51';
const CHANNEL_ID = '4a2b7c1e-9f5d-4c3a-8b21-6e0f7d5a4c39';

interface Fixture {
  blobs: BlobStore;
  enqueued: SplitEmailItemJob[];
  lines: { level: string; message: string }[];
  metrics: WorkerMetrics;
  pool: DatabasePool;
  queries: { text: string; values: unknown[] }[];
  unlinked: string[];
}

const REAPER_ERROR_PATH = '/var/lib/bap/org/organization_1/6c4d9e30.bin';

function fixture(
  options: { reaperFails?: boolean; sweepFails?: boolean } = {},
): Fixture {
  const queries: { text: string; values: unknown[] }[] = [];
  const unlinked: string[] = [];
  const enqueued: SplitEmailItemJob[] = [];
  const lines: { level: string; message: string }[] = [];
  const pool = {
    query: async (text: string, values: unknown[]) => {
      queries.push({ text, values });
      if (text.includes('app.list_blob_keys')) {
        return { rows: [{ list_blob_keys: TRACKED }] };
      }
      if (text.includes('app.reap_stalled_inbox_items')) {
        if (options.reaperFails === true) {
          const error = new Error(
            `ENOENT: no such file or directory, unlink '${REAPER_ERROR_PATH}'`,
          ) as NodeJS.ErrnoException;
          error.code = 'ENOENT';
          throw error;
        }
        return { rows: [{ id: ITEM_ID }] };
      }
      if (text.includes('app.list_stuck_email_items')) {
        return {
          rows: [
            {
              channel_id: CHANNEL_ID,
              item_id: ITEM_ID,
              organization_id: ORGANIZATION,
            },
          ],
        };
      }
      return { rows: [] };
    },
  } as unknown as DatabasePool;
  const stale: StaleBlob[] = [
    { key: `org/${ORGANIZATION}/${TRACKED}`, sha256: TRACKED },
    { key: `org/${ORGANIZATION}/${ORPHAN}`, sha256: ORPHAN },
  ];
  const blobs = {
    listOrganizations: vi.fn(async () => {
      if (options.sweepFails === true) {
        throw new Error(
          `EACCES: permission denied, scandir 'org/${ORGANIZATION}'`,
        );
      }
      return [ORGANIZATION];
    }),
    listStale: vi.fn(async () => stale),
    unlink: vi.fn(async (key: string) => {
      unlinked.push(key);
    }),
  } as unknown as BlobStore;

  return {
    blobs,
    enqueued,
    lines,
    metrics: new WorkerMetrics(),
    pool,
    queries,
    unlinked,
  };
}

function loggerOf(lines: Fixture['lines']) {
  return {
    debug: (message: string) => lines.push({ level: 'debug', message }),
    error: (message: string) => lines.push({ level: 'error', message }),
    log: (message: string) => lines.push({ level: 'info', message }),
  };
}

describe('runInboxMaintenance', () => {
  it('sweeps orphans, reaps stalled items and requeues stuck emails in three statements', async () => {
    const f = fixture();

    const report = await runInboxMaintenance({
      blobs: f.blobs,
      data: {},
      enqueueSplitEmailItem: async (job) => {
        f.enqueued.push(job);
      },
      logger: loggerOf(f.lines),
      metrics: f.metrics,
      pool: f.pool,
    });

    expect(report).toEqual({
      failedTasks: [],
      orphansRemoved: 1,
      reapedItemIds: [ITEM_ID],
      requeuedItemIds: [ITEM_ID],
    });
    // Only the hash with no row is unlinked; the tracked one stays.
    expect(f.unlinked).toEqual([`org/${ORGANIZATION}/${ORPHAN}`]);
    expect(f.blobs.listStale).toHaveBeenCalledWith(
      ORGANIZATION,
      expect.any(Date),
      ORPHAN_FILE_LIMIT,
    );
    expect(f.queries.map((query) => query.values)).toEqual([
      [ORGANIZATION, [TRACKED, ORPHAN]],
      ['60 minutes', MAINTENANCE_ROW_LIMIT],
      ['10 minutes', MAINTENANCE_ROW_LIMIT],
    ]);
    expect(f.enqueued).toEqual([
      { channelId: CHANNEL_ID, itemId: ITEM_ID, organizationId: ORGANIZATION },
    ]);
    expect(await f.metrics.render()).toContain(
      'bap_worker_jobs_total{outcome="completed",queue="inbox_maintenance"} 1',
    );
  });

  it('runs the remaining tasks when one throws and records the tick as failed', async () => {
    const f = fixture({ reaperFails: true });

    const report = await runInboxMaintenance({
      blobs: f.blobs,
      data: {},
      enqueueSplitEmailItem: async (job) => {
        f.enqueued.push(job);
      },
      logger: loggerOf(f.lines),
      metrics: f.metrics,
      pool: f.pool,
    });

    expect(report.failedTasks).toEqual(['reap_stalled_items']);
    expect(report.orphansRemoved).toBe(1);
    expect(report.requeuedItemIds).toEqual([ITEM_ID]);
    const errors = f.lines.filter((line) => line.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('reap_stalled_items');
    expect(errors[0]?.message).toContain('ENOENT');
    expect(errors[0]?.message).not.toContain('no such file or directory');
    expect(errors[0]?.message).not.toContain(REAPER_ERROR_PATH);
    expect(await f.metrics.render()).toContain(
      'bap_worker_jobs_total{outcome="failed",queue="inbox_maintenance"} 1',
    );
  });

  it('runs the reaper and the requeue when the sweep throws and records the tick as failed', async () => {
    const f = fixture({ sweepFails: true });

    const report = await runInboxMaintenance({
      blobs: f.blobs,
      data: {},
      enqueueSplitEmailItem: async (job) => {
        f.enqueued.push(job);
      },
      logger: loggerOf(f.lines),
      metrics: f.metrics,
      pool: f.pool,
    });

    expect(report.failedTasks).toEqual(['sweep_orphans']);
    expect(report.reapedItemIds).toEqual([ITEM_ID]);
    expect(report.requeuedItemIds).toEqual([ITEM_ID]);
    expect(f.lines.filter((line) => line.level === 'error')).toHaveLength(1);
    expect(await f.metrics.render()).toContain(
      'bap_worker_jobs_total{outcome="failed",queue="inbox_maintenance"} 1',
    );
  });

  it('logs counts at info and ids at debug, never a key or a filename', async () => {
    const f = fixture();

    await runInboxMaintenance({
      blobs: f.blobs,
      data: {},
      enqueueSplitEmailItem: async () => undefined,
      logger: loggerOf(f.lines),
      metrics: f.metrics,
      pool: f.pool,
    });

    const info = f.lines.filter((line) => line.level === 'info');
    const debug = f.lines.filter((line) => line.level === 'debug');
    expect(info).toHaveLength(1);
    expect(info[0]?.message).toContain('1 orphaned files removed');
    expect(info[0]?.message).toContain('1 stalled items reaped');
    expect(info[0]?.message).toContain('1 email items requeued');
    expect(info[0]?.message).not.toContain(ITEM_ID);
    expect(debug[0]?.message).toContain(ITEM_ID);
    for (const line of f.lines) {
      expect(line.message).not.toContain(ORPHAN);
      expect(line.message).not.toContain('org/');
    }
  });

  it('refuses a payload that carries anything', async () => {
    const f = fixture();

    await expect(
      runInboxMaintenance({
        blobs: f.blobs,
        data: { organizationId: ORGANIZATION },
        enqueueSplitEmailItem: async () => undefined,
        logger: loggerOf(f.lines),
        metrics: f.metrics,
        pool: f.pool,
      }),
    ).rejects.toThrow();
    expect(f.queries).toEqual([]);
  });
});

describe('scheduleInboxMaintenance', () => {
  it('registers the cron once with the singleton key and the run options', async () => {
    const schedule = vi.fn(async () => undefined);

    await scheduleInboxMaintenance({ schedule });

    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith(
      'inbox_maintenance',
      INBOX_MAINTENANCE_CRON,
      {},
      INBOX_MAINTENANCE_SCHEDULE_OPTIONS,
    );
    expect(INBOX_MAINTENANCE_CRON).toBe('*/15 * * * *');
    expect(INBOX_MAINTENANCE_SCHEDULE_OPTIONS).toEqual({
      expireInSeconds: 600,
      retryLimit: 0,
      singletonKey: 'inbox_maintenance',
    });
  });
});
