import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readRailPinned: vi.fn(),
  readThemeMode: vi.fn(),
  refresh: vi.fn(),
  setMode: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock('../../../../lib/preferences/server', () => ({
  readRailPinned: mocks.readRailPinned,
  readThemeMode: mocks.readThemeMode,
}));
vi.mock('@bap/design-system/theme', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@bap/design-system/theme')>()),
  useThemeMode: () => ({ mode: 'system', setMode: mocks.setMode }),
}));

import { I18nProvider } from '../../../../i18n/client-provider';
import AccountPreferencesPage from './page';

async function renderPage() {
  const ui = await AccountPreferencesPage();
  return render(<I18nProvider>{ui}</I18nProvider>);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.cookie = 'bap_theme=; path=/; max-age=0';
  document.cookie = 'bap_rail=; path=/; max-age=0';
});

describe('AccountPreferencesPage', () => {
  beforeEach(() => {
    mocks.readThemeMode.mockResolvedValue('system');
    mocks.readRailPinned.mockResolvedValue(false);
  });

  it('writes the theme cookie and updates the live theme', async () => {
    await renderPage();

    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));

    expect(mocks.setMode).toHaveBeenCalledWith('dark');
    expect(document.cookie).toContain('bap_theme=dark');
  });

  it('writes the rail cookie and refreshes when pinned', async () => {
    await renderPage();

    fireEvent.click(
      screen.getByRole('switch', { name: 'Pin the side navigation' }),
    );

    expect(document.cookie).toContain('bap_rail=pinned');
    expect(mocks.refresh).toHaveBeenCalled();
  });
});
