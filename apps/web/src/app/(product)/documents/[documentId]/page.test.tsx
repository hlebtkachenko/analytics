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

// jsdom ships no matchMedia, which Carbon Tabs and the DataGrid read on mount.
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

import { ToastProvider } from '../../../../components/shell/toast';
import { formatDate, formatMoney } from '../../../../lib/format.ts';
import { I18nProvider } from '../../../../i18n/client-provider';
import DocumentDetailPage from './page';

const LEGAL_ENTITY_ID = '9b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21';
const PARTNER_ID = '4c2f8b11-8c35-4a2e-9f61-1de2f0a7c934';
const INVOICE_LINE_ID = '00000000-0000-4000-8000-000000000020';
const ADVANCE_LINE_ID = '00000000-0000-4000-8000-000000000021';
const EVENT_ID = '00000000-0000-4000-8000-000000000030';
const ISSUE_ID = '00000000-0000-4000-8000-000000000040';
const LINK_ID = '00000000-0000-4000-8000-000000000050';
const OTHER_DOCUMENT_ID = '00000000-0000-4000-8000-000000000060';
const CANDIDATE_ID = '00000000-0000-4000-8000-000000000099';

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
        description: 'Supplied services',
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

const link = {
  createdAt: '2026-09-02T00:00:00.000Z',
  fromDocumentId: DOCUMENT_ID,
  id: LINK_ID,
  kind: 'relates',
  toDocumentId: OTHER_DOCUMENT_ID,
};

const candidate = {
  ...detail.document,
  id: CANDIDATE_ID,
  reference: 'REF-2',
  title: 'Another document',
};

const patched: { body?: unknown } = {};
const linked: { body?: unknown } = {};

// The capabilities the access contract always carries, tuned per test.
function capabilities(manageDocuments: boolean) {
  return {
    createEntities: false,
    deleteEntities: false,
    manageDocuments,
    manageHr: false,
    managePayroll: false,
    manageSensitiveHr: false,
    manageEntityAccess: false,
    manageMembers: false,
    manageOrganization: false,
    readDocuments: true,
    readHr: false,
    readPayroll: false,
    readSensitiveHr: false,
    updateEntities: false,
    uploadData: false,
    useAi: false,
    approvePayroll: false,
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
      if (init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }
      linked.body = JSON.parse(String(init?.body));
      return Response.json(link, { status });
    }

    // The link picker searches the documents list before it opens the detail.
    if (input.includes('/documents?')) {
      return Response.json({
        counts: {
          all: 1,
          archived: 0,
          needsReview: 0,
          verified: 0,
          withIssues: 0,
        },
        documents: [candidate],
        page: 1,
        pageSize: 25,
        total: 1,
        totalsByCurrency: [],
      });
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

async function openTab(name: string): Promise<void> {
  renderDetailPage();
  await screen.findByRole('heading', { name: 'Placeholder document' });
  fireEvent.click(screen.getByRole('tab', { name }));
}

// The DOM normalizer turns Carbon's no-break space into a plain space, so matchers must too.
function czk(amount: string): string {
  return formatMoney(amount, 'CZK').replace(/ /g, ' ');
}

// Portaled overflow items are hidden in jsdom, so they are found by option-content class.
async function menuText(name: string) {
  return screen.findByText(name, {
    selector: '.cds--overflow-menu-options__option-content',
  });
}

async function clickMenuItem(trigger: string, name: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: trigger }));
  fireEvent.click(await menuText(name));
}

afterEach(() => {
  cleanup();
  delete patched.body;
  delete linked.body;
  vi.unstubAllGlobals();
});

