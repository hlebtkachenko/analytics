import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ITEM_ID = '00000000-0000-4000-8000-000000000050';
const EARLIER_ITEM_ID = '00000000-0000-4000-8000-000000000051';
const NEXT_ITEM_ID = '00000000-0000-4000-8000-000000000052';

const push = vi.fn();

// Carbon Tabs read matchMedia on mount, which jsdom does not implement.
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

vi.mock('next/navigation', () => ({
  useParams: () => ({ itemId: ITEM_ID }),
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams('tab=toReview'),
}));

import { ToastProvider } from '../../../../components/shell/toast';
import { I18nProvider } from '../../../../i18n/client-provider';
import InboxItemPage from './page';

const LEGAL_ENTITY_ID = '9b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21';
const BLOB_ID = '00000000-0000-4000-8000-000000000060';
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

const members = {
  members: [
    { email: 'alice@bap.invalid', id: 'user_1', name: 'Alice Owner' },
    { email: 'bob@bap.invalid', id: 'user_2', name: 'Bob Reviewer' },
  ],
};

const inboxItem = {
  assigneeId: null,
  channelId: null,
  channelKind: 'upload',
  confidence: 0.75,
  createdAt: '2026-09-16T08:00:00.000Z',
  datasetId: null,
  decidedByKind: 'provider',
  decidedByRuleId: null,
  decidedByRuleName: null,
  decidedByUserId: null,
  detectedType: 'pdf',
  documentId: null,
  duplicateOfItemId: null,
  hintKind: null,
  hintLegalEntityId: null,
  hintLinkDocumentId: null,
  hintPartnerId: null,
  hintText: null,
  humanTouched: false,
  id: ITEM_ID,
  legalEntityId: null,
  origin: null,
  partnerId: null,
  payloadKind: 'file',
  receivedAt: '2026-09-16T08:00:00.000Z',
  routedAt: null,
  sender: null,
  snoozedUntil: null,
  status: 'needs_review',
  updatedAt: '2026-09-16T08:00:00.000Z',
};

function file(mediaType: string, scanStatus = 'clean') {
  return {
    blobId: BLOB_ID,
    byteSize: 3,
    mediaType,
    originalFilename: 'placeholder.pdf',
    position: 1,
    scanStatus,
    sha256: 'a'.repeat(64),
  };
}

// A complete draft: only the partner is missing, so the needs-input panel names one thing.
const extraction = {
  confidence: 0.75,
  createdAt: '2026-09-16T08:01:00.000Z',
  detectedType: 'pdf',
  draft: {
    currencyCode: 'CZK',
    documentDate: '2026-09-01',
    kind: 'contract',
    legalEntityId: LEGAL_ENTITY_ID,
    notes: 'Passed through untouched',
    reference: 'REF-9',
    title: 'Placeholder contract',
  },
  fieldConfidences: { title: 0.5 },
  id: '00000000-0000-4000-8000-000000000070',
  issues: [
    {
      code: 'missing_required_field',
      field: 'partnerId',
      message: 'a partner',
    },
  ],
  legalEntityId: null,
  provider: 'sniff',
  providerVersion: '1',
  reasons: [{ evidence: 'a PDF header', step: 'sniff', weight: 0.9 }],
};

const routingTarget = {
  auto: 'never',
  autoThreshold: null,
  defaultAssigneeId: null,
  defaultLegalEntityId: null,
  destination: 'documents',
  detectedType: 'pdf',
  documentKind: 'receipt',
  partnerPolicy: 'match_only',
  requiredFields: [],
  source: 'platform',
};

function capabilities(manageDocuments: boolean) {
  return {
    createEntities: false,
    deleteEntities: false,
    manageDocuments,
    manageHr: false,
    managePayroll: false,
    manageSensitiveHr: false,
    readHr: false,
    readPayroll: false,
    readSensitiveHr: false,
    approvePayroll: false,
    manageEntityAccess: false,
    manageMembers: false,
    manageOrganization: false,
    readDocuments: true,
    updateEntities: false,
    uploadData: false,
    useAi: false,
  };
}

function listEntry(overrides: Record<string, unknown> = {}) {
  return {
    ...inboxItem,
    decidedByRuleName: null,
    fileCount: 1,
    primaryFilename: 'placeholder.pdf',
    sender: null,
    senderAuthenticated: false,
    ...overrides,
  };
}

const listResponse = {
  counts: { all: 3, discarded: 0, filed: 0, toReview: 3 },
  items: [
    listEntry({ id: EARLIER_ITEM_ID }),
    listEntry(),
    listEntry({ id: NEXT_ITEM_ID }),
  ],
  page: 1,
  pageSize: 100,
  total: 3,
};

const documentSummary = {
  createdAt: '2026-09-01T00:00:00.000Z',
  currencyCode: 'CZK',
  documentDate: '2026-09-01',
  hasEvent: false,
  id: DOCUMENT_ID,
  isBalanced: null,
  isCurrent: true,
  kind: 'contract',
  legalEntityId: LEGAL_ENTITY_ID,
  openIssueCount: 0,
  partnerId: null,
  partnerName: null,
  reference: 'REF-9',
  source: 'manual',
  status: 'registered',
  title: 'Placeholder contract',
  totalAmount: null,
  updatedAt: '2026-09-01T00:00:00.000Z',
  validFrom: null,
  validTo: null,
  version: 1,
};

const PARTNER_ID = '00000000-0000-4000-8000-000000000080';
const PARSED_ID = '00000000-0000-4000-8000-000000000071';
const CREATED_PARTNER_ID = '00000000-0000-4000-8000-000000000081';

