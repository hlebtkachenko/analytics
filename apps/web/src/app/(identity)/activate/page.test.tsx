import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ActivatePage from './page';

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

describe('ActivatePage', () => {
  it('shows generic expired or tampered guidance for the canonical invalid state', async () => {
    render(
      await ActivatePage({
        searchParams: Promise.resolve({ state: 'invalid' }),
      }),
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This activation link is invalid or expired.',
    );
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it('redirects a live session to welcome', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } });

    await ActivatePage({ searchParams: Promise.resolve({}) });

    expect(mocks.redirect).toHaveBeenCalledWith('/welcome');
  });

  it('guides a no-session scanner-consumed visit to sign in', async () => {
    mocks.getSession.mockResolvedValue(null);

    render(await ActivatePage({ searchParams: Promise.resolve({}) }));

    expect(
      screen.getByText('Your account may already be active.'),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/sign-in',
    );
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
