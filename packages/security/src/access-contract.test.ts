import { describe, expect, it } from 'vitest';

import {
  organizationAccessResponseSchema,
  organizationIdentifierSchema,
  resolveOrganizationAccess,
} from './access-contract.js';

describe('organization access contract', () => {
  it('returns the allow-listed response for a verified member', () => {
    expect(
      resolveOrganizationAccess('application-api', 'organization_1', {
        emailVerified: true,
        role: 'owner',
      }),
    ).toEqual({
      organizationId: 'organization_1',
      role: 'owner',
      service: 'application-api',
    });
  });

  it('denies unverified users and non-members', () => {
    expect(
      resolveOrganizationAccess('reporting-api', 'organization_1', {
        emailVerified: false,
        role: 'member',
      }),
    ).toBeNull();
    expect(
      resolveOrganizationAccess('reporting-api', 'organization_1', {
        emailVerified: true,
        role: null,
      }),
    ).toBeNull();
  });

  it('rejects selectors and response fields outside the fixed contract', () => {
    expect(
      organizationIdentifierSchema.safeParse('../organization').success,
    ).toBe(false);
    expect(
      organizationAccessResponseSchema.safeParse({
        organizationId: 'organization_1',
        role: 'owner',
        service: 'application-api',
        token: 'not-allowed',
      }).success,
    ).toBe(false);
  });
});
