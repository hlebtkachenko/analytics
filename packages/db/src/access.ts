import { createHash } from 'node:crypto';

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
export const DATABASE_MIGRATION_COMPATIBILITY = '20260831.0001';

export const PUBLIC_SIGNUP_EDGE_RATE_LIMIT = {
  max: 3,
  windowSeconds: 60,
} as const;

export type PublicSignupEdgeRateLimitDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false; retryAfterSeconds: number }>;

export async function consumePublicSignupEdgeRateLimit(
  pool: DatabasePool,
  clientIdentity: string,
  now = Date.now(),
): Promise<PublicSignupEdgeRateLimitDecision> {
  const identityHash = createHash('sha256')
    .update(clientIdentity)
    .digest('hex');
  const rateLimitKey = `bap-edge:public-sign-up:${identityHash}`;
  const windowMilliseconds = PUBLIC_SIGNUP_EDGE_RATE_LIMIT.windowSeconds * 1000;
  const result = await pool.query<{
    count: number | string;
    last_request: number | string;
  }>(
    `with pruned as (
       delete from auth.rate_limit
       where "key" like 'bap-edge:public-sign-up:%'
         and "key" <> $1
         and last_request <= $2::bigint - $3::bigint
     )
     insert into auth.rate_limit (id, "key", count, last_request)
     values ($1, $1, 1, $2)
     on conflict ("key") do update
     set count = case
           when auth.rate_limit.last_request <= $2::bigint - $3::bigint then 1
           else auth.rate_limit.count + 1
         end,
         last_request = case
           when auth.rate_limit.last_request <= $2::bigint - $3::bigint then $2
           else auth.rate_limit.last_request
         end
     where auth.rate_limit.last_request <= $2::bigint - $3::bigint
        or auth.rate_limit.count < $4::integer
     returning count, last_request`,
    [rateLimitKey, now, windowMilliseconds, PUBLIC_SIGNUP_EDGE_RATE_LIMIT.max],
  );
  const row = result.rows[0];
  if (row === undefined) {
    return {
      allowed: false,
      retryAfterSeconds: PUBLIC_SIGNUP_EDGE_RATE_LIMIT.windowSeconds,
    };
  }
  const count = Number(row.count);
  const lastRequest = Number(row.last_request);

  if (!Number.isSafeInteger(count) || !Number.isSafeInteger(lastRequest)) {
    throw new Error('Invalid public sign-up rate-limit state.');
  }

  if (count <= PUBLIC_SIGNUP_EDGE_RATE_LIMIT.max) {
    return { allowed: true };
  }

  return {
    allowed: false,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((lastRequest + windowMilliseconds - now) / 1000),
    ),
  };
}

export async function publicSignupInvitationExists(
  pool: DatabasePool,
  email: string,
): Promise<boolean> {
  const result = await pool.query<{ invited: boolean }>(
    `select exists (
       select 1
       from auth.invitation
       where lower(email) = lower($1)
         and status = 'pending'
         and expires_at > now()
     ) as invited`,
    [email],
  );

  return result.rows[0]?.invited === true;
}

export async function publicSignupEnabled(
  pool: DatabasePool,
): Promise<boolean> {
  const result = await pool.query<{ enabled: boolean }>(
    'select auth.public_signup_enabled() as enabled',
  );

  return result.rows[0]?.enabled ?? false;
}

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
