import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { MembershipResolver } from './membership-resolver.js';
import { resolveTenantAccess } from './tenant-access.js';

const CHANNEL_ID = '4a2b7c1e-9f5d-4c3a-8b21-6e0f7d5a4c39';

describe('resolveTenantAccess', () => {
  const memberships: MembershipResolver = {
    checkReadiness: vi.fn(async () => true),
    getPoolStatistics: vi.fn(() => ({ idle: 0, total: 0, waiting: 0 })),
    readEntityScope: vi.fn(async () => ({ mode: 'all' as const })),
    resolve: vi.fn(async () => ({
      emailVerified: true,
      role: 'owner' as const,
    })),
  };

  it('answers 403 to a channel subject before any membership lookup', async () => {
    await expect(
      resolveTenantAccess({
        memberships,
        organizationId: 'organization_1',
        request: {
          headers: {},
          method: 'GET',
          resourcePrincipal: { issuedAt: 1, subject: `channel_${CHANNEL_ID}` },
          url: '/',
        },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(memberships.resolve).not.toHaveBeenCalled();
  });

  it('still resolves a person through the membership', async () => {
    const access = await resolveTenantAccess({
      capability: 'manageOrganization',
      memberships,
      organizationId: 'organization_1',
      request: {
        headers: {},
        method: 'GET',
        resourcePrincipal: { issuedAt: 1, subject: 'user_1' },
        url: '/',
      },
    });

    expect(access.tenant).toEqual({
      organizationId: 'organization_1',
      role: 'owner',
      userId: 'user_1',
    });
  });
});
