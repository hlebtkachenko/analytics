import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../../i18n/client-provider';
import {
  resetCapabilityCookieName,
  resetCapabilityCookiePath,
} from '../../../lib/auth/reset-capability';
import { resetPassword } from './actions';
import ResetPasswordPage from './page';

const resetCapability = 'ResetSentinelTokenAbc123';
const mocks = vi.hoisted(() => ({
  authHandler: vi.fn(),
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  directResetPassword: vi.fn(),
  requestHeaders: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: mocks.cookieGet, set: mocks.cookieSet }),
  headers: async () => mocks.requestHeaders(),
}));

vi.mock('../../../lib/auth/server', () => ({
  getAuth: async () => ({
    api: { resetPassword: mocks.directResetPassword },
    handler: mocks.authHandler,
  }),
}));

beforeEach(() => {
  mocks.cookieGet.mockReturnValue({ value: resetCapability });
  mocks.requestHeaders.mockReturnValue(
    new Headers({
      cookie: 'browser-session=private',
      host: 'attacker.invalid',
      origin: 'https://bap.invalid',
      'x-bap-client-ip': '198.51.100.42',
    }),
  );
  mocks.authHandler.mockResolvedValue(
    Response.json({ status: true }, { status: 200 }),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderResetPassword() {
  return render(<I18nProvider>{await ResetPasswordPage()}</I18nProvider>);
}

function fillPasswords(password: string, confirmation = password): void {
  fireEvent.change(screen.getByLabelText('New password'), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText('Confirm new password'), {
    target: { value: confirmation },
  });
}

describe('ResetPasswordPage', () => {
  it.each([
    ['an absent capability', undefined],
    ['a malformed capability', { value: 'not-a-framework-token' }],
  ])('renders a generic error and no form for %s', async (_label, cookie) => {
    mocks.cookieGet.mockReturnValue(cookie);

    await renderResetPassword();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This password reset link is invalid or expired.',
    );
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('not-a-framework-token');
  });

  it('renders a bounded form without passing the capability into visible content', async () => {
    const view = await renderResetPassword();

    expect(
      screen.getByRole('form', { name: 'Choose a new password' }),
    ).toBeVisible();
    expect(screen.getByLabelText('New password')).toHaveAttribute(
      'minlength',
      '14',
    );
    expect(screen.getByLabelText('New password')).toHaveAttribute(
      'maxlength',
      '128',
    );
    expect(view.container.textContent).not.toContain(resetCapability);
  });

  it('rejects mismatched passwords without consuming the capability', async () => {
    await renderResetPassword();
    fillPasswords('replacement-password', 'different-password');
    fireEvent.submit(
      screen.getByRole('form', { name: 'Choose a new password' }),
    );

    expect(
      (
        await screen.findByText(
          'The password could not be reset. Request a new link and try again.',
        )
      ).closest('[role="alert"]'),
    ).toBeInTheDocument();
    expect(mocks.authHandler).not.toHaveBeenCalled();
    expect(mocks.directResetPassword).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
    expect(screen.getByRole('form')).toBeVisible();
  });

  it.each(['too-short-123', 'a'.repeat(129)])(
    'enforces password bounds on the server',
    async (password) => {
      const formData = new FormData();
      formData.set('newPassword', password);
      formData.set('confirmPassword', password);

      await expect(
        resetPassword({ status: 'form' }, formData),
      ).resolves.toEqual({ status: 'error' });
      expect(mocks.authHandler).not.toHaveBeenCalled();
      expect(mocks.directResetPassword).not.toHaveBeenCalled();
      expect(mocks.cookieSet).not.toHaveBeenCalled();
    },
  );

  it('submits through the Better Auth HTTP handler and clears the capability', async () => {
    const view = await renderResetPassword();
    fillPasswords('replacement-password');
    fireEvent.submit(
      screen.getByRole('form', { name: 'Choose a new password' }),
    );

    await screen.findByText('Password updated');
    expect(mocks.authHandler).toHaveBeenCalledOnce();
    const request = mocks.authHandler.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe(
      'https://better-auth.invalid/api/auth/reset-password',
    );
    expect(request.method).toBe('POST');
    expect(request.headers.get('content-type')).toBe('application/json');
    expect(request.headers.get('x-bap-client-ip')).toBe('198.51.100.42');
    expect(request.headers.get('cookie')).toBeNull();
    expect(request.headers.get('origin')).toBeNull();
    expect(request.headers.get('host')).toBeNull();
    await expect(request.json()).resolves.toEqual({
      newPassword: 'replacement-password',
      token: resetCapability,
    });
    expect(mocks.directResetPassword).not.toHaveBeenCalled();
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      resetCapabilityCookieName,
      '',
      expect.objectContaining({
        httpOnly: true,
        maxAge: 0,
        path: resetCapabilityCookiePath,
        sameSite: 'lax',
      }),
    );
    expect(view.container.textContent).not.toContain(resetCapability);
  });

  it('reduces a handler rejection to generic state and clears the capability', async () => {
    mocks.authHandler.mockResolvedValue(
      Response.json({ message: 'private framework detail' }, { status: 429 }),
    );
    const view = await renderResetPassword();
    fillPasswords('replacement-password');
    fireEvent.submit(
      screen.getByRole('form', { name: 'Choose a new password' }),
    );

    await waitFor(() => expect(mocks.cookieSet).toHaveBeenCalledOnce());
    expect(
      (
        await screen.findByText(
          'The password could not be reset. Request a new link and try again.',
        )
      ).closest('[role="alert"]'),
    ).toBeInTheDocument();
    expect(view.container.textContent).not.toMatch(
      /private framework detail|ResetSentinelTokenAbc123/,
    );
    expect(mocks.directResetPassword).not.toHaveBeenCalled();
  });
});
