import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import type { MembershipResolver } from './membership-resolver.js';
import { resolveTenantAccess } from './tenant-access.js';

const entityA = '11111111-1111-4111-8111-111111111111';
const entityB = '22222222-2222-4222-8222-222222222222';

function resolver(input: {
  assignments?: Array<{
    accessRole:
      | 'hr_admin'
      | 'hr_auditor'
      | 'payroll_approver'
      | 'payroll_specialist'
      | 'sensitive_hr';
    legalEntityId: string;
  }>;
  role: 'owner' | 'admin' | 'member';
  scope?: { legalEntityIds: string[]; mode: 'restricted' } | { mode: 'all' };
}): MembershipResolver {
  return {
    checkReadiness: async () => true,
    getPoolStatistics: () => ({ idle: 0, total: 0, waiting: 0 }),
    readEntityScope: async () => input.scope ?? { mode: 'all' as const },
    readHrAccessAssignments: async () => input.assignments ?? [],
    resolve: async () => ({ emailVerified: true, role: input.role }),
  } as MembershipResolver;
}

function request() {
  return {
    headers: {},
    method: 'GET',
    resourcePrincipal: { issuedAt: 1, subject: 'user_1' },
    url: '/v1/organizations/org/access',
  } as never;
}

describe('application tenant access resolution', () => {
  it('applies every base role without adding payroll to an admin', async () => {
    const expected = {
      owner: {
        manageHr: true,
        managePayroll: true,
        readHr: true,
        readPayroll: true,
      },
      admin: {
        manageHr: true,
        managePayroll: false,
        readHr: true,
        readPayroll: false,
      },
      member: {
        manageHr: false,
        managePayroll: false,
        readHr: false,
        readPayroll: false,
      },
    } as const;
    for (const role of ['owner', 'admin', 'member'] as const) {
      const resolved = await resolveTenantAccess({
        memberships: resolver({ role }),
        organizationId: 'org',
        request: request(),
      });
      expect(resolved.access.capabilities).toMatchObject(expected[role]);
    }
  });

  it('expands every assignment role and aggregates multiple assignments with OR semantics', async () => {
    const assignments = [
      { accessRole: 'hr_admin' as const, legalEntityId: entityA },
      { accessRole: 'payroll_specialist' as const, legalEntityId: entityA },
      { accessRole: 'payroll_approver' as const, legalEntityId: entityB },
      { accessRole: 'sensitive_hr' as const, legalEntityId: entityB },
      { accessRole: 'hr_auditor' as const, legalEntityId: entityB },
    ];
    const resolved = await resolveTenantAccess({
      memberships: resolver({ assignments, role: 'member' }),
      organizationId: 'org',
      request: request(),
    });
    expect(resolved.access.capabilities).toMatchObject({
      approvePayroll: true,
      manageHr: true,
      managePayroll: true,
      manageSensitiveHr: true,
      readHr: true,
      readPayroll: true,
      readSensitiveHr: true,
    });
  });

  it('uses assigned entities only for assignment-only capabilities', async () => {
    const memberships = resolver({
      assignments: [
        { accessRole: 'payroll_specialist', legalEntityId: entityA },
      ],
      role: 'member',
      scope: { legalEntityIds: [entityA, entityB], mode: 'restricted' },
    });
    const payroll = await resolveTenantAccess({
      capability: 'managePayroll',
      memberships,
      organizationId: 'org',
      request: request(),
    });
    expect(payroll.entityScope).toEqual({
      legalEntityIds: [entityA],
      mode: 'restricted',
    });
    await expect(
      resolveTenantAccess({
        capability: 'managePayroll',
        memberships: resolver({
          assignments: [
            { accessRole: 'payroll_specialist', legalEntityId: entityA },
          ],
          role: 'member',
          scope: { legalEntityIds: [entityB], mode: 'restricted' },
        }),
        organizationId: 'org',
        request: request(),
      }),
    ).resolves.toMatchObject({
      entityScope: { legalEntityIds: [], mode: 'restricted' },
    });
  });

  it('keeps membership scope for base HR and all scope for owners', async () => {
    const admin = await resolveTenantAccess({
      capability: 'manageHr',
      memberships: resolver({
        role: 'admin',
        scope: { legalEntityIds: [entityA], mode: 'restricted' },
      }),
      organizationId: 'org',
      request: request(),
    });
    expect(admin.entityScope).toEqual({
      legalEntityIds: [entityA],
      mode: 'restricted',
    });
    const owner = await resolveTenantAccess({
      capability: 'managePayroll',
      memberships: resolver({
        role: 'owner',
        scope: { legalEntityIds: [entityA], mode: 'restricted' },
      }),
      organizationId: 'org',
      request: request(),
    });
    expect(owner.entityScope).toEqual({ mode: 'all' });
  });

  it('denies an admin without a payroll assignment and observes revoked assignments on the next resolution', async () => {
    await expect(
      resolveTenantAccess({
        capability: 'readPayroll',
        memberships: resolver({ role: 'admin' }),
        organizationId: 'org',
        request: request(),
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    let assignments = [
      { accessRole: 'payroll_specialist' as const, legalEntityId: entityA },
    ];
    const memberships = resolver({ role: 'member' });
    memberships.readHrAccessAssignments = async () => assignments;
    await expect(
      resolveTenantAccess({
        capability: 'managePayroll',
        memberships,
        organizationId: 'org',
        request: request(),
      }),
    ).resolves.toBeDefined();
    assignments = [];
    await expect(
      resolveTenantAccess({
        capability: 'managePayroll',
        memberships,
        organizationId: 'org',
        request: request(),
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
