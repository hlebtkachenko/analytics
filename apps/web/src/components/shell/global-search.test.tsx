import { DesignSystemProvider } from '@bap/design-system/theme';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
}));

import { I18nProvider } from '../../i18n/client-provider';
import GlobalSearch from './global-search';

const activeOrganization = {
  id: 'org-1',
  name: 'Acme Legal',
  role: 'owner',
  slug: 'acme-legal',
} as const;

const workspaces = [
  { id: 'w1', name: 'Acme Legal', slug: 'acme-legal' },
  { id: 'w2', name: 'Beta Corp', slug: 'beta-corp' },
];

const legalEntities = {
  legalEntities: [
    {
      createdAt: '2026-01-01T00:00:00.000Z',
      id: 'e1',
      kind: 'company',
      name: 'Acme Trading',
      registrationNumber: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
};

function jsonResponse(payload: unknown) {
  return { json: async () => payload, ok: true } as unknown as Response;
}

function mockFetch(reject = false): void {
  globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
    if (reject) {
      return Promise.reject(new Error('offline'));
    }
    const url = String(input);
    if (url.includes('/api/auth/organization/list')) {
      return Promise.resolve(jsonResponse(workspaces));
    }
    if (url.includes('/legal-entities')) {
      return Promise.resolve(jsonResponse(legalEntities));
    }
    return Promise.reject(new Error(`unexpected ${url}`));
  }) as typeof fetch;
}

function renderSearch(onClose = vi.fn()) {
  return render(
    <DesignSystemProvider mode="light">
      <I18nProvider>
        <GlobalSearch
          activeOrganization={activeOrganization}
          onClose={onClose}
        />
      </I18nProvider>
    </DesignSystemProvider>,
  );
}

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  push.mockReset();
  mockFetch();
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(),
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  }));
  globalThis.ResizeObserver =
    ResizeObserverStub as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

describe('GlobalSearch', () => {
  it('builds the index from pages, workspaces, and entities', async () => {
    renderSearch();

    // A page from the rail is present without any query.
    expect(screen.getByRole('option', { name: 'Datasets' })).toBeTruthy();
    // The workspace list and legal entities resolve from their fetches.
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Beta Corp' })).toBeTruthy();
    });
    expect(screen.getByRole('option', { name: 'Acme Trading' })).toBeTruthy();
  });

  it('filters the flat index by the query', async () => {
    renderSearch();
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Beta Corp' })).toBeTruthy(),
    );

    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'beta' },
    });

    expect(screen.getByRole('option', { name: 'Beta Corp' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Datasets' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Acme Trading' })).toBeNull();
  });

  it('navigates to the highlighted result on Enter', async () => {
    const onClose = vi.fn();
    renderSearch(onClose);
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Beta Corp' })).toBeTruthy(),
    );

    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'beta' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(push).toHaveBeenCalledWith('/beta-corp');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the empty state only for a non-matching query', async () => {
    renderSearch();
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Beta Corp' })).toBeTruthy(),
    );

    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'zzzzz' },
    });

    expect(screen.getByText('No results.')).toBeTruthy();
  });

  it('falls back to the pages-only index when the fetches reject', async () => {
    mockFetch(true);
    renderSearch();

    expect(screen.getByRole('option', { name: 'Datasets' })).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: 'Beta Corp' })).toBeNull();
    });
    expect(screen.queryByText('No results.')).toBeNull();
  });
});
