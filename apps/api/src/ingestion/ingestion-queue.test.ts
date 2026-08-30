import type { PgBoss } from 'pg-boss';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { INGEST_DATASET_QUEUE } from './contract.js';
import type { IngestDatasetJob } from './contract.js';
import { PgBossIngestionQueue } from './ingestion-queue.js';

const mocks = vi.hoisted(() => ({
  createQueue: vi.fn(),
  createQueueClientFromConfiguration: vi.fn(),
  loadDatabaseConfiguration: vi.fn(),
}));

vi.mock('@bap/db/config', () => ({
  loadDatabaseConfiguration: mocks.loadDatabaseConfiguration,
}));

vi.mock('../worker/queue.js', () => ({
  createQueue: mocks.createQueue,
  createQueueClientFromConfiguration: mocks.createQueueClientFromConfiguration,
}));

const job: IngestDatasetJob = {
  organizationId: 'organization_1',
  uploadId: '00000000-0000-4000-8000-000000000001',
  userId: 'user_1',
};

interface FakeClient {
  on: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

function createFakeClient(): FakeClient {
  return {
    on: vi.fn(),
    send: vi.fn(async () => 'job_1'),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  };
}

function queueWithClients(...clients: readonly FakeClient[]): void {
  for (const client of clients) {
    mocks.createQueueClientFromConfiguration.mockReturnValueOnce(
      client as unknown as PgBoss,
    );
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.loadDatabaseConfiguration.mockResolvedValue({ role: 'bap_api' });
  mocks.createQueue.mockResolvedValue(undefined);
});

describe('PgBossIngestionQueue', () => {
  it('retries the client start after a first failure instead of caching the rejection', async () => {
    const failing = createFakeClient();
    failing.start.mockRejectedValueOnce(new Error('the database is starting'));
    const working = createFakeClient();
    queueWithClients(failing, working);
    const queue = new PgBossIngestionQueue();

    await expect(queue.enqueue(job)).rejects.toThrow(
      'the database is starting',
    );
    await expect(queue.enqueue(job)).resolves.toBeUndefined();

    expect(working.send).toHaveBeenCalledWith(INGEST_DATASET_QUEUE, job, {
      retryLimit: 0,
    });
    // The abandoned client must not keep its connection pool open.
    expect(failing.stop).toHaveBeenCalledTimes(1);
  });

  it('reuses one client across enqueues once the start succeeded', async () => {
    const client = createFakeClient();
    queueWithClients(client);
    const queue = new PgBossIngestionQueue();

    await queue.enqueue(job);
    await queue.enqueue(job);

    expect(mocks.createQueueClientFromConfiguration).toHaveBeenCalledTimes(1);
    expect(client.send).toHaveBeenCalledTimes(2);
  });

  it('shuts down cleanly when the client was never started', async () => {
    const queue = new PgBossIngestionQueue();

    await expect(queue.onModuleDestroy()).resolves.toBeUndefined();
    expect(mocks.createQueueClientFromConfiguration).not.toHaveBeenCalled();
  });

  it('shuts down cleanly while a failing start is still in flight', async () => {
    const failing = createFakeClient();
    failing.start.mockRejectedValue(new Error('the database is unreachable'));
    queueWithClients(failing);
    const queue = new PgBossIngestionQueue();
    const enqueued = queue.enqueue(job);
    const destroyed = queue.onModuleDestroy();

    await expect(enqueued).rejects.toThrow('the database is unreachable');
    await expect(destroyed).resolves.toBeUndefined();
  });
});
