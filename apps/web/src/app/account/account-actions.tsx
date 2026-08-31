'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { authClient } from '../../lib/auth/client';

type Status = Readonly<{
  kind: 'error' | 'success';
  message: string;
}> | null;

type AccountActionsProperties = Readonly<{
  email: string;
}>;

function StatusMessage({ status }: Readonly<{ status: Status }>) {
  if (!status) {
    return null;
  }

  return status.kind === 'error' ? (
    <p role="alert">{status.message}</p>
  ) : (
    <p aria-live="polite" role="status">
      {status.message}
    </p>
  );
}

export default function AccountActions({ email }: AccountActionsProperties) {
  const router = useRouter();
  const [changeStatus, setChangeStatus] = useState<Status>(null);
  const [deleteStatus, setDeleteStatus] = useState<Status>(null);
  const [signOutStatus, setSignOutStatus] = useState<Status>(null);

  async function changePassword(formData: FormData): Promise<void> {
    setChangeStatus(null);
    const newPassword = String(formData.get('newPassword') ?? '');
    const confirmPassword = String(formData.get('confirmPassword') ?? '');

    if (newPassword !== confirmPassword) {
      setChangeStatus({
        kind: 'error',
        message: 'Could not change your password.',
      });
      return;
    }

    try {
      const result = await authClient.changePassword({
        currentPassword: String(formData.get('currentPassword') ?? ''),
        newPassword,
        revokeOtherSessions: formData.get('revokeOtherSessions') === 'on',
      });
      setChangeStatus(
        result.error
          ? { kind: 'error', message: 'Could not change your password.' }
          : { kind: 'success', message: 'Password changed.' },
      );
    } catch {
      setChangeStatus({
        kind: 'error',
        message: 'Could not change your password.',
      });
    }
  }

  async function deleteAccount(formData: FormData): Promise<void> {
    setDeleteStatus(null);

    try {
      const result = await authClient.deleteUser({
        password: String(formData.get('deletePassword') ?? ''),
      });
      if (result.error) {
        setDeleteStatus({
          kind: 'error',
          message: 'Could not delete your account.',
        });
        return;
      }

      router.replace('/sign-in');
      router.refresh();
    } catch {
      setDeleteStatus({
        kind: 'error',
        message: 'Could not delete your account.',
      });
    }
  }

  async function signOut(): Promise<void> {
    setSignOutStatus(null);

    try {
      const result = await authClient.signOut();
      if (result.error) {
        setSignOutStatus({ kind: 'error', message: 'Could not sign out.' });
        return;
      }

      router.replace('/sign-in');
      router.refresh();
    } catch {
      setSignOutStatus({ kind: 'error', message: 'Could not sign out.' });
    }
  }

  return (
    <main>
      <h1>Account</h1>
      <p>Email: {email}</p>

      <section aria-labelledby="sign-out-heading">
        <h2 id="sign-out-heading">Session</h2>
        <button onClick={() => void signOut()} type="button">
          Sign out
        </button>
        <StatusMessage status={signOutStatus} />
      </section>

      <section aria-labelledby="change-password-heading">
        <h2 id="change-password-heading">Change password</h2>
        <form action={changePassword} aria-label="Change password">
          <label htmlFor="current-password">Current password</label>
          <input
            autoComplete="current-password"
            id="current-password"
            name="currentPassword"
            required
            type="password"
          />

          <label htmlFor="new-password">New password</label>
          <input
            autoComplete="new-password"
            id="new-password"
            maxLength={128}
            minLength={14}
            name="newPassword"
            required
            type="password"
          />

          <label htmlFor="confirm-password">Confirm new password</label>
          <input
            autoComplete="new-password"
            id="confirm-password"
            maxLength={128}
            minLength={14}
            name="confirmPassword"
            required
            type="password"
          />

          <label>
            <input name="revokeOtherSessions" type="checkbox" />
            Sign out other sessions
          </label>

          <button type="submit">Change password</button>
          <StatusMessage status={changeStatus} />
        </form>
      </section>

      <section aria-labelledby="delete-account-heading">
        <h2 id="delete-account-heading">Delete account</h2>
        <p>
          Sole organization owners must delete or delegate their organizations
          first.
        </p>
        <form action={deleteAccount} aria-label="Delete account">
          <label htmlFor="delete-password">Current password</label>
          <input
            autoComplete="current-password"
            id="delete-password"
            name="deletePassword"
            required
            type="password"
          />
          <button type="submit">Delete account</button>
          <StatusMessage status={deleteStatus} />
        </form>
      </section>
    </main>
  );
}
