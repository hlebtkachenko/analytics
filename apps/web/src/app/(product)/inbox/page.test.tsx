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
import InboxPage from './page';

const LEGAL_ENTITY_ID = '9b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21';
const ITEM_ID = '00000000-0000-4000-8000-000000000050';
const OTHER_ITEM_ID = '00000000-0000-4000-8000-000000000051';

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
  decidedByRuleId: null,
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
  humanTouched: false,
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
        capabilities: capabilities(manageDocuments, manageOrganization),
        organizationId: 'organization_1',
      });
    }
    if (input.endsWith('/legal-entities')) {
      return Response.json(legalEntities);
    }
    if (input.endsWith('/inbox/items/bulk')) {
      const body = JSON.parse(String(init?.body)) as { itemIds: string[] };
      return Response.json({
        results: body.itemIds.map((itemId, index) =>
          index === 0
            ? { itemId, status: 'ok' }
            : { code: 'not_open', itemId, status: 'refused' },
        ),
      });
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

  it('offers the channels and settings pages to an owner only', async () => {
    vi.stubGlobal('fetch', respondWith([inboxItem], true, true));

    renderInboxPage();

    expect(
      await screen.findByRole('link', { name: 'Channels' }),
    ).toHaveAttribute('href', '/inbox/channels?organization=organization-1');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/inbox/settings?organization=organization-1',
    );
    expect(screen.getByRole('link', { name: 'Rules' })).toHaveAttribute(
      'href',
      '/inbox/rules?organization=organization-1',
    );

    cleanup();
    vi.stubGlobal('fetch', respondWith([inboxItem]));

    renderInboxPage();
    await screen.findByText('Placeholder Holding');

    expect(screen.queryByRole('link', { name: 'Channels' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
    // Rules are readable by anyone who manages documents, not only an owner.
    expect(screen.getByRole('link', { name: 'Rules' })).toHaveAttribute(
      'href',
      '/inbox/rules?organization=organization-1',
    );
  });

  it('restores the issue, assignee and confidence filters from the URL and round-trips a change', async () => {
    navigation.search =
      '?filter=all&issue=reference_conflict&assigneeId=none&confidence=low';
    const fetchMock = respondWith([inboxItem]);
    vi.stubGlobal('fetch', fetchMock);

    renderInboxPage();
    await screen.findByText('Placeholder Holding');

    expect(itemRequests(fetchMock)[0]).toBe(
      '/api/bff/application/organizations/organization_1/inbox/items?status=received%2Cprocessing%2Cneeds_review%2Cfailed&issue=reference_conflict&assigneeId=none&confidence=low&page=1&pageSize=25',
    );
    expect(screen.getByLabelText('Issue')).toHaveValue('reference_conflict');
    expect(screen.getByLabelText('Confidence')).toHaveValue('low');

    fireEvent.change(screen.getByLabelText('Confidence'), {
      target: { value: 'high' },
    });
    fireEvent.change(screen.getByLabelText('Assignee'), {
      target: { value: 'user_2' },
    });
    fireEvent.keyDown(screen.getByLabelText('Assignee'), { key: 'Enter' });

    await waitFor(() => {
      expect(itemRequests(fetchMock).at(-1)).toBe(
        '/api/bff/application/organizations/organization_1/inbox/items?status=received%2Cprocessing%2Cneeds_review%2Cfailed&issue=reference_conflict&assigneeId=user_2&confidence=high&page=1&pageSize=25',
      );
    });
    expect(window.location.search).toContain('confidence=high');
    expect(window.location.search).toContain('assigneeId=user_2');
  });

  it('colours the state from the status and the human touch', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith([
        inboxItem,
        { ...inboxItem, humanTouched: true, id: OTHER_ITEM_ID },
        {
          ...inboxItem,
          id: '00000000-0000-4000-8000-000000000052',
          status: 'routed',
        },
      ]),
    );

    renderInboxPage();

    await screen.findAllByText('Placeholder Holding');
    const table = screen.getByRole('table');
    expect(within(table).getByText('Untouched')).toBeVisible();
    expect(within(table).getByText('User-touched')).toBeVisible();
    // The status tag says Routed too, so the state tag is the second one on that row.
    expect(within(table).getAllByText('Routed')).toHaveLength(2);
  });

  it('runs a bulk action on the selected rows and reports the refused ids', async () => {
    const fetchMock = respondWith([
      inboxItem,
      { ...inboxItem, id: OTHER_ITEM_ID },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    renderInboxPage();
    await screen.findAllByText('Placeholder Holding');

    fireEvent.click(screen.getByLabelText('Select all rows'));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

    const dialog = await screen.findByRole('dialog', { name: 'Discard' });
    expect(within(dialog).getByText('2 items selected.')).toBeVisible();
    fireEvent.change(within(dialog).getByLabelText('Discard reason'), {
      target: { value: 'spam' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));

    await waitFor(() => {
      expect(screen.getByText('1 of 2 items done.')).toBeVisible();
    });
    expect(
      screen.getByText(`Refused: ${OTHER_ITEM_ID} (not open)`),
    ).toBeVisible();
    const bulkCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).endsWith('/inbox/items/bulk'),
    )!;
    expect(JSON.parse(String((bulkCall[1] as RequestInit).body))).toEqual({
      action: 'discard',
      itemIds: [ITEM_ID, OTHER_ITEM_ID],
      reason: 'spam',
    });
    // The list is reread after the action.
    expect(itemRequests(fetchMock).length).toBeGreaterThan(1);
  });

  it('hides the selection and the bulk actions without the manage capability', async () => {
    vi.stubGlobal('fetch', respondWith([inboxItem], false));

    renderInboxPage();
    await screen.findByText('Placeholder Holding');

    expect(screen.queryByLabelText('Select all rows')).toBeNull();
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
