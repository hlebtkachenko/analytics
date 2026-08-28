import { describe, expect, it } from 'vitest';

import type { MembershipResolver } from './membership-resolver.js';
import { MetricsController, ServiceMetrics } from './metrics.js';

describe('reporting metrics', () => {
  it('uses only normalized labels and exposes no organization or subject value', async () => {
    const memberships = {
      checkReadiness: async () => true,
      getPoolStatistics: () => ({ idle: 1, total: 2, waiting: 0 }),
      resolve: async () => ({ emailVerified: false, role: null }),
    } as MembershipResolver;
    const metrics = new ServiceMetrics(memberships);
    metrics.recordRequest('GET', '/organizations/:organizationId/access', 200);

    const output = await new MetricsController(metrics).getMetrics();

    expect(output).toContain('route="/organizations/:organizationId/access"');
    expect(output).not.toContain('organization_');
    expect(output).not.toContain('subject=');
    expect(output).toContain('bap_database_pool_connections{state="total"} 2');
  });
});
