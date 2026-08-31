import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../../i18n/client-provider';
import SignUpPage from './page';

const mocks = vi.hoisted(() => ({
  getAuthPool: vi.fn(),
  publicSignupEnabled: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock('@bap/db/access', () => ({
  publicSignupEnabled: mocks.publicSignupEnabled,
}));

vi.mock('../../../lib/auth/server', () => ({
  getAuthPool: mocks.getAuthPool,
}));

vi.mock('../../../lib/auth/client', () => ({
  authClient: { signUp: { email: mocks.signUp } },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderSignUp() {
  return render(<I18nProvider>{await SignUpPage()}</I18nProvider>);
}

async function submitSignUp(): Promise<void> {
  fireEvent.change(screen.getByLabelText('Full name'), {
    target: { value: 'Synthetic Member' },
  });
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: 'member@bap.invalid' },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'test-only-password' },
  });
  fireEvent.submit(
    screen.getByRole('form', { name: 'Create your BAP account' }),
  );
  await screen.findByText('Check your email');
}

describe('SignUpPage', () => {
  it('renders the form only when the server-side switch read is enabled', async () => {
    const pool = {};
    mocks.getAuthPool.mockResolvedValue(pool);
    mocks.publicSignupEnabled.mockResolvedValueOnce(true);

    await renderSignUp();

    expect(
      screen.getByRole('form', { name: 'Create your BAP account' }),
    ).toBeVisible();
    expect(mocks.publicSignupEnabled).toHaveBeenCalledWith(pool);

    cleanup();
    mocks.publicSignupEnabled.mockResolvedValueOnce(false);
    await renderSignUp();

    expect(
      screen.queryByRole('form', { name: 'Create your BAP account' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('Account creation is not available right now.'),
    ).toBeVisible();
  });

  it('fails closed when the server-side switch read fails', async () => {
    mocks.getAuthPool.mockResolvedValue({});
    mocks.publicSignupEnabled.mockRejectedValue(
      new Error('private database detail'),
    );

    await renderSignUp();

    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(mocks.publicSignupEnabled).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain('private database detail');
  });

  it('shows identical generic success for fresh and duplicate addresses', async () => {
    mocks.getAuthPool.mockResolvedValue({});
    mocks.publicSignupEnabled.mockResolvedValue(true);
    mocks.signUp.mockResolvedValueOnce({
      data: { token: null, user: { id: 'fresh-user' } },
      error: null,
    });

    const fresh = await renderSignUp();
    await submitSignUp();
    const freshOutcome = fresh.container.textContent;

    cleanup();
    mocks.signUp.mockResolvedValueOnce({
      data: { token: null, user: { id: 'synthetic-duplicate' } },
      error: null,
    });
    const duplicate = await renderSignUp();
    await submitSignUp();

    expect(duplicate.container.textContent).toBe(freshOutcome);
    expect(freshOutcome).not.toMatch(/fresh-user|synthetic-duplicate/i);
    await waitFor(() =>
      expect(mocks.signUp).toHaveBeenLastCalledWith({
        callbackURL: '/activate',
        email: 'member@bap.invalid',
        name: 'Synthetic Member',
        password: 'test-only-password',
      }),
    );
  });
});
