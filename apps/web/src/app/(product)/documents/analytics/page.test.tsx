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

// jsdom ships no matchMedia, which Carbon's list box reads on mount.
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
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

import { I18nProvider } from '../../../../i18n/client-provider';
import DocumentAnalyticsPage from './page';

const LEGAL_ENTITY_ID = '9b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21';
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

const analytics = {
  byAccount: [
    {
      accountCode: '518',
      accountName: 'Other services',
      credit: '0.0000',
      debit: '5000.0000',
      nature: 'EXPENSE',
    },
  ],
  byActivity: [
    {
      activityCode: 'month-01',
      credit: '0.0000',
      debit: '1000.0000',
      lineCount: 1,
    },
  ],
  byMonth: [
    {
      accountCode: '518',
      accountName: 'Other services',
      credit: '0.0000',
      debit: '1000.0000',
      month: '2026-01-01',
    },
  ],
  byVatRegime: [
    {
      baseAmount: '5000.0000',
      lineCount: 5,
      lineKind: 'item',
      vatAmount: '1050.0000',
      vatMode: 'standard',
      vatRate: '21',
    },
  ],
  documents: [
    {
      advanceTotal: '500.0000',
      amountDue: '5550.0000',
      currencyCode: 'CZK',
      documentDate: '2026-01-15',
      grossTotal: '6050.0000',
      id: DOCUMENT_ID,
      kind: 'received_invoice',
      partnerName: 'Placeholder Supplier',
      reference: 'REF-1',
      roundingAmount: '0.0000',
      status: 'registered',
      title: 'Placeholder document',
    },
  ],
  stats: {
    documentCount: 73,
    elapsedMs: 12,
    eventLineCount: 10,
    invoiceLineCount: 5,
    queryCount: 6,
  },
};

const empty = {
  byAccount: [],
  byActivity: [],
  byMonth: [],
  byVatRegime: [],
  documents: [],
  stats: {
    documentCount: 0,
    elapsedMs: 3,
    eventLineCount: 0,
    invoiceLineCount: 0,
    queryCount: 6,
  },
};

// One router per test, so every request is answered by the shape its route promises.
function respondWith(
  payload: unknown,
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
        capabilities: {
          createEntities: false,
          deleteEntities: false,
          manageDocuments: false,
          manageEntityAccess: false,
          manageMembers: false,
          manageOrganization: false,
          readDocuments,
          updateEntities: false,
          uploadData: false,
          useAi: false,
        },
        organizationId: 'organization_1',
      });
    }

    if (input.endsWith('/legal-entities')) {
      return Response.json(entitiesPayload);
    }

    if (input.includes('/documents/analytics')) {
      return Response.json(payload);
    }

    return new Response(null, { status: 404 });
  });
}

function analyticsRequests(
  fetchMock: ReturnType<typeof respondWith>,
): string[] {
  return fetchMock.mock.calls
    .map((call) => String(call[0]))
    .filter((path) => path.includes('/documents/analytics'));
}

