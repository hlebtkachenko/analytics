import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteUser: vi.fn(),
  getSession: vi.fn(),
  listWorkspaceMemberships: vi.fn(),
  redirect: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace }),
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../../lib/auth/server', () => ({
  getAuth: async () => ({ api: { getSession: mocks.getSession } }),
  getAuthPool: async () => ({}),
}));
vi.mock('@bap/db/access', () => ({
  listWorkspaceMemberships: mocks.listWorkspaceMemberships,
}));
vi.mock('../../../lib/auth/client', () => ({
  authClient: { deleteUser: mocks.deleteUser, updateUser: mocks.updateUser },
}));

import { ToastProvider } from '../../../components/shell/toast';
import { I18nProvider } from '../../../i18n/client-provider';
import AccountPage from './page';

async function renderPage() {
  const ui = await AccountPage();
  return render(
    <I18nProvider>
      <ToastProvider>{ui}</ToastProvider>
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AccountPage', () => {
  beforeEach(() => {
    mocks.getSession.mockResolvedValue({
      user: {
        email: 'ada@bap.test',
        id: 'user-1',
        name: 'Ada Lovelace',
      },
    });
    mocks.listWorkspaceMemberships.mockResolvedValue([
      {
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        id: 'organization-1',
        name: 'Organization One',
        role: 'owner',
        slug: 'organization-one',
        status: 'active',
      },
    ]);
    mocks.updateUser.mockResolvedValue({ data: {}, error: null });
    mocks.deleteUser.mockResolvedValue({ data: {}, error: null });
  });

  it('redirects an unauthenticated request to sign in', async () => {
    mocks.getSession.mockResolvedValue(null);

    const result = await AccountPage();

    expect(mocks.redirect).toHaveBeenCalledWith('/sign-in');
    expect(result).toBeNull();
  });

  it('shows the profile, workspaces and initials without leaking the id', async () => {
    await renderPage();

    expect(screen.getByDisplayValue('Ada Lovelace')).toBeVisible();
    expect(screen.getByDisplayValue('ada@bap.test')).toBeVisible();
    expect(screen.getByText('AL')).toBeVisible();
    expect(screen.getByText('Organization One')).toBeVisible();
    expect(document.body.textContent).not.toContain('user-1');
  });

  it('saves a new profile name and refreshes', async () => {
    await renderPage();

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Ada B. Lovelace' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(mocks.updateUser).toHaveBeenCalledWith({
        name: 'Ada B. Lovelace',
      });
    });
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('maps the sole-owner delete error to an inline notification', async () => {
    mocks.deleteUser.mockResolvedValue({
      data: null,
      error: { code: 'ACCOUNT_HAS_SOLE_OWNED_ORGANIZATIONS', status: 403 },
    });
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Current password'), {
      target: { value: 'secret-password' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Delete account' }),
    );

    expect(
      await screen.findByText(
        'Delete or hand over the workspaces you solely own before deleting your account.',
        { selector: '.cds--inline-notification__title' },
      ),
    ).toBeVisible();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('maps an invalid delete password inline and keeps the modal open', async () => {
    mocks.deleteUser.mockResolvedValue({
      data: null,
      error: { code: 'INVALID_PASSWORD', status: 400 },
    });
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Current password'), {
      target: { value: 'wrong-password' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Delete account' }),
    );

    expect(
      await screen.findByText('That password is incorrect.'),
    ).toBeVisible();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('signs out after a successful delete', async () => {
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Current password'), {
      target: { value: 'secret-password' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Delete account' }),
    );

    await waitFor(() => {
      expect(mocks.deleteUser).toHaveBeenCalledWith({
        password: 'secret-password',
      });
    });
    expect(mocks.replace).toHaveBeenCalledWith('/sign-in');
  });
});
