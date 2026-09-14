import { describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn() }));

import { cookies } from 'next/headers';

import { readRailPinned, readThemeMode } from './server';

function mockCookies(store: Record<string, string>): void {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) =>
      store[name] === undefined ? undefined : { value: store[name] },
  } as unknown as Awaited<ReturnType<typeof cookies>>);
}

describe('readThemeMode', () => {
  it('defaults to system when the cookie is absent or invalid', async () => {
    mockCookies({});
    expect(await readThemeMode()).toBe('system');

    mockCookies({ bap_theme: 'sepia' });
    expect(await readThemeMode()).toBe('system');
  });

  it('returns a stored valid mode', async () => {
    mockCookies({ bap_theme: 'dark' });
    expect(await readThemeMode()).toBe('dark');
  });
});

describe('readRailPinned', () => {
  it('is true only when the cookie is exactly pinned', async () => {
    mockCookies({ bap_rail: 'pinned' });
    expect(await readRailPinned()).toBe(true);

    mockCookies({ bap_rail: 'collapsed' });
    expect(await readRailPinned()).toBe(false);

    mockCookies({});
    expect(await readRailPinned()).toBe(false);
  });
});
