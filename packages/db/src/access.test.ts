import { describe, expect, it, vi } from 'vitest';

import {
  ensureInitialOrganizationQuota,
  organizationCreationLimitReached,
  resolveMembership,
  setOrganizationQuota,
} from './access.js';
import type { DatabasePool } from './pool.js';

function createPool(query: ReturnType<typeof vi.fn>): {
  pool: DatabasePool;
  release: ReturnType<typeof vi.fn>;
} {
  const release = vi.fn();
  return {
    pool: {
      connect: vi.fn(async () => ({ query, release })),
    } as unknown as DatabasePool,
    release,
  };
}

describe('organization accessors', () => {
  it.each([
    { rows: [{ limit_reached: false }], expected: false },
    { rows: [{ limit_reached: true }], expected: true },
    { rows: [], expected: null },
    { rows: [{ limit_reached: 'invalid' }], expected: null },
  ])(
    'reads a nullable organization limit decision',
    async ({ expected, rows }) => {
      const query = vi.fn(async () => ({ rows }));
      const pool = { query } as unknown as DatabasePool;

      await expect(
        organizationCreationLimitReached(pool, 'user-1'),
      ).resolves.toBe(expected);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('organization.created_by = quota.user_id'),
        ['user-1'],
      );
    },
  );

  it('seeds an initial quota through one owner transaction', async () => {
    const grantedAt = new Date('2026-08-31T12:00:00.000Z');
    const query = vi.fn(async (statement: string) => {
      const normalized = statement.replaceAll(/\s+/g, ' ').trim().toLowerCase();
      if (
        normalized === 'begin' ||
        normalized === 'set local role bap_owner' ||
        normalized === 'commit'
      ) {
        return { rows: [] };
      }
      if (normalized.startsWith('insert into auth.organization_quota')) {
        return {
          rows: [
            {
              granted_at: grantedAt,
              granted_by: null,
              granted_total: 1,
              note: 'system-bootstrap: initial organization',
              user_id: 'user-1',
            },
          ],
        };
      }
      throw new Error(`Unexpected statement: ${normalized}`);
    });
    const { pool, release } = createPool(query);

    await expect(
      ensureInitialOrganizationQuota(pool, 'user-1'),
    ).resolves.toEqual({
      grantedAt,
      grantedBy: null,
      grantedTotal: 1,
      note: 'system-bootstrap: initial organization',
      userId: 'user-1',
    });
    expect(query.mock.calls.map(([statement]) => statement.trim())).toEqual([
      'begin',
      'set local role bap_owner',
      expect.stringContaining('insert into auth.organization_quota'),
      'commit',
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('preserves an existing positive quota and its provenance', async () => {
    const grantedAt = new Date('2026-08-30T12:00:00.000Z');
    const query = vi.fn(async (statement: string) => {
      const normalized = statement.replaceAll(/\s+/g, ' ').trim().toLowerCase();
      if (
        normalized === 'begin' ||
        normalized === 'set local role bap_owner' ||
        normalized === 'commit'
      ) {
        return { rows: [] };
      }
      if (normalized.startsWith('insert into auth.organization_quota')) {
        return { rows: [] };
      }
      if (normalized.startsWith('select user_id')) {
        return {
          rows: [
            {
              granted_at: grantedAt,
              granted_by: 'operator-1',
              granted_total: 4,
              note: 'approved quota',
              user_id: 'user-1',
            },
          ],
        };
      }
      throw new Error(`Unexpected statement: ${normalized}`);
    });
    const { pool } = createPool(query);

    await expect(
      ensureInitialOrganizationQuota(pool, 'user-1'),
    ).resolves.toEqual({
      grantedAt,
      grantedBy: 'operator-1',
      grantedTotal: 4,
      note: 'approved quota',
      userId: 'user-1',
    });
  });

  it('rolls back and releases after a failed seed', async () => {
    const providerDetail = 'provider-detail-that-must-not-be-emitted';
    const query = vi.fn(async (statement: string) => {
      const normalized = statement.replaceAll(/\s+/g, ' ').trim().toLowerCase();
      if (
        normalized === 'begin' ||
        normalized === 'set local role bap_owner' ||
        normalized === 'rollback'
      ) {
        return { rows: [] };
      }
      throw new Error(providerDetail);
    });
    const { pool, release } = createPool(query);

    await expect(
      ensureInitialOrganizationQuota(pool, 'user-1'),
    ).rejects.toThrow(providerDetail);
    expect(query).toHaveBeenLastCalledWith('rollback');
    expect(release).toHaveBeenCalledOnce();
  });

  it('sets quota and operator provenance through one owner transaction', async () => {
    const grantedAt = new Date('2026-08-31T15:00:00.000Z');
    const query = vi.fn(async (statement: string, parameters?: unknown[]) => {
      const normalized = statement.replaceAll(/\s+/g, ' ').trim().toLowerCase();
      if (
        normalized === 'begin' ||
        normalized === 'set local role bap_owner' ||
        normalized === 'commit'
      ) {
        return { rows: [] };
      }
      if (normalized.startsWith('select id')) {
        expect(parameters).toEqual(['member@example.test']);
        return { rows: [{ id: 'user-1' }] };
      }
      if (normalized.startsWith('insert into auth.organization_quota')) {
        expect(parameters).toEqual(['user-1', 4, 'approved capacity']);
        return {
          rows: [
            {
              granted_at: grantedAt,
              granted_by: null,
              granted_total: 4,
              note: 'approved capacity',
              user_id: 'user-1',
            },
          ],
        };
      }
      throw new Error(`Unexpected statement: ${normalized}`);
    });
    const { pool, release } = createPool(query);

    await expect(
      setOrganizationQuota(pool, {
        email: 'member@example.test',
        note: 'approved capacity',
        total: 4,
      }),
    ).resolves.toEqual({
      grantedAt,
      grantedBy: null,
      grantedTotal: 4,
      note: 'approved capacity',
      userId: 'user-1',
    });
    expect(query.mock.calls.map(([statement]) => statement.trim())).toEqual([
      'begin',
      'set local role bap_owner',
      expect.stringContaining('select id'),
      expect.stringContaining('insert into auth.organization_quota'),
      'commit',
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('rolls quota changes back when the subject is absent', async () => {
    const query = vi.fn(async (statement: string) => {
      const normalized = statement.replaceAll(/\s+/g, ' ').trim().toLowerCase();
      if (
        normalized === 'begin' ||
        normalized === 'set local role bap_owner' ||
        normalized === 'rollback'
      ) {
        return { rows: [] };
      }
      if (normalized.startsWith('select id')) {
        return { rows: [] };
      }
      throw new Error(`Unexpected statement: ${normalized}`);
    });
    const { pool, release } = createPool(query);

    await expect(
      setOrganizationQuota(pool, {
        email: 'missing@example.test',
        note: 'approved capacity',
        total: 1,
      }),
    ).rejects.toThrow('not found');
    expect(query).toHaveBeenLastCalledWith('rollback');
    expect(release).toHaveBeenCalledOnce();
  });

  it('returns null for a legacy invalid membership role', async () => {
    const invalidPool = {
      query: vi.fn(async () => ({
        rows: [{ email_verified: true, role: 'legacy-role' }],
      })),
    } as unknown as DatabasePool;
    const validPool = {
      query: vi.fn(async () => ({
        rows: [{ email_verified: true, role: 'admin' }],
      })),
    } as unknown as DatabasePool;

    await expect(
      resolveMembership(invalidPool, {
        organizationId: 'organization-1',
        subjectId: 'user-1',
      }),
    ).resolves.toBeNull();
    await expect(
      resolveMembership(validPool, {
        organizationId: 'organization-1',
        subjectId: 'user-1',
      }),
    ).resolves.toEqual({ emailVerified: true, role: 'admin' });
  });
});
