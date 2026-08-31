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

export interface OrganizationRouteResolution {
  id: string;
  name: string;
  role: MembershipRole;
  slug: string;
}

export interface ResolveOrganizationRouteInput {
  organizationSlug: string;
  subjectId: string;
}

// Exact match against the version recorded by the migration runner.
// Bump it to the newest migration id in the same pull request as that migration.
// Rollback consequence: application code rolled back after the migration is
// applied makes /ready return 503 on every service until this is bumped again.
export const DATABASE_MIGRATION_COMPATIBILITY = '20260831.0003';

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

export async function countSoleOwnedOrganizations(
  pool: DatabasePool,
  userId: string,
): Promise<number> {
  const result = await pool.query<{ total: number }>(
    `select count(*)::integer as total
     from auth.member as subject_membership
     where subject_membership.user_id = $1
       and 'owner' = any(string_to_array(subject_membership.role, ','))
       and not exists (
         select 1
         from auth.member as other_owner
         where other_owner.organization_id = subject_membership.organization_id
           and 'owner' = any(string_to_array(other_owner.role, ','))
           and other_owner.user_id <> subject_membership.user_id
       )`,
    [userId],
  );
  const total = result.rows[0]?.total;

  if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) {
    throw new Error('Invalid sole-owned organization count.');
  }

  return total;
}

export async function recordUserErasureRequest(
  pool: DatabasePool,
  userId: string,
): Promise<void> {
  await pool.query('select auth.request_user_erasure($1)', [userId]);
}

export interface InitialOrganizationQuota {
  grantedAt: Date;
  grantedBy: string | null;
  grantedTotal: number;
  note: string | null;
  userId: string;
}

export interface OrganizationQuotaGrant {
  grantedAt: Date;
  grantedBy: string | null;
  grantedTotal: number;
  note: string | null;
  userId: string;
}

export interface SetOrganizationQuotaInput {
  email: string;
  note: string;
  total: number;
}

const initialOrganizationQuotaNote = 'system-bootstrap: initial organization';

export async function ensureInitialOrganizationQuota(
  pool: DatabasePool,
  userId: string,
): Promise<InitialOrganizationQuota> {
  if (userId.length === 0) {
    throw new Error('Initial organization quota requires a user id.');
  }

  const client = await pool.connect();
  let transactionOpen = false;

  try {
    await client.query('begin');
    transactionOpen = true;
    await client.query('set local role bap_owner');

    const seeded = await client.query<{
      granted_at: Date;
      granted_by: string | null;
      granted_total: number;
      note: string | null;
      user_id: string;
    }>(
      `insert into auth.organization_quota (
         user_id,
         granted_total,
         granted_by,
         granted_at,
         note
       )
       values ($1, 1, null, now(), $2)
       on conflict (user_id) do update
       set granted_total = 1,
           granted_by = null,
           granted_at = excluded.granted_at,
           note = excluded.note
       where auth.organization_quota.granted_total = 0
       returning user_id, granted_total, granted_by, granted_at, note`,
      [userId, initialOrganizationQuotaNote],
    );
    const result =
      seeded.rows[0] ??
      (
        await client.query<{
          granted_at: Date;
          granted_by: string | null;
          granted_total: number;
          note: string | null;
          user_id: string;
        }>(
          `select user_id, granted_total, granted_by, granted_at, note
           from auth.organization_quota
           where user_id = $1`,
          [userId],
        )
      ).rows[0];

    if (result === undefined || result.granted_total < 1) {
      throw new Error('Initial organization quota was not established.');
    }

    await client.query('commit');
    transactionOpen = false;
    return {
      grantedAt: result.granted_at,
      grantedBy: result.granted_by,
      grantedTotal: result.granted_total,
      note: result.note,
      userId: result.user_id,
    };
  } catch (error) {
    if (transactionOpen) {
      await client.query('rollback').catch(() => undefined);
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function organizationCreationLimitReached(
  pool: DatabasePool,
  userId: string,
): Promise<boolean | null> {
  const result = await pool.query<{ limit_reached: boolean }>(
    `select quota.granted_total <= count(organization.id)::integer as limit_reached
     from auth.organization_quota as quota
     left join auth.organization as organization
       on organization.created_by = quota.user_id
     where quota.user_id = $1
     group by quota.granted_total`,
    [userId],
  );
  const limitReached = result.rows[0]?.limit_reached;

  return typeof limitReached === 'boolean' ? limitReached : null;
}

export async function setOrganizationQuota(
  pool: DatabasePool,
  input: SetOrganizationQuotaInput,
): Promise<OrganizationQuotaGrant> {
  const client = await pool.connect();
  let transactionOpen = false;

  try {
    await client.query('begin');
    transactionOpen = true;
    await client.query('set local role bap_owner');

    const user = await client.query<{ id: string }>(
      `select id
       from auth."user"
       where lower(email) = lower($1)`,
      [input.email],
    );
    const userId = user.rows[0]?.id;
    if (user.rows.length !== 1 || userId === undefined) {
      throw new Error('Quota subject was not found.');
    }

    const result = await client.query<{
      granted_at: Date;
      granted_by: string | null;
      granted_total: number;
      note: string | null;
      user_id: string;
    }>(
      `insert into auth.organization_quota (
         user_id,
         granted_total,
         granted_by,
         granted_at,
         note
       )
       values ($1, $2, null, now(), $3)
       on conflict (user_id) do update
       set granted_total = excluded.granted_total,
           granted_by = excluded.granted_by,
           granted_at = excluded.granted_at,
           note = excluded.note
       returning user_id, granted_total, granted_by, granted_at, note`,
      [userId, input.total, input.note],
    );
    const quota = result.rows[0];
    if (quota === undefined) {
      throw new Error('Organization quota was not updated.');
    }

    await client.query('commit');
    transactionOpen = false;
    return {
      grantedAt: quota.granted_at,
      grantedBy: quota.granted_by,
      grantedTotal: quota.granted_total,
      note: quota.note,
      userId: quota.user_id,
    };
  } catch (error) {
    if (transactionOpen) {
      await client.query('rollback').catch(() => undefined);
    }
    throw error;
  } finally {
    client.release();
  }
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

  const role = membershipRoleSchema.safeParse(row.role);
  if (!role.success) {
    return null;
  }

  return { emailVerified: row.email_verified, role: role.data };
}

export async function resolveOrganizationRoute(
  pool: DatabasePool,
  input: ResolveOrganizationRouteInput,
): Promise<OrganizationRouteResolution | null> {
  const result = await pool.query<{
    id: string;
    name: string;
    role: string;
    slug: string;
  }>(
    `select organization.id, organization.name, organization.slug, membership.role
     from auth.organization as organization
     inner join auth.member as membership
       on membership.organization_id = organization.id
     where organization.slug = $1
       and membership.user_id = $2
     limit 1`,
    [input.organizationSlug, input.subjectId],
  );
  const row = result.rows[0];

  if (row === undefined) {
    return null;
  }

  const role = membershipRoleSchema.safeParse(row.role);
  if (!role.success) {
    return null;
  }

  return { id: row.id, name: row.name, role: role.data, slug: row.slug };
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
