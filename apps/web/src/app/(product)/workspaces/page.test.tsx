import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getAuthPool: vi.fn(),
  listUserInvitations: vi.fn(),
  listWorkspaceMemberships: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock('@bap/db/access', () => ({
  listWorkspaceMemberships: mocks.listWorkspaceMemberships,
}));
vi.mock('../../../lib/auth/server', () => ({
  getAuth: async () => ({
    api: {
      getSession: mocks.getSession,
      listUserInvitations: mocks.listUserInvitations,
    },
  }),
  getAuthPool: mocks.getAuthPool,
}));
vi.mock('../../../lib/organizations/actions', () => ({
  acceptOrganizationInvitationAction: vi.fn(),
  declineOrganizationInvitationAction: vi.fn(),
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    replace: mocks.replace,
  }),
  useSearchParams: () => mocks.searchParams,
}));

import { I18nProvider } from '../../../i18n/client-provider';
import { ToastProvider } from '../../../components/shell/toast';
import OrganizationsPage from './page';

async function renderPage() {
  const ui = await OrganizationsPage();
  return render(
    <I18nProvider>
      <ToastProvider>{ui}</ToastProvider>
    </I18nProvider>,
  );
}

afterEach(cleanup);

describe('OrganizationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchParams = new URLSearchParams();
    mocks.getSession.mockResolvedValue({
      user: { emailVerified: true, id: 'user-1' },
    });
    mocks.getAuthPool.mockResolvedValue({});
    mocks.listWorkspaceMemberships.mockResolvedValue([]);
    mocks.listUserInvitations.mockResolvedValue([]);
  });

  it('lists an owned workspace under My workspaces', async () => {
    mocks.listWorkspaceMemberships.mockResolvedValue([
      {
        id: 'organization-1',
        name: 'Placeholder Holding',
        slug: 'placeholder-holding',
        role: 'owner',
        status: 'active',
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    ]);

    await renderPage();

    expect(screen.getByRole('heading', { name: 'Workspaces' })).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'My workspaces' }),
    ).toBeVisible();
    expect(screen.getByText('Placeholder Holding')).toBeVisible();
  });

  it('lists a non-owner membership under Member of with its status', async () => {
    mocks.listWorkspaceMemberships.mockResolvedValue([
      {
        id: 'organization-2',
        name: 'Client Books',
        slug: 'client-books',
        role: 'member',
        status: 'inactive',
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    ]);

    await renderPage();

    expect(screen.getByRole('heading', { name: 'Member of' })).toBeVisible();
    const table = screen.getAllByRole('table')[1]!;
    expect(within(table).getByText('Client Books')).toBeVisible();
    expect(within(table).getByText('Inactive')).toBeVisible();
  });

  it('shows the empty owned state when the caller owns no workspace', async () => {
    await renderPage();

    expect(screen.getByText('You do not own a workspace yet.')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Create workspace' }),
    ).toBeVisible();
  });

  it('lists pending invitations with accept and decline actions', async () => {
    mocks.listUserInvitations.mockResolvedValue([
      {
        id: 'invitation-1',
        organizationName: 'Placeholder Holding',
        role: 'member',
        expiresAt: '2026-09-30T00:00:00.000Z',
      },
    ]);

    await renderPage();

    expect(screen.getByText('Invitations for you')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeVisible();
  });

  it('redirects an unverified request before reading memberships', async () => {
    mocks.getSession.mockResolvedValue({ user: { emailVerified: false } });

    await expect(OrganizationsPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith('/sign-in');
    expect(mocks.listWorkspaceMemberships).not.toHaveBeenCalled();
  });

  it('reports a generic load failure without leaking detail', async () => {
    mocks.listWorkspaceMemberships.mockRejectedValue(
      new Error('private detail'),
    );

    await renderPage();

    expect(
      screen.getByText('Your workspaces could not be loaded.'),
    ).toBeVisible();
    expect(document.body).not.toHaveTextContent('private detail');
  });

  it('does not show the invitations section when there are no invitations', async () => {
    await renderPage();

    expect(screen.queryByText('Invitations for you')).toBeNull();
  });

  it('shows an inline error when invitations fail to load', async () => {
    mocks.listUserInvitations.mockRejectedValue(new Error('private detail'));

    await renderPage();

    expect(
      screen.getByText('Your invitations could not be loaded.'),
    ).toBeVisible();
    expect(document.body).not.toHaveTextContent('private detail');
  });

  it.each([
    ['accept-success', 'You joined the workspace.'],
    ['accept-error', 'The invitation could not be accepted.'],
    ['decline-success', 'The invitation was declined.'],
    ['decline-error', 'The invitation could not be declined.'],
  ])(
    'turns ?result=%s into a toast and clears the marker',
    async (result, text) => {
      mocks.searchParams = new URLSearchParams({ result });

      await renderPage();

      expect(screen.getByText(text)).toBeVisible();
      expect(mocks.replace).toHaveBeenCalledOnce();
      expect(mocks.replace).toHaveBeenCalledWith('/workspaces');
    },
  );
});
