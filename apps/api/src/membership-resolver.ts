import type { TenantContext } from '@bap/db';
import type {
  EntityScope,
  HrAccessRole,
  MembershipResolution,
} from '@bap/security';

export abstract class MembershipResolver {
  abstract checkReadiness(): Promise<boolean>;
  abstract getPoolStatistics(): {
    idle: number;
    total: number;
    waiting: number;
  };
  // Reads the stored scope inside one tenant transaction, so row level security decides which rows it sees.
  abstract readEntityScope(tenant: TenantContext): Promise<EntityScope>;
  abstract resolve(
    subjectId: string,
    organizationId: string,
  ): Promise<MembershipResolution>;
  // Kept here because assignment resolution belongs to the application API, not @bap/security.
  readHrAccessAssignments?(
    tenant: TenantContext,
  ): Promise<Array<{ accessRole: HrAccessRole; legalEntityId: string }>>;
}
