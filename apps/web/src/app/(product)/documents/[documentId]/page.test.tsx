import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const DOCUMENT_ID = '00000000-0000-4000-8000-000000000010';

vi.mock('next/navigation', () => ({
  useParams: () => ({ documentId: DOCUMENT_ID }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));

import { ToastProvider } from '../../../../components/shell/toast';
import { I18nProvider } from '../../../../i18n/client-provider';
import DocumentDetailPage from './page';

const LEGAL_ENTITY_ID = '9b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21';
const PARTNER_ID = '4c2f8b11-8c35-4a2e-9f61-1de2f0a7c934';
const INVOICE_LINE_ID = '00000000-0000-4000-8000-000000000020';
const EVENT_ID = '00000000-0000-4000-8000-000000000030';
const ISSUE_ID = '00000000-0000-4000-8000-000000000040';

const detail = {
  attributes: { contract_number: 'PLACEHOLDER-1' },
  document: {
    createdAt: '2026-09-01T00:00:00.000Z',
    currencyCode: 'CZK',
    documentDate: '2026-09-01',
    hasEvent: true,
    id: DOCUMENT_ID,
    isBalanced: true,
    isCurrent: true,
    kind: 'received_invoice',
    legalEntityId: LEGAL_ENTITY_ID,
    openIssueCount: 1,
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
  },
  event: {
    creditTotal: '1210.0000',
    debitTotal: '1210.0000',
    derivedAt: '2026-09-02T00:00:00.000Z',
    eventDate: '2026-09-01',
    id: EVENT_ID,
    isBalanced: true,
    lines: [
      {
        accountCode: '518',
        accountName: 'Other services',
        amount: '1000.0000',
        description: 'Placeholder line',
        invoiceLineId: INVOICE_LINE_ID,
        lineNo: 1,
        partnerId: null,
        side: 'debit',
      },
      {
        accountCode: '343',
        accountName: 'Value added tax',
        amount: '210.0000',
        description: 'Placeholder line',
        invoiceLineId: INVOICE_LINE_ID,
        lineNo: 2,
        partnerId: null,
        side: 'debit',
      },
      {
        accountCode: '321',
        accountName: 'Trade payables',
        amount: '1210.0000',
        description: 'Placeholder line',
        invoiceLineId: INVOICE_LINE_ID,
        lineNo: 3,
        partnerId: PARTNER_ID,
        side: 'credit',
      },
    ],
    ruleSetVersion: 'cz-default-2026-09',
  },
  invoice: {
    baseTotal: '1000.0000',
    dueDate: '2026-09-15',
    fxRate: null,
    grossTotal: '1210.0000',
    lines: [
      {
        baseAmount: '1000.0000',
        category: 'services',
        description: 'Placeholder line',
        id: INVOICE_LINE_ID,
        lineNo: 1,
        quantity: null,
        sourceAccountCode: null,
        unit: null,
        unitPrice: null,
        vatAmount: '210.0000',
        vatMode: 'standard',
        vatRate: '21.00',
      },
    ],
    receivedDate: null,
    taxPointDate: '2026-09-01',
    variableSymbol: '1234567890',
    vatTotal: '210.0000',
  },
  issues: [
    {
      code: 'missing_partner',
      createdAt: '2026-09-02T00:00:00.000Z',
      detail: null,
      id: ISSUE_ID,
      resolvedAt: null,
      severity: 'warning',
    },
  ],
  links: [],
};

const LINK_ID = '00000000-0000-4000-8000-000000000050';
const OTHER_DOCUMENT_ID = '00000000-0000-4000-8000-000000000060';

const link = {
  createdAt: '2026-09-02T00:00:00.000Z',
  fromDocumentId: DOCUMENT_ID,
  id: LINK_ID,
  kind: 'relates',
  toDocumentId: OTHER_DOCUMENT_ID,
};

const patched: { body?: unknown } = {};

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

type RouterOptions = Readonly<{
  linkStatus?: number;
  links?: unknown[];
  manageDocuments?: boolean;
}>;

function respond(options: RouterOptions = {}) {
  return vi.fn(async (input: string, init?: RequestInit) => {
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
        capabilities: capabilities(options.manageDocuments ?? true),
        organizationId: 'organization_1',
      });
    }

    if (input.includes('/links')) {
      const status = options.linkStatus ?? 201;
      if (status >= 400) {
        return new Response(null, { status });
      }
      return init?.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : Response.json(link, { status });
    }

    if (input.includes('/documents/') && init?.method === 'PATCH') {
      patched.body = JSON.parse(String(init.body));
      return Response.json({
        ...detail,
        document: { ...detail.document, status: 'verified' },
      });
    }

    if (input.includes('/documents/')) {
      return Response.json({ ...detail, links: options.links ?? [] });
    }

    return new Response(null, { status: 404 });
  });
}

