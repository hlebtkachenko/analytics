import { describe, expect, it, vi } from 'vitest';

import { ensureInitialOrganizationQuota, resolveMembership } from './access.js';
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
