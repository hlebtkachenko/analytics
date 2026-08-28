import { describe, expect, it } from 'vitest';

import { renderMetrics } from './metrics';

describe('renderMetrics', () => {
  it('exports process metrics without user or organization dimensions', async () => {
    const metrics = await renderMetrics();

    expect(metrics).toContain('process_');
    expect(metrics).not.toContain('organization_id');
    expect(metrics).not.toContain('user_id');
  });
});
