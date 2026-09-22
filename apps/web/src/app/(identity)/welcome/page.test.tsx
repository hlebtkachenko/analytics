import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listUserInvitations: vi.fn(),
  redirect: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock('../../../lib/auth/server', () => ({
  getAuth: async () => ({
    api: {
      getSession: mocks.getSession,
      listUserInvitations: mocks.listUserInvitations,
    },
  }),
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

vi.mock('../../../lib/auth/client', () => ({
  authClient: { updateUser: mocks.updateUser },
}));

vi.mock('../../../lib/organizations/actions', () => ({
  acceptOrganizationInvitationAction: vi.fn(),
}));

import { I18nProvider } from '../../../i18n/client-provider';
import WelcomePage from './page';

async function renderPage() {
  const ui = await WelcomePage();
  return render(<I18nProvider>{ui}</I18nProvider>);
}

beforeEach(() => {
  mocks.listUserInvitations.mockResolvedValue([]);
});

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

  it('onboards an authenticated request with a prefilled name and continue link', async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: 'user-1', name: 'Ada Lovelace' },
    });

    await renderPage();

    expect(
      screen.getByRole('heading', { name: 'Welcome to BAP' }),
    ).toBeVisible();
    expect(screen.getByDisplayValue('Ada Lovelace')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save name' })).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Continue to BAP' }),
    ).toHaveAttribute('href', '/access');
  });

  it('surfaces a pending workspace invitation to accept inline', async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: 'user-1', name: 'Ada Lovelace' },
    });
    mocks.listUserInvitations.mockResolvedValue([
      { id: 'invitation-1', organizationName: 'Placeholder Holding' },
    ]);

    await renderPage();

    expect(screen.getByText('Workspace invitations')).toBeVisible();
    expect(screen.getByText('Placeholder Holding')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeVisible();
  });
});
