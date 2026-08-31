import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AccountPage from './page';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('../../lib/auth/server', () => ({
  getAuth: async () => ({ api: { getSession: mocks.getSession } }),
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

vi.mock('./account-actions', () => ({
  default: ({ email }: { email: string }) => <p>Account email: {email}</p>,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AccountPage', () => {
  it('redirects an unauthenticated request to sign in', async () => {
    mocks.getSession.mockResolvedValue(null);

    const result = await AccountPage();

    expect(mocks.redirect).toHaveBeenCalledWith('/sign-in');
    expect(result).toBeNull();
  });

  it('fails closed when the session read fails', async () => {
    mocks.getSession.mockRejectedValue(new Error('private session detail'));

    const result = await AccountPage();

    expect(mocks.redirect).toHaveBeenCalledWith('/sign-in');
    expect(result).toBeNull();
  });

  it('passes only the authenticated email to account actions', async () => {
    mocks.getSession.mockResolvedValue({
      user: { email: 'member@bap.invalid', id: 'private-user-id' },
    });

    render(await AccountPage());

    expect(screen.getByText('Account email: member@bap.invalid')).toBeVisible();
    expect(document.body.textContent).not.toContain('private-user-id');
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
