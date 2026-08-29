import { describe, expect, it } from 'vitest';

import { ServiceMetrics } from './metrics.js';

describe('ServiceMetrics', () => {
  it('uses normalized non-identity labels', async () => {
    const metrics = new ServiceMetrics();

    metrics.recordRequest(
      'GET',
      '/v1/organizations/:organizationId/access',
      200,
    );
    metrics.setMigrationCompatible(true);
    const output = await metrics.registry.metrics();

    expect(output).toContain(
      'route="/v1/organizations/:organizationId/access"',
    );
    expect(output).toContain('status_class="2xx"');
    expect(output).not.toContain('subject');
    expect(output).not.toContain('organization_1');
  });
});
