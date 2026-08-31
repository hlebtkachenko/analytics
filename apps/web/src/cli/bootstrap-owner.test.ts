// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import type { DatabasePool } from '@bap/db';

import { bootstrapOwner } from './bootstrap-owner.js';

function createBootstrapPool(hasOwner = false) {
  const query = vi.fn(async (statement: string) => {
    const normalized = statement.replaceAll(/\s+/g, ' ').trim().toLowerCase();
    if (normalized.includes('as has_owner')) {
      return { rows: [{ has_owner: hasOwner }] };
    }
    if (normalized.startsWith('select u.id')) {
      return { rows: [] };
    }
    return { rows: [] };
  });
  const release = vi.fn();
  return {
    pool: {
      connect: vi.fn(async () => ({ query, release })),
    } as unknown as DatabasePool,
    query,
    release,
  };
}

describe('bootstrap-owner CLI', () => {
  it('normalizes before side effects and seeds quota before organization creation', async () => {
    const harness = createBootstrapPool();
    const createUser = vi.fn(async () => ({ user: { id: 'user-1' } }));
    const createOrganization = vi.fn(async () => ({ id: 'organization-1' }));
    const seedQuota = vi.fn(async () => undefined);

    await expect(
      bootstrapOwner({
        getAuth: async () => ({ api: { createOrganization, createUser } }),
        getAuthPool: async () => harness.pool,
        readInput: async () => ({
          email: 'owner@example.test',
          name: 'Owner',
          organizationName: 'A very long organization name',
          password: 'test-only-password',
        }),
        seedQuota,
      }),
    ).resolves.toEqual({ organizationId: 'organization-1', userId: 'user-1' });

    expect(createOrganization).toHaveBeenCalledWith({
      body: {
        name: 'A very long organization name',
        slug: 'a-very-long-organiza',
        userId: 'user-1',
      },
    });
    expect(createUser.mock.invocationCallOrder[0]).toBeLessThan(
      seedQuota.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(seedQuota.mock.invocationCallOrder[0]).toBeLessThan(
      createOrganization.mock.invocationCallOrder[0] ??
        Number.POSITIVE_INFINITY,
    );
    expect(harness.release).toHaveBeenCalledOnce();
  });

  it.each(['api', '12345', 'ab'])(
    'rejects invalid normalized slug %j before database or auth writes',
    async (organizationName) => {
      const getAuth = vi.fn();
      const getAuthPool = vi.fn();
      const seedQuota = vi.fn();

      await expect(
        bootstrapOwner({
          getAuth,
          getAuthPool,
          readInput: async () => ({
            email: 'owner@example.test',
            name: 'Owner',
            organizationName,
            password: 'test-only-password',
          }),
          seedQuota,
        }),
      ).rejects.toThrow(
        'Provide confirmed owner details and a 14-128 character password.',
      );
      expect(getAuthPool).not.toHaveBeenCalled();
      expect(getAuth).not.toHaveBeenCalled();
      expect(seedQuota).not.toHaveBeenCalled();
    },
  );

  it('treats a legacy composed owner role as an existing owner', async () => {
    const harness = createBootstrapPool(true);
    const createUser = vi.fn();
    const createOrganization = vi.fn();
    const seedQuota = vi.fn();

    await expect(
      bootstrapOwner({
        getAuth: async () => ({ api: { createOrganization, createUser } }),
        getAuthPool: async () => harness.pool,
        readInput: async () => ({
          email: 'owner@example.test',
          name: 'Owner',
          organizationName: 'Owner Organization',
          password: 'test-only-password',
        }),
        seedQuota,
      }),
    ).rejects.toThrow(
      'Bootstrap cannot continue. Use the documented recovery procedure.',
    );
    expect(
      harness.query.mock.calls.find(([statement]) =>
        String(statement).includes("ANY(string_to_array(role, ','))"),
      ),
    ).toBeDefined();
    expect(createUser).not.toHaveBeenCalled();
    expect(seedQuota).not.toHaveBeenCalled();
    expect(createOrganization).not.toHaveBeenCalled();
  });

  it('closes the auth lock after a quota failure', async () => {
    const harness = createBootstrapPool();
    const providerDetail = 'provider-detail-that-must-not-be-emitted';
    const createOrganization = vi.fn(async () => ({ id: 'organization-1' }));

    await expect(
      bootstrapOwner({
        getAuth: async () => ({
          api: {
            createOrganization,
            createUser: async () => ({ user: { id: 'user-1' } }),
          },
        }),
        getAuthPool: async () => harness.pool,
        readInput: async () => ({
          email: 'owner@example.test',
          name: 'Owner',
          organizationName: 'Owner Organization',
          password: 'test-only-password',
        }),
        seedQuota: async () => {
          throw new Error(providerDetail);
        },
      }),
    ).rejects.toThrow(providerDetail);
    expect(createOrganization).not.toHaveBeenCalled();
    expect(harness.release).toHaveBeenCalledOnce();
    expect(harness.query.mock.calls.at(-1)?.[0]).toContain(
      'pg_advisory_unlock',
    );
  });
});
