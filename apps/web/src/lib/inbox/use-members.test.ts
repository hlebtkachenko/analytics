import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useMembers } from './use-members';

const ORG_ID = 'organization_1';
const members = {
  members: [{ email: 'alice@bap.invalid', id: 'user_1', name: 'Alice Owner' }],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useMembers', () => {
  it('is undefined until the list resolves, then carries the members', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(members)),
    );

    const { result } = renderHook(() => useMembers(ORG_ID));
    // Nothing has resolved on first paint, so an id reads as a neutral name, never "former".
    expect(result.current).toBeUndefined();

    await waitFor(() => {
      expect(result.current).toEqual(members.members);
    });
  });

  it('stays undefined when the list fails, so no id reads as a former member', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 500 })),
    );

    const { result } = renderHook(() => useMembers(ORG_ID));

    // A failed load never resolves into an empty list, which would mislabel every id.
    await waitFor(() => {
      expect(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length,
      ).toBeGreaterThan(0);
    });
    expect(result.current).toBeUndefined();
  });
});
