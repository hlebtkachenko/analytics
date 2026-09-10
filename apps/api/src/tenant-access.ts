import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { TenantContext } from '@bap/db';
import {
  resolveCapabilities,
  resolveOrganizationAccess,
  type EntityScope,
  type OrganizationAccessResponse,
  type OrganizationCapabilities,
} from '@bap/security';

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

  const membership = await input.memberships.resolve(
    principal.subject,
    input.organizationId,
  );

  if (!membership.emailVerified || membership.role === null) {
    throw new ForbiddenException();
  }

  if (
    input.capability !== undefined &&
    !resolveCapabilities(membership.role)[input.capability]
  ) {
    throw new ForbiddenException();
  }

  const tenant: TenantContext = {
    organizationId: input.organizationId,
    role: membership.role,
    userId: principal.subject,
  };
  const entityScope = await input.memberships.readEntityScope(tenant);
  const access = resolveOrganizationAccess(
    'application-api',
    input.organizationId,
    membership,
    entityScope,
  );

  if (access === null) {
    throw new ForbiddenException();
  }

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
