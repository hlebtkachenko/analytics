import type { MembershipResolution } from '@bap/security';

export abstract class MembershipResolver {
  abstract checkReadiness(): Promise<boolean>;
  abstract resolve(
    subjectId: string,
    organizationId: string,
  ): Promise<MembershipResolution>;
}
