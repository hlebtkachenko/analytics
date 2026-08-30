import { withTenantContext } from '@bap/db';
import { resolveMembership } from '@bap/db/access';
import type { DatabasePool } from '@bap/db/pool';
import { organizationIdentifierSchema } from '@bap/security';
import type { PoolClient } from 'pg';
import { z } from 'zod';

// pgboss.job has no row level security and is readable across tenants by bap_api.
// Job payloads therefore carry identifiers only, never PII, file contents or secrets.
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

export interface RunTenantJobOptions<T> {
  data: unknown;
  pool: DatabasePool;
  work: (transaction: PoolClient, payload: TenantJobPayload) => Promise<T>;
}

// The dequeue gate: parse, re-resolve membership, only then open a tenant transaction.
// Model, API and network calls belong outside withTenantContext, never inside the transaction.
export async function runTenantJob<T>(
  options: RunTenantJobOptions<T>,
): Promise<T> {
  const payload = tenantJobPayloadSchema.parse(options.data);
  const membership = await resolveMembership(options.pool, {
    organizationId: payload.organizationId,
    subjectId: payload.userId,
  });

  // Membership revoked between enqueue and dequeue must fail the job before any transaction.
  if (membership === null) {
    throw new Error('Job subject has no membership in the organization.');
  }

  const client = await options.pool.connect();

  try {
    return await withTenantContext(
      client,
      { organizationId: payload.organizationId, userId: payload.userId },
      (transaction) => options.work(transaction, payload),
    );
  } finally {
    client.release();
  }
}
