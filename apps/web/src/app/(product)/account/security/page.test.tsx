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
  changePassword: vi.fn(),
  disable: vi.fn(),
  enable: vi.fn(),
  generateBackupCodes: vi.fn(),
  getSession: vi.fn(),
  listUserSessions: vi.fn(),
  refresh: vi.fn(),
  revokeAccountSessionAction: vi.fn(),
  revokeOtherSessions: vi.fn(),
  verifyTotp: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../../../lib/auth/server', () => ({
  getAuth: async () => ({ api: { getSession: mocks.getSession } }),
  getAuthPool: async () => ({}),
}));
vi.mock('@bap/db/access', () => ({
  listUserSessions: mocks.listUserSessions,
}));
vi.mock('../../../../lib/auth/client', () => ({
  authClient: {
    changePassword: mocks.changePassword,
    revokeOtherSessions: mocks.revokeOtherSessions,
    twoFactor: {
      disable: mocks.disable,
      enable: mocks.enable,
      generateBackupCodes: mocks.generateBackupCodes,
      verifyTotp: mocks.verifyTotp,
    },
  },
}));
vi.mock('./actions', () => ({
  revokeAccountSessionAction: mocks.revokeAccountSessionAction,
}));

import { ToastProvider } from '../../../../components/shell/toast';
import { I18nProvider } from '../../../../i18n/client-provider';
import AccountSecurityPage from './page';

function stubMatchMedia(): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(),
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  }));
}

async function renderPage() {
  const ui = await AccountSecurityPage();
  return render(
    <I18nProvider>
      <ToastProvider>{ui}</ToastProvider>
    </I18nProvider>,
  );
}

// The modal password field and the section password field share a label, so the
// modal one is the last in the DOM.
function modalPasswordField(): HTMLElement {
  const fields = screen.getAllByLabelText('Current password');
  return fields[fields.length - 1]!;
}