function renderDetailPage() {
  return render(
    <I18nProvider>
      <ToastProvider>
        <DocumentDetailPage />
      </ToastProvider>
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  delete patched.body;
  vi.unstubAllGlobals();
});

describe('DocumentDetailPage', () => {
  it('renders the register header, invoice lines, and derived event lines', async () => {
    vi.stubGlobal('fetch', respond());

    renderDetailPage();

    expect(
      await screen.findByRole('heading', { name: 'Placeholder document' }),
    ).toBeVisible();
    expect(screen.getByText('Placeholder Supplier')).toBeVisible();

    const invoiceTable = screen.getByRole('table', { name: 'Invoice lines' });
    expect(within(invoiceTable).getByText('Placeholder line')).toBeVisible();
    expect(within(invoiceTable).getByText('Services')).toBeVisible();

    const eventTable = screen.getByRole('table', { name: 'Economic event' });
    expect(within(eventTable).getByText('518 Other services')).toBeVisible();
    expect(within(eventTable).getByText('343 Value added tax')).toBeVisible();
    expect(within(eventTable).getByText('321 Trade payables')).toBeVisible();
  });

  it('reports every open data issue', async () => {
    vi.stubGlobal('fetch', respond());

    renderDetailPage();

    expect(await screen.findByText('No partner is recorded')).toBeVisible();
  });

  it('sends a status change as a patch of the register', async () => {
    vi.stubGlobal('fetch', respond());

    renderDetailPage();
    await screen.findByRole('heading', { name: 'Placeholder document' });

    fireEvent.click(screen.getByRole('button', { name: 'Mark verified' }));

    await waitFor(() => {
      expect(patched.body).toEqual({ status: 'verified' });
    });
  });

  it('takes the new status from the patch answer without reading the document again', async () => {
    const fetchMock = respond();
    vi.stubGlobal('fetch', fetchMock);

    renderDetailPage();
    await screen.findByRole('heading', { name: 'Placeholder document' });
    const readsBefore = fetchMock.mock.calls.filter(
      (call) => call[1] === undefined || call[1].method === undefined,
    ).length;

    fireEvent.click(screen.getByRole('button', { name: 'Mark verified' }));

    expect(await screen.findByText('Verified')).toBeVisible();
    expect(
      fetchMock.mock.calls.filter(
        (call) => call[1] === undefined || call[1].method === undefined,
      ).length,
    ).toBe(readsBefore);
  });

  it('drops a removed link from the list it already holds', async () => {
    vi.stubGlobal('fetch', respond({ links: [link] }));

    renderDetailPage();
    await screen.findByRole('heading', { name: 'Placeholder document' });

    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));

    expect(await screen.findByText('No linked documents.')).toBeVisible();
  });

  it('reports a failed link on its own terms, not as a status failure', async () => {
    vi.stubGlobal('fetch', respond({ linkStatus: 404, links: [link] }));

    renderDetailPage();
    await screen.findByRole('heading', { name: 'Placeholder document' });

    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));

    expect(
      await screen.findByText('The link could not be saved.'),
    ).toBeVisible();
    expect(screen.queryByText('The status could not be updated.')).toBeNull();
  });

  it('hides every manage action from an account without the capability', async () => {
    vi.stubGlobal('fetch', respond({ manageDocuments: false }));

    renderDetailPage();
    await screen.findByRole('heading', { name: 'Placeholder document' });

    expect(screen.queryByRole('button', { name: 'Mark verified' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add link' })).toBeNull();
    expect(screen.queryByLabelText('Relationship')).toBeNull();
  });
});
