import type {
  EntityScope,
  MembershipResolution,
  OrganizationRole,
} from '@bap/security';

// What one tenant transaction binds: the organization, the acting subject and the resolved role.
export interface TenantSelector {
  organizationId: string;
  role: OrganizationRole;
  userId: string;
}

export abstract class MembershipResolver {
  abstract checkReadiness(): Promise<boolean>;
  abstract getPoolStatistics(): {
    idle: number;
    total: number;
    waiting: number;
  };
  // Reads the stored scope inside one tenant transaction on the reporting pool.
  abstract readEntityScope(tenant: TenantSelector): Promise<EntityScope>;
  abstract resolve(
    subjectId: string,
    organizationId: string,
  ): Promise<MembershipResolution>;
}
