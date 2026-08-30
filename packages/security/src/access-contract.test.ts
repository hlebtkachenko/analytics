import { describe, expect, it } from 'vitest';

import {
  organizationAccessResponseSchema,
  organizationIdentifierSchema,
  resolveCapabilities,
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
      capabilities: {
        manageGrants: true,
        manageMembers: true,
        uploadData: true,
        useAi: true,
      },
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
        capabilities: {
          manageGrants: true,
          manageMembers: true,
          uploadData: true,
          useAi: true,
        },
        organizationId: 'organization_1',
        role: 'owner',
        service: 'application-api',
        token: 'not-allowed',
      }).success,
    ).toBe(false);
    expect(
      organizationAccessResponseSchema.safeParse({
        capabilities: {
          manageGrants: true,
          manageMembers: true,
          uploadData: true,
          useAi: true,
          exportEverything: true,
        },
        organizationId: 'organization_1',
        role: 'owner',
        service: 'application-api',
      }).success,
    ).toBe(false);
  });

  it('derives capabilities from the generic role', () => {
    expect(resolveCapabilities('owner')).toEqual({
      manageGrants: true,
      manageMembers: true,
      uploadData: true,
      useAi: true,
    });
    expect(resolveCapabilities('admin')).toEqual({
      manageGrants: false,
      manageMembers: true,
      uploadData: true,
      useAi: true,
    });
    expect(resolveCapabilities('member')).toEqual({
      manageGrants: false,
      manageMembers: false,
      uploadData: true,
      useAi: true,
    });
  });

  it('gives every role an independent capability object', () => {
    const capabilities = resolveCapabilities('member');
    capabilities.manageMembers = true;

    expect(resolveCapabilities('member').manageMembers).toBe(false);
  });

  it('carries the resolved capabilities on every service response', () => {
    expect(
      resolveOrganizationAccess('reporting-api', 'organization_1', {
        emailVerified: true,
        role: 'admin',
      }),
    ).toEqual({
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
});
