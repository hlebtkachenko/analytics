import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
    elapsedMs: 12,
    eventLineCount: 10,
    invoiceLineCount: 5,
    queryCount: 4,
  },
};

const empty = {
  byAccount: [],
  byActivity: [],
  byMonth: [],
  byVatRegime: [],
  documents: [],
  stats: {
    elapsedMs: 3,
    eventLineCount: 0,
    invoiceLineCount: 0,
    queryCount: 4,
  },
};

// One router per test, so every request is answered by the shape its route promises.
function respondWith(payload: unknown, readDocuments = true) {
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
      return Response.json(legalEntities);
    }

    if (input.includes('/documents/analytics')) {
      return Response.json(payload);
    }

    return new Response(null, { status: 404 });
  });
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
  vi.unstubAllGlobals();
});

describe('DocumentAnalyticsPage', () => {
  it('renders the five aggregates the register stores', async () => {
    vi.stubGlobal('fetch', respondWith(analytics));

    renderAnalyticsPage();

    await screen.findByTestId('analytics-documents');
    expect(
      screen.getByRole('heading', { name: 'Document analytics' }),
    ).toBeVisible();

    for (const [testId, title] of [
      ['analytics-documents', 'Documents'],
      ['analytics-by-month', 'By month'],
      ['analytics-by-activity', 'By activity (expense and revenue accounts)'],
      ['analytics-by-vat-regime', 'By VAT regime'],
      ['analytics-by-account', 'By account'],
    ] as const) {
      const wrapper = screen.getByTestId(testId);
      expect(within(wrapper).getByText(title)).toBeVisible();
      expect(within(wrapper).getByRole('table')).toBeVisible();
    }

    const documentsTable = within(
      screen.getByTestId('analytics-documents'),
    ).getByRole('table');
    expect(within(documentsTable).getByText('REF-1')).toBeVisible();
    expect(within(documentsTable).getByText(/6,050\.00/)).toBeVisible();
    expect(within(documentsTable).getByText(/5,550\.00/)).toBeVisible();

    const monthTable = within(
      screen.getByTestId('analytics-by-month'),
    ).getByRole('table');
    expect(within(monthTable).getByText('2026-01')).toBeVisible();
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

  it('states its own cost from the stats the read reports', async () => {
    vi.stubGlobal('fetch', respondWith(analytics));

    renderAnalyticsPage();

    expect(await screen.findByTestId('analytics-stats')).toHaveTextContent(
      'Read from 10 event lines and 5 invoice lines with 4 group by queries in 12 ms.',
    );
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

  it('asks the analytics route for the selected legal entity only', async () => {
    const fetchMock = respondWith(analytics);
    vi.stubGlobal('fetch', fetchMock);

    renderAnalyticsPage();
    await screen.findByTestId('analytics-stats');

    expect(
      fetchMock.mock.calls
        .map((call) => String(call[0]))
        .filter((path) => path.includes('/documents/analytics')),
    ).toEqual([
      '/api/bff/application/organizations/organization_1/documents/analytics',
    ]);
  });

  it('shows the empty state when nothing is stored for the scope', async () => {
    vi.stubGlobal('fetch', respondWith(empty));

    renderAnalyticsPage();

    expect(
      await screen.findByText(
        'No invoice analytics are stored for this organization yet.',
      ),
    ).toBeVisible();
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
    expect(
      fetchMock.mock.calls
        .map((call) => String(call[0]))
        .filter((path) => path.includes('/documents/analytics')),
    ).toEqual([]);
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