function rowFor(text: string): HTMLElement {
  const row = screen.getByText(text).closest('tr');
  if (row === null) {
    throw new Error('row not found');
  }
  return row;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AccountSecurityPage', () => {
  beforeEach(() => {
    stubMatchMedia();
    mocks.getSession.mockResolvedValue({
      session: { id: 'session-current' },
      user: { id: 'user-1', twoFactorEnabled: false },
    });
    mocks.listUserSessions.mockResolvedValue([
      {
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        expiresAt: new Date('2026-09-10T00:00:00.000Z'),
        id: 'session-current',
        ipAddress: '203.0.113.7',
        updatedAt: new Date('2026-09-05T00:00:00.000Z'),
        userAgent: 'Mozilla/5.0',
      },
      {
        createdAt: new Date('2026-09-02T00:00:00.000Z'),
        expiresAt: new Date('2026-09-11T00:00:00.000Z'),
        id: 'session-other',
        ipAddress: null,
        updatedAt: new Date('2026-09-04T00:00:00.000Z'),
        userAgent: null,
      },
    ]);
    mocks.changePassword.mockResolvedValue({ data: {}, error: null });
    mocks.enable.mockResolvedValue({
      data: {
        backupCodes: ['aaaa-1111', 'bbbb-2222'],
        totpURI: 'otpauth://totp/BAP:ada?secret=SECRET123&issuer=BAP',
      },
      error: null,
    });
    mocks.verifyTotp.mockResolvedValue({ data: {}, error: null });
    mocks.disable.mockResolvedValue({ data: {}, error: null });
    mocks.generateBackupCodes.mockResolvedValue({
      data: { backupCodes: ['cccc-3333'], status: true },
      error: null,
    });
    mocks.revokeAccountSessionAction.mockResolvedValue({ ok: true });
    mocks.revokeOtherSessions.mockResolvedValue({ data: {}, error: null });
  });

  it('changes the password with the revoke-others option and refreshes', async () => {
    await renderPage();

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'old-password-value' },
    });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'new-password-value' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'new-password-value' },
    });
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Sign out other sessions' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() => {
      expect(mocks.changePassword).toHaveBeenCalledWith({
        currentPassword: 'old-password-value',
        newPassword: 'new-password-value',
        revokeOtherSessions: true,
      });
    });
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('maps an invalid current password inline', async () => {
    mocks.changePassword.mockResolvedValue({
      data: null,
      error: { code: 'INVALID_PASSWORD', status: 400 },
    });
    await renderPage();

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'wrong' },
    });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'new-password-value' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'new-password-value' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(
      await screen.findByText('That password is incorrect.'),
    ).toBeVisible();
  });

  it('maps a too-short new password inline', async () => {
    mocks.changePassword.mockResolvedValue({
      data: null,
      error: { code: 'PASSWORD_TOO_SHORT', status: 400 },
    });
    await renderPage();

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'old-password-value' },
    });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'short' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'short' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(
      await screen.findByText('Use at least 14 characters.'),
    ).toBeVisible();
  });

  it('runs the two-factor enable flow across its steps', async () => {
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    fireEvent.change(modalPasswordField(), {
      target: { value: 'my-password-value' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(mocks.enable).toHaveBeenCalledWith({
        password: 'my-password-value',
      });
    });
    expect(await screen.findByText('SECRET123')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(screen.getByLabelText('Verification code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => {
      expect(mocks.verifyTotp).toHaveBeenCalledWith({ code: '123456' });
    });
    expect(screen.getByText(/aaaa-1111/)).toBeVisible();
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('maps an invalid enrolment code inline', async () => {
    mocks.verifyTotp.mockResolvedValue({
      data: null,
      error: { code: 'INVALID_CODE', status: 401 },
    });
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    fireEvent.change(modalPasswordField(), {
      target: { value: 'my-password-value' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('SECRET123');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(screen.getByLabelText('Verification code'), {
      target: { value: '000000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByText('That code is incorrect.')).toBeVisible();
  });

  it('disables two-factor and refreshes', async () => {
    mocks.getSession.mockResolvedValue({
      session: { id: 'session-current' },
      user: { id: 'user-1', twoFactorEnabled: true },
    });
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    fireEvent.change(modalPasswordField(), {
      target: { value: 'my-password-value' },
    });
    const dialogButtons = screen.getAllByRole('button', { name: 'Turn off' });
    fireEvent.click(dialogButtons[dialogButtons.length - 1]!);

    await waitFor(() => {
      expect(mocks.disable).toHaveBeenCalledWith({
        password: 'my-password-value',
      });
    });
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('regenerates backup codes and shows them', async () => {
    mocks.getSession.mockResolvedValue({
      session: { id: 'session-current' },
      user: { id: 'user-1', twoFactorEnabled: true },
    });
    await renderPage();

    fireEvent.click(
      screen.getByRole('button', { name: 'Regenerate backup codes' }),
    );
    fireEvent.change(modalPasswordField(), {
      target: { value: 'my-password-value' },
    });
    const buttons = screen.getAllByRole('button', {
      name: 'Regenerate backup codes',
    });
    fireEvent.click(buttons[buttons.length - 1]!);

    await waitFor(() => {
      expect(mocks.generateBackupCodes).toHaveBeenCalledWith({
        password: 'my-password-value',
      });
    });
    expect(await screen.findByText(/cccc-3333/)).toBeVisible();
  });

  it('lists sessions, marks the current one and hides its revoke action', async () => {
    await renderPage();

    expect(screen.getByText('This session')).toBeVisible();
    // The current session row has no overflow action button.
    expect(within(rowFor('203.0.113.7')).queryByRole('button')).toBeNull();
    expect(
      within(rowFor('Unknown device')).getByRole('button'),
    ).toBeInTheDocument();
  });

  it('revokes another session through the server action', async () => {
    await renderPage();

    fireEvent.click(within(rowFor('Unknown device')).getByRole('button'));
    fireEvent.click(await screen.findByText('Revoke'));

    await waitFor(() => {
      expect(mocks.revokeAccountSessionAction).toHaveBeenCalledWith(
        'session-other',
      );
    });
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('signs out other sessions from the toolbar', async () => {
    await renderPage();

    fireEvent.click(
      screen.getByRole('button', { name: 'Sign out other sessions' }),
    );

    await waitFor(() => {
      expect(mocks.revokeOtherSessions).toHaveBeenCalled();
    });
    expect(mocks.refresh).toHaveBeenCalled();
  });
});
