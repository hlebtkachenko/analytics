import { DATABASE_MIGRATION_COMPATIBILITY } from '@bap/db/access';
import type { DatabasePool } from '@bap/db/pool';
import { afterEach, describe, expect, it } from 'vitest';

import {
  startObservabilityServer,
  type ObservabilityServer,
} from './observability.js';
import { WorkerMetrics } from './worker-metrics.js';

function createFakePool(version: string | null): DatabasePool {
  return {
    idleCount: 1,
    query: async () => ({ rows: [{ version }] }),
    totalCount: 2,
    waitingCount: 0,
  } as unknown as DatabasePool;
}

let observability: ObservabilityServer | undefined;

async function start(version: string | null): Promise<string> {
  observability = await startObservabilityServer({
    env: { HOST: '127.0.0.1', PORT: '0' },
    metrics: new WorkerMetrics(),
    pool: createFakePool(version),
  });

  return `http://127.0.0.1:${observability.port}`;
}

afterEach(async () => {
  await observability?.close();
  observability = undefined;
});

describe('startObservabilityServer', () => {
  it('reports worker health', async () => {
    const origin = await start(DATABASE_MIGRATION_COMPATIBILITY);
    const response = await fetch(`${origin}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: 'worker',
      status: 'ok',
    });
  });

  it('reports readiness when the migration version matches', async () => {
    const origin = await start(DATABASE_MIGRATION_COMPATIBILITY);
    const response = await fetch(`${origin}/ready`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: 'worker',
      status: 'ready',
    });
  });

  it('fails readiness and reports the gauge when the migration version differs', async () => {
    const origin = await start('19990101.0001');
    const response = await fetch(`${origin}/ready`);
    const metrics = await fetch(`${origin}/metrics`);

    expect(response.status).toBe(503);
    await expect(metrics.text()).resolves.toContain(
      'bap_migration_compatible 0',
    );
  });

  it('serves the Prometheus text exposition format', async () => {
    const origin = await start(DATABASE_MIGRATION_COMPATIBILITY);
    const response = await fetch(`${origin}/metrics`);

    expect(response.headers.get('content-type')).toBe(
      'text/plain; version=0.0.4; charset=utf-8',
    );
    await expect(response.text()).resolves.toContain(
      'bap_database_pool_connections{state="total"} 2',
    );
  });

  it('rejects unknown paths', async () => {
    const origin = await start(DATABASE_MIGRATION_COMPATIBILITY);
    const response = await fetch(`${origin}/private`);

    expect(response.status).toBe(404);
  });
});
