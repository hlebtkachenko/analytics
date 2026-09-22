import { withTenantContext } from '@bap/db';
import type { TenantContext } from '@bap/db';
import { resolveMembership } from '@bap/db/access';
import type { DatabasePool } from '@bap/db/pool';
import { organizationIdentifierSchema } from '@bap/security';
import type { PoolClient } from 'pg';
import { z } from 'zod';

import { channelTenant } from '../channel-access.js';

// pgboss.job has no row level security and is readable across tenants by bap_api, so job payloads carry identifiers only, never PII, file contents or secrets.
export const subjectIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const tenantJobPayloadSchema = z
  .object({
    organizationId: organizationIdentifierSchema,
    userId: subjectIdentifierSchema,
  })
  .strict();

export type TenantJobPayload = z.infer<typeof tenantJobPayloadSchema>;

// A channel job (ADR 0016): the channel is the principal, the item is what it works on; both are row ids, never subjects.
export const channelJobPayloadSchema = z
  .object({
    channelId: z.string().uuid(),
    itemId: z.string().uuid().optional(),
    organizationId: organizationIdentifierSchema,
    // The scan job of a channel push carries the route its intake deferred; every other channel job omits it.
    routeRuleId: z.string().uuid().nullable().optional(),
  })
  .strict();

export type ChannelJobPayload = z.infer<typeof channelJobPayloadSchema>;

// The rerun walks as its creator: a tenant payload plus the rule and the cursor the previous batch stopped at.
export const rerunInboxRuleJobPayloadSchema = tenantJobPayloadSchema
  .extend({
    cursor: z
      .object({ itemId: z.string().uuid(), receivedAt: z.iso.datetime() })
      .strict()
      .optional(),
    ruleId: z.string().uuid(),
  })
  .strict();

export type RerunInboxRuleJobPayload = z.infer<
  typeof rerunInboxRuleJobPayloadSchema
>;

// The scan job of an uploaded item runs as its uploader; an API push scans under the channel payload instead.
export const scanInboxItemJobPayloadSchema = tenantJobPayloadSchema
  .extend({
    itemId: z.string().uuid(),
    routeRuleId: z.string().uuid().nullable().optional(),
  })
  .strict();

export type ScanInboxItemJobPayload = z.infer<
  typeof scanInboxItemJobPayloadSchema
>;

// The route job names no subject: the author is resolved at dequeue from the rule or the target, never carried.
export const routeInboxItemJobPayloadSchema = z
  .object({
    itemId: z.string().uuid(),
    organizationId: organizationIdentifierSchema,
    ruleId: z.string().uuid().nullable(),
  })
  .strict();

export type RouteInboxItemJobPayload = z.infer<
  typeof routeInboxItemJobPayloadSchema
>;

export const jobPayloadSchema = z.union([
  tenantJobPayloadSchema,
  channelJobPayloadSchema,
  rerunInboxRuleJobPayloadSchema,
  routeInboxItemJobPayloadSchema,
  scanInboxItemJobPayloadSchema,
]);

export type JobPayload = z.infer<typeof jobPayloadSchema>;

export interface RunTenantJobOptions<T> {
  data: unknown;
  pool: DatabasePool;
  work: (
    transaction: PoolClient,
    payload: JobPayload,
    tenant: TenantContext,
  ) => Promise<T>;
}

// The dequeue gate: parse, re-resolve membership, only then open a tenant transaction. Model, API and network calls belong outside withTenantContext, never inside the transaction.
export async function runTenantJob<T>(
  options: RunTenantJobOptions<T>,
): Promise<T> {
  const payload = jobPayloadSchema.parse(options.data);

  if ('channelId' in payload) {
    return runChannelJob(options, payload);
  }

  // The route job resolves its own author and opens its own transactions; it never runs as a payload subject.
  if (!('userId' in payload)) {
    throw new Error('Job payload names no subject.');
  }

  const membership = await resolveMembership(options.pool, {
    organizationId: payload.organizationId,
    subjectId: payload.userId,
  });

  // Membership revoked between enqueue and dequeue must fail the job before any transaction.
  if (membership === null) {
    throw new Error('Job subject has no membership in the organization.');
  }

  // Every tenant job writes, so a subject demoted to the read-only member role fails just as early.
  if (membership.role === 'member') {
    throw new Error('Job subject can no longer write in the organization.');
  }

  const client = await options.pool.connect();

  try {
    // The role is re-resolved here, never carried in the payload, so a demoted subject loses its writes.
    const tenant: TenantContext = {
      organizationId: payload.organizationId,
      role: membership.role,
      userId: payload.userId,
    };
    return await withTenantContext(client, tenant, (transaction) =>
      options.work(transaction, payload, tenant),
    );
  } finally {
    client.release();
  }
}

// The channel row is visible only inside its own tenant context, so the gate runs first inside the transaction: a disabled or deleted channel rolls back before any work, exactly as a revoked membership fails a user job.
async function runChannelJob<T>(
  options: RunTenantJobOptions<T>,
  payload: ChannelJobPayload,
): Promise<T> {
  const client = await options.pool.connect();
  const tenant = channelTenant(payload.organizationId, payload.channelId);

  try {
    return await withTenantContext(client, tenant, async (transaction) => {
      const channel = await transaction.query(
        'select 1 from app.inbox_channel where id = $1 and enabled and deleted_at is null',
        [payload.channelId],
      );

      if (channel.rows.length === 0) {
        throw new Error('Job channel is disabled or missing.');
      }

      return options.work(transaction, payload, tenant);
    });
  } finally {
    client.release();
  }
}
