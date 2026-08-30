import { describe, expect, it } from 'vitest';

import { WorkerMetrics } from './worker-metrics.js';

describe('WorkerMetrics', () => {
  it('uses normalized non-identity labels', async () => {
    const metrics = new WorkerMetrics();

    metrics.recordJob('ingest_dataset', 'completed');
    metrics.recordJob('ingest_dataset', 'failed');
    metrics.setMigrationCompatible(true);
    metrics.updatePoolStatistics({ idle: 1, total: 2, waiting: 0 });
    const output = await metrics.render();

    expect(output).toContain('queue="ingest_dataset"');
    expect(output).toContain('outcome="completed"');
    expect(output).toContain('outcome="failed"');
    expect(output).toContain('bap_migration_compatible 1');
    expect(output).toContain('bap_database_pool_connections{state="total"} 2');
    expect(output).not.toContain('organization');
    expect(output).not.toContain('subject');
    expect(output).not.toContain('user');
  });
});
