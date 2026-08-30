import { describe, expect, it } from 'vitest';

import type { MembershipResolver } from './membership-resolver.js';
import { MetricsController, ServiceMetrics } from './metrics.js';

describe('ServiceMetrics', () => {
  it('uses normalized non-identity labels', async () => {
    const memberships = {
      checkReadiness: async () => true,
      getPoolStatistics: () => ({ idle: 1, total: 2, waiting: 0 }),
      resolve: async () => ({ emailVerified: false, role: null }),
    } as MembershipResolver;
    const metrics = new ServiceMetrics(memberships);

    metrics.recordRequest(
      'GET',
      '/v1/organizations/:organizationId/access',
      200,
    );
    metrics.setMigrationCompatible(true);
    const output = await new MetricsController(metrics).getMetrics();

    expect(output).toContain(
      'route="/v1/organizations/:organizationId/access"',
    );
    expect(output).toContain('status_class="2xx"');
    expect(output).not.toContain('subject');
    expect(output).not.toContain('organization_1');
    expect(output).toContain('bap_database_pool_connections{state="total"} 2');
  });
});
