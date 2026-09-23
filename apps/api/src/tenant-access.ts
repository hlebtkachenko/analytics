import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { TenantContext } from '@bap/db';
import {
  resolveCapabilities,
  resolveOrganizationAccess,
  hrAssignmentCapabilities,
  type EntityScope,
  type OrganizationAccessResponse,
  type OrganizationCapabilities,
} from '@bap/security';

import { isChannelSubject } from './channel-access.js';
import type { MembershipResolver } from './membership-resolver.js';
import type { AuthenticatedRequest } from './request-context.js';

export interface TenantAccess {
  access: OrganizationAccessResponse;
  entityScope: EntityScope;
  tenant: TenantContext;
}

export interface ResolveTenantAccessInput {
  // Checked on the role before any transaction opens, as ADR 0011 requires, then again on the scope-narrowed set.
  capability?: keyof OrganizationCapabilities;
  memberships: MembershipResolver;
  organizationId: string;
  request: AuthenticatedRequest;
}

// The one resolver every route goes through: membership, then capability, then tenant context, then entity scope.
export async function resolveTenantAccess(
  input: ResolveTenantAccessInput,
): Promise<TenantAccess> {
  const principal = input.request.resourcePrincipal;

  if (principal === undefined) {
    throw new UnauthorizedException();
  }

  // A channel principal (ADR 0016) has no membership; only the intake routes accept it, through resolveChannelAccess.
  if (isChannelSubject(principal.subject)) {
    throw new ForbiddenException();
  }

  const membership = await input.memberships.resolve(
    principal.subject,
    input.organizationId,
  );

  if (!membership.emailVerified || membership.role === null) {
    throw new ForbiddenException();
  }

  const tenant: TenantContext = {
    organizationId: input.organizationId,
    role: membership.role,
    userId: principal.subject,
  };
  // The persisted resolver already returns all for owners. Preserve that invariant
  // here too, so a future resolver cannot accidentally narrow an owner's scope.
  const membershipScope =
    membership.role === 'owner'
      ? ({ mode: 'all' } as const)
      : await input.memberships.readEntityScope(tenant);
  const baseCapabilities = resolveCapabilities(membership.role);
  const assignments =
    membership.role === 'owner' ||
    input.memberships.readHrAccessAssignments === undefined
      ? []
      : await input.memberships.readHrAccessAssignments(tenant);
  const assignedEntitiesByCapability = new Map<
    keyof OrganizationCapabilities,
    Set<string>
  >();
  for (const assignment of assignments) {
    for (const capability of hrAssignmentCapabilities[assignment.accessRole]) {
      const ids =
        assignedEntitiesByCapability.get(capability) ?? new Set<string>();
      ids.add(assignment.legalEntityId);
      assignedEntitiesByCapability.set(capability, ids);
    }
  }
  const capabilities = { ...baseCapabilities };
  if (membershipScope.mode === 'restricted')
    capabilities.createEntities = false;
  for (const capability of assignedEntitiesByCapability.keys())
    capabilities[capability] = true;
  const intersect = (ids: Set<string>): EntityScope => {
    if (membership.role === 'owner' || membershipScope.mode === 'all')
      return { legalEntityIds: [...ids].sort(), mode: 'restricted' };
    return {
      legalEntityIds: membershipScope.legalEntityIds.filter((id) =>
        ids.has(id),
      ),
      mode: 'restricted',
    };
  };
  // Base membership grants retain their membership scope. Assignment-only grants narrow to their entities.
  const entityScope =
    input.capability !== undefined && !baseCapabilities[input.capability]
      ? intersect(
          assignedEntitiesByCapability.get(input.capability) ?? new Set(),
        )
      : membershipScope;
  if (input.capability !== undefined && !capabilities[input.capability]) {
    throw new ForbiddenException();
  }
  const access = resolveOrganizationAccess(
    'application-api',
    input.organizationId,
    membership,
    membershipScope,
  );

  if (access === null) {
    throw new ForbiddenException();
  }
  Object.assign(access.capabilities, capabilities);

  // The scope can only narrow the role capabilities, so the resolved set is the one that decides.
  if (
    input.capability !== undefined &&
    !access.capabilities[input.capability]
  ) {
    throw new ForbiddenException();
  }

  return { access, entityScope, tenant };
}

// null means no entity filter at all; an empty array means the caller may see nothing.
export function allowedEntityIds(scope: EntityScope): string[] | null {
  return scope.mode === 'all' ? null : [...scope.legalEntityIds];
}
