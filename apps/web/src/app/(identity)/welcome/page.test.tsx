import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import WelcomePage from './page';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('../../../lib/auth/server', () => ({
  getAuth: async () => ({ api: { getSession: mocks.getSession } }),
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('WelcomePage', () => {
  it('redirects an unauthenticated request to sign in', async () => {
    mocks.getSession.mockResolvedValue(null);

    const result = await WelcomePage();

    expect(mocks.redirect).toHaveBeenCalledWith('/sign-in');
    expect(result).toBeNull();
  });

  it('welcomes an authenticated request and links to the application', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } });

    render(await WelcomePage());

    expect(
      screen.getByRole('heading', { name: 'Welcome to BAP' }),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Continue to BAP' }),
    ).toHaveAttribute('href', '/access');
  });
});
