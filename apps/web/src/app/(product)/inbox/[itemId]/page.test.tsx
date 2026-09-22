import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
  channelKind: 'upload',
  confidence: 0.75,
  createdAt: '2026-09-16T08:00:00.000Z',
  datasetId: null,
  decidedByKind: 'provider',
  decidedByUserId: null,
  detectedType: 'pdf',
  documentId: null,
  duplicateOfItemId: EARLIER_ITEM_ID,
  hintKind: null,
  hintLegalEntityId: null,
  hintLinkDocumentId: null,
  hintPartnerId: null,
  hintText: null,
  id: ITEM_ID,
  legalEntityId: null,
  partnerId: null,
  payloadKind: 'file',
  receivedAt: '2026-09-16T08:00:00.000Z',
  routedAt: null,
  snoozedUntil: null,
  status: 'needs_review',
  updatedAt: '2026-09-16T08:00:00.000Z',
};

function file(mediaType: string) {
  return {
    blobId: BLOB_ID,
    byteSize: 3,
    mediaType,
    originalFilename: 'placeholder.bin',
    position: 1,
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
function respondWith(detail: Record<string, unknown>, manageDocuments = true) {
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
    if (input.endsWith(`/inbox/items/${ITEM_ID}/route/document`)) {
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
