import { describe, expect, it } from 'vitest';

import type { DatabaseConfiguration } from './config.js';
import { createDatabasePool } from './pool.js';

const configuration: DatabaseConfiguration = {
  database: 'bap',
  host: 'database.invalid',
  password: 'test-only-value',
  port: 5432,
  role: 'bap_api',
  ssl: false,
  user: 'bap_api',
};

describe('createDatabasePool', () => {
  it('swallows idle client failures instead of ending the process', async () => {
    const pool = createDatabasePool(configuration);

    expect(pool.listenerCount('error')).toBe(1);
    expect(() =>
      pool.emit('error', new Error('idle client failed')),
    ).not.toThrow();

    await pool.end();
  });
});
