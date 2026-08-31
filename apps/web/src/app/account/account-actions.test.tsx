import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AccountActions from './account-actions';

const mocks = vi.hoisted(() => ({
  changePassword: vi.fn(),
  deleteUser: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('../../lib/auth/client', () => ({
  authClient: {
    changePassword: mocks.changePassword,
    deleteUser: mocks.deleteUser,
    signOut: mocks.signOut,
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace }),
}));

beforeEach(() => {
  mocks.changePassword.mockResolvedValue({ data: {}, error: null });
  mocks.deleteUser.mockResolvedValue({ data: {}, error: null });
  mocks.signOut.mockResolvedValue({ data: {}, error: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderAccount() {
  return render(<AccountActions email="member@bap.invalid" />);
}

describe('AccountActions', () => {
  it('displays the email with plain semantic account controls', () => {
    renderAccount();

    expect(screen.getByRole('heading', { name: 'Account' })).toBeVisible();
    expect(screen.getByText('Email: member@bap.invalid')).toBeVisible();
    expect(screen.getByRole('form', { name: 'Change password' })).toBeVisible();
    expect(screen.getByRole('form', { name: 'Delete account' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });

  it('changes the password and forwards revokeOtherSessions', async () => {
    renderAccount();
    const form = screen.getByRole('form', { name: 'Change password' });

    fireEvent.change(
      screen.getByLabelText('Current password', {
        selector: '#current-password',
      }),
      {
        target: { value: 'current-password' },
      },
    );
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'replacement-password' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'replacement-password' },
    });
    fireEvent.click(screen.getByLabelText('Sign out other sessions'));
    fireEvent.submit(form);

    await waitFor(() =>
      expect(mocks.changePassword).toHaveBeenCalledWith({
        currentPassword: 'current-password',
        newPassword: 'replacement-password',
        revokeOtherSessions: true,
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Password changed.',
    );
  });

  it('always sends the current password when deleting the account', async () => {
    renderAccount();

    fireEvent.change(
      screen.getByLabelText('Current password', {
        selector: '#delete-password',
      }),
      {
        target: { value: 'deletion-password' },
      },
    );
    fireEvent.submit(screen.getByRole('form', { name: 'Delete account' }));

    await waitFor(() =>
      expect(mocks.deleteUser).toHaveBeenCalledWith({
        password: 'deletion-password',
      }),
    );
    expect(mocks.replace).toHaveBeenCalledWith('/sign-in');
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it('signs out and returns to sign in', async () => {
    renderAccount();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledWith());
    expect(mocks.replace).toHaveBeenCalledWith('/sign-in');
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it('reduces framework failures to generic accessible errors', async () => {
    mocks.changePassword.mockResolvedValue({
      data: null,
      error: { message: 'private change detail' },
    });
    mocks.deleteUser.mockRejectedValue(new Error('private delete detail'));
    mocks.signOut.mockResolvedValue({
      data: null,
      error: { message: 'private sign-out detail' },
    });
    const view = renderAccount();

    fireEvent.change(
      screen.getByLabelText('Current password', {
        selector: '#current-password',
      }),
      {
        target: { value: 'current-password' },
      },
    );
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'replacement-password' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'replacement-password' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Change password' }));
    fireEvent.change(
      screen.getByLabelText('Current password', {
        selector: '#delete-password',
      }),
      {
        target: { value: 'deletion-password' },
      },
    );
    fireEvent.submit(screen.getByRole('form', { name: 'Delete account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(3));
    expect(screen.getByText('Could not change your password.')).toBeVisible();
    expect(screen.getByText('Could not delete your account.')).toBeVisible();
    expect(screen.getByText('Could not sign out.')).toBeVisible();
    expect(view.container.textContent).not.toMatch(
      /private change detail|private delete detail|private sign-out detail/,
    );
  });
});
