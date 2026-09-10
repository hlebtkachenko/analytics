import type { EntityScope, MembershipResolution } from '@bap/security';

import type { TenantSelector } from './tenant-access.js';

export abstract class MembershipResolver {
  abstract checkReadiness(): Promise<boolean>;
  abstract getPoolStatistics(): {
    idle: number;
    total: number;
    waiting: number;
  };
  // Reads the stored scope inside one tenant transaction, so row level security decides which rows it sees.
  abstract readEntityScope(tenant: TenantSelector): Promise<EntityScope>;
  abstract resolve(
    subjectId: string,
    organizationId: string,
  ): Promise<MembershipResolution>;
}