function renderAnalyticsPage() {
  return render(
    <I18nProvider>
      <DocumentAnalyticsPage />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  navigation.search = '';
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

describe('DocumentAnalyticsPage', () => {
  it('renders the five aggregates as data grids the register stores', async () => {
    vi.stubGlobal('fetch', respondWith(analytics));

    renderAnalyticsPage();

    await screen.findByTestId('analytics-documents');
    expect(
      screen.getByRole('heading', { name: 'Document analytics' }),
    ).toBeVisible();

    // Each grid names itself through its accessible label, not a visible title band.
    for (const [testId, label] of [
      ['analytics-documents', 'Documents'],
      ['analytics-by-month', 'By month'],
      ['analytics-by-activity', 'By activity (expense and revenue accounts)'],
      ['analytics-by-vat-regime', 'By VAT regime'],
      ['analytics-by-account', 'By account'],
    ] as const) {
      const wrapper = screen.getByTestId(testId);
      expect(within(wrapper).getByRole('table', { name: label })).toBeVisible();
    }

    const documentsTable = within(
      screen.getByTestId('analytics-documents'),
    ).getByRole('table');
    expect(within(documentsTable).getByText('REF-1')).toBeVisible();
    // Amounts read the Czech way: grouped thousands and a decimal comma.
    expect(within(documentsTable).getByText(/6[\s ]050,00/)).toBeVisible();
    expect(within(documentsTable).getByText(/5[\s ]550,00/)).toBeVisible();

    // The document row carries the kind icon next to its title link.
    const titleCell = within(documentsTable)
      .getByRole('link', { name: 'Placeholder document' })
      .closest('span');
    expect(titleCell?.querySelector('svg')).not.toBeNull();

    const monthTable = within(
      screen.getByTestId('analytics-by-month'),
    ).getByRole('table');
    expect(within(monthTable).getByText('January 2026')).toBeVisible();
    expect(within(monthTable).getByText('Other services')).toBeVisible();

    const activityTable = within(
      screen.getByTestId('analytics-by-activity'),
    ).getByRole('table');
    expect(within(activityTable).getByText('month-01')).toBeVisible();

    const vatTable = within(
      screen.getByTestId('analytics-by-vat-regime'),
    ).getByRole('table');
    expect(within(vatTable).getByText('Standard')).toBeVisible();
    expect(within(vatTable).getByText('Supply')).toBeVisible();

    const accountTable = within(
      screen.getByTestId('analytics-by-account'),
    ).getByRole('table');
    expect(within(accountTable).getByText('EXPENSE')).toBeVisible();
  });

  it('states its analysed counts as a row of stat tiles from the read', async () => {
    vi.stubGlobal('fetch', respondWith(analytics));

    renderAnalyticsPage();

    const stats = await screen.findByTestId('analytics-stats');
    expect(within(stats).getByText('Invoices analysed')).toBeVisible();
    // The count comes from the unbounded aggregates, never from the capped document list.
    expect(within(stats).getByText('73')).toBeVisible();
    expect(within(stats).getByText('Event lines')).toBeVisible();
    expect(within(stats).getByText('10')).toBeVisible();
    expect(within(stats).getByText('Invoice lines')).toBeVisible();
    expect(within(stats).getByText('5')).toBeVisible();
    // The read never advertises its own query cost on the page.
    expect(document.body.textContent).not.toContain('queries');
    expect(document.body.textContent).not.toContain(' ms');
  });

  it('scopes the register through a legal entity multiselect, not a switcher', async () => {
    vi.stubGlobal('fetch', respondWith(analytics, true, twoLegalEntities));

    renderAnalyticsPage();

    // The scope is one multiselect naming every entity, opened from the header.
    const scope = await screen.findByRole('combobox', { name: 'Legal entity' });
    fireEvent.click(scope);
    expect(screen.getByRole('option', { name: 'Entity One' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'Entity Two' })).toBeVisible();

    // The old switcher is gone; no entity tab renders in the header.
    expect(
      screen.queryByRole('tab', { name: 'All legal entities' }),
    ).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Entity One' })).toBeNull();
  });

  it('sends both chosen entities in the analytics read and reflects them in the URL', async () => {
    const fetchMock = respondWith(analytics, true, twoLegalEntities);
    vi.stubGlobal('fetch', fetchMock);

    renderAnalyticsPage();

    fireEvent.click(
      await screen.findByRole('combobox', { name: 'Legal entity' }),
    );
    fireEvent.click(screen.getByRole('option', { name: 'Entity One' }));
    await waitFor(() => {
      expect(analyticsRequests(fetchMock).at(-1)).toContain(
        `legalEntityId=${ENTITY_ONE_ID}`,
      );
    });

    fireEvent.click(screen.getByRole('option', { name: 'Entity Two' }));
    await waitFor(() => {
      const last = analyticsRequests(fetchMock).at(-1) ?? '';
      expect(last).toContain(`legalEntityId=${ENTITY_ONE_ID}`);
      expect(last).toContain(`legalEntityId=${ENTITY_TWO_ID}`);
    });

    // The URL keeps both ids as a CSV, so a reload or a shared link reopens the scope.
    const search = decodeURIComponent(window.location.search);
    expect(search).toContain(`entity=${ENTITY_ONE_ID},${ENTITY_TWO_ID}`);
  });

  it('clears the scope back to every entity', async () => {
    const fetchMock = respondWith(analytics, true, twoLegalEntities);
    vi.stubGlobal('fetch', fetchMock);

    renderAnalyticsPage();

    fireEvent.click(
      await screen.findByRole('combobox', { name: 'Legal entity' }),
    );
    fireEvent.click(screen.getByRole('option', { name: 'Entity One' }));
    await waitFor(() => {
      expect(analyticsRequests(fetchMock).at(-1)).toContain('legalEntityId=');
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Clear selected item' }),
    );
    await waitFor(() => {
      expect(analyticsRequests(fetchMock).at(-1)).not.toContain(
        'legalEntityId=',
      );
    });
    expect(window.location.search).not.toContain('entity=');
  });

  it('drops an unknown entity id from the read and URL once the entities load', async () => {
    navigation.search = `?entity=${UNKNOWN_ENTITY_ID}`;
    const fetchMock = respondWith(analytics, true, twoLegalEntities);
    vi.stubGlobal('fetch', fetchMock);

    renderAnalyticsPage();
    await screen.findByTestId('analytics-stats');

    // The stale id is pruned, so the final read scopes to every entity again.
    await waitFor(() => {
      expect(analyticsRequests(fetchMock).at(-1)).not.toContain(
        'legalEntityId=',
      );
    });
    expect(window.location.search).not.toContain(UNKNOWN_ENTITY_ID);
  });

  it('links the document title back to the document, keeping the organization', async () => {
    vi.stubGlobal('fetch', respondWith(analytics));

    renderAnalyticsPage();

    const link = await screen.findByRole('link', {
      name: 'Placeholder document',
    });
    expect(link).toHaveAttribute(
      'href',
      `/documents/${DOCUMENT_ID}?organization=organization-1`,
    );
  });

  it('asks the analytics route for the whole scope until an entity is chosen', async () => {
    const fetchMock = respondWith(analytics);
    vi.stubGlobal('fetch', fetchMock);

    renderAnalyticsPage();
    await screen.findByTestId('analytics-stats');

    expect(analyticsRequests(fetchMock)).toEqual([
      '/api/bff/application/organizations/organization_1/documents/analytics',
    ]);
  });

  it('shows the empty state when nothing is stored for the scope', async () => {
    vi.stubGlobal('fetch', respondWith(empty));

    renderAnalyticsPage();

    expect(
      await screen.findByText(
        'Analytics covers invoice kinds: received and issued invoices and credit notes. None are registered in this scope yet.',
      ),
    ).toBeVisible();
    const register = screen.getByRole('link', { name: 'Register an invoice' });
    expect(register).toHaveAttribute(
      'href',
      '/documents/new?organization=organization-1',
    );
    const inbox = screen.getByRole('link', { name: 'Open the inbox' });
    expect(inbox).toHaveAttribute('href', '/inbox?organization=organization-1');
    expect(screen.queryByTestId('analytics-by-month')).toBeNull();
  });

  it('reports a failed read rather than an empty page', async () => {
    const fetchMock = respondWith(analytics);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input.includes('/documents/analytics')) {
          return new Response(null, { status: 500 });
        }
        return await fetchMock(input);
      }),
    );

    renderAnalyticsPage();

    expect(
      await screen.findByText('Document analytics could not be loaded.'),
    ).toBeVisible();
  });

  it('warns an account without the read capability and never asks the route', async () => {
    const fetchMock = respondWith(analytics, false);
    vi.stubGlobal('fetch', fetchMock);

    renderAnalyticsPage();

    expect(
      await screen.findByText(
        'This account cannot read documents in this organization.',
      ),
    ).toBeVisible();
    expect(
      screen.queryByText('Document analytics could not be loaded.'),
    ).toBeNull();
    expect(analyticsRequests(fetchMock)).toEqual([]);
  });

  it('keeps a refused access read out of the generic error alert', async () => {
    const fetchMock = respondWith(analytics);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input.endsWith('/access')) {
          return new Response(null, { status: 403 });
        }
        return await fetchMock(input);
      }),
    );

    renderAnalyticsPage();

    expect(
      await screen.findByText('Organization access could not be checked.'),
    ).toBeVisible();
    expect(
      screen.queryByText('Document analytics could not be loaded.'),
    ).toBeNull();
  });
});