// A parsed ISDOC row: one supply line, one deducted advance and a rounding, all synthetic.
const parsedRow = {
  confidence: 1,
  createdAt: '2026-09-16T08:02:00.000Z',
  detectedType: 'isdoc_invoice',
  draft: {
    attributes: { isdoc_document_type: '1' },
    currencyCode: 'CZK',
    documentDate: '2026-09-01',
    invoice: {
      dueDate: '2026-09-15',
      lines: [
        {
          baseAmount: '1000.00',
          description: 'Placeholder service',
          lineKind: 'item',
          quantity: '2',
          unit: 'h',
          unitPrice: '500.00',
          vatAmount: '210.00',
          vatMode: 'standard',
          vatRate: '21',
        },
        {
          baseAmount: '100.00',
          description: 'Advance ADV-1',
          lineKind: 'advance_deduction',
          vatAmount: '21.00',
          vatMode: 'standard',
          vatRate: '21',
        },
      ],
      roundingAmount: '0.40',
      taxPointDate: '2026-09-01',
      variableSymbol: '20260001',
    },
    kind: 'received_invoice',
    legalEntityId: LEGAL_ENTITY_ID,
    partnerId: PARTNER_ID,
    reference: 'FV-1',
    title: 'Placeholder Supplier FV-1',
    totalAmount: '1210.00',
  },
  fieldConfidences: {},
  id: PARSED_ID,
  issues: [] as { code: string; field?: string; message: string }[],
  legalEntityId: LEGAL_ENTITY_ID,
  provider: 'isdoc',
  providerVersion: '1',
  reasons: [
    {
      evidence: 'The counterparty matches a partner.',
      step: 'parse',
      weight: 1,
    },
  ],
};

function partner(defaultLineCategory: string | null, id = PARTNER_ID) {
  return {
    countryCode: 'CZ',
    createdAt: '2026-09-01T00:00:00.000Z',
    defaultLineCategory,
    id,
    legalEntityId: null,
    name: 'Placeholder Supplier',
    registrationNumber: '00000000',
    updatedAt: '2026-09-01T00:00:00.000Z',
    vatNumber: null,
  };
}

// The item router with a stored partner list; a PATCH saves the category it was sent, as the API would.
function respondWithParsed(
  stored: ReturnType<typeof partner>[],
  given: Record<string, unknown> = {},
  manageDocuments = true,
) {
  const base = respondWith(
    {
      events: [],
      extraction: parsedRow,
      files: [file('application/pdf')],
      item: inboxItem,
      parsed: parsedRow,
      ...given,
    },
    manageDocuments,
  );
  let partners = stored;
  return vi.fn(async (input: string, init?: RequestInit) => {
    if (input.includes('/partners')) {
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body));
        partners = [partner(body.defaultLineCategory)];
        return Response.json(partners[0]);
      }
      if (init?.method === 'POST') {
        return Response.json(partner(null, CREATED_PARTNER_ID));
      }
      return Response.json({ partners });
    }
    return base(input, init);
  });
}

type RouteAnswers = Readonly<{ conflicts?: unknown[]; inlineText?: string }>;

// One router per test, so every request is answered by the shape its route promises.
function respondWith(
  given: Record<string, unknown>,
  manageDocuments = true,
  answers: RouteAnswers = {},
) {
  const conflicts = [...(answers.conflicts ?? [])];
  const draft =
    (given['extraction'] as { draft?: Record<string, unknown> } | undefined)
      ?.draft ?? {};
  // The detail item always carries the sender's DKIM verdict; the list entries never do.
  const detail: Record<string, unknown> = {
    corrections: [],
    parsed: null,
    routeSuggestion: {
      kind: draft['kind'] ?? routingTarget.documentKind,
      legalEntityId: draft['legalEntityId'] ?? LEGAL_ENTITY_ID,
      partnerId: draft['partnerId'] ?? null,
    },
    routingTarget,
    ...given,
    item: { senderAuthenticated: false, ...(given['item'] as object) },
  };
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
        capabilities: capabilities(manageDocuments),
        organizationId: 'organization_1',
      });
    }
    if (input.endsWith('/legal-entities')) {
      return Response.json(legalEntities);
    }
    if (input.endsWith('/members')) {
      return Response.json(members);
    }
    if (input.includes('/partners')) {
      return Response.json({ partners: [] });
    }
    if (input.includes('/inbox/items?')) {
      return Response.json(listResponse);
    }
    if (input.includes('/documents?')) {
      return Response.json({
        counts: {
          all: 1,
          archived: 0,
          needsReview: 0,
          verified: 0,
          withIssues: 0,
        },
        documents: [documentSummary],
        page: 1,
        pageSize: 25,
        total: 1,
        totalsByCurrency: [],
      });
    }
    // The text preview reads the download route, since inline serves only pdf and images.
    if (input.endsWith('/download')) {
      return new Response(answers.inlineText ?? '');
    }
    if (input.endsWith(`/inbox/items/${ITEM_ID}/route/document`)) {
      const conflict = conflicts.shift();
      if (conflict !== undefined) {
        return Response.json(conflict, { status: 409 });
      }
      return Response.json({
        ...detail,
        item: {
          ...(detail['item'] as object),
          documentId: DOCUMENT_ID,
          status: 'routed',
        },
      });
    }
    if (
      input.endsWith(`/inbox/items/${ITEM_ID}`) &&
      init?.method === undefined
    ) {
      return Response.json(detail);
    }
    if (input.includes(`/inbox/items/${ITEM_ID}/`)) {
      return Response.json(detail);
    }
    return new Response(null, { status: 404 });
  });
}

