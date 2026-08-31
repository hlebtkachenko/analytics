import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../../i18n/client-provider';
import ForgotPasswordPage from './page';

const mocks = vi.hoisted(() => ({ requestPasswordReset: vi.fn() }));

vi.mock('../../../lib/auth/client', () => ({
  authClient: { requestPasswordReset: mocks.requestPasswordReset },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderForgotPassword() {
  return render(
    <I18nProvider>
      <ForgotPasswordPage />
    </I18nProvider>,
  );
}

async function requestReset(email: string): Promise<string | null> {
  const view = renderForgotPassword();
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: email },
  });
  fireEvent.submit(screen.getByRole('form', { name: 'Reset your password' }));
  await screen.findByText('Check your email');
  return view.container.textContent;
}

describe('ForgotPasswordPage', () => {
  it('shows the identical generic result for existing and nonexistent addresses', async () => {
    mocks.requestPasswordReset.mockResolvedValueOnce({
      data: { message: 'existing-address-result', status: true },
      error: null,
    });
    const existing = await requestReset('existing@bap.invalid');

    cleanup();
    mocks.requestPasswordReset.mockResolvedValueOnce({
      data: { message: 'nonexistent-address-result', status: true },
      error: null,
    });
    const nonexistent = await requestReset('missing@bap.invalid');

    expect(nonexistent).toBe(existing);
    expect(nonexistent).not.toMatch(
      /existing-address-result|nonexistent-address-result/,
    );
    expect(mocks.requestPasswordReset).toHaveBeenLastCalledWith({
      email: 'missing@bap.invalid',
      redirectTo: '/reset-password',
    });
  });

  it('uses the standard generic auth error notification', async () => {
    mocks.requestPasswordReset.mockRejectedValue(
      new Error('private framework detail'),
    );
    renderForgotPassword();

    fireEvent.submit(screen.getByRole('form', { name: 'Reset your password' }));

    expect(
      (
        await screen.findByText(
          'The reset request could not be completed. Try again.',
        )
      ).closest('[role="alert"]'),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('private framework detail');
  });
});
