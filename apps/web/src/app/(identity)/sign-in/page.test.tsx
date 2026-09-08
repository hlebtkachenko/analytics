import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../../i18n/client-provider';
import SignInPage from './page';

const mocks = vi.hoisted(() => ({
  getAuthPool: vi.fn(),
  publicSignupEnabled: vi.fn(),
  replace: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock('@bap/db/access', () => ({
  publicSignupEnabled: mocks.publicSignupEnabled,
}));

vi.mock('../../../lib/auth/server', () => ({
  getAuthPool: mocks.getAuthPool,
}));

vi.mock('../../../lib/auth/client', () => ({
  authClient: { signIn: { email: mocks.signIn } },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderSignIn(publicSignup = true) {
  const pool = {};
  mocks.getAuthPool.mockResolvedValue(pool);
  mocks.publicSignupEnabled.mockResolvedValue(publicSignup);
  return render(<I18nProvider>{await SignInPage()}</I18nProvider>);
}

describe('SignInPage', () => {
  it('continues to the access page after successful authentication', async () => {
    mocks.signIn.mockResolvedValue({ data: {}, error: null });
    await renderSignIn();
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'owner@bap.invalid' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'test-only-password' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Sign in to BAP' }));

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/access'));
  });

  it('routes to the challenge when a second factor is pending', async () => {
    mocks.signIn.mockResolvedValue({
      data: { twoFactorMethods: ['totp'], twoFactorRedirect: true },
      error: null,
    });
    await renderSignIn();
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'owner@bap.invalid' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'test-only-password' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Sign in to BAP' }));

    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith('/sign-in/two-factor'),
    );
    expect(mocks.replace).not.toHaveBeenCalledWith('/access');
  });

  it('shows the localized error and stays on the page after rejection', async () => {
    mocks.signIn.mockResolvedValue({
      data: null,
      error: { message: 'Denied' },
    });
    await renderSignIn();
    fireEvent.submit(screen.getByRole('form', { name: 'Sign in to BAP' }));

    expect(
      (
        await screen.findByText(
          'Sign-in failed. Check your credentials and try again.',
        )
      ).closest('[role="alert"]'),
    ).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('links to password recovery and discovers public sign-up when enabled', async () => {
    await renderSignIn();

    expect(
      screen.getByRole('link', { name: 'Forgot your password?' }),
    ).toHaveAttribute('href', '/forgot-password');
    expect(
      screen.getByRole('link', { name: 'Create an account' }),
    ).toHaveAttribute('href', '/sign-up');
  });

  it('does not advertise public sign-up when the switch is off or unreadable', async () => {
    await renderSignIn(false);
    expect(
      screen.queryByRole('link', { name: 'Create an account' }),
    ).not.toBeInTheDocument();

    cleanup();
    mocks.publicSignupEnabled.mockRejectedValueOnce(
      new Error('private database detail'),
    );
    render(<I18nProvider>{await SignInPage()}</I18nProvider>);
    expect(
      screen.queryByRole('link', { name: 'Create an account' }),
    ).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('private database detail');
  });
});
