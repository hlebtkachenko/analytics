import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const navigation = { search: '' };

vi.mock('next/navigation', () => ({
  useParams: () => ({}),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

import { I18nProvider } from '../../../i18n/client-provider';
import InboxPage from './page';

const LEGAL_ENTITY_ID = '9b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21';
const ITEM_ID = '00000000-0000-4000-8000-000000000050';

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
  confidence: 0.8,
  createdAt: '2026-09-16T08:00:00.000Z',
  datasetId: null,
  decidedByKind: null,
  decidedByUserId: null,
  detectedType: 'pdf',
  documentId: null,
  duplicateOfItemId: null,
  fileCount: 3,
  hintKind: null,
  hintLegalEntityId: null,
  hintLinkDocumentId: null,
  hintPartnerId: null,
  hintText: null,
  id: ITEM_ID,
  legalEntityId: LEGAL_ENTITY_ID,
  origin: null,
  partnerId: null,
  payloadKind: 'file',
  primaryFilename: 'invoice.pdf',
  receivedAt: '2026-09-16T08:00:00.000Z',
  routedAt: null,
  snoozedUntil: null,
  status: 'needs_review',
  updatedAt: '2026-09-16T08:00:00.000Z',
};

function capabilities(manageDocuments: boolean, manageOrganization = false) {
  return {
    createEntities: false,
    deleteEntities: false,
    manageDocuments,
    manageEntityAccess: false,
    manageMembers: false,
    manageOrganization,
    readDocuments: true,
    updateEntities: false,
    uploadData: false,
    useAi: false,
  };
}

// One router per test, so every request is answered by the shape its route promises.
function respondWith(
  items: unknown[],
  manageDocuments = true,
  manageOrganization = false,
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
        capabilities: capabilities(manageDocuments, manageOrganization),
        organizationId: 'organization_1',
      });
    }
    if (input.endsWith('/legal-entities')) {
      return Response.json(legalEntities);
    }
    if (input.includes('/inbox/items')) {
      return Response.json({
        items,
        page: 1,
        pageSize: 25,
        total: items.length,
      });
    }
    return new Response(null, { status: 404 });
  });
}

function itemRequests(fetchMock: ReturnType<typeof respondWith>): string[] {
  return fetchMock.mock.calls
    .map((call) => String(call[0]))
    .filter((path) => path.includes('/inbox/items?'));
}

function renderInboxPage() {
  return render(
    <I18nProvider>
      <InboxPage />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  navigation.search = '';
  vi.unstubAllGlobals();
});

describe('InboxPage', () => {
  it('lists the open items with the drop zone, hiding routed and discarded by default', async () => {
    const fetchMock = respondWith([inboxItem]);
    vi.stubGlobal('fetch', fetchMock);

    renderInboxPage();

    expect(await screen.findByText('Placeholder Holding')).toBeVisible();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Needs review')).toBeVisible();
    expect(within(table).getByText('pdf')).toBeVisible();
    expect(within(table).getByText('invoice.pdf +2')).toBeVisible();
    expect(within(table).getByText('80 %')).toBeVisible();
    expect(within(table).getByText('Unassigned')).toBeVisible();
    expect(
      within(table).getByRole('link', {
        name: 'Open item 2026-09-16T08:00:00.000Z',
      }),
    ).toHaveAttribute('href', `/inbox/${ITEM_ID}?organization=organization-1`);
    expect(screen.getByRole('region', { name: 'Upload files' })).toBeVisible();
    expect(itemRequests(fetchMock)[0]).toBe(
      '/api/bff/application/organizations/organization_1/inbox/items?status=received%2Cprocessing%2Cneeds_review%2Cfailed&page=1&pageSize=25',
    );
  });

  it('restores the stored quick filter from the URL', async () => {
    navigation.search = '?filter=unprocessed&page=2&pageSize=50';
    const fetchMock = respondWith([inboxItem]);
    vi.stubGlobal('fetch', fetchMock);

    renderInboxPage();
    await screen.findByText('Placeholder Holding');

    expect(itemRequests(fetchMock)[0]).toBe(
      '/api/bff/application/organizations/organization_1/inbox/items?status=received%2Cprocessing%2Cfailed&page=2&pageSize=50',
    );
  });

  it('offers the channels page to an owner only', async () => {
    vi.stubGlobal('fetch', respondWith([inboxItem], true, true));

    renderInboxPage();

    expect(
      await screen.findByRole('link', { name: 'Channels' }),
    ).toHaveAttribute('href', '/inbox/channels?organization=organization-1');

    cleanup();
    vi.stubGlobal('fetch', respondWith([inboxItem]));

    renderInboxPage();
    await screen.findByText('Placeholder Holding');

    expect(screen.queryByRole('link', { name: 'Channels' })).toBeNull();
  });

  it('shows the empty state and hides the drop zone without the manage capability', async () => {
    vi.stubGlobal('fetch', respondWith([], false));

    renderInboxPage();

    expect(
      await screen.findByText('No items are waiting in the inbox.'),
    ).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Upload files' })).toBeNull();
  });
});