describe('DocumentDetailPage', () => {
  it('titles the register with its meta line and status tags', async () => {
    vi.stubGlobal(
      'fetch',
      respond({ extra: { document: { ...detail.document, version: 2 } } }),
    );

    renderDetailPage();

    expect(
      await screen.findByRole('heading', { name: 'Placeholder document' }),
    ).toBeVisible();
    const meta = [
      'Received invoice',
      'REF-1',
      formatDate('2026-09-01'),
      'Placeholder Supplier',
    ].join(' · ');
    expect(screen.getByText(meta)).toBeVisible();
    // The status word rides both the header tag and the summary Status pair.
    expect(screen.getAllByText('Registered').length).toBeGreaterThan(0);
    expect(screen.getByText('Version 2')).toBeVisible();
  });

  it('offers Mark verified for a registered document and Archive for a verified one', async () => {
    vi.stubGlobal('fetch', respond());
    renderDetailPage();
    await screen.findByRole('heading', { name: 'Placeholder document' });
    expect(screen.getByRole('button', { name: 'Mark verified' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
    cleanup();

    vi.stubGlobal(
      'fetch',
      respond({
        extra: { document: { ...detail.document, status: 'verified' } },
      }),
    );
    renderDetailPage();
    await screen.findByRole('heading', { name: 'Placeholder document' });
    expect(screen.getByRole('button', { name: 'Archive' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Mark verified' })).toBeNull();
  });

  it('leaves an archived document without a primary status button', async () => {
    vi.stubGlobal(
      'fetch',
      respond({
        extra: { document: { ...detail.document, status: 'archived' } },
      }),
    );
    renderDetailPage();
    await screen.findByRole('heading', { name: 'Placeholder document' });

    expect(screen.queryByRole('button', { name: 'Mark verified' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(await menuText('Mark verified')).toBeInTheDocument();
  });

  it('sends a status change from the overflow menu as a patch of the register', async () => {
    vi.stubGlobal('fetch', respond());
    renderDetailPage();
    await screen.findByRole('heading', { name: 'Placeholder document' });

    await clickMenuItem('More actions', 'Needs review');

    await waitFor(() => {
      expect(patched.body).toEqual({ status: 'needs_review' });
    });
  });

  it('links a document through the modal picker', async () => {
    vi.stubGlobal('fetch', respond());
    renderDetailPage();
    await screen.findByRole('heading', { name: 'Placeholder document' });

    await clickMenuItem('More actions', 'Link a document');

    const dialog = await screen.findByRole('dialog', {
      name: 'Link a document',
    });
    fireEvent.change(within(dialog).getByLabelText('Relationship'), {
      target: { value: 'settles' },
    });
    fireEvent.change(
      within(dialog).getByRole('combobox', { name: 'Document identifier' }),
      { target: { value: 'Another' } },
    );
    fireEvent.click(
      await screen.findByRole('option', { name: 'Another document' }),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add link' }));

    await waitFor(() => {
      expect(linked.body).toEqual({
        kind: 'settles',
        toDocumentId: CANDIDATE_ID,
      });
    });
  });

  it('shows the tabs with their counts', async () => {
    vi.stubGlobal('fetch', respond());
    renderDetailPage();
    await screen.findByRole('heading', { name: 'Placeholder document' });

    expect(screen.getByRole('tab', { name: 'Original' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Lines (2)' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Event' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Links (0)' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Activity' })).toBeVisible();
  });

  it('opens an invoice on its Lines tab', async () => {
    vi.stubGlobal('fetch', respond());
    renderDetailPage();
    await screen.findByRole('heading', { name: 'Placeholder document' });

    expect(screen.getByRole('table', { name: 'Invoice lines' })).toBeVisible();
  });

  it('lays out the summary pairs with an honest issue count', async () => {
    vi.stubGlobal('fetch', respond());
    renderDetailPage();
    await screen.findByRole('heading', { name: 'Placeholder document' });

    // The Source pair reads its label, never the raw code.
    expect(screen.getByText('Manual')).toBeVisible();
    // The Issues pair carries a red count tag when issues are open.
    expect(screen.getByText('1 open')).toBeVisible();
    cleanup();

    vi.stubGlobal(
      'fetch',
      respond({
        extra: { document: { ...detail.document, openIssueCount: 0 } },
      }),
    );
    renderDetailPage();
    expect(await screen.findByText('No open issues')).toBeVisible();
  });

  it('lists each open issue as a sentence, and none when there are none', async () => {
    vi.stubGlobal(
      'fetch',
      respond({
        extra: {
          document: { ...detail.document, openIssueCount: 2 },
          issues: [
            {
              code: 'missing_partner',
              createdAt: '2026-09-02T00:00:00.000Z',
              detail: null,
              id: ISSUE_ID,
              resolvedAt: null,
              severity: 'warning',
            },
            {
              code: 'total_mismatch',
              createdAt: '2026-09-02T00:00:00.000Z',
              detail: null,
              id: '00000000-0000-4000-8000-000000000041',
              resolvedAt: null,
              severity: 'error',
            },
          ],
        },
      }),
    );
    renderDetailPage();
    await screen.findByRole('heading', { name: 'Placeholder document' });

    expect(screen.getByText('No partner is recorded')).toBeVisible();
    expect(
      screen.getByText('Line totals disagree with the invoice totals'),
    ).toBeVisible();
    cleanup();

    vi.stubGlobal(
      'fetch',
      respond({
        extra: {
          document: { ...detail.document, openIssueCount: 0 },
          issues: [],
        },
      }),
    );
    renderDetailPage();
    expect(await screen.findByText('No open issues')).toBeVisible();
    expect(screen.queryByText('No partner is recorded')).toBeNull();
  });

  it('marks the advance and rounding rows and totals the amount due', async () => {
    vi.stubGlobal('fetch', respond());
    await openTab('Lines (2)');

    const table = screen.getByRole('table', { name: 'Invoice lines' });
    expect(within(table).getByText('Supplied services')).toBeVisible();
    expect(within(table).getByText('Advance deduction')).toBeVisible();
    expect(within(table).getByText('Rounding')).toBeVisible();
    expect(within(table).getByText(czk('0.2000'))).toBeVisible();
    // The deduction reads negative, so 1210 - 605 + 0.20 sums to the amount due row.
    expect(within(table).getByText(czk('1210.0000'))).toBeVisible();
    expect(within(table).getByText(czk('-105.0000'))).toBeVisible();
    expect(within(table).getByText(czk('-605.0000'))).toBeVisible();
    expect(within(table).getByText('Amount due')).toBeVisible();
    expect(within(table).getByText(czk('605.2000'))).toBeVisible();
  });

  it('opens a linked document on its page, never on the API path', async () => {
    vi.stubGlobal('fetch', respond({ links: [link] }));
    await openTab('Links (1)');

    const table = screen.getByRole('table', { name: 'Linked documents' });
    expect(
      within(table).getByRole('link', { name: 'Open document' }),
    ).toHaveAttribute(
      'href',
      `/documents/${OTHER_DOCUMENT_ID}?organization=organization-1`,
    );
  });

  it('shows the derived double entry with its balance', async () => {
    vi.stubGlobal('fetch', respond());
    await openTab('Event');

    const table = screen.getByRole('table', { name: 'Economic event' });
    expect(within(table).getByText('518 Other services')).toBeVisible();
    expect(within(table).getByText('Balance')).toBeVisible();
    expect(within(table).getAllByText(czk('1210.0000')).length).toBeGreaterThan(
      0,
    );
  });

  it('narrates the activity newest first with the inbox and version links', async () => {
    const ITEM_ID = '00000000-0000-4000-8000-000000000071';
    vi.stubGlobal(
      'fetch',
      respond({
        extra: {
          inboxItems: [
            {
              channelKind: 'upload',
              id: ITEM_ID,
              receivedAt: '2026-09-02T00:00:00.000Z',
              status: 'routed',
            },
          ],
          supersededByDocumentId: LINK_ID,
          supersedesDocumentId: OTHER_DOCUMENT_ID,
        },
      }),
    );
    await openTab('Activity');

    const activity = screen.getByRole('list', { name: 'Activity' });
    expect(
      within(activity).getByText(
        `Registered on ${formatDate('2026-09-01T00:00:00.000Z')}`,
      ),
    ).toBeVisible();
    expect(
      within(activity).getByRole('link', {
        name: `Filed from the inbox ${formatDate('2026-09-02T00:00:00.000Z')}`,
      }),
    ).toHaveAttribute('href', `/inbox/${ITEM_ID}?organization=organization-1`);
    expect(
      within(activity).getByRole('link', {
        name: 'This document replaces an earlier version',
      }),
    ).toHaveAttribute(
      'href',
      `/documents/${OTHER_DOCUMENT_ID}?organization=organization-1`,
    );
    expect(
      within(activity).getByRole('link', {
        name: 'A newer version replaces this document',
      }),
    ).toHaveAttribute(
      'href',
      `/documents/${LINK_ID}?organization=organization-1`,
    );
  });

  it('lists the original files with a Download link and the inbox back link', async () => {
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

    await openTab('Original');

    const originals = await screen.findByRole('list', { name: 'Original' });
    expect(within(originals).getByText('scan.pdf')).toBeVisible();
    expect(
      within(originals).getByRole('link', { name: 'Download scan.pdf' }),
    ).toHaveAttribute(
      'href',
      `/api/bff/application/organizations/organization_1/inbox/blobs/${BLOB_ID}/download`,
    );
    expect(
      screen.getByRole('link', {
        name: `Filed from the inbox ${formatDate('2026-09-02T00:00:00.000Z')}`,
      }),
    ).toHaveAttribute('href', `/inbox/${ITEM_ID}?organization=organization-1`);
  });

  it('says so when no original file is stored', async () => {
    vi.stubGlobal('fetch', respond());
    await openTab('Original');

    expect(
      await screen.findByText('No original file is stored for this document.'),
    ).toBeVisible();
  });

  it('drops a removed link from the list it already holds', async () => {
    vi.stubGlobal('fetch', respond({ links: [link] }));
    await openTab('Links (1)');

    const rows = screen.getAllByRole('row');
    fireEvent.click(
      within(rows[rows.length - 1] as HTMLElement).getByRole('button'),
    );
    fireEvent.click(screen.getByText('Remove link'));

    expect(await screen.findByText('No linked documents.')).toBeVisible();
  });

  it('reports a failed link on its own terms, not as a status failure', async () => {
    vi.stubGlobal('fetch', respond({ linkStatus: 404, links: [link] }));
    await openTab('Links (1)');

    const rows = screen.getAllByRole('row');
    fireEvent.click(
      within(rows[rows.length - 1] as HTMLElement).getByRole('button'),
    );
    fireEvent.click(screen.getByText('Remove link'));

    expect(
      await screen.findByText('The link could not be saved.'),
    ).toBeVisible();
    expect(screen.queryByText('The status could not be updated.')).toBeNull();
  });

  it('takes the new status from the patch answer without reading the document again', async () => {
    const fetchMock = respond();
    vi.stubGlobal('fetch', fetchMock);
    renderDetailPage();
    await screen.findByRole('heading', { name: 'Placeholder document' });
    const reads = () =>
      fetchMock.mock.calls.filter(
        (call) => call[1] === undefined || call[1].method === undefined,
      ).length;
    const readsBefore = reads();

    fireEvent.click(screen.getByRole('button', { name: 'Mark verified' }));

    // The patch answer flips the primary from Mark verified to Archive.
    expect(
      await screen.findByRole('button', { name: 'Archive' }),
    ).toBeVisible();
    expect(screen.getAllByText('Verified').length).toBeGreaterThan(0);
    expect(reads()).toBe(readsBefore);
  });

  it('hides every manage action from an account without the capability', async () => {
    vi.stubGlobal('fetch', respond({ manageDocuments: false }));
    renderDetailPage();
    await screen.findByRole('heading', { name: 'Placeholder document' });

    expect(screen.queryByRole('button', { name: 'Mark verified' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Link a document' }),
    ).toBeNull();
  });

  it('shows no raw identifier or timestamp anywhere on the page', async () => {
    vi.stubGlobal('fetch', respond());
    renderDetailPage();
    await screen.findByRole('heading', { name: 'Placeholder document' });

    expect(screen.queryByText(DOCUMENT_ID)).toBeNull();
    expect(screen.queryByText(EVENT_ID)).toBeNull();
    expect(screen.queryByText(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)).toBeNull();
  });
});
