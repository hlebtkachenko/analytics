import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { DatabasePool } from './pool.js';

const membershipRoleSchema = z.enum(['owner', 'admin', 'member']);
export type MembershipRole = z.infer<typeof membershipRoleSchema>;

const membershipStatusSchema = z.enum(['active', 'inactive']);
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

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

export interface OrganizationCreationQuota {
  attributedTotal: number;
  grantedTotal: number;
  remainingTotal: number;
}

export interface ResolveOrganizationRouteInput {
  organizationSlug: string;
  subjectId: string;
}

export interface WorkspaceMembership {
  id: string;
  name: string;
  slug: string;
  role: MembershipRole;
  status: MembershipStatus;
  createdAt: Date;
  joinedAt: Date;
  memberCount: number;
}

// Exact match against the version recorded by the migration runner. Bump it to the newest migration id in the same pull request as that migration. Rollback consequence: application code rolled back after the migration is applied makes /ready return 503 on every service until this is bumped again.
export const DATABASE_MIGRATION_COMPATIBILITY = '20260922.0005';

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
           and other_owner.status = 'active'
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

// Atomically hands ownership from the sitting owner to an active member and demotes
// the sitting owner to admin. The definer function verifies the caller is the owner,
// so a non-owner from-user is refused inside the transaction.
export async function transferOwnership(
  pool: DatabasePool,
  organizationId: string,
  fromUserId: string,
  toUserId: string,
): Promise<void> {
  await pool.query('select auth.transfer_ownership($1, $2, $3)', [
    organizationId,
    fromUserId,
    toUserId,
  ]);
}

// The scope an owner chooses when inviting an admin or member: all entities, or a named set.
export type InvitationEntityScope =
  | Readonly<{ mode: 'all' }>
  | Readonly<{ legalEntityIds: readonly string[]; mode: 'restricted' }>;

export interface WriteInvitationEntityScopeInput {
  createdBy: string;
  invitationId: string;
  organizationId: string;
  scope: InvitationEntityScope;
}

// 'unknown-entity' is the only failure the caller translates to a rejected invite.
export type WriteInvitationEntityScopeResult = 'unknown-entity' | 'written';

// Stores the chosen scope against the invitation id through the definer function, the only writer
// bap_auth may use in schema app. A restricted scope naming an entity outside the organization is
// refused, which the invite action turns into a rejected invitation.
export async function writeInvitationEntityScope(
  pool: DatabasePool,
  input: WriteInvitationEntityScopeInput,
): Promise<WriteInvitationEntityScopeResult> {
  const legalEntityIds =
    input.scope.mode === 'restricted' ? [...input.scope.legalEntityIds] : [];

  try {
    await pool.query(
      'select auth.write_invitation_entity_scope($1, $2, $3, $4::uuid[], $5)',
      [
        input.invitationId,
        input.organizationId,
        input.scope.mode,
        legalEntityIds,
        input.createdBy,
      ],
    );
    return 'written';
  } catch (error) {
    if ((error as { code?: unknown }).code === 'BP008') {
      return 'unknown-entity';
    }
    throw error;
  }
}

export interface ApplyInvitationEntityScopeInput {
  invitationId: string;
  organizationId: string;
  userId: string;
}

