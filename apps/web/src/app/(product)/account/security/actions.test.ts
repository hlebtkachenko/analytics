import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUserSessionToken: vi.fn(),
  getSession: vi.fn(),
  revokeSession: vi.fn(),
}));

vi.mock('@bap/db/access', () => ({
  findUserSessionToken: mocks.findUserSessionToken,
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../../../lib/auth/server', () => ({
  getAuth: async () => ({
    api: { getSession: mocks.getSession, revokeSession: mocks.revokeSession },
  }),
  getAuthPool: async () => ({}),
}));

import { revokeAccountSessionAction } from './actions';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('revokeAccountSessionAction', () => {
  it('rejects an invalid session id before any lookup', async () => {
    await expect(revokeAccountSessionAction('')).resolves.toEqual({
      ok: false,
    });
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.findUserSessionToken).not.toHaveBeenCalled();
  });

  it('returns not ok for a signed-out caller before any database read', async () => {
    mocks.getSession.mockResolvedValue(null);

    await expect(revokeAccountSessionAction('session-1')).resolves.toEqual({
      ok: false,
    });
    expect(mocks.findUserSessionToken).not.toHaveBeenCalled();
    expect(mocks.revokeSession).not.toHaveBeenCalled();
  });

  it('never revokes when the token is not found for the caller', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } });
    mocks.findUserSessionToken.mockResolvedValue(null);

    await expect(revokeAccountSessionAction('session-1')).resolves.toEqual({
      ok: false,
    });
    expect(mocks.findUserSessionToken).toHaveBeenCalledOnce();
    expect(mocks.revokeSession).not.toHaveBeenCalled();
  });
});
