import { loadDatabaseConfiguration } from '@bap/db/config';
import type { DatabaseConfiguration } from '@bap/db/config';
import { PgBoss } from 'pg-boss';
import type { ConstructorOptions } from 'pg-boss';

type Environment = Record<string, string | undefined>;

// The queue lives in the pgboss schema installed by the checksummed migration runner.
export const QUEUE_SCHEMA = 'pgboss';

// bap_api holds no CREATE privilege, so pg-boss must never issue DDL at runtime. migrate and createSchema off keep schema ownership with the migration runner. persistQueueStats off suppresses the daily queue_stats partition DDL inside supervise. supervise and schedule on make pg-boss cron the only scheduler in the platform.
export const QUEUE_MAINTENANCE_OPTIONS = {
  createSchema: false,
  migrate: false,
  persistQueueStats: false,
  schedule: true,
  schema: QUEUE_SCHEMA,
  supervise: true,
} as const;

export function createQueueClientFromConfiguration(
  configuration: DatabaseConfiguration,
): PgBoss {
  const options: ConstructorOptions = {
    ...QUEUE_MAINTENANCE_OPTIONS,
    database: configuration.database,
    host: configuration.host,
    password: configuration.password,
    port: configuration.port,
    user: configuration.user,
  };

  // Mirrors createDatabasePool: enabled TLS is always certificate verified.
  if (configuration.ssl) {
    options.ssl = { rejectUnauthorized: true };
  }

  return new PgBoss(options);
}

export async function createQueueClient(env: Environment): Promise<PgBoss> {
  const configuration = await loadDatabaseConfiguration(env, {
    role: 'bap_api',
  });

  return createQueueClientFromConfiguration(configuration);
}

export type QueueOptions = { policy?: 'exclusive' };

// A partitioned queue makes pgboss.create_queue run CREATE TABLE, which bap_api cannot do.
// pg-boss honours singletonKey only under a keyed policy, and createQueue is ON CONFLICT DO NOTHING.
// updateQueue refuses a policy change, so a queue found with another policy is deleted and created again.
// Deleting drops pending jobs; the maintenance requeue re-enqueues every email parent still received after 10 minutes.
export async function createQueue(
  client: PgBoss,
  name: string,
  options: QueueOptions = {},
  warn: (message: string) => void = () => undefined,
): Promise<void> {
  const policy = options.policy ?? 'standard';
  const existing = await client.getQueue(name);

  if (existing !== null && existing.policy !== policy) {
    warn(
      `Recreating queue ${name}: policy ${existing.policy} cannot become ${policy} in place`,
    );
    await client.deleteQueue(name);
  }

  await client.createQueue(name, { ...options, partition: false });
}
