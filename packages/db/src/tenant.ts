import type { PoolClient } from 'pg';

export interface TenantContext {
  organizationId: string;
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
      "select set_config('bap.user_id', $1, true), set_config('bap.organization_id', $2, true)",
      [context.userId, context.organizationId],
    );
    const result = await operation(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}