// Copies the invitation scope onto the accepted membership and removes the invitation scope, run
// from the accept-invitation hook so both accept surfaces apply the same grant.
export async function applyInvitationEntityScope(
  pool: DatabasePool,
  input: ApplyInvitationEntityScopeInput,
): Promise<void> {
  await pool.query('select auth.apply_invitation_entity_scope($1, $2, $3)', [
    input.invitationId,
    input.organizationId,
    input.userId,
  ]);
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

export async function getOrganizationCreationQuota(
  pool: DatabasePool,
  userId: string,
): Promise<OrganizationCreationQuota | null> {
  const result = await pool.query<{
    attributed_total: number;
    granted_total: number;
  }>(
    `select quota.granted_total,
            count(organization.id)::integer as attributed_total
     from auth.organization_quota as quota
     left join auth.organization as organization
       on organization.created_by = quota.user_id
     where quota.user_id = $1
     group by quota.granted_total`,
    [userId],
  );
  const row = result.rows[0];

  if (row === undefined) {
    return null;
  }
  if (
    !Number.isInteger(row.attributed_total) ||
    row.attributed_total < 0 ||
    !Number.isInteger(row.granted_total) ||
    row.granted_total < 0
  ) {
    throw new Error('Invalid organization quota state.');
  }

  return {
    attributedTotal: row.attributed_total,
    grantedTotal: row.granted_total,
    remainingTotal: Math.max(0, row.granted_total - row.attributed_total),
  };
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

// Reads a member's status for the inactive-caller gate; bap_auth holds SELECT on auth.member.
// null means no membership row, which the gate leaves to Better Auth rather than treating as inactive.
export async function readMemberStatus(
  pool: DatabasePool,
  organizationId: string,
  userId: string,
): Promise<'active' | 'inactive' | null> {
  const result = await pool.query<{ status: string }>(
    `select status
     from auth.member
     where organization_id = $1 and user_id = $2`,
    [organizationId, userId],
  );
  const status = result.rows[0]?.status;

  return status === 'active' || status === 'inactive' ? status : null;
}

// True when the organization keeps another active owner besides the excluded member.
export async function hasOtherActiveOwner(
  pool: DatabasePool,
  organizationId: string,
  excludedUserId: string,
): Promise<boolean> {
  const result = await pool.query<{ present: boolean }>(
    `select exists (
       select 1
       from auth.member
       where organization_id = $1
         and user_id <> $2
         and status = 'active'
         and 'owner' = any(string_to_array(role, ','))
     ) as present`,
    [organizationId, excludedUserId],
  );

  return result.rows[0]?.present === true;
}

// Slug-only lookup for the gated synthetic setup path, never a request-time resolver.
export async function findOrganizationIdBySlug(
  pool: DatabasePool,
  organizationSlug: string,
): Promise<string | null> {
  const result = await pool.query<{ id: string }>(
    'select id from auth.organization where slug = $1 limit 1',
    [organizationSlug],
  );

  return result.rows[0]?.id ?? null;
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
       and membership.status = 'active'
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

// Lists every one of the caller's workspaces with their own role and status in
// one query, never per-organization. Inactive memberships are included; callers
// that only navigate to enterable workspaces filter to the active status.
export async function listWorkspaceMemberships(
  pool: DatabasePool,
  subjectId: string,
): Promise<WorkspaceMembership[]> {
  const result = await pool.query<{
    id: string;
    name: string;
    slug: string;
    role: string;
    status: string;
    created_at: Date;
    joined_at: Date;
    member_count: number | string;
  }>(
    `select organization.id, organization.name, organization.slug,
            membership.role, membership.status, organization.created_at,
            membership.created_at as joined_at,
            (select count(*) from auth.member as counted
              where counted.organization_id = organization.id
                and counted.status = 'active')::int as member_count
     from auth.organization as organization
     inner join auth.member as membership
       on membership.organization_id = organization.id
     where membership.user_id = $1
     order by organization.name`,
    [subjectId],
  );

  const memberships: WorkspaceMembership[] = [];
  for (const row of result.rows) {
    const role = membershipRoleSchema.safeParse(row.role);
    const status = membershipStatusSchema.safeParse(row.status);
    // Drop rows whose role or status fails the enum parse, consistent with resolveOrganizationRoute.
    if (!role.success || !status.success) {
      continue;
    }
    memberships.push({
      id: row.id,
      name: row.name,
      slug: row.slug,
      role: role.data,
      status: status.data,
      createdAt: row.created_at,
      joinedAt: row.joined_at,
      memberCount: Number(row.member_count),
    });
  }

  return memberships;
}

// A caller session row for the account security page; the token is never returned.
export interface UserSession {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}

// Lists the caller's own sessions for display; the token column is deliberately omitted.
export async function listUserSessions(
  pool: DatabasePool,
  userId: string,
): Promise<UserSession[]> {
  const result = await pool.query<{
    id: string;
    created_at: Date;
    updated_at: Date;
    expires_at: Date;
    ip_address: string | null;
    user_agent: string | null;
  }>(
    `select id, created_at, updated_at, expires_at, ip_address, user_agent
     from auth.session
     where user_id = $1
     order by updated_at desc`,
    [userId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
  }));
}

// Resolves a session token scoped to the caller, so a revoke only ever targets the caller's row.
export async function findUserSessionToken(
  pool: DatabasePool,
  userId: string,
  sessionId: string,
): Promise<string | null> {
  const result = await pool.query<{ token: string }>(
    'select token from auth.session where id = $1 and user_id = $2',
    [sessionId, userId],
  );

  return result.rows[0]?.token ?? null;
}

// A persisted per-user notification row for the header inbox panel.
export interface NotificationRow {
  id: string;
  userId: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface CreateNotificationInput {
  userId: string;
  kind: string;
  title: string;
  body?: string | null;
  href?: string | null;
}

// Raises one notification for a user; any server path scopes it by owning the user_id it writes.
export async function createNotification(
  pool: DatabasePool,
  input: CreateNotificationInput,
): Promise<void> {
  await pool.query(
    `insert into auth.notification (user_id, kind, title, body, href)
     values ($1, $2, $3, $4, $5)`,
    [
      input.userId,
      input.kind,
      input.title,
      input.body ?? null,
      input.href ?? null,
    ],
  );
}

// Lists the caller's own notifications, newest first, scoped by user_id.
export async function listNotifications(
  pool: DatabasePool,
  userId: string,
  limit = 20,
): Promise<NotificationRow[]> {
  const result = await pool.query<{
    id: string;
    user_id: string;
    kind: string;
    title: string;
    body: string | null;
    href: string | null;
    read_at: Date | null;
    created_at: Date;
  }>(
    `select id, user_id, kind, title, body, href, read_at, created_at
     from auth.notification
     where user_id = $1
     order by created_at desc
     limit $2`,
    [userId, limit],
  );

  return result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    href: row.href,
    readAt: row.read_at,
    createdAt: row.created_at,
  }));
}

