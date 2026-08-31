import {
  createDatabasePool,
  ensureInitialOrganizationQuota,
  loadDatabaseConfiguration,
} from '@bap/db';
import type { DatabaseConfiguration, DatabasePool } from '@bap/db';

type Environment = Readonly<Record<string, string | undefined>>;

export interface InitialQuotaSeederDependencies {
  createPool: (configuration: DatabaseConfiguration) => DatabasePool;
  ensureQuota: (pool: DatabasePool, userId: string) => Promise<unknown>;
  loadConfiguration: (
    environment: Environment,
    options: Readonly<{ role: 'bap_migrator' }>,
  ) => Promise<DatabaseConfiguration>;
}

const defaultDependencies: InitialQuotaSeederDependencies = {
  createPool: createDatabasePool,
  ensureQuota: ensureInitialOrganizationQuota,
  loadConfiguration: loadDatabaseConfiguration,
};

export async function seedInitialOrganizationQuotaForCli(
  userId: string,
  environment: Environment = process.env,
  dependencies: InitialQuotaSeederDependencies = defaultDependencies,
): Promise<void> {
  const passwordFile = environment.BAP_MIGRATOR_PASSWORD_FILE;
  if (passwordFile === undefined || passwordFile.length === 0) {
    throw new Error('Initial organization setup is unavailable.');
  }

  const configuration = await dependencies.loadConfiguration(
    {
      ...environment,
      BAP_DATABASE_PASSWORD_FILE: passwordFile,
      BAP_DATABASE_USER: 'bap_migrator',
    },
    { role: 'bap_migrator' },
  );
  const pool = dependencies.createPool(configuration);

  try {
    await dependencies.ensureQuota(pool, userId);
  } finally {
    await pool.end();
  }
}
