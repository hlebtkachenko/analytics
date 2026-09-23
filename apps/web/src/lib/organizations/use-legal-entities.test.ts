import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useLegalEntities, useLegalEntityList } from './use-legal-entities';

const ORG_ID = 'organization_1';
const legalEntities = {
  legalEntities: [
    {
      createdAt: '2026-01-01T00:00:00.000Z',
      id: '9b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21',
      kind: 'company',
      name: 'Placeholder Holding',
      registrationNumber: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
};

// Lets the rejected read settle, so an assertion sees the stored outcome and not the pending one.
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function fetchMock(response: () => Response) {
  const mock = vi.fn(async () => response());
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useLegalEntityList', () => {
  it('is undefined until the list resolves, then carries the entities', async () => {
    fetchMock(() => Response.json(legalEntities));

    const { result } = renderHook(() => useLegalEntityList(ORG_ID));
    expect(result.current).toBeUndefined();

    await waitFor(() => {
      expect(result.current).toEqual(legalEntities.legalEntities);
    });
  });

  it('stays undefined when the list fails, so no entity reads as hidden', async () => {
    const mock = fetchMock(() => new Response(null, { status: 500 }));

    const { result } = renderHook(() => useLegalEntityList(ORG_ID));

    await waitFor(() => {
      expect(mock).toHaveBeenCalled();
    });
    await settle();
    expect(result.current).toBeUndefined();
  });
});

describe('useLegalEntities', () => {
  it('falls back to an empty list when the list fails', async () => {
    const mock = fetchMock(() => new Response(null, { status: 500 }));

    const { result } = renderHook(() => useLegalEntities(ORG_ID));

    await waitFor(() => {
      expect(mock).toHaveBeenCalled();
    });
    await settle();
    expect(result.current).toEqual([]);
  });
});
