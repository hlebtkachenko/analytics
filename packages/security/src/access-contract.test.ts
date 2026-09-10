import { describe, expect, it } from 'vitest';

import {
  entityScopeSchema,
  legalEntityInScope,
  legalEntityKindSchema,
  legalEntitySchema,
  organizationAccessResponseSchema,
  organizationIdentifierSchema,
  resolveCapabilities,
  resolveOrganizationAccess,
} from './access-contract.js';

const entityId = '4a2b7c1e-9f5d-4c3a-8b21-6e0f7d5a4c39';
const otherEntityId = '5b3c8d2f-0a6e-4d4b-9c32-7f1a8e6b5d40';

const ownerCapabilities = {
  createEntities: true,
  deleteEntities: true,
  manageEntityAccess: true,
  manageMembers: true,
  manageOrganization: true,
  updateEntities: true,
  uploadData: true,
  useAi: true,
};

const adminCapabilities = {
  createEntities: true,
  deleteEntities: false,
  manageEntityAccess: false,
  manageMembers: false,
  manageOrganization: false,
  updateEntities: true,
  uploadData: true,
  useAi: true,
};

const memberCapabilities = {
  createEntities: false,
  deleteEntities: false,
  manageEntityAccess: false,
  manageMembers: false,
  manageOrganization: false,
  updateEntities: false,
  uploadData: false,
  useAi: true,
};

describe('organization access contract', () => {
  it('returns the allow-listed response for a verified member', () => {
    expect(
      resolveOrganizationAccess(
        'application-api',
        'organization_1',
        { emailVerified: true, role: 'owner' },
        { mode: 'all' },
      ),
    ).toEqual({
      capabilities: ownerCapabilities,
      entityScope: { mode: 'all' },
      organizationId: 'organization_1',
      role: 'owner',
      service: 'application-api',
    });
  });

  it('denies unverified users and non-members', () => {
    expect(
      resolveOrganizationAccess(
        'reporting-api',
        'organization_1',
        { emailVerified: false, role: 'member' },
        { mode: 'all' },
      ),
    ).toBeNull();
    expect(
      resolveOrganizationAccess(
        'reporting-api',
        'organization_1',
        { emailVerified: true, role: null },
        { mode: 'all' },
      ),
    ).toBeNull();
  });

  it('rejects selectors and response fields outside the fixed contract', () => {
    expect(
      organizationIdentifierSchema.safeParse('../organization').success,
    ).toBe(false);
    expect(
      organizationAccessResponseSchema.safeParse({
        capabilities: ownerCapabilities,
        entityScope: { mode: 'all' },
        organizationId: 'organization_1',
        role: 'owner',
        service: 'application-api',
        token: 'not-allowed',
      }).success,
    ).toBe(false);
    expect(
      organizationAccessResponseSchema.safeParse({
        capabilities: { ...ownerCapabilities, exportEverything: true },
        entityScope: { mode: 'all' },
        organizationId: 'organization_1',
        role: 'owner',
        service: 'application-api',
      }).success,
    ).toBe(false);
    // The scope is discriminated, so a restricted scope without its entity list never parses.
    expect(
      organizationAccessResponseSchema.safeParse({
        capabilities: ownerCapabilities,
        entityScope: { mode: 'restricted' },
        organizationId: 'organization_1',
        role: 'owner',
        service: 'application-api',
      }).success,
    ).toBe(false);
  });

  it('derives capabilities from the generic role', () => {
    expect(resolveCapabilities('owner')).toEqual(ownerCapabilities);
    expect(resolveCapabilities('admin')).toEqual(adminCapabilities);
    expect(resolveCapabilities('member')).toEqual(memberCapabilities);
  });

  it('gives every role an independent capability object', () => {
    const capabilities = resolveCapabilities('member');
    capabilities.useAi = false;

    expect(resolveCapabilities('member').useAi).toBe(true);
  });

  it('carries the resolved capabilities and the scope on every service response', () => {
    expect(
      resolveOrganizationAccess(
        'reporting-api',
        'organization_1',
        { emailVerified: true, role: 'admin' },
        { legalEntityIds: [entityId], mode: 'restricted' },
      ),
    ).toEqual({
      capabilities: adminCapabilities,
      entityScope: { legalEntityIds: [entityId], mode: 'restricted' },
      organizationId: 'organization_1',
      role: 'admin',
      service: 'reporting-api',
    });
  });

  it('accepts only the two entity kinds and a bounded legal entity', () => {
    expect(legalEntityKindSchema.safeParse('company').success).toBe(true);
    expect(legalEntityKindSchema.safeParse('sole_trader').success).toBe(true);
    expect(legalEntityKindSchema.safeParse('charity').success).toBe(false);

    const entity = {
      createdAt: '2026-09-10T06:00:00.000Z',
      id: entityId,
      kind: 'company',
      name: '  Placeholder Holding  ',
      registrationNumber: 'AB-123456',
      updatedAt: '2026-09-10T06:00:00.000Z',
    };

    expect(legalEntitySchema.parse(entity)).toMatchObject({
      name: 'Placeholder Holding',
      registrationNumber: 'AB-123456',
    });
    expect(
      legalEntitySchema.safeParse({ ...entity, registrationNumber: null })
        .success,
    ).toBe(true);
    expect(legalEntitySchema.safeParse({ ...entity, name: '  ' }).success).toBe(
      false,
    );
    expect(
      legalEntitySchema.safeParse({ ...entity, name: 'a'.repeat(201) }).success,
    ).toBe(false);
    expect(
      legalEntitySchema.safeParse({ ...entity, registrationNumber: 'a b' })
        .success,
    ).toBe(false);
    expect(
      legalEntitySchema.safeParse({ ...entity, id: 'not-a-uuid' }).success,
    ).toBe(false);
  });

  it('answers scope membership for both scope modes', () => {
    expect(entityScopeSchema.safeParse({ mode: 'all' }).success).toBe(true);
    expect(
      entityScopeSchema.safeParse({ legalEntityIds: [], mode: 'restricted' })
        .success,
    ).toBe(true);
    expect(
      entityScopeSchema.safeParse({ legalEntityIds: ['nope'], mode: 'all' })
        .success,
    ).toBe(false);
    expect(legalEntityInScope({ mode: 'all' }, entityId)).toBe(true);
    expect(
      legalEntityInScope(
        { legalEntityIds: [entityId], mode: 'restricted' },
        entityId,
      ),
    ).toBe(true);
    expect(
      legalEntityInScope(
        { legalEntityIds: [entityId], mode: 'restricted' },
        otherEntityId,
      ),
    ).toBe(false);
  });
});
