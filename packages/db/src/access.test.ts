import { describe, expect, it, vi } from 'vitest';

import {
  countUnreadNotifications,
  createNotification,
  ensureInitialOrganizationQuota,
  findOrganizationIdBySlug,
  findUserSessionToken,
  getOrganizationCreationQuota,
  listNotifications,
  listUserSessions,
  listWorkspaceMemberships,
  markNotificationsRead,
  organizationCreationLimitReached,
  resolveMembership,
  resolveOrganizationRoute,
  setOrganizationQuota,
  transferOwnership,
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
    {
      expected: {
        attributedTotal: 2,
        grantedTotal: 5,
        remainingTotal: 3,
      },
      rows: [{ attributed_total: 2, granted_total: 5 }],
    },
    {
      expected: {
        attributedTotal: 3,
        grantedTotal: 1,
        remainingTotal: 0,
      },
      rows: [{ attributed_total: 3, granted_total: 1 }],
    },
    { expected: null, rows: [] },
  ])(
    'reads remaining attributed creation quota',
    async ({ expected, rows }) => {
      const query = vi.fn(async () => ({ rows }));
      const pool = { query } as unknown as DatabasePool;

      await expect(
        getOrganizationCreationQuota(pool, 'user-1'),
      ).resolves.toEqual(expected);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('organization.created_by = quota.user_id'),
        ['user-1'],
      );
    },
  );

  it('rejects malformed organization quota state', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [{ attributed_total: -1, granted_total: 1 }],
      })),
    } as unknown as DatabasePool;

    await expect(getOrganizationCreationQuota(pool, 'user-1')).rejects.toThrow(
      'Invalid organization quota state.',
    );
  });

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

  it('resolves an organization route through one membership join', async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          id: 'organization-1',
          name: 'Organization One',
          role: 'admin',
          slug: 'organization-one',
        },
      ],
    }));
    const pool = { query } as unknown as DatabasePool;

    await expect(
      resolveOrganizationRoute(pool, {
        organizationSlug: 'organization-one',
        subjectId: 'user-1',
      }),
    ).resolves.toEqual({
      id: 'organization-1',
      name: 'Organization One',
      role: 'admin',
      slug: 'organization-one',
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(
        /from auth\.organization as organization\s+inner join auth\.member as membership/,
      ),
      ['organization-one', 'user-1'],
    );
  });

  it.each([
    { rows: [], name: 'a missing membership' },
    {
      rows: [
        {
          id: 'organization-1',
          name: 'Organization One',
          role: 'legacy-role',
          slug: 'organization-one',
        },
      ],
      name: 'an invalid legacy role',
    },
  ])('returns null for $name', async ({ rows }) => {
    const pool = {
      query: vi.fn(async () => ({ rows })),
    } as unknown as DatabasePool;

    await expect(
      resolveOrganizationRoute(pool, {
        organizationSlug: 'organization-one',
        subjectId: 'user-1',
      }),
    ).resolves.toBeNull();
  });

  it('lists the caller workspaces with their own role and status in one query', async () => {
    const createdAt = new Date('2026-09-01T00:00:00.000Z');
    const joinedAt = new Date('2026-09-05T00:00:00.000Z');
    const query = vi.fn(async () => ({
      rows: [
        {
          id: 'organization-1',
          name: 'Organization One',
          slug: 'organization-one',
          role: 'owner',
          status: 'active',
          created_at: createdAt,
          joined_at: joinedAt,
          member_count: 4,
        },
        {
          id: 'organization-3',
          name: 'Organization Three',
          slug: 'organization-three',
          role: 'member',
          status: 'inactive',
          created_at: createdAt,
          joined_at: joinedAt,
          // pg can hand back the count as a string; the row builder coerces it.
          member_count: '2',
        },
        {
          id: 'organization-2',
          name: 'Organization Two',
          slug: 'organization-two',
          role: 'legacy-role',
          status: 'active',
          created_at: createdAt,
          joined_at: joinedAt,
          member_count: 1,
        },
      ],
    }));
    const pool = { query } as unknown as DatabasePool;

    // The inactive membership is returned; the row with an unparseable role is dropped.
    await expect(listWorkspaceMemberships(pool, 'user-1')).resolves.toEqual([
      {
        id: 'organization-1',
        name: 'Organization One',
        slug: 'organization-one',
        role: 'owner',
        status: 'active',
        createdAt,
        joinedAt,
        memberCount: 4,
      },
      {
        id: 'organization-3',
        name: 'Organization Three',
        slug: 'organization-three',
        role: 'member',
        status: 'inactive',
        createdAt,
        joinedAt,
        memberCount: 2,
      },
    ]);
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(
        /from auth\.organization as organization\s+inner join auth\.member as membership/,
      ),
      ['user-1'],
    );
    // The active-only predicate is gone so every membership is returned.
    expect(query).toHaveBeenCalledWith(
      expect.not.stringContaining("membership.status = 'active'"),
      ['user-1'],
    );
  });

  it('lists the caller own sessions without exposing the token', async () => {
    const createdAt = new Date('2026-09-01T00:00:00.000Z');
    const updatedAt = new Date('2026-09-02T00:00:00.000Z');
    const expiresAt = new Date('2026-09-10T00:00:00.000Z');
    const query = vi.fn(async () => ({
      rows: [
        {
          id: 'session-1',
          created_at: createdAt,
          updated_at: updatedAt,
          expires_at: expiresAt,
          ip_address: '203.0.113.7',
          user_agent: 'Mozilla/5.0',
        },
        {
          id: 'session-2',
          created_at: createdAt,
          updated_at: createdAt,
          expires_at: expiresAt,
          ip_address: null,
          user_agent: null,
        },
      ],
    }));
    const pool = { query } as unknown as DatabasePool;

    const sessions = await listUserSessions(pool, 'user-1');

    expect(sessions).toEqual([
      {
        id: 'session-1',
        createdAt,
        updatedAt,
        expiresAt,
        ipAddress: '203.0.113.7',
        userAgent: 'Mozilla/5.0',
      },
      {
        id: 'session-2',
        createdAt,
        updatedAt: createdAt,
        expiresAt,
        ipAddress: null,
        userAgent: null,
      },
    ]);
    for (const session of sessions) {
      expect(session).not.toHaveProperty('token');
    }
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/from auth\.session\s+where user_id = \$1/),
      ['user-1'],
    );
  });

  it.each([
    { expected: 'token-1', rows: [{ token: 'token-1' }] },
    { expected: null, rows: [] },
  ])(
    'resolves a session token scoped to the caller',
    async ({ expected, rows }) => {
      const query = vi.fn(async () => ({ rows }));
      const pool = { query } as unknown as DatabasePool;

      await expect(
        findUserSessionToken(pool, 'user-1', 'session-1'),
      ).resolves.toBe(expected);
      expect(query).toHaveBeenCalledWith(
        'select token from auth.session where id = $1 and user_id = $2',
        ['session-1', 'user-1'],
      );
    },
  );

  it.each([
    { expected: 'organization-1', rows: [{ id: 'organization-1' }] },
    { expected: null, rows: [] },
  ])(
    'resolves an organization id from its slug alone',
    async ({ expected, rows }) => {
      const query = vi.fn(async () => ({ rows }));
      const pool = { query } as unknown as DatabasePool;

      await expect(
        findOrganizationIdBySlug(pool, 'organization-one'),
      ).resolves.toBe(expected);
      expect(query).toHaveBeenCalledWith(
        'select id from auth.organization where slug = $1 limit 1',
        ['organization-one'],
      );
    },
  );

  it('transfers ownership through the definer function', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const pool = { query } as unknown as DatabasePool;

    await expect(
      transferOwnership(pool, 'organization-1', 'user-1', 'user-2'),
    ).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledWith(
      'select auth.transfer_ownership($1, $2, $3)',
      ['organization-1', 'user-1', 'user-2'],
    );
  });
});

