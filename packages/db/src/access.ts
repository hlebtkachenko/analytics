import { z } from 'zod';

import type { DatabasePool } from './pool.js';

const membershipRoleSchema = z.enum(['owner', 'admin', 'member']);
export type MembershipRole = z.infer<typeof membershipRoleSchema>;

export interface MembershipResolution {
  emailVerified: boolean;
  role: MembershipRole;
}

export interface ResolveMembershipInput {
  organizationId: string;
  subjectId: string;
}

// Exact match against the version recorded by the migration runner.
// Bump it to the newest migration id in the same pull request as that migration.
// Rollback consequence: application code rolled back after the migration is
// applied makes /ready return 503 on every service until this is bumped again.
export const DATABASE_MIGRATION_COMPATIBILITY = '20260830.0004';

export async function resolveMembership(
  pool: DatabasePool,
  input: ResolveMembershipInput,
): Promise<MembershipResolution | null> {
  const result = await pool.query<{
    email_verified: boolean;
    role: string;
  }>('select email_verified, role from auth.resolve_membership($1, $2)', [
    input.subjectId,
    input.organizationId,
  ]);
  const row = result.rows[0];

  if (row === undefined) {
    return null;
  }

  return {
    emailVerified: row.email_verified,
    role: membershipRoleSchema.parse(row.role),
  };
}

export interface MigrationCompatibility {
  compatible: boolean;
  expectedVersion: string;
  version: string | null;
}

export async function checkMigrationCompatibility(
  pool: DatabasePool,
): Promise<MigrationCompatibility> {
  const result = await pool.query<{ version: string | null }>(
    'select version from bap_migrations.current_migration_version()',
  );
  const version = result.rows[0]?.version ?? null;

  return {
    compatible: version === DATABASE_MIGRATION_COMPATIBILITY,
    expectedVersion: DATABASE_MIGRATION_COMPATIBILITY,
    version,
  };
}
