import { describe, expect, it } from 'vitest';

import { QUEUE_MAINTENANCE_OPTIONS } from './queue.js';

describe('QUEUE_MAINTENANCE_OPTIONS', () => {
  it('keeps every runtime schema change disabled for the bap_api role', () => {
    expect(QUEUE_MAINTENANCE_OPTIONS).toEqual({
      createSchema: false,
      migrate: false,
      persistQueueStats: false,
      schedule: true,
      schema: 'pgboss',
      supervise: true,
    });
  });
});
