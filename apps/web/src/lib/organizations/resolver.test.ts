// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveOrganizationRouteForRequest } from './resolver';

const mocks = vi.hoisted(() => ({
  getAuth: vi.fn(),
  getAuthPool: vi.fn(),
  getSession: vi.fn(),
  headers: vi.fn(),
  resolveOrganizationRoute: vi.fn(),
}));

vi.mock('react', () => ({ cache: <T>(operation: T) => operation }));

vi.mock('next/headers', () => ({ headers: mocks.headers }));

vi.mock('@bap/db/access', () => ({
  resolveOrganizationRoute: mocks.resolveOrganizationRoute,
}));

vi.mock('../auth/server', () => ({
  getAuth: mocks.getAuth,
  getAuthPool: mocks.getAuthPool,
}));

describe('resolveOrganizationRouteForRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuth.mockResolvedValue({
      api: { getSession: mocks.getSession },
    });
    mocks.getAuthPool.mockResolvedValue({ pool: 'auth' });
    mocks.headers.mockResolvedValue(new Headers({ cookie: 'session=opaque' }));
    mocks.getSession.mockResolvedValue({
      user: { emailVerified: true, id: 'user-1' },
    });
    mocks.resolveOrganizationRoute.mockResolvedValue({
      id: 'organization-1',
      name: 'Organization One',
      role: 'owner',
      slug: 'organization-one',
    });
  });

  it('resolves a verified member through the auth pool', async () => {
    await expect(
      resolveOrganizationRouteForRequest('organization-one'),
    ).resolves.toEqual({
      id: 'organization-1',
      name: 'Organization One',
      role: 'owner',
      slug: 'organization-one',
    });
    expect(mocks.getSession).toHaveBeenCalledWith({
      headers: expect.any(Headers),
    });
    expect(mocks.resolveOrganizationRoute).toHaveBeenCalledWith(
      { pool: 'auth' },
      { organizationSlug: 'organization-one', subjectId: 'user-1' },
    );
  });

  it.each(['ab', '12345', 'access', '../organization-one'])(
    'rejects malformed slug %j before session or database work',
    async (slug) => {
      await expect(
        resolveOrganizationRouteForRequest(slug),
      ).resolves.toBeNull();

      expect(mocks.getAuth).not.toHaveBeenCalled();
      expect(mocks.headers).not.toHaveBeenCalled();
      expect(mocks.getAuthPool).not.toHaveBeenCalled();
      expect(mocks.resolveOrganizationRoute).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['an unauthenticated request', null],
    ['an unverified request', { user: { emailVerified: false, id: 'user-1' } }],
  ])('returns null for %s', async (_name, session) => {
    mocks.getSession.mockResolvedValue(session);

    await expect(
      resolveOrganizationRouteForRequest('organization-one'),
    ).resolves.toBeNull();
    expect(mocks.getAuthPool).not.toHaveBeenCalled();
    expect(mocks.resolveOrganizationRoute).not.toHaveBeenCalled();
  });

  it.each([
    [
      'session failure',
      () => mocks.getSession.mockRejectedValue(new Error('private')),
    ],
    [
      'database failure',
      () =>
        mocks.resolveOrganizationRoute.mockRejectedValue(new Error('private')),
    ],
  ])('fails closed after a %s', async (_name, arrange) => {
    arrange();

    await expect(
      resolveOrganizationRouteForRequest('organization-one'),
    ).resolves.toBeNull();
  });
});
