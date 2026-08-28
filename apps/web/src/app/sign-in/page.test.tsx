import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../i18n/client-provider';
import SignInPage from './page';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock('../../lib/auth/client', () => ({
  authClient: { signIn: { email: mocks.signIn } },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderSignIn() {
  return render(
    <I18nProvider>
      <SignInPage />
    </I18nProvider>,
  );
}

describe('SignInPage', () => {
  it('continues to the access page after successful authentication', async () => {
    mocks.signIn.mockResolvedValue({ data: {}, error: null });
    renderSignIn();
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'owner@bap.invalid' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'test-only-password' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Sign in to BAP' }));

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/access'));
  });

  it('shows the localized error and stays on the page after rejection', async () => {
    mocks.signIn.mockResolvedValue({
      data: null,
      error: { message: 'Denied' },
    });
    renderSignIn();
    fireEvent.submit(screen.getByRole('form', { name: 'Sign in to BAP' }));

    expect(
      await screen.findByText(
        'Sign-in failed. Check your credentials and try again.',
      ),
    ).toHaveAttribute('role', 'alert');
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
