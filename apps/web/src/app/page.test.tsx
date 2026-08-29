import { beforeEach, describe, expect, it, vi } from 'vitest';

import HomePage from './page';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('../lib/auth/server', () => ({
  getAuth: async () => ({ api: { getSession: mocks.getSession } }),
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

describe('HomePage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends a verified session to organization access', async () => {
    mocks.getSession.mockResolvedValue({ user: { emailVerified: true } });

    await HomePage();

    expect(mocks.redirect).toHaveBeenCalledWith('/access');
  });

  it('sends an unauthenticated visitor to sign in', async () => {
    mocks.getSession.mockResolvedValue(null);

    await HomePage();

    expect(mocks.redirect).toHaveBeenCalledWith('/sign-in');
  });
});
