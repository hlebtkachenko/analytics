import type { TenantContext } from '@bap/db';
import type { EntityScope, MembershipResolution } from '@bap/security';

export abstract class MembershipResolver {
  abstract checkReadiness(): Promise<boolean>;
  abstract getPoolStatistics(): {
    idle: number;
    total: number;
    waiting: number;
  };
  // Reads the stored scope inside one tenant transaction on the reporting pool.
  abstract readEntityScope(tenant: TenantContext): Promise<EntityScope>;
  abstract resolve(
    subjectId: string,
    organizationId: string,
  ): Promise<MembershipResolution>;
}
