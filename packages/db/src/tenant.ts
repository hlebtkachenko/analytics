import type { PoolClient } from 'pg';

export type TenantRole = 'owner' | 'admin' | 'member';

export interface TenantContext {
  organizationId: string;
  // Re-resolved on every request and every dequeued job; it never travels in a token or a job payload.
  role: TenantRole;
  userId: string;
}

// 'all' is the absence of an entity filter, never a cross-organization query.
export type EntityScope =
  { mode: 'all' } | { legalEntityIds: string[]; mode: 'restricted' };

export interface ReadEntityScopeInput {
  organizationId: string;
  role: TenantRole;
  userId: string;
}

export async function withTenantContext<T>(
  client: PoolClient,
  context: TenantContext,
  operation: (transaction: PoolClient) => Promise<T>,
): Promise<T> {
  await client.query('begin');

  try {
    await client.query(
      "select set_config('bap.user_id', $1, true), set_config('bap.organization_id', $2, true), set_config('bap.role', $3, true)",
      [context.userId, context.organizationId, context.role],
    );
    const result = await operation(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

// The single entity scope resolver: every data path that reads a dataset or an upload goes through it,
// because row level security deliberately does not filter by entity.
export async function readEntityScope(
  transaction: PoolClient,
  input: ReadEntityScopeInput,
): Promise<EntityScope> {
  // Owners are never restricted, so their scope needs no lookup at all.
  if (input.role === 'owner') {
    return { mode: 'all' };
  }

  const scope = await transaction.query<{ mode: string }>(
    `select mode
     from app.member_entity_scope
     where organization_id = $1 and user_id = $2`,
    [input.organizationId, input.userId],
  );

  // A missing row is the default, so a member is unrestricted until an owner says otherwise.
  if (scope.rows[0]?.mode !== 'restricted') {
    return { mode: 'all' };
  }

  const granted = await transaction.query<{ legal_entity_id: string }>(
    `select legal_entity_id
     from app.legal_entity_access
     where organization_id = $1 and user_id = $2
     order by legal_entity_id`,
    [input.organizationId, input.userId],
  );

  return {
    legalEntityIds: granted.rows.map((row) => row.legal_entity_id),
    mode: 'restricted',
  };
}
