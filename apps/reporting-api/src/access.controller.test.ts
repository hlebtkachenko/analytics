import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';

import { AccessController } from './access.controller.js';
import type { MembershipResolver } from './membership-resolver.js';
import { ResourceJwtGuard } from './resource-jwt.guard.js';
import { SubjectRateLimitGuard } from './subject-rate-limit.guard.js';

describe('AccessController', () => {
  it('uses JWT verification before subject limiting', () => {
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        AccessController.prototype.getAccess,
      ),
    ).toEqual([ResourceJwtGuard, SubjectRateLimitGuard]);
  });

  it('returns only the reporting access contract for a verified member', async () => {
    const controller = new AccessController({
      checkReadiness: async () => true,
      getPoolStatistics: () => ({ idle: 0, total: 0, waiting: 0 }),
      readEntityScope: async () => ({ mode: 'all' as const }),
      resolve: async () => ({ emailVerified: true, role: 'admin' }),
    } as MembershipResolver);

    await expect(
      controller.getAccess('organization_1', {
        headers: {},
        method: 'GET',
        resourcePrincipal: { issuedAt: 1, subject: 'user_1' },
        url: '/v1/organizations/organization_1/access',
      }),
    ).resolves.toEqual({
      capabilities: {
        createEntities: true,
        deleteEntities: false,
        manageEntityAccess: false,
        manageMembers: false,
        manageOrganization: false,
        updateEntities: true,
        uploadData: true,
        useAi: true,
      },
      entityScope: { mode: 'all' },
      organizationId: 'organization_1',
      role: 'admin',
      service: 'reporting-api',
    });
  });

  it('mirrors a restricted entity scope in the response', async () => {
    const legalEntityId = '4a2b7c1e-9f5d-4c3a-8b21-6e0f7d5a4c39';
    const controller = new AccessController({
      checkReadiness: async () => true,
      getPoolStatistics: () => ({ idle: 0, total: 0, waiting: 0 }),
      readEntityScope: async () => ({
        legalEntityIds: [legalEntityId],
        mode: 'restricted' as const,
      }),
      resolve: async () => ({ emailVerified: true, role: 'member' }),
    } as MembershipResolver);

    await expect(
      controller.getAccess('organization_1', {
        headers: {},
        method: 'GET',
        resourcePrincipal: { issuedAt: 1, subject: 'user_1' },
        url: '/v1/organizations/organization_1/access',
      }),
    ).resolves.toMatchObject({
      entityScope: { legalEntityIds: [legalEntityId], mode: 'restricted' },
      role: 'member',
    });
  });

  it('denies a forged organization selector without membership', async () => {
    const controller = new AccessController({
      checkReadiness: async () => true,
      getPoolStatistics: () => ({ idle: 0, total: 0, waiting: 0 }),
      readEntityScope: async () => ({ mode: 'all' as const }),
      resolve: async () => ({ emailVerified: false, role: null }),
    } as MembershipResolver);

    await expect(
      controller.getAccess('forged_organization', {
        headers: {},
        method: 'GET',
        resourcePrincipal: { issuedAt: 1, subject: 'user_1' },
        url: '/v1/organizations/forged_organization/access',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
