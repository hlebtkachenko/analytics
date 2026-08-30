import { Counter, Gauge, Registry } from '@prometheus-io/client';

export type JobOutcome = 'completed' | 'failed';

export type ModelCallOutcome = 'error' | 'success';

export interface PoolStatistics {
  idle: number;
  total: number;
  waiting: number;
}

export class WorkerMetrics {
  readonly registry = new Registry();
  private readonly migrationCompatible = new Gauge({
    help: 'Whether the worker database migration is compatible',
    name: 'bap_migration_compatible',
    registers: [this.registry],
  });
  private readonly databasePoolConnections = new Gauge({
    help: 'Database pool connections by state',
    labelNames: ['state'] as const,
    name: 'bap_database_pool_connections',
    registers: [this.registry],
  });
  // Labels stay on queue and outcome so no organization or subject identifier is exported.
  private readonly jobs = new Counter({
    help: 'Processed worker jobs by queue and outcome',
    labelNames: ['outcome', 'queue'] as const,
    name: 'bap_worker_jobs_total',
    registers: [this.registry],
  });

  // Supervisor failures are counted without a label so no queue name can leak a tenant hint.
  private readonly queueErrors = new Counter({
    help: 'Queue supervisor failures reported by pg-boss',
    name: 'bap_worker_queue_errors_total',
    registers: [this.registry],
  });

  // Unlabelled on purpose: a per dataset or per tenant label would publish tenant activity.
  private readonly ingestedRows = new Counter({
    help: 'Dataset rows written by the ingestion job',
    name: 'bap_worker_ingested_rows_total',
    registers: [this.registry],
  });

  // Unlabelled for the same reason: the count of embedded datasets must not become a tenant activity feed.
  private readonly embeddedDatasets = new Counter({
    help: 'Datasets embedded by the backfill job',
    name: 'bap_worker_embedded_datasets_total',
    registers: [this.registry],
  });

  // Labelled by outcome only, so no organization, subject, dataset or model name is exported.
  private readonly modelCalls = new Counter({
    help: 'AI provider calls made by the agent jobs by outcome',
    labelNames: ['outcome'] as const,
    name: 'bap_worker_model_calls_total',
    registers: [this.registry],
  });

  recordEmbeddedDatasets(datasets: number): void {
    this.embeddedDatasets.inc(datasets);
  }

  recordIngestedRows(rows: number): void {
    this.ingestedRows.inc(rows);
  }

  recordJob(queue: string, outcome: JobOutcome): void {
    this.jobs.inc({ outcome, queue });
  }

  recordModelCall(outcome: ModelCallOutcome): void {
    this.modelCalls.inc({ outcome });
  }

  recordQueueError(): void {
    this.queueErrors.inc();
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }

  setMigrationCompatible(compatible: boolean): void {
    this.migrationCompatible.set(compatible ? 1 : 0);
  }

  updatePoolStatistics(statistics: PoolStatistics): void {
    this.databasePoolConnections.set({ state: 'idle' }, statistics.idle);
    this.databasePoolConnections.set({ state: 'total' }, statistics.total);
    this.databasePoolConnections.set({ state: 'waiting' }, statistics.waiting);
  }
}
