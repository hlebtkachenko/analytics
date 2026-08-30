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
        manageGrants: false,
        manageMembers: true,
        uploadData: true,
        useAi: true,
      },
      organizationId: 'organization_1',
      role: 'admin',
      service: 'reporting-api',
    });
  });

  it('denies a forged organization selector without membership', async () => {
    const controller = new AccessController({
      checkReadiness: async () => true,
      getPoolStatistics: () => ({ idle: 0, total: 0, waiting: 0 }),
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