function routeBodies(fetchMock: ReturnType<typeof respondWith>) {
  return fetchMock.mock.calls
    .filter((call) => String(call[0]).endsWith('/route/document'))
    .map((call) => JSON.parse(String((call[1] as RequestInit).body)));
}

function actionCall(fetchMock: ReturnType<typeof respondWith>, suffix: string) {
  return fetchMock.mock.calls.find((call) =>
    String(call[0]).endsWith(`/inbox/items/${ITEM_ID}/${suffix}`),
  );
}

function renderItemPage() {
  return render(
    <I18nProvider>
      <ToastProvider>
        <InboxItemPage />
      </ToastProvider>
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  push.mockReset();
  vi.unstubAllGlobals();
});

// Portaled overflow items stay visibility:hidden in jsdom, so queries need hidden.
async function menuItem(name: string) {
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  return await screen.findByText(name, {
    selector: '.cds--overflow-menu-options__option-content',
  });
}

describe('InboxItemPage', () => {
  it('shows the needs-input panel, prefills the draft and files with every blob', async () => {
    const fetchMock = respondWith({
      events: [],
      extraction,
      files: [file('application/pdf')],
      item: inboxItem,
    });
    vi.stubGlobal('fetch', fetchMock);

    renderItemPage();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'placeholder.pdf' }),
    ).toBeVisible();
    expect(screen.getByText('Needs your input')).toBeVisible();
    expect(screen.getByLabelText('Title')).toHaveValue('Placeholder contract');
    expect(screen.getByLabelText('Reference')).toHaveValue('REF-9');

    fireEvent.click(screen.getByRole('button', { name: 'File as document' }));

    await waitFor(() => {
      expect(routeBodies(fetchMock)).toHaveLength(1);
    });
    const body = routeBodies(fetchMock)[0];
    expect(body.fileBlobIds).toEqual([BLOB_ID]);
    expect(body.document).toEqual({
      currencyCode: 'CZK',
      documentDate: '2026-09-01',
      kind: 'contract',
      legalEntityId: LEGAL_ENTITY_ID,
      notes: 'Passed through untouched',
      reference: 'REF-9',
      title: 'Placeholder contract',
    });
  });

  it('shows the ready-to-file panel with the passed checks when nothing is missing', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        events: [],
        extraction: { ...extraction, issues: [] },
        files: [file('application/pdf')],
        item: inboxItem,
      }),
    );

    renderItemPage();

    expect(await screen.findByText('Ready to file')).toBeVisible();
    expect(
      screen.getByText('Goes to Documents as Receipt (platform default)'),
    ).toBeVisible();
    expect(screen.getByText('No earlier copy of this file')).toBeVisible();
  });

  it('shows the filed panel keyed on the rule and the open-document primary once routed', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        events: [],
        extraction,
        files: [file('application/pdf')],
        item: {
          ...inboxItem,
          decidedByKind: 'rule',
          decidedByRuleName: 'Fio statements',
          documentId: DOCUMENT_ID,
          status: 'routed',
        },
      }),
    );

    renderItemPage();

    // An auto-filed item spells out the honest derivation instead of a false "Complete".
    expect(
      await screen.findByText(
        /Rule Fio statements filed it as Contract for Placeholder Holding\./,
      ),
    ).toBeVisible();
    expect(
      screen.getByText('Nothing read the file contents yet.'),
    ).toBeVisible();
    // The sections read "Defaults", not "Complete": nothing but the rule and the file name filled them.
    expect(screen.getAllByText('Defaults').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Complete')).toBeNull();
    expect(screen.getAllByText('Filed').length).toBeGreaterThanOrEqual(1);
    // The panel links to the document by its title, the primary button opens it.
    expect(
      screen.getByRole('link', { name: 'Placeholder contract' }),
    ).toHaveAttribute(
      'href',
      `/documents/${DOCUMENT_ID}?organization=organization-1`,
    );
    expect(screen.getByRole('link', { name: 'Open document' })).toHaveAttribute(
      'href',
      `/documents/${DOCUMENT_ID}?organization=organization-1`,
    );
    expect(await menuItem('Reopen')).toBeInTheDocument();
  });

  it('marks a section Complete once a correction exists', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        corrections: [
          {
            createdAt: '2026-09-16T09:00:00.000Z',
            createdBy: 'user_1',
            field: 'legal_entity_id',
            finalValue: LEGAL_ENTITY_ID,
            id: '00000000-0000-4000-8000-000000000090',
            reason: null,
            source: 'provider',
            suggestedValue: null,
          },
        ],
        events: [],
        extraction: { ...extraction, issues: [] },
        files: [file('application/pdf')],
        item: {
          ...inboxItem,
          decidedByKind: 'rule',
          decidedByRuleName: 'Fio statements',
          documentId: DOCUMENT_ID,
          status: 'routed',
        },
      }),
    );

    renderItemPage();

    await screen.findByRole('heading', { level: 1, name: 'placeholder.pdf' });
    expect(screen.getAllByText('Complete').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Defaults')).toBeNull();
  });

  it('renders no floating tooltip over the heading on load of a routed item', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        events: [],
        extraction,
        files: [file('application/pdf')],
        item: {
          ...inboxItem,
          decidedByKind: 'rule',
          decidedByRuleName: 'Fio statements',
          documentId: DOCUMENT_ID,
          status: 'routed',
        },
      }),
    );

    renderItemPage();

    await screen.findByRole('heading', { level: 1, name: 'placeholder.pdf' });
    // Nothing floats open over the heading on load.
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(document.querySelector('.cds--popover--open')).toBeNull();
    // The Kind control carries its label as title, never its value as a native tooltip.
    expect(screen.getByLabelText('Kind')).toHaveAttribute('title', 'Kind');
    expect(screen.getByLabelText('Legal entity')).toHaveAttribute(
      'title',
      'Legal entity',
    );
  });

  it('shows the discarded panel and a restore primary', async () => {
    const fetchMock = respondWith({
      events: [
        {
          actorUserId: 'user_1',
          createdAt: '2026-09-16T09:00:00.000Z',
          id: '00000000-0000-4000-8000-000000000071',
          kind: 'discarded',
          reason: 'spam',
        },
      ],
      extraction: null,
      files: [file('application/pdf')],
      item: {
        ...inboxItem,
        decidedByKind: 'user',
        decidedByUserId: 'user_1',
        status: 'discarded',
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    renderItemPage();

    expect(
      await screen.findByText('Discarded as Spam by Alice Owner'),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => {
      expect(actionCall(fetchMock, 'restore')).toBeDefined();
    });
  });

  it('handles an invoice kind without parsed content by disabling the primary and offering attach', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        events: [],
        extraction: { ...extraction, draft: { kind: 'received_invoice' } },
        files: [file('application/pdf')],
        item: inboxItem,
      }),
    );

    renderItemPage();

    expect(await screen.findByText('No parsed invoice content')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'File as document' }),
    ).toBeDisabled();
    expect(
      screen.getAllByRole('button', { name: 'Attach to existing document' })
        .length,
    ).toBeGreaterThan(0);
  });

  it('asks why a changed field differs and sends the reason with the route', async () => {
    const fetchMock = respondWith({
      events: [],
      extraction,
      files: [file('application/pdf')],
      item: inboxItem,
    });
    vi.stubGlobal('fetch', fetchMock);

    renderItemPage();

    expect(await screen.findByLabelText('Kind')).toHaveValue('contract');
    fireEvent.change(screen.getByLabelText('Kind'), {
      target: { value: 'agreement' },
    });
    fireEvent.change(screen.getByLabelText('Why did Kind change?'), {
      target: { value: 'It is signed by both sides.' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'File as document' }));

    await waitFor(() => {
      expect(routeBodies(fetchMock)).toHaveLength(1);
    });
    const body = routeBodies(fetchMock)[0];
    expect(body.correctionReasons).toEqual({
      kind: 'It is signed by both sides.',
    });
    expect(body.document.kind).toBe('agreement');
  });

  it('offers to register a new version on a reference conflict and resends with the id', async () => {
    const fetchMock = respondWith(
      {
        events: [],
        extraction,
        files: [file('application/pdf')],
        item: inboxItem,
      },
      true,
      { conflicts: [{ code: 'reference_conflict', documentId: DOCUMENT_ID }] },
    );
    vi.stubGlobal('fetch', fetchMock);

    renderItemPage();
    await screen.findByLabelText('Title');
    fireEvent.click(screen.getByRole('button', { name: 'File as document' }));

    expect(
      await screen.findByText(
        'A current document already carries this reference.',
      ),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', { name: 'Register as new version' }),
    );

    await waitFor(() => {
      expect(routeBodies(fetchMock)).toHaveLength(2);
    });
    const [first, second] = routeBodies(fetchMock);
    expect(first.supersedesDocumentId).toBeUndefined();
    expect(second.supersedesDocumentId).toBe(DOCUMENT_ID);
  });

  it('shows the duplicate dialog with the candidates and routes anyway', async () => {
    const fetchMock = respondWith(
      {
        events: [],
        extraction,
        files: [file('application/pdf')],
        item: inboxItem,
      },
      true,
      {
        conflicts: [
          {
            candidates: [
              {
                documentDate: '2026-09-01',
                id: DOCUMENT_ID,
                reference: 'REF-9',
                totalAmount: '10.0000',
              },
            ],
            code: 'duplicate_probable',
          },
        ],
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    renderItemPage();
    await screen.findByLabelText('Title');
    fireEvent.click(screen.getByRole('button', { name: 'File as document' }));

    const dialog = await screen.findByRole('dialog', {
      name: 'This looks like a duplicate',
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Route anyway' }),
    );

    await waitFor(() => {
      expect(routeBodies(fetchMock)).toHaveLength(2);
    });
    expect(routeBodies(fetchMock)[1].acknowledgeDuplicateOf).toBe(DOCUMENT_ID);
  });

  it('discards from the overflow with a reason', async () => {
    const fetchMock = respondWith({
      events: [],
      extraction,
      files: [file('application/pdf')],
      item: inboxItem,
    });
    vi.stubGlobal('fetch', fetchMock);

    renderItemPage();
    await screen.findByLabelText('Title');
    fireEvent.click(await menuItem('Discard'));

    const dialog = await screen.findByRole('dialog', { name: 'Discard item' });
    fireEvent.change(within(dialog).getByLabelText('Discard reason'), {
      target: { value: 'spam' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));

    await waitFor(() => {
      const call = actionCall(fetchMock, 'discard');
      expect(call).toBeDefined();
      expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({
        reason: 'spam',
      });
    });
  });

  it('assigns from the overflow with the member picker', async () => {
    const fetchMock = respondWith({
      events: [],
      extraction,
      files: [file('application/pdf')],
      item: inboxItem,
    });
    vi.stubGlobal('fetch', fetchMock);

    renderItemPage();
    await screen.findByLabelText('Title');
    fireEvent.click(await menuItem('Assign'));

    const dialog = await screen.findByRole('dialog', { name: 'Assign item' });
    fireEvent.change(within(dialog).getByLabelText('Assignee'), {
      target: { value: 'user_2' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));

    await waitFor(() => {
      const call = actionCall(fetchMock, 'assign');
      expect(call).toBeDefined();
      expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({
        assigneeId: 'user_2',
      });
    });
  });

  it('snoozes from the overflow with a date and time', async () => {
    const fetchMock = respondWith({
      events: [],
      extraction,
      files: [file('application/pdf')],
      item: inboxItem,
    });
    vi.stubGlobal('fetch', fetchMock);

    renderItemPage();
    await screen.findByLabelText('Title');
    fireEvent.click(await menuItem('Snooze'));

    const dialog = await screen.findByRole('dialog', { name: 'Snooze item' });
    fireEvent.change(within(dialog).getByLabelText('Snoozed until'), {
      target: { value: '2026-10-01T09:00' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Snooze' }));

    await waitFor(() => {
      const call = actionCall(fetchMock, 'snooze');
      expect(call).toBeDefined();
      expect(
        JSON.parse(String((call![1] as RequestInit).body)).snoozedUntil,
      ).toContain('2026');
    });
  });

  it('attaches from the overflow to a searched document', async () => {
    const fetchMock = respondWith({
      events: [],
      extraction,
      files: [file('application/pdf')],
      item: inboxItem,
    });
    vi.stubGlobal('fetch', fetchMock);

    renderItemPage();
    await screen.findByLabelText('Title');
    fireEvent.click(await menuItem('Attach to document'));

    const dialog = await screen.findByRole('dialog', {
      name: 'Attach to existing document',
    });
    fireEvent.change(within(dialog).getByRole('combobox'), {
      target: { value: 'Placeholder' },
    });
    fireEvent.click(
      await screen.findByRole('option', { name: 'Placeholder contract' }),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Attach' }));

    await waitFor(() => {
      const call = actionCall(fetchMock, 'attach');
      expect(call).toBeDefined();
      expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({
        documentId: DOCUMENT_ID,
      });
    });
  });

  it('resolves actor names and the rule name in the activity', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        events: [
          {
            actorUserId: null,
            createdAt: '2026-09-16T08:00:00.000Z',
            id: '00000000-0000-4000-8000-000000000081',
            kind: 'rule_matched',
            reason: null,
          },
          {
            actorUserId: 'user_2',
            createdAt: '2026-09-16T09:00:00.000Z',
            id: '00000000-0000-4000-8000-000000000082',
            kind: 'assigned',
            reason: null,
          },
        ],
        extraction: null,
        files: [file('application/pdf')],
        item: {
          ...inboxItem,
          decidedByKind: 'rule',
          decidedByRuleName: 'Fio statements',
        },
      }),
    );

    renderItemPage();

    fireEvent.click(await screen.findByRole('tab', { name: /Activity/ }));
    expect(await screen.findByText('Assigned by Bob Reviewer')).toBeVisible();
    expect(screen.getByText('Rule Fio statements matched')).toBeVisible();
  });

  it('renders read only without manageDocuments', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith(
        {
          events: [],
          extraction,
          files: [file('application/pdf')],
          item: inboxItem,
        },
        false,
      ),
    );

    renderItemPage();

    expect(await screen.findByLabelText('Title')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'File as document' }),
    ).toBeNull();
    // Every edit affordance is hidden read only, including Create partner.
    expect(screen.queryByRole('button', { name: 'Create partner' })).toBeNull();
  });

  it('names the missing document fields in the needs-input panel', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        events: [],
        // A draft with the entity set but no title and no date.
        extraction: {
          ...extraction,
          draft: { legalEntityId: LEGAL_ENTITY_ID },
          issues: [],
        },
        files: [file('application/pdf')],
        item: inboxItem,
      }),
    );

    renderItemPage();

    expect(await screen.findByText('Needs your input')).toBeVisible();
    expect(screen.getByText('Add a title.')).toBeVisible();
    expect(screen.getByText('Add a document date.')).toBeVisible();
  });

  it('shows no raw status, event or issue code anywhere on the page', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        events: [
          {
            actorUserId: 'user_2',
            createdAt: '2026-09-16T09:00:00.000Z',
            id: '00000000-0000-4000-8000-000000000083',
            kind: 'rule_matched',
            reason: null,
          },
        ],
        extraction,
        files: [file('application/pdf')],
        item: inboxItem,
      }),
    );

    renderItemPage();
    await screen.findByLabelText('Title');
    fireEvent.click(screen.getByRole('tab', { name: /Activity/ }));

    expect(screen.queryByText('needs_review')).toBeNull();
    expect(screen.queryByText('missing_required_field')).toBeNull();
    expect(screen.queryByText('rule_matched')).toBeNull();
    expect(screen.queryByText(/2026-09-16T/)).toBeNull();
  });

  it('previews a PDF unsandboxed, an image as an img and offers the download', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        events: [],
        extraction: null,
        files: [file('application/pdf')],
        item: inboxItem,
      }),
    );

    renderItemPage();

    const frame = await screen.findByTitle('File preview');
    expect(frame).not.toHaveAttribute('sandbox');
    expect(
      screen.getByRole('link', { name: 'Download placeholder.pdf' }),
    ).toHaveAttribute(
      'href',
      `/api/bff/application/organizations/organization_1/inbox/blobs/${BLOB_ID}/download`,
    );
  });

  it('previews a text file inline from the download route up to the size limit', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith(
        {
          events: [],
          extraction: null,
          files: [{ ...file('text/csv'), byteSize: 20 }],
          item: inboxItem,
        },
        true,
        { inlineText: 'code,amount\na,1' },
      ),
    );

    renderItemPage();

    expect(
      await screen.findByText('code,amount', { exact: false }),
    ).toBeVisible();
  });

  it('offers the download card for an svg the frame will not render inline', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        events: [],
        extraction: null,
        files: [file('image/svg+xml')],
        item: inboxItem,
      }),
    );

    renderItemPage();

    await screen.findByRole('heading', { level: 1, name: 'placeholder.pdf' });
    // No broken <img> for a type the BFF refuses; the download link stands in.
    expect(
      screen.getByText(
        'This file type does not render inline. Download it instead.',
      ),
    ).toBeVisible();
    expect(document.querySelector('img')).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Download placeholder.pdf' }),
    ).toBeVisible();
  });

  it('shows a scan pending indicator instead of the preview and the download', async () => {
    const otherBlobId = '00000000-0000-4000-8000-000000000061';
    vi.stubGlobal(
      'fetch',
      respondWith({
        events: [],
        extraction: null,
        files: [
          file('application/pdf', 'not_scanned'),
          {
            ...file('application/zip'),
            blobId: otherBlobId,
            originalFilename: 'clean.zip',
            position: 2,
          },
        ],
        item: inboxItem,
      }),
    );

    renderItemPage();

    // Once in the preview pane and once in the file row; the scanned sibling keeps its link.
    expect(await screen.findAllByText('Scan pending')).toHaveLength(2);
    expect(screen.queryByTitle('File preview')).toBeNull();
    expect(
      screen.queryByRole('link', { name: 'Download placeholder.pdf' }),
    ).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Download clean.zip' }),
    ).toBeVisible();
  });

  it('shows whether the sender of an email item was authenticated', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        events: [],
        extraction: null,
        files: [file('application/pdf')],
        item: {
          ...inboxItem,
          sender: 'billing@dodavatel.cz',
          senderAuthenticated: true,
        },
      }),
    );

    const view = renderItemPage();

    expect(await screen.findByText('Sender verified by DKIM')).toBeTruthy();
    expect(screen.queryByText('Sender not verified')).toBeNull();
    view.unmount();

    vi.stubGlobal(
      'fetch',
      respondWith({
        events: [],
        extraction: null,
        files: [file('application/pdf')],
        item: { ...inboxItem, sender: 'billing@dodavatel.cz' },
      }),
    );

    renderItemPage();

    expect(await screen.findByText('Sender not verified')).toBeTruthy();
  });

  it('routes a rule-matched draft and sends none of the rule keys to the document', async () => {
    const fetchMock = respondWith({
      events: [],
      // The rule provider types its matched rules and nulls into the draft next to the document fields.
      extraction: {
        ...extraction,
        draft: {
          ...extraction.draft,
          matchedRuleIds: ['00000000-0000-4000-8000-000000000095'],
          partnerId: null,
        },
        provider: 'rule',
      },
      files: [file('application/pdf')],
      item: inboxItem,
    });
    vi.stubGlobal('fetch', fetchMock);

    renderItemPage();
    await screen.findByLabelText('Title');
    fireEvent.click(screen.getByRole('button', { name: 'File as document' }));

    await waitFor(() => {
      expect(routeBodies(fetchMock)).toHaveLength(1);
    });
    const body = routeBodies(fetchMock)[0];
    expect(body.document).not.toHaveProperty('matchedRuleIds');
    expect(body.document).toEqual({
      currencyCode: 'CZK',
      documentDate: '2026-09-01',
      kind: 'contract',
      legalEntityId: LEGAL_ENTITY_ID,
      notes: 'Passed through untouched',
      reference: 'REF-9',
      title: 'Placeholder contract',
    });
    expect(
      screen.queryByText(
        'The draft is incomplete. Fill in every required field.',
      ),
    ).toBeNull();
  });

  it.each(['infected', 'failed'])(
    'shows a quarantine notice instead of the preview and the download for a %s blob',
    async (scanStatus) => {
      const otherBlobId = '00000000-0000-4000-8000-000000000061';
      const fetchMock = respondWith({
        events: [],
        extraction: null,
        files: [
          file('application/pdf', scanStatus),
          {
            ...file('application/zip'),
            blobId: otherBlobId,
            originalFilename: 'clean.zip',
            position: 2,
          },
        ],
        item: inboxItem,
      });
      vi.stubGlobal('fetch', fetchMock);

      renderItemPage();

      // Once in the preview pane and once in the file row.
      expect(await screen.findAllByText('Quarantined')).toHaveLength(2);
      expect(
        screen.getByText(
          'The virus scan flagged this file or could not complete. It cannot be previewed or downloaded.',
        ),
      ).toBeVisible();
      expect(screen.queryByTitle('File preview')).toBeNull();
      expect(
        screen.queryByRole('link', { name: 'Download placeholder.pdf' }),
      ).toBeNull();
      // The clean sibling keeps its download link; the verdict comes with the detail, so no blob is fetched.
      expect(
        screen.getByRole('link', { name: 'Download clean.zip' }),
      ).toHaveAttribute(
        'href',
        `/api/bff/application/organizations/organization_1/inbox/blobs/${otherBlobId}/download`,
      );
      expect(
        fetchMock.mock.calls.filter(([input]) =>
          String(input).includes('/inbox/blobs/'),
        ),
      ).toHaveLength(0);
    },
  );

  it('lists the corrections in the activity and offers a rule from a routed item', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        corrections: [
          {
            createdAt: '2026-09-16T09:00:00.000Z',
            createdBy: 'user_2',
            field: 'kind',
            finalValue: 'agreement',
            id: '00000000-0000-4000-8000-000000000091',
            reason: 'It is signed by both sides.',
            source: 'provider',
            suggestedValue: 'contract',
          },
          {
            createdAt: '2026-09-16T09:00:00.000Z',
            createdBy: 'user_2',
            field: 'partner_id',
            finalValue: null,
            id: '00000000-0000-4000-8000-000000000092',
            reason: null,
            source: 'hint',
            suggestedValue: '00000000-0000-4000-8000-000000000090',
          },
        ],
        events: [],
        extraction,
        files: [file('application/pdf')],
        item: {
          ...inboxItem,
          assigneeId: 'user_2',
          decidedByKind: 'user',
          documentId: DOCUMENT_ID,
          legalEntityId: LEGAL_ENTITY_ID,
          status: 'routed',
        },
      }),
    );

    renderItemPage();

    fireEvent.click(await screen.findByRole('tab', { name: /Activity/ }));
    const list = await screen.findByRole('list', { name: 'Activity' });
    expect(list).toHaveTextContent(
      'Kind: contract (Provider) changed to agreement It is signed by both sides.',
    );
    expect(list).toHaveTextContent(
      'Partner id: 00000000-0000-4000-8000-000000000090 (Hint) changed to none',
    );
    const rule = await menuItem('Create a rule');
    const href = new URL(
      rule.closest('a')!.getAttribute('href')!,
      'https://bap.invalid',
    );
    expect(href.pathname).toBe('/inbox/rules');
    expect(Object.fromEntries(href.searchParams)).toEqual({
      assigneeId: 'user_2',
      detectedType: 'pdf',
      kind: 'contract',
      legalEntityId: LEGAL_ENTITY_ID,
      organization: 'organization-1',
    });
  });

  it('offers a discard rule with the reason of the discard event', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        events: [
          {
            actorUserId: 'user_1',
            createdAt: '2026-09-16T09:00:00.000Z',
            id: '00000000-0000-4000-8000-000000000071',
            kind: 'discarded',
            reason: 'spam',
          },
        ],
        extraction: null,
        files: [file('application/pdf')],
        item: {
          ...inboxItem,
          channelId: '00000000-0000-4000-8000-000000000060',
          decidedByKind: 'user',
          status: 'discarded',
        },
      }),
    );

    renderItemPage();
    await screen.findByText('Discarded as Spam by Alice Owner');

    const rule = await menuItem('Create a rule');
    const href = new URL(
      rule.closest('a')!.getAttribute('href')!,
      'https://bap.invalid',
    );
    expect(Object.fromEntries(href.searchParams)).toEqual({
      channelId: '00000000-0000-4000-8000-000000000060',
      detectedType: 'pdf',
      discardReason: 'spam',
      organization: 'organization-1',
    });
  });

  it('leaves J and K inert while a modal is open', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        events: [],
        extraction,
        files: [file('application/pdf')],
        item: inboxItem,
      }),
    );

    renderItemPage();
    await screen.findByLabelText('Title');
    fireEvent.click(await menuItem('Discard'));
    await screen.findByRole('dialog', { name: 'Discard item' });

    fireEvent.keyDown(document.body, { key: 'j' });
    expect(push).not.toHaveBeenCalled();
  });

  it('leaves J and K inert while the Create partner modal is open', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        events: [],
        extraction,
        files: [file('application/pdf')],
        item: inboxItem,
      }),
    );

    renderItemPage();
    await screen.findByLabelText('Title');
    fireEvent.click(screen.getByRole('button', { name: 'Create partner' }));
    await screen.findByRole('dialog', { name: 'Create partner' });

    fireEvent.keyDown(document.body, { key: 'j' });
    expect(push).not.toHaveBeenCalled();
  });
});