// Counts the caller's unread notifications for the header badge, scoped by user_id.
export async function countUnreadNotifications(
  pool: DatabasePool,
  userId: string,
): Promise<number> {
  const result = await pool.query<{ unread_count: string }>(
    `select count(*) as unread_count
     from auth.notification
     where user_id = $1 and read_at is null`,
    [userId],
  );

  return Number(result.rows[0]?.unread_count ?? 0);
}

// Marks every unread notification of the caller as read and returns how many rows changed.
export async function markNotificationsRead(
  pool: DatabasePool,
  userId: string,
): Promise<number> {
  const result = await pool.query(
    `update auth.notification
     set read_at = now()
     where user_id = $1 and read_at is null`,
    [userId],
  );

  return result.rowCount ?? 0;
}

// Marks one of the caller's own unread notifications read and returns how many rows changed.
export async function markNotificationRead(
  pool: DatabasePool,
  userId: string,
  id: string,
): Promise<number> {
  const result = await pool.query(
    `update auth.notification
     set read_at = now()
     where user_id = $1 and id = $2 and read_at is null`,
    [userId, id],
  );

  return result.rowCount ?? 0;
}

// Hard-deletes one of the caller's own notifications and returns how many rows were removed.
export async function deleteNotification(
  pool: DatabasePool,
  userId: string,
  id: string,
): Promise<number> {
  const result = await pool.query(
    `delete from auth.notification
     where user_id = $1 and id = $2`,
    [userId, id],
  );

  return result.rowCount ?? 0;
}

// Hard-deletes every one of the caller's own notifications and returns how many rows were removed.
export async function deleteAllNotifications(
  pool: DatabasePool,
  userId: string,
): Promise<number> {
  const result = await pool.query(
    `delete from auth.notification
     where user_id = $1`,
    [userId],
  );

  return result.rowCount ?? 0;
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
