import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigation = { search: '' };
const routerPush = vi.fn();

// jsdom ships no matchMedia, which Carbon Tabs and the DataGrid read on mount.
beforeEach(() => {
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
});

vi.mock('next/navigation', () => ({
  useParams: () => ({}),
  useRouter: () => ({ push: routerPush, refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

import { I18nProvider } from '../../../i18n/client-provider';
import { lastSeenKey } from '../../../lib/inbox/last-seen.ts';
import DocumentsPage from './page';

const LEGAL_ENTITY_ID = '9b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21';
const PARTNER_ID = '4c2f8b11-8c35-4a2e-9f61-1de2f0a7c934';
const DOCUMENT_ID = '00000000-0000-4000-8000-000000000010';

const legalEntities = {
  legalEntities: [
    {
      createdAt: '2026-01-01T00:00:00.000Z',
      id: LEGAL_ENTITY_ID,
      kind: 'company',
      name: 'Placeholder Holding',
      registrationNumber: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
};

const ENTITY_ONE_ID = '00000000-0000-4000-8000-000000000201';
const ENTITY_TWO_ID = '00000000-0000-4000-8000-000000000202';
const UNKNOWN_ENTITY_ID = '00000000-0000-4000-8000-000000000999';

// Two entities in scope, so the multiselect can carry more than one id at once.
const twoLegalEntities = {
  legalEntities: [
    {
      createdAt: '2026-01-01T00:00:00.000Z',
      id: ENTITY_ONE_ID,
      kind: 'company',
      name: 'Entity One',
      registrationNumber: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      createdAt: '2026-01-01T00:00:00.000Z',
      id: ENTITY_TWO_ID,
      kind: 'company',
      name: 'Entity Two',
      registrationNumber: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
};

const partners = {
  partners: [
    {
      countryCode: 'CZ',
      createdAt: '2026-01-01T00:00:00.000Z',
      id: PARTNER_ID,
      legalEntityId: null,
      name: 'Placeholder Supplier',
      registrationNumber: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
      vatNumber: null,
    },
  ],
};

const documentSummary = {
  createdAt: '2026-09-01T00:00:00.000Z',
  currencyCode: 'CZK',
  documentDate: '2026-09-01',
  hasEvent: true,
  id: DOCUMENT_ID,
  isBalanced: false,
  isCurrent: true,
  kind: 'received_invoice',
  legalEntityId: LEGAL_ENTITY_ID,
  openIssueCount: 2,
  partnerId: PARTNER_ID,
  partnerName: 'Placeholder Supplier',
  reference: 'REF-1',
  source: 'manual',
  status: 'registered',
  title: 'Placeholder document',
  totalAmount: '1210.0000',
  updatedAt: '2026-09-02T00:00:00.000Z',
  validFrom: null,
  validTo: null,
  version: 1,
};

const counts = {
  all: 3,
  archived: 0,
  needsReview: 1,
  verified: 1,
  withIssues: 1,
};

function capabilities(manageDocuments: boolean, readDocuments = true) {
  return {
    createEntities: false,
    deleteEntities: false,
    manageDocuments,
    manageEntityAccess: false,
    manageMembers: false,
    manageOrganization: false,
    readDocuments,
    updateEntities: false,
    uploadData: false,
    useAi: false,
  };
}

// One router per test, so every request is answered by the shape its route promises.
function respondWith(
  documents: unknown[],
  manageDocuments = true,
  readDocuments = true,
  entitiesPayload: unknown = legalEntities,
) {
  return vi.fn(async (input: string) => {
    if (input === '/api/auth/organization/list') {
      return Response.json([
        {
          id: 'organization_1',
          name: 'Organization 1',
          slug: 'organization-1',
        },
      ]);
    }

    if (input.endsWith('/access')) {
      return Response.json({
        capabilities: capabilities(manageDocuments, readDocuments),
        organizationId: 'organization_1',
      });
    }

    if (input.endsWith('/legal-entities')) {
      return Response.json(entitiesPayload);
    }

    if (input.includes('/partners')) {
      return Response.json(partners);
    }

    if (input.includes('/documents')) {
      // A scoped request narrows the counts so the tiles visibly react to the entity switch.
      const scoped = input.includes('legalEntityId=');
      return Response.json({
        counts: scoped ? { ...counts, all: 7 } : counts,
        documents,
        page: 1,
        pageSize: 25,
        total: documents.length,
        totalsByCurrency:
          documents.length === 0
            ? []
            : [{ currencyCode: 'CZK', totalAmount: '1210.0000' }],
      });
    }

    return new Response(null, { status: 404 });
  });
}

function documentRequests(fetchMock: ReturnType<typeof respondWith>): string[] {
  return fetchMock.mock.calls
    .map((call) => String(call[0]))
    .filter((path) => path.includes('/documents?'));
}

function renderDocumentsPage() {
  return render(
    <I18nProvider>
      <DocumentsPage />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  navigation.search = '';
  routerPush.mockReset();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('DocumentsPage', () => {
  it('lists the register on the default tab and asks the server for the first page', async () => {
    const fetchMock = respondWith([documentSummary]);
    vi.stubGlobal('fetch', fetchMock);

    renderDocumentsPage();

    expect(await screen.findByText('Placeholder document')).toBeVisible();
    const table = screen.getByRole('table');
    expect(within(table).getByText('REF-1')).toBeVisible();
    expect(documentRequests(fetchMock)[0]).toBe(
      '/api/bff/application/organizations/organization_1/documents?sort=documentDate&order=desc&page=1&pageSize=25',
    );
  });

  it('shows a tab per status with its count from the response', async () => {
    vi.stubGlobal('fetch', respondWith([documentSummary]));

    renderDocumentsPage();
    await screen.findByText('Placeholder document');

    expect(screen.getByRole('tab', { name: 'All (3)' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Needs review (1)' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Verified (1)' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Archived (0)' })).toBeVisible();
  });

  it('maps each tab to its status filter in the query', async () => {
    const fetchMock = respondWith([documentSummary]);
    vi.stubGlobal('fetch', fetchMock);

    renderDocumentsPage();
    await screen.findByText('Placeholder document');

    fireEvent.click(screen.getByRole('tab', { name: 'Needs review (1)' }));
    await waitFor(() => {
      expect(
        documentRequests(fetchMock).some((path) =>
          path.includes('status=needs_review'),
        ),
      ).toBe(true);
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Archived (0)' }));
    await waitFor(() => {
      expect(
        documentRequests(fetchMock).some((path) =>
          path.includes('status=archived'),
        ),
      ).toBe(true);
    });
  });

  it('asks the server for the sort when a column header is clicked', async () => {
    const fetchMock = respondWith([documentSummary]);
    vi.stubGlobal('fetch', fetchMock);

    renderDocumentsPage();
    await screen.findByText('Placeholder document');

    fireEvent.click(screen.getByText('Total'));
    await waitFor(() => {
      expect(
        documentRequests(fetchMock).some(
          (path) =>
            path.includes('sort=totalAmount') && path.includes('order=asc'),
        ),
      ).toBe(true);
    });
  });

  it('shows four stat tiles with the total shown formatted in Czech', async () => {
    vi.stubGlobal('fetch', respondWith([documentSummary]));

    renderDocumentsPage();
    await screen.findByText('Placeholder document');

    const stats = screen.getByRole('region', { name: 'Document statistics' });
    expect(within(stats).getByText('With issues')).toBeVisible();
    expect(within(stats).getByText('Total shown')).toBeVisible();
    expect(within(stats).getByText(/1.?210,00.+CZK/)).toBeVisible();
  });

  it('shows the total of every currency in the scope, never only the first', async () => {
    const base = respondWith([documentSummary]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const response = await base(input);
        if (!input.includes('/documents?')) {
          return response;
        }
        const body = (await response.json()) as Record<string, unknown>;
        return Response.json({
          ...body,
          totalsByCurrency: [
            { currencyCode: 'CZK', totalAmount: '1210.0000' },
            { currencyCode: 'EUR', totalAmount: '50.0000' },
          ],
        });
      }),
    );

    renderDocumentsPage();
    await screen.findByText('Placeholder document');

    const stats = screen.getByRole('region', { name: 'Document statistics' });
    expect(
      within(stats).getByText(/1.?210,00.+CZK · 50,00.+EUR/),
    ).toBeVisible();
  });

  it('reveals the filters behind the toggle and shows a removable tag', async () => {
    navigation.search = '?kind=received_invoice';
    vi.stubGlobal('fetch', respondWith([documentSummary]));

    renderDocumentsPage();
    await screen.findByText('Placeholder document');

    // The active kind filter reads back from the URL as a removable tag.
    expect(screen.getByText('Kind: Received invoice')).toBeVisible();

    // The Kind control only appears once the Filter toggle is used.
    expect(screen.queryByRole('button', { name: /^Kind/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    expect(screen.getByRole('group', { name: 'Filters' })).toBeInTheDocument();
  });

  it('carries the date filters from the URL into the query', async () => {
    navigation.search = '?dateFrom=2026-01-01&dateTo=2026-03-31';
    const fetchMock = respondWith([documentSummary]);
    vi.stubGlobal('fetch', fetchMock);

    renderDocumentsPage();
    await screen.findByText('Placeholder document');

    expect(documentRequests(fetchMock)[0]).toContain('dateFrom=2026-01-01');
    expect(documentRequests(fetchMock)[0]).toContain('dateTo=2026-03-31');
    expect(screen.getByText(/Document date from:/)).toBeVisible();
  });

  it('sends the typed search as a debounced server query', async () => {
    const fetchMock = respondWith([documentSummary]);
    vi.stubGlobal('fetch', fetchMock);

    renderDocumentsPage();
    await screen.findByText('Placeholder document');

    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'placeholder' },
    });

    await waitFor(() => {
      expect(
        documentRequests(fetchMock).some((path) =>
          path.includes('q=placeholder'),
        ),
      ).toBe(true);
    });
  });

  it('opens the document on a row click', async () => {
    vi.stubGlobal('fetch', respondWith([documentSummary]));

    renderDocumentsPage();
    fireEvent.click(await screen.findByText('Placeholder document'));

    expect(routerPush).toHaveBeenCalledWith(
      `/documents/${DOCUMENT_ID}?organization=organization-1`,
    );
  });

  it('marks a document registered after the last visit with a New tag', async () => {
    window.localStorage.setItem(
      lastSeenKey('documents', 'organization_1'),
      '2026-08-01T00:00:00.000Z',
    );
    vi.stubGlobal('fetch', respondWith([documentSummary]));

    renderDocumentsPage();
    await screen.findByText('Placeholder document');

    const table = screen.getByRole('table');
    expect(within(table).getByText('New')).toBeVisible();
  });

  it('keeps raw codes, identifiers and timestamps out of the row text', async () => {
    vi.stubGlobal('fetch', respondWith([documentSummary]));

    renderDocumentsPage();
    await screen.findByText('Placeholder document');

    const table = screen.getByRole('table');
    const text = table.textContent ?? '';
    expect(text).not.toContain('received_invoice');
    expect(text).not.toContain(DOCUMENT_ID);
    expect(text).not.toContain('2026-09-01T00:00:00.000Z');
    // The status and issues read as words, not codes.
    expect(within(table).getByText('Registered')).toBeVisible();
    expect(within(table).getByText('Unbalanced')).toBeVisible();
  });

  it('hides registration from an account without the manage capability', async () => {
    vi.stubGlobal('fetch', respondWith([documentSummary], false));

    renderDocumentsPage();
    await screen.findByText('Placeholder document');

    expect(screen.queryByRole('link', { name: 'New document' })).toBeNull();
  });

  it('scopes the register through a legal entity multiselect, not a switcher', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith([documentSummary], true, true, twoLegalEntities),
    );

    renderDocumentsPage();
    await screen.findByText('Placeholder document');

    // The scope is one multiselect naming every entity, opened from the header.
    const scope = screen.getByRole('combobox', { name: 'Legal entity' });
    fireEvent.click(scope);
    expect(screen.getByRole('option', { name: 'Entity One' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'Entity Two' })).toBeVisible();

    // The old switcher is gone; no entity tab renders above the tiles.
    expect(
      screen.queryByRole('tab', { name: 'All legal entities' }),
    ).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Entity One' })).toBeNull();
  });

  it('sends both chosen entities in the query and reflects them in the URL', async () => {
    const fetchMock = respondWith(
      [documentSummary],
      true,
      true,
      twoLegalEntities,
    );
    vi.stubGlobal('fetch', fetchMock);

    renderDocumentsPage();
    await screen.findByText('Placeholder document');

    const stats = screen.getByRole('region', { name: 'Document statistics' });
    expect(within(stats).getByText('3')).toBeVisible();

    fireEvent.click(screen.getByRole('combobox', { name: 'Legal entity' }));
    fireEvent.click(screen.getByRole('option', { name: 'Entity One' }));
    await waitFor(() => {
      expect(documentRequests(fetchMock).at(-1)).toContain(
        `legalEntityId=${ENTITY_ONE_ID}`,
      );
    });

    fireEvent.click(screen.getByRole('option', { name: 'Entity Two' }));
    await waitFor(() => {
      const last = documentRequests(fetchMock).at(-1) ?? '';
      expect(last).toContain(`legalEntityId=${ENTITY_ONE_ID}`);
      expect(last).toContain(`legalEntityId=${ENTITY_TWO_ID}`);
    });

    // The scoped counts land on the tiles, and the URL keeps both ids as a CSV.
    await waitFor(() => {
      expect(within(stats).getByText('7')).toBeVisible();
    });
    const search = decodeURIComponent(window.location.search);
    expect(search).toContain(`entity=${ENTITY_ONE_ID},${ENTITY_TWO_ID}`);
  });

  it('clears the scope back to every entity', async () => {
    const fetchMock = respondWith(
      [documentSummary],
      true,
      true,
      twoLegalEntities,
    );
    vi.stubGlobal('fetch', fetchMock);

    renderDocumentsPage();
    await screen.findByText('Placeholder document');

    fireEvent.click(screen.getByRole('combobox', { name: 'Legal entity' }));
    fireEvent.click(screen.getByRole('option', { name: 'Entity One' }));
    await waitFor(() => {
      expect(documentRequests(fetchMock).at(-1)).toContain('legalEntityId=');
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Clear selected item' }),
    );
    await waitFor(() => {
      expect(documentRequests(fetchMock).at(-1)).not.toContain(
        'legalEntityId=',
      );
    });
    expect(window.location.search).not.toContain('entity=');
  });

  it('drops an unknown entity id from the request and URL once the entities load', async () => {
    navigation.search = `?entity=${UNKNOWN_ENTITY_ID}`;
    const fetchMock = respondWith(
      [documentSummary],
      true,
      true,
      twoLegalEntities,
    );
    vi.stubGlobal('fetch', fetchMock);

    renderDocumentsPage();
    await screen.findByText('Placeholder document');

    // The stale id is pruned, so the final request scopes to every entity again.
    await waitFor(() => {
      expect(documentRequests(fetchMock).at(-1)).not.toContain(
        'legalEntityId=',
      );
    });
    expect(window.location.search).not.toContain(UNKNOWN_ENTITY_ID);
  });

  it('shows the document kind icon in the Document cell', async () => {
    vi.stubGlobal('fetch', respondWith([documentSummary]));

    renderDocumentsPage();
    await screen.findByText('Placeholder document');

    const table = screen.getByRole('table');
    // The kind icon carries its kind label as the svg title.
    expect(within(table).getByTitle('Received invoice')).toBeInTheDocument();
  });

  it('offers the analytics page from the overflow, keeping the organization', async () => {
    vi.stubGlobal('fetch', respondWith([documentSummary]));

    renderDocumentsPage();
    await screen.findByText('Placeholder document');

    // The overflow mounts its items into a portal once opened.
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    const item = await screen.findByText('Analytics', {
      selector: '.cds--overflow-menu-options__option-content',
    });
    expect(item.closest('a')).toHaveAttribute(
      'href',
      '/documents/analytics?organization=organization-1',
    );
  });

  it('hides analytics from an account without the read capability', async () => {
    vi.stubGlobal('fetch', respondWith([documentSummary], true, false));

    renderDocumentsPage();
    await screen.findByText('Placeholder document');
    // The denied notice proves access has loaded, so the missing overflow is a decision, not a race.
    expect(
      await screen.findByText(
        'This account cannot read documents in this organization.',
      ),
    ).toBeVisible();

    expect(screen.queryByRole('button', { name: 'Actions' })).toBeNull();
  });

  it('names the document in the row action, so the menus are told apart', async () => {
    vi.stubGlobal('fetch', respondWith([documentSummary]));

    renderDocumentsPage();
    await screen.findByText('Placeholder document');

    expect(
      screen.getByRole('button', { name: 'Actions for Placeholder document' }),
    ).toBeInTheDocument();
  });
});
