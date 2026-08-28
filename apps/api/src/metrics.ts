import { Controller, Get, Header, Injectable } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Counter, Gauge, Registry } from '@prometheus-io/client';
import type { DatabasePool } from '@bap/db/pool';

@Injectable()
export class ServiceMetrics {
  readonly registry = new Registry();
  private readonly requests = new Counter({
    help: 'Completed HTTP requests by normalized route and status class',
    labelNames: ['method', 'route', 'status_class'] as const,
    name: 'bap_http_requests_total',
    registers: [this.registry],
  });
  private readonly migrationCompatible = new Gauge({
    help: 'Whether the service database migration is compatible',
    name: 'bap_migration_compatible',
    registers: [this.registry],
  });
  private readonly databasePoolConnections = new Gauge({
    help: 'Database pool connections by state',
    labelNames: ['state'] as const,
    name: 'bap_database_pool_connections',
    registers: [this.registry],
  });

  recordRequest(method: string, route: string, statusCode: number): void {
    this.requests.inc({
      method,
      route,
      status_class: `${Math.floor(statusCode / 100)}xx`,
    });
  }

  setMigrationCompatible(compatible: boolean): void {
    this.migrationCompatible.set(compatible ? 1 : 0);
  }

  setDatabasePoolState(pool: DatabasePool): void {
    this.databasePoolConnections.set({ state: 'idle' }, pool.idleCount);
    this.databasePoolConnections.set({ state: 'total' }, pool.totalCount);
    this.databasePoolConnections.set({ state: 'waiting' }, pool.waitingCount);
  }
}

@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: ServiceMetrics) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  getMetrics(): Promise<string> {
    return this.metrics.registry.metrics();
  }
}
