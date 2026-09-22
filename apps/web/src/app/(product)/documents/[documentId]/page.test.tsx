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
const ADVANCE_LINE_ID = '00000000-0000-4000-8000-000000000021';
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
        activityCode: 'month-01',
        amount: '1000.0000',
        description: 'Placeholder line',
        effectiveDate: '2026-01-31',
        invoiceLineId: INVOICE_LINE_ID,
        lineNo: 1,
        partnerId: null,
        side: 'debit',
      },
      {
        accountCode: '343',
        accountName: 'Value added tax',
        activityCode: 'month-01',
        amount: '210.0000',
        description: 'Placeholder line',
        effectiveDate: '2026-01-31',
        invoiceLineId: INVOICE_LINE_ID,
        lineNo: 2,
        partnerId: null,
        side: 'debit',
      },
      {
        accountCode: '321',
        accountName: 'Trade payables',
        activityCode: null,
        amount: '1210.0000',
        description: 'Placeholder line',
        effectiveDate: '2026-01-31',
        invoiceLineId: INVOICE_LINE_ID,
        lineNo: 3,
        partnerId: PARTNER_ID,
        side: 'credit',
      },
    ],
    ruleSetVersion: 'cz-default-2026-09',
  },
  invoice: {
    advanceTotal: '605.0000',
    amountDue: '605.2000',
    baseTotal: '1000.0000',
    dueDate: '2026-09-15',
    fxRate: null,
    grossTotal: '1210.0000',
    lines: [
      {
        activityCode: 'month-01',
        baseAmount: '1000.0000',
        category: 'services',
        description: 'Placeholder line',
        id: INVOICE_LINE_ID,
        lineKind: 'item',
        lineNo: 1,
        periodEnd: '2026-01-31',
        periodStart: '2026-01-01',
        quantity: null,
        sourceAccountCode: null,
        taxPointDate: '2026-01-31',
        unit: null,
        unitPrice: null,
        vatAmount: '210.0000',
        vatMode: 'standard',
        vatRate: '21.00',
      },
      {
        activityCode: null,
        baseAmount: '500.0000',
        category: null,
        description: 'Advance deducted',
        id: ADVANCE_LINE_ID,
        lineKind: 'advance_deduction',
        lineNo: 2,
        periodEnd: null,
        periodStart: null,
        quantity: null,
        sourceAccountCode: null,
        taxPointDate: null,
        unit: null,
        unitPrice: null,
        vatAmount: '105.0000',
        vatMode: 'standard',
        vatRate: '21.00',
      },
    ],
    receivedDate: null,
    roundingAmount: '0.2000',
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
  files: [],
  inboxItems: [],
  links: [],
  supersededByDocumentId: null,
  supersedesDocumentId: null,
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
  extra?: Record<string, unknown>;
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
      return Response.json({
        ...detail,
        links: options.links ?? [],
        ...(options.extra ?? {}),
      });
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

  it('shows the kind, the period, the tax point and the activity on every line', async () => {
    vi.stubGlobal('fetch', respond());

    renderDetailPage();
    await screen.findByRole('heading', { name: 'Placeholder document' });

    const invoiceTable = screen.getByRole('table', { name: 'Invoice lines' });
    expect(within(invoiceTable).getByText('Supply')).toBeVisible();
    expect(within(invoiceTable).getByText('Advance deduction')).toBeVisible();
    expect(
      within(invoiceTable).getByText('2026-01-01 to 2026-01-31'),
    ).toBeVisible();
    expect(within(invoiceTable).getAllByText('2026-01-31')).toHaveLength(1);
    expect(within(invoiceTable).getAllByText('month-01')).toHaveLength(1);
  });

  it('shows the rounding, the deducted advance and the amount due beside the gross', async () => {
    vi.stubGlobal('fetch', respond());

    renderDetailPage();
    await screen.findByRole('heading', { name: 'Placeholder document' });

    const totals = screen.getByLabelText('Invoice totals');
    expect(within(totals).getByText('CZK 1,210.00')).toBeVisible();
    expect(within(totals).getByText('CZK 0.20')).toBeVisible();
    expect(within(totals).getByText('CZK 605.00')).toBeVisible();
    expect(within(totals).getByText('CZK 605.20')).toBeVisible();
  });

  it('shows the effective date and the activity on every event line', async () => {
    vi.stubGlobal('fetch', respond());

    renderDetailPage();
    await screen.findByRole('heading', { name: 'Placeholder document' });

    const eventTable = screen.getByRole('table', { name: 'Economic event' });
    expect(within(eventTable).getAllByText('2026-01-31')).toHaveLength(3);
    expect(within(eventTable).getAllByText('month-01')).toHaveLength(2);
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

  it('lists the original files with their download links and the source items', async () => {
    const BLOB_ID = '00000000-0000-4000-8000-000000000070';
    const ITEM_ID = '00000000-0000-4000-8000-000000000071';
    vi.stubGlobal(
      'fetch',
      respond({
        extra: {
          files: [
            {
              blobId: BLOB_ID,
              byteSize: 3,
              filename: 'scan.pdf',
              mediaType: 'application/pdf',
              position: 1,
            },
            {
              blobId: OTHER_DOCUMENT_ID,
              byteSize: 3,
              filename: null,
              mediaType: 'application/pdf',
              position: 2,
            },
          ],
          inboxItems: [
            {
              channelKind: 'upload',
              id: ITEM_ID,
              receivedAt: '2026-09-02T00:00:00.000Z',
              status: 'routed',
            },
          ],
        },
      }),
    );

    renderDetailPage();

    expect(
      await screen.findByRole('link', { name: 'scan.pdf' }),
    ).toHaveAttribute(
      'href',
      `/api/bff/application/organizations/organization_1/inbox/blobs/${BLOB_ID}/download`,
    );
    expect(screen.getByRole('link', { name: 'File 2' })).toHaveAttribute(
      'href',
      `/api/bff/application/organizations/organization_1/inbox/blobs/${OTHER_DOCUMENT_ID}/download`,
    );
    expect(screen.getByRole('link', { name: ITEM_ID })).toHaveAttribute(
      'href',
      `/inbox/${ITEM_ID}?organization=organization-1`,
    );
  });

  it('says so when no original file is stored', async () => {
    vi.stubGlobal('fetch', respond());

    renderDetailPage();

    expect(
      await screen.findByText('No original file is stored for this document.'),
    ).toBeVisible();
  });

  it('shows the version banner as text and links to the related versions', async () => {
    vi.stubGlobal(
      'fetch',
      respond({
        extra: {
          supersededByDocumentId: LINK_ID,
          supersedesDocumentId: OTHER_DOCUMENT_ID,
        },
      }),
    );

    renderDetailPage();

    expect(await screen.findByText('Version history')).toBeVisible();
    expect(
      screen.getByRole('link', {
        name: 'This document replaces an earlier version',
      }),
    ).toHaveAttribute(
      'href',
      `/api/bff/application/organizations/organization_1/documents/${OTHER_DOCUMENT_ID}`,
    );
    expect(
      screen.getByRole('link', {
        name: 'A newer version replaces this document',
      }),
    ).toHaveAttribute(
      'href',
      `/api/bff/application/organizations/organization_1/documents/${LINK_ID}`,
    );
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
