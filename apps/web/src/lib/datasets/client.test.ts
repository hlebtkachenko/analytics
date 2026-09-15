import { afterEach, describe, expect, it, vi } from 'vitest';

import { getJson } from './client';

const assign = vi.fn();

// jsdom refuses a navigation, so the one method the client calls is replaced instead.
Object.defineProperty(window, 'location', {
  configurable: true,
  value: {
    assign,
    pathname: '/documents/analytics',
    search: '?organization=bap-operational',
  },
  writable: true,
});

afterEach(() => {
  assign.mockClear();
  vi.unstubAllGlobals();
});

describe('getJson', () => {
  it('returns the parsed body of a successful read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ ok: true })),
    );

    await expect(
      getJson('/api/bff/application/x', new AbortController().signal),
    ).resolves.toEqual({ ok: true });
    expect(assign).not.toHaveBeenCalled();
  });

  it('sends an expired session back to sign in with the current path', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 401 })),
    );

    await expect(
      getJson('/api/bff/application/x', new AbortController().signal),
    ).rejects.toThrow('Request failed.');
    expect(assign).toHaveBeenCalledWith(
      '/sign-in?next=%2Fdocuments%2Fanalytics%3Forganization%3Dbap-operational',
    );
  });

  it('leaves another failure to the caller', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 500 })),
    );

    await expect(
      getJson('/api/bff/application/x', new AbortController().signal),
    ).rejects.toThrow('Request failed.');
    expect(assign).not.toHaveBeenCalled();
  });
});
