import { Controller, Get, Header, Inject, Injectable } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Counter, Gauge, Registry } from '@prometheus-io/client';

import { MembershipResolver } from './membership-resolver.js';

@Injectable()
export class ServiceMetrics {
  readonly registry = new Registry();
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
  private readonly requests = new Counter({
    help: 'Completed HTTP requests by normalized route and status class',
    labelNames: ['method', 'route', 'status_class'] as const,
    name: 'bap_http_requests_total',
    registers: [this.registry],
  });

  constructor(
    @Inject(MembershipResolver)
    private readonly memberships: MembershipResolver,
  ) {}

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

  updatePoolStatistics(): void {
    const statistics = this.memberships.getPoolStatistics();
    this.databasePoolConnections.set({ state: 'idle' }, statistics.idle);
    this.databasePoolConnections.set({ state: 'total' }, statistics.total);
    this.databasePoolConnections.set({ state: 'waiting' }, statistics.waiting);
  }
}

@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: ServiceMetrics) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  getMetrics(): Promise<string> {
    this.metrics.updatePoolStatistics();
    return this.metrics.registry.metrics();
  }
}
