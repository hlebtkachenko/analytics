import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../../i18n/client-provider';
import HrSettingsRedirect from './hr-settings-redirect';

const replace = vi.fn();
let organization = 'placeholder-organization';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(`organization=${organization}`),
}));

afterEach(() => {
  cleanup();
  replace.mockReset();
});

describe('HrSettingsRedirect', () => {
  it('preserves the selected organization in the structure redirect', async () => {
    render(
      <I18nProvider>
        <HrSettingsRedirect />
      </I18nProvider>,
    );
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        '/hr-settings/structure?organization=placeholder-organization',
      ),
    );
  });

  it('does not add an empty organization query value', async () => {
    organization = '';
    render(
      <I18nProvider>
        <HrSettingsRedirect />
      </I18nProvider>,
    );
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/hr-settings/structure'),
    );
    organization = 'placeholder-organization';
  });
});