describe('InboxItemPage with a parsed ISDOC invoice', () => {
  it('summarises the parsed lines, deduction, totals, issues and the unverified signature', async () => {
    const withIssue = {
      ...parsedRow,
      issues: [
        {
          code: 'amount_mismatch',
          field: 'invoice.lines',
          message: 'TaxExclusiveAmount 1000.00 differs from 990.00.',
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      respondWithParsed([partner('services')], {
        extraction: withIssue,
        parsed: withIssue,
      }),
    );

    renderItemPage();

    expect(
      await screen.findByRole('heading', { name: 'Read from the ISDOC file' }),
    ).toBeVisible();
    expect(screen.getByText('Digital signature not verified.')).toBeVisible();
    const grid = screen.getByRole('table', { name: 'Parsed lines' });
    expect(within(grid).getByText('Placeholder service')).toBeVisible();
    expect(within(grid).getByText('Advance ADV-1')).toBeVisible();
    expect(within(grid).getByText('Advance deduction')).toBeVisible();
    expect(within(grid).getByText('Rounding')).toBeVisible();
    // 1210.00 supplied, 121.00 deducted, 0.40 rounding.
    expect(within(grid).getByText(/1\s089,40 CZK/)).toBeVisible();
    expect(within(grid).getByText(/^189,00 CZK$/)).toBeVisible();
    const issues = screen.getByRole('list', { name: 'Parser findings' });
    expect(
      within(issues).getByText('The invoice amounts do not add up.'),
    ).toBeVisible();
    expect(
      screen.getByRole('list', { name: 'Invoice details' }),
    ).toHaveTextContent('Variable symbol: 20260001');
    expect(
      screen.getByRole('button', { name: 'File as document' }),
    ).toBeEnabled();
  });

  it('routes by the parsed row id and never sends the invoice, total or attributes', async () => {
    const fetchMock = respondWithParsed([partner('services')]);
    vi.stubGlobal('fetch', fetchMock);

    renderItemPage();

    const category = await screen.findByLabelText('Line category');
    await screen.findByRole('option', { name: 'Partner default (Services)' });
    expect(category).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'File as document' }));

    await waitFor(() => {
      expect(routeBodies(fetchMock)).toHaveLength(1);
    });
    expect(routeBodies(fetchMock)[0]).toEqual({
      document: {
        currencyCode: 'CZK',
        documentDate: '2026-09-01',
        kind: 'received_invoice',
        legalEntityId: LEGAL_ENTITY_ID,
        partnerId: PARTNER_ID,
        reference: 'FV-1',
        title: 'Placeholder Supplier FV-1',
      },
      fileBlobIds: [BLOB_ID],
      parsedExtractionId: PARSED_ID,
    });
  });

  it('uses the server entity suggestion when the parsed file names another entity', async () => {
    const otherEntityId = '00000000-0000-4000-8000-000000000099';
    const conflicting = {
      ...parsedRow,
      draft: { ...parsedRow.draft, legalEntityId: otherEntityId },
      legalEntityId: otherEntityId,
      issues: [
        {
          code: 'entity_conflict',
          field: 'legalEntityId',
          message: 'The customer differs from the selected entity.',
        },
      ],
    };
    const fetchMock = respondWithParsed([partner('services')], {
      extraction: conflicting,
      parsed: conflicting,
      routeSuggestion: {
        kind: 'received_invoice',
        legalEntityId: LEGAL_ENTITY_ID,
        partnerId: PARTNER_ID,
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    renderItemPage();

    expect(await screen.findByLabelText('Legal entity')).toHaveValue(
      LEGAL_ENTITY_ID,
    );
    fireEvent.click(screen.getByRole('button', { name: 'File as document' }));
    await waitFor(() => expect(routeBodies(fetchMock)).toHaveLength(1));
    expect(routeBodies(fetchMock)[0].document.legalEntityId).toBe(
      LEGAL_ENTITY_ID,
    );
  });

  it('sends the chosen line category with the route', async () => {
    const fetchMock = respondWithParsed([partner('services')]);
    vi.stubGlobal('fetch', fetchMock);

    renderItemPage();

    fireEvent.change(await screen.findByLabelText('Line category'), {
      target: { value: 'goods' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'File as document' }));

    await waitFor(() => {
      expect(routeBodies(fetchMock)).toHaveLength(1);
    });
    const body = routeBodies(fetchMock)[0];
    expect(body.lineCategory).toBe('goods');
    expect(body.parsedExtractionId).toBe(PARSED_ID);
    expect(body.document).not.toHaveProperty('invoice');
  });

  it('asks for a line category when the partner has no default and routes nothing', async () => {
    const fetchMock = respondWithParsed([partner(null)]);
    vi.stubGlobal('fetch', fetchMock);

    renderItemPage();

    await screen.findByRole('option', { name: 'Choose a category' });
    expect(
      await screen.findByText('Choose a line category for the parsed lines.'),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'File as document' }));

    expect(
      await screen.findByText(
        'The draft is incomplete. Fill in every required field.',
      ),
    ).toBeVisible();
    expect(routeBodies(fetchMock)).toHaveLength(0);
  });

  it('saves the partner default line category through the partner route', async () => {
    const fetchMock = respondWithParsed([partner(null)]);
    vi.stubGlobal('fetch', fetchMock);

    renderItemPage();

    const select = await screen.findByLabelText(
      'Partner default line category',
    );
    fireEvent.change(select, { target: { value: 'transport' } });

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.find(
          (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
        ),
      ).toBeDefined();
    });
    const patch = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
    )!;
    expect(String(patch[0])).toBe(
      `/api/bff/application/organizations/organization_1/partners/${PARTNER_ID}`,
    );
    expect(JSON.parse(String((patch[1] as RequestInit).body))).toEqual({
      defaultLineCategory: 'transport',
    });
    expect(
      await screen.findByRole('option', {
        name: 'Partner default (Transport)',
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Choose a line category for the parsed lines.'),
    ).toBeNull();
  });

  it('offers no partner default select without manageDocuments', async () => {
    vi.stubGlobal('fetch', respondWithParsed([partner(null)], {}, false));

    renderItemPage();

    expect(await screen.findByLabelText('Line category')).toBeDisabled();
    expect(screen.queryByLabelText('Partner default line category')).toBeNull();
  });

  it('creates a missing partner from the item and routes with it', async () => {
    const unknown = {
      ...parsedRow,
      draft: { ...parsedRow.draft, partnerId: null },
      issues: [
        {
          code: 'unknown_partner',
          field: 'partnerId',
          message: 'No partner matches the counterparty.',
        },
      ],
      reasons: [
        {
          evidence:
            'Proposed partner: name Placeholder Supplier, IČO 00000000, DIČ none, country CZ.',
          step: 'parse',
          weight: 0.5,
        },
      ],
    };
    const fetchMock = respondWithParsed([], {
      extraction: unknown,
      parsed: unknown,
    });
    vi.stubGlobal('fetch', fetchMock);

    renderItemPage();

    expect(
      await screen.findByText(/Proposed partner: name Placeholder Supplier/),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Create partner' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Create partner',
    });
    fireEvent.change(within(dialog).getByLabelText('Name'), {
      target: { value: 'Placeholder Supplier' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    // The new partner has no default yet, so the person picks the category for this invoice.
    expect(
      await screen.findByLabelText('Partner default line category'),
    ).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Line category'), {
      target: { value: 'services' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'File as document' }));

    await waitFor(() => {
      expect(routeBodies(fetchMock)).toHaveLength(1);
    });
    const body = routeBodies(fetchMock)[0];
    expect(body.document.partnerId).toBe(CREATED_PARTNER_ID);
    expect(body.lineCategory).toBe('services');
    expect(body.parsedExtractionId).toBe(PARSED_ID);
  });
});
