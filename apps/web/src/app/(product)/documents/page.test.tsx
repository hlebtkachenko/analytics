import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const navigation = { search: '' };

vi.mock('next/navigation', () => ({
  useParams: () => ({}),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

import { I18nProvider } from '../../../i18n/client-provider';
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
  isBalanced: true,
  isCurrent: true,
  kind: 'received_invoice',
  legalEntityId: LEGAL_ENTITY_ID,
  openIssueCount: 0,
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

// The ten capabilities the access contract always carries, tuned per test.
function capabilities(manageDocuments: boolean) {
  return {
    createEntities: false,
    deleteEntities: false,
    manageDocuments,
    manageEntityAccess: false,
    manageMembers: false,
    manageOrganization: false,
    readDocuments: true,
    updateEntities: false,
    uploadData: false,
    useAi: false,
  };
}

// One router per test, so every request is answered by the shape its route promises.
function respondWith(documents: unknown[], manageDocuments = true) {
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
        capabilities: capabilities(manageDocuments),
        organizationId: 'organization_1',
      });
    }

    if (input.endsWith('/legal-entities')) {
      return Response.json(legalEntities);
    }

    if (input.includes('/partners')) {
      return Response.json(partners);
    }

    if (input.includes('/documents')) {
      return Response.json({
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
  vi.unstubAllGlobals();
});

describe('DocumentsPage', () => {
  it('lists the register with the default page, sort, and totals', async () => {
    const fetchMock = respondWith([documentSummary]);
    vi.stubGlobal('fetch', fetchMock);

    renderDocumentsPage();

    expect(await screen.findByText('Placeholder document')).toBeVisible();
    const table = screen.getByRole('table');
    expect(within(table).getByText('REF-1')).toBeVisible();
    expect(within(table).getByText('Received invoice')).toBeVisible();
    expect(within(table).getByText('Registered')).toBeVisible();
    expect(within(table).getByText(/1,210\.00/)).toBeVisible();
    expect(documentRequests(fetchMock)[0]).toBe(
      '/api/bff/application/organizations/organization_1/documents?page=1&pageSize=25&sort=documentDate&order=desc',
    );
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

  it('asks the server to sort when a sortable column header is used', async () => {
    const fetchMock = respondWith([documentSummary]);
    vi.stubGlobal('fetch', fetchMock);

    renderDocumentsPage();
    await screen.findByText('Placeholder document');

    fireEvent.click(screen.getByRole('button', { name: 'Title' }));

    await waitFor(() => {
      expect(
        documentRequests(fetchMock).some((path) => path.includes('sort=title')),
      ).toBe(true);
    });
  });

  it('restores the stored filters from the URL', async () => {
    navigation.search = '?status=verified&page=2&pageSize=50';
    const fetchMock = respondWith([documentSummary]);
    vi.stubGlobal('fetch', fetchMock);

    renderDocumentsPage();
    await screen.findByText('Placeholder document');

    expect(documentRequests(fetchMock)[0]).toContain('status=verified');
    expect(documentRequests(fetchMock)[0]).toContain('page=2');
    expect(documentRequests(fetchMock)[0]).toContain('pageSize=50');
  });

  it('offers registration on an empty register and clearing on an empty filter', async () => {
    navigation.search = '';
    vi.stubGlobal('fetch', respondWith([]));

    renderDocumentsPage();

    expect(
      await screen.findByText(
        'No documents are registered for this organization yet.',
      ),
    ).toBeVisible();
    expect(
      screen.getAllByRole('link', { name: 'New document' }).length,
    ).toBeGreaterThan(0);

    cleanup();
    navigation.search = '?status=verified';
    vi.stubGlobal('fetch', respondWith([]));

    renderDocumentsPage();

    expect(
      await screen.findByText('No documents match the current filters.'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeVisible();
  });

  it('hides registration from an account without the manage capability', async () => {
    vi.stubGlobal('fetch', respondWith([documentSummary], false));

    renderDocumentsPage();
    await screen.findByText('Placeholder document');

    expect(screen.queryByRole('link', { name: 'New document' })).toBeNull();
  });

  it('names the document in the row action, so the menus are told apart', async () => {
    vi.stubGlobal('fetch', respondWith([documentSummary]));

    renderDocumentsPage();
    await screen.findByText('Placeholder document');

    expect(
      screen.getByRole('button', { name: 'View Placeholder document' }),
    ).toBeVisible();
  });
});
