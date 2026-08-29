import { checkMigrationCompatibility } from '@bap/db/access';
import type { DatabasePool } from '@bap/db/pool';

export type ReadinessPool = DatabasePool;

export async function checkReadiness(pool: ReadinessPool): Promise<boolean> {
  return (await checkMigrationCompatibility(pool)).compatible;
}
