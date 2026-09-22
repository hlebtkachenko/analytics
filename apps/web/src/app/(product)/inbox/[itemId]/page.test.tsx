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

vi.mock('next/navigation', () => ({
  useParams: () => ({ itemId: ITEM_ID }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
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

const inboxItem = {
  assigneeId: null,
  channelId: null,
  channelKind: 'upload',
  confidence: 0.75,
  createdAt: '2026-09-16T08:00:00.000Z',
  datasetId: null,
  decidedByKind: 'provider',
  decidedByRuleId: null,
  decidedByUserId: null,
  detectedType: 'pdf',
  documentId: null,
  duplicateOfItemId: EARLIER_ITEM_ID,
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
  senderAuthenticated: false,
  snoozedUntil: null,
  status: 'needs_review',
  updatedAt: '2026-09-16T08:00:00.000Z',
};

function file(mediaType: string, scanStatus = 'clean') {
  return {
    blobId: BLOB_ID,
    byteSize: 3,
    mediaType,
    originalFilename: 'placeholder.bin',
    position: 1,
    scanStatus,
    sha256: 'a'.repeat(64),
  };
}

const extraction = {
  confidence: 0.75,
  createdAt: '2026-09-16T08:01:00.000Z',
  detectedType: 'pdf',
  draft: {
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
      message: 'No partner could be matched.',
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
    manageEntityAccess: false,
    manageMembers: false,
    manageOrganization: false,
    readDocuments: true,
    updateEntities: false,
    uploadData: false,
    useAi: false,
  };
}

// The route answers with the queued 409 bodies first, then routes; the attach answers the routed detail.
type RouteAnswers = Readonly<{ conflicts?: unknown[] }>;

// One router per test, so every request is answered by the shape its route promises.
function respondWith(
  given: Record<string, unknown>,
  manageDocuments = true,
  answers: RouteAnswers = {},
) {
  const conflicts = [...(answers.conflicts ?? [])];
  // Every detail carries the effective target and no corrections unless a test says otherwise.
  const detail: Record<string, unknown> = {
    corrections: [],
    routingTarget,
    ...given,
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
    if (input.includes('/documents?')) {
      return Response.json({
        documents: [documentSummary],
        page: 1,
        pageSize: 25,
        total: 1,
        totalsByCurrency: [],
      });
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

function routeBodies(fetchMock: ReturnType<typeof respondWith>) {
  return fetchMock.mock.calls
    .filter((call) => String(call[0]).endsWith('/route/document'))
    .map((call) => JSON.parse(String((call[1] as RequestInit).body)));
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
  vi.unstubAllGlobals();
});

describe('InboxItemPage', () => {
  it('previews a PDF in an unsandboxed frame and always offers the download', async () => {
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
    expect(frame).toHaveAttribute(
      'src',
      `/api/bff/application/organizations/organization_1/inbox/blobs/${BLOB_ID}/inline`,
    );
    // A sandboxed frame has no plugins, so the PDF viewer would render blank.
    expect(frame).not.toHaveAttribute('sandbox');
    expect(
      screen.getByRole('link', { name: 'Download placeholder.bin' }),
    ).toHaveAttribute(
      'href',
      `/api/bff/application/organizations/organization_1/inbox/blobs/${BLOB_ID}/download`,
    );
    expect(
      screen.getByRole('link', { name: 'Duplicate of an earlier item' }),
    ).toHaveAttribute(
      'href',
      `/inbox/${EARLIER_ITEM_ID}?organization=organization-1`,
    );
  });

  it('previews an image in a sandboxed frame', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        events: [],
        extraction: null,
        files: [file('image/png')],
        item: inboxItem,
      }),
    );

    renderItemPage();

    const frame = await screen.findByTitle('File preview');
    expect(frame).toHaveAttribute('sandbox', '');
  });

  it('offers a download only for a media type that never renders inline', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        events: [],
        extraction: null,
        files: [file('application/zip')],
        item: inboxItem,
      }),
    );

    renderItemPage();

    expect(
      await screen.findByRole('link', { name: 'Download placeholder.bin' }),
    ).toBeVisible();
    expect(screen.queryByTitle('File preview')).toBeNull();
    expect(
      screen.getByText(
        'This file type does not render inline. Download it instead.',
      ),
    ).toBeVisible();
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

      expect(await screen.findAllByText('Quarantined')).toHaveLength(2);
      expect(
        screen.getByText(
          'The virus scan flagged this file or could not complete. It cannot be previewed or downloaded.',
        ),
      ).toBeVisible();
      expect(screen.queryByTitle('File preview')).toBeNull();
      expect(
        screen.queryByRole('link', { name: 'Download placeholder.bin' }),
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

  it('shows a scan pending indicator instead of the preview and the download', async () => {
    const otherBlobId = '00000000-0000-4000-8000-000000000061';
    const fetchMock = respondWith({
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
    });
    vi.stubGlobal('fetch', fetchMock);

    renderItemPage();

    // Once in the preview tile and once in the file row; the scanned sibling keeps its link.
    expect(await screen.findAllByText('Scan pending')).toHaveLength(2);
    expect(screen.queryByTitle('File preview')).toBeNull();
    expect(
      screen.queryByRole('link', { name: 'Download placeholder.bin' }),
    ).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Download clean.zip' }),
    ).toBeVisible();
  });

  it('prefills the draft from the extraction, explains it, and routes with every blob', async () => {
    const fetchMock = respondWith({
      events: [],
      extraction,
      files: [file('application/pdf')],
      item: inboxItem,
    });
    vi.stubGlobal('fetch', fetchMock);

    renderItemPage();

    expect(await screen.findByLabelText('Title')).toHaveValue(
      'Placeholder contract',
    );
    expect(screen.getByLabelText('Document date')).toHaveValue('2026-09-01');
    expect(screen.getByLabelText('Reference')).toHaveValue('REF-9');
    expect(screen.getByLabelText('Kind')).toHaveValue('contract');
    expect(
      screen.getByText('The sniff step found a PDF header.'),
    ).toBeVisible();
    expect(screen.getByText('missing_required_field')).toBeVisible();
    expect(screen.getByText('No partner could be matched.')).toBeVisible();
    expect(
      screen.getByText(/Decided by: Provider\. Confidence: 75 %/),
    ).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Route to document' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((call) =>
          String(call[0]).endsWith('/route/document'),
        ),
      ).toBe(true);
    });
    const routeCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).endsWith('/route/document'),
    )!;
    const body = JSON.parse(String((routeCall[1] as RequestInit).body));
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
    // Every action rereads the detail rather than trusting the answer.
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(
          (call) =>
            String(call[0]).endsWith(`/inbox/items/${ITEM_ID}`) &&
            call[1]?.method === undefined,
        ).length,
      ).toBeGreaterThan(1);
    });
  });

  it('shows the effective routing target and defaults the draft kind from it', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        events: [],
        extraction: { ...extraction, draft: {} },
        files: [file('application/pdf')],
        item: inboxItem,
      }),
    );

    renderItemPage();

    expect(
      await screen.findByText(
        'Routing target: Documents, Receipt (platform default)',
      ),
    ).toBeVisible();
    expect(screen.getByLabelText('Kind')).toHaveValue('receipt');
  });

  it('lets the kind hint win over the routing target and shows an organization target', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        events: [],
        extraction: { ...extraction, draft: {} },
        files: [file('application/pdf')],
        item: { ...inboxItem, hintKind: 'contract' },
        routingTarget: {
          ...routingTarget,
          destination: 'discard',
          documentKind: null,
          source: 'organization',
        },
      }),
    );

    renderItemPage();

    expect(
      await screen.findByText('Routing target: Discard (organization setting)'),
    ).toBeVisible();
    expect(screen.getByLabelText('Kind')).toHaveValue('contract');
  });

  it('asks why a changed field differs and sends the reasons with the route', async () => {
    const fetchMock = respondWith({
      events: [],
      extraction,
      files: [file('application/pdf')],
      item: inboxItem,
    });
    vi.stubGlobal('fetch', fetchMock);

    renderItemPage();

    expect(await screen.findByLabelText('Kind')).toHaveValue('contract');
    expect(screen.queryByLabelText(/^Why did/)).toBeNull();

    fireEvent.change(screen.getByLabelText('Kind'), {
      target: { value: 'agreement' },
    });
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Placeholder agreement' },
    });
    expect(screen.getByLabelText('Why did Title change?')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Why did Kind change?'), {
      target: { value: 'It is signed by both sides.' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Route to document' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((call) =>
          String(call[0]).endsWith('/route/document'),
        ),
      ).toBe(true);
    });
    const routeCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).endsWith('/route/document'),
    )!;
    const body = JSON.parse(String((routeCall[1] as RequestInit).body));
    // Only a filled reason is sent; the unexplained title change is still a correction upstream.
    expect(body.correctionReasons).toEqual({
      kind: 'It is signed by both sides.',
    });
    expect(body.document.kind).toBe('agreement');
  });

  it('lists the corrections under the explanation and offers a rule from a routed item', async () => {
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

    const list = await screen.findByRole('list', { name: 'Corrections' });
    expect(list).toHaveTextContent(
      'Kind: contract (Provider) changed to agreement It is signed by both sides.',
    );
    expect(list).toHaveTextContent(
      'Partner id: 00000000-0000-4000-8000-000000000090 (Hint) changed to none',
    );
    const link = screen.getByRole('link', { name: 'Create a rule' });
    const href = new URL(link.getAttribute('href')!, 'https://bap.invalid');
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

    const link = await screen.findByRole('link', { name: 'Create a rule' });
    const href = new URL(link.getAttribute('href')!, 'https://bap.invalid');
    expect(Object.fromEntries(href.searchParams)).toEqual({
      channelId: '00000000-0000-4000-8000-000000000060',
      detectedType: 'pdf',
      discardReason: 'spam',
      organization: 'organization-1',
    });
    expect(screen.queryByRole('list', { name: 'Corrections' })).toBeNull();
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

  it('carries the lowercased sender domain on the create-a-rule link', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        events: [],
        extraction: null,
        files: [file('application/pdf')],
        item: {
          ...inboxItem,
          documentId: DOCUMENT_ID,
          sender: 'Someone <person@Example.org>',
          status: 'routed',
        },
      }),
    );

    renderItemPage();

    const link = await screen.findByRole('link', { name: 'Create a rule' });
    const href = new URL(link.getAttribute('href')!, 'https://bap.invalid');
    expect(href.searchParams.get('sender')).toBe('@example.org');
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
      {
        conflicts: [{ code: 'reference_conflict', documentId: DOCUMENT_ID }],
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    renderItemPage();
    await screen.findByLabelText('Title');
    fireEvent.click(screen.getByRole('button', { name: 'Route to document' }));

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
    expect(second.document).toEqual(first.document);
  });

  it('shows the duplicate dialog with the candidates and routes anyway with the acknowledgement', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Route to document' }));

    const dialog = await screen.findByRole('dialog', {
      name: 'This looks like a duplicate',
    });
    expect(within(dialog).getByRole('link', { name: 'REF-9' })).toHaveAttribute(
      'href',
      `/documents/${DOCUMENT_ID}?organization=organization-1`,
    );
    expect(
      within(dialog).getByRole('button', { name: 'Attach to this document' }),
    ).toBeVisible();
    expect(
      within(dialog).getByRole('button', { name: 'Discard as duplicate' }),
    ).toBeVisible();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Route anyway' }),
    );

    await waitFor(() => {
      expect(routeBodies(fetchMock)).toHaveLength(2);
    });
    expect(routeBodies(fetchMock)[1].acknowledgeDuplicateOf).toBe(DOCUMENT_ID);
  });

  it('attaches to a candidate from the dialog and discards as duplicate from it', async () => {
    const conflict = {
      candidates: [
        {
          documentDate: '2026-09-01',
          id: DOCUMENT_ID,
          reference: 'REF-9',
          totalAmount: null,
        },
      ],
      code: 'duplicate_probable',
    };
    const fetchMock = respondWith(
      {
        events: [],
        extraction,
        files: [file('application/pdf')],
        item: inboxItem,
      },
      true,
      { conflicts: [conflict, conflict] },
    );
    vi.stubGlobal('fetch', fetchMock);

    renderItemPage();
    await screen.findByLabelText('Title');
    fireEvent.click(screen.getByRole('button', { name: 'Route to document' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'This looks like a duplicate',
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Attach to this document' }),
    );

    await waitFor(() => {
      const attach = fetchMock.mock.calls.find((call) =>
        String(call[0]).endsWith(`/inbox/items/${ITEM_ID}/attach`),
      );
      expect(attach).toBeDefined();
      expect(JSON.parse(String((attach![1] as RequestInit).body))).toEqual({
        documentId: DOCUMENT_ID,
      });
    });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Route to document' }),
    );
    const again = await screen.findByRole('dialog', {
      name: 'This looks like a duplicate',
    });
    fireEvent.click(
      within(again).getByRole('button', { name: 'Discard as duplicate' }),
    );

    await waitFor(() => {
      const discard = fetchMock.mock.calls.find((call) =>
        String(call[0]).endsWith(`/inbox/items/${ITEM_ID}/discard`),
      );
      expect(discard).toBeDefined();
      expect(JSON.parse(String((discard![1] as RequestInit).body))).toEqual({
        reason: 'duplicate',
      });
    });
  });

  it('attaches an open item to a document picked from the search', async () => {
    const fetchMock = respondWith({
      events: [],
      extraction: null,
      files: [file('application/pdf')],
      item: inboxItem,
    });
    vi.stubGlobal('fetch', fetchMock);

    renderItemPage();
    const form = await screen.findByRole('form', {
      name: 'Attach to existing document',
    });
    const attach = within(form).getByRole('button', { name: 'Attach' });
    expect(attach).toBeDisabled();
    const picker = within(form).getByRole('combobox');
    fireEvent.change(picker, { target: { value: 'Placeholder' } });
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((call) =>
          String(call[0]).includes('/documents?'),
        ),
      ).toBe(true);
    });
    fireEvent.click(
      await screen.findByRole('option', { name: 'Placeholder contract' }),
    );

    expect(attach).toBeEnabled();
    fireEvent.click(attach);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((entry) =>
        String(entry[0]).endsWith(`/inbox/items/${ITEM_ID}/attach`),
      );
      expect(call).toBeDefined();
      expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({
        documentId: DOCUMENT_ID,
      });
    });
  });

  it('offers undo and the document link once the item is routed', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        events: [],
        extraction: null,
        files: [file('application/pdf')],
        item: { ...inboxItem, documentId: DOCUMENT_ID, status: 'routed' },
      }),
    );

    renderItemPage();

    expect(
      await screen.findByRole('button', { name: 'Undo route' }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open document' })).toHaveAttribute(
      'href',
      `/documents/${DOCUMENT_ID}?organization=organization-1`,
    );
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
  });
});