describe('notification accessors', () => {
  it('inserts a notification scoped to the owning user', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 1 }));
    const pool = { query } as unknown as DatabasePool;

    await expect(
      createNotification(pool, {
        userId: 'user-1',
        kind: 'member.joined',
        title: 'Ada joined Acme',
        href: '/acme/members',
      }),
    ).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('into auth.notification'),
      ['user-1', 'member.joined', 'Ada joined Acme', '/acme/members'],
    );
  });

  it('defaults an absent href to null on insert', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 1 }));
    const pool = { query } as unknown as DatabasePool;

    await createNotification(pool, {
      userId: 'user-1',
      kind: 'member.joined',
      title: 'Ada joined Acme',
    });
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      'user-1',
      'member.joined',
      'Ada joined Acme',
      null,
    ]);
  });

  it('lists the caller notifications newest first with a limit param', async () => {
    const createdAt = new Date('2026-09-20T10:00:00.000Z');
    const query = vi.fn(async () => ({
      rows: [
        {
          id: 'notification-1',
          user_id: 'user-1',
          kind: 'member.joined',
          title: 'Ada joined Acme',
          href: '/acme/members',
          read_at: null,
          created_at: createdAt,
        },
      ],
    }));
    const pool = { query } as unknown as DatabasePool;

    await expect(listNotifications(pool, 'user-1')).resolves.toEqual([
      {
        id: 'notification-1',
        userId: 'user-1',
        kind: 'member.joined',
        title: 'Ada joined Acme',
        href: '/acme/members',
        readAt: null,
        createdAt,
      },
    ]);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toEqual(expect.stringContaining('where user_id = $1'));
    expect(sql).toEqual(expect.stringMatching(/order by created_at desc/));
    expect(sql).toEqual(expect.stringContaining('limit $2'));
    expect(params).toEqual(['user-1', 20]);
  });

  it('honours an explicit notification limit', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const pool = { query } as unknown as DatabasePool;

    await listNotifications(pool, 'user-1', 5);
    expect(query).toHaveBeenCalledWith(expect.any(String), ['user-1', 5]);
  });

  it('counts only unread notifications for the caller', async () => {
    const query = vi.fn(async () => ({ rows: [{ unread_count: '3' }] }));
    const pool = { query } as unknown as DatabasePool;

    await expect(countUnreadNotifications(pool, 'user-1')).resolves.toBe(3);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toEqual(expect.stringContaining('where user_id = $1'));
    expect(sql).toEqual(expect.stringContaining('read_at is null'));
    expect(params).toEqual(['user-1']);
  });

  it('marks the caller unread notifications read and returns the row count', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 2 }));
    const pool = { query } as unknown as DatabasePool;

    await expect(markNotificationsRead(pool, 'user-1')).resolves.toBe(2);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toEqual(expect.stringContaining('where user_id = $1'));
    expect(sql).toEqual(expect.stringContaining('read_at is null'));
    expect(params).toEqual(['user-1']);
  });
});
