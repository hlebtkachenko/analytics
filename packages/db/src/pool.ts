import { Pool, type PoolConfig } from 'pg';

import type { DatabaseConfiguration } from './config.js';

export type DatabasePool = Pool;

export interface CreateDatabasePoolOptions {
  searchPath?: 'auth';
}

export function createDatabasePool(
  configuration: DatabaseConfiguration,
  configurationOptions: CreateDatabasePoolOptions = {},
): DatabasePool {
  const poolOptions: PoolConfig = {
    database: configuration.database,
    host: configuration.host,
    password: configuration.password,
    port: configuration.port,
    user: configuration.user,
  };

  if (configurationOptions.searchPath === 'auth') {
    if (configuration.role !== 'bap_auth') {
      throw new Error('The auth search path requires the bap_auth role.');
    }

    poolOptions.options = '-c search_path=auth,pg_catalog';
  }

  if (configuration.ssl) {
    poolOptions.ssl = { rejectUnauthorized: true };
  }

  const pool = new Pool(poolOptions);
  // pg emits idle client failures on the pool and Node exits without a listener; the pool drops that client and reconnects on the next checkout.
  pool.on('error', () => undefined);
  return pool;
}
