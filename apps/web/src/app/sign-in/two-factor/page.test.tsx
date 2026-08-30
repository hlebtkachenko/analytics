import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../../i18n/client-provider';
import TwoFactorPage from './page';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  verifyTotp: vi.fn(),
}));

vi.mock('../../../lib/auth/client', () => ({
  authClient: { twoFactor: { verifyTotp: mocks.verifyTotp } },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderTwoFactor() {
  return render(
    <I18nProvider>
      <TwoFactorPage />
    </I18nProvider>,
  );
}

describe('TwoFactorPage', () => {
  it('continues to the access page after a valid code', async () => {
    mocks.verifyTotp.mockResolvedValue({ data: {}, error: null });
    renderTwoFactor();
    fireEvent.change(screen.getByLabelText('Verification code'), {
      target: { value: '123456' },
    });
    fireEvent.submit(
      screen.getByRole('form', { name: 'Two-step verification' }),
    );

    await waitFor(() =>
      expect(mocks.verifyTotp).toHaveBeenCalledWith({ code: '123456' }),
    );
    expect(mocks.replace).toHaveBeenCalledWith('/access');
  });

  it('shows the localized error and stays on the page after rejection', async () => {
    mocks.verifyTotp.mockResolvedValue({
      data: null,
      error: { message: 'Invalid code' },
    });
    renderTwoFactor();
    fireEvent.submit(
      screen.getByRole('form', { name: 'Two-step verification' }),
    );

    expect(
      await screen.findByText(
        'Verification failed. Check the code and try again.',
      ),
    ).toHaveAttribute('role', 'alert');
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('never names a credential in the visible copy', () => {
    mocks.verifyTotp.mockResolvedValue({ data: {}, error: null });
    const { container } = renderTwoFactor();

    expect(container.textContent).not.toMatch(/token|jwt|bearer/i);
  });
});
