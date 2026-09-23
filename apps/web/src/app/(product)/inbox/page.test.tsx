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

// jsdom ships no matchMedia, which Carbon Tabs read on mount.
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
  useParams: () => ({}),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

import { I18nProvider } from '../../../i18n/client-provider';
import InboxPage from './page';

const LEGAL_ENTITY_ID = '9b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21';
const ITEM_ID = '00000000-0000-4000-8000-000000000050';
const OTHER_ITEM_ID = '00000000-0000-4000-8000-000000000051';
const MEMBER_ID = 'user_2';

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
    {
      email: 'reviewer@bap.invalid',
      id: MEMBER_ID,
      name: 'Placeholder Reviewer',
    },
  ],
};

const counts = { all: 5, discarded: 1, filed: 1, toReview: 3 };

const inboxItem = {
  assigneeId: null,
  channelId: null,
  channelKind: 'upload',
  confidence: 0.8,
  createdAt: '2026-09-16T08:00:00.000Z',
  datasetId: null,
  decidedByKind: null,
  decidedByRuleId: null,
  decidedByRuleName: null,
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
  sender: null,
  senderAuthenticated: false,
  snoozedUntil: null,
  status: 'needs_review',
  updatedAt: '2026-09-16T08:00:00.000Z',
};

function capabilities(manageDocuments: boolean, manageOrganization = false) {
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
    if (input.endsWith('/members')) {
      return Response.json(members);
    }
    if (input.endsWith('/inbox/uploads')) {
      // The upload response item is a plain inbox item, without the list-only fields.
      const {
        decidedByRuleName,
        fileCount,
        primaryFilename,
        sender,
        senderAuthenticated,
        ...baseItem
      } = inboxItem;
      void decidedByRuleName;
      void fileCount;
      void primaryFilename;
      void sender;
      void senderAuthenticated;
      return Response.json({
        duplicateOfItemId: null,
        files: [],
        item: baseItem,
      });
    }
    if (input.endsWith('/inbox/items/bulk')) {
      const body = JSON.parse(String(init?.body)) as { itemIds: string[] };
      return Response.json({
        results: body.itemIds.map((itemId) => ({ itemId, status: 'ok' })),
      });
    }
    if (input.includes('/inbox/items')) {
      return Response.json({
        counts,
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
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('InboxPage', () => {
  it('opens on the To review tab with counts, excluding snoozed items', async () => {
    const fetchMock = respondWith([inboxItem]);
    vi.stubGlobal('fetch', fetchMock);

    renderInboxPage();

    expect(await screen.findByText('Placeholder Holding')).toBeVisible();
    // The tab labels carry the counts from the response.
    expect(screen.getByRole('tab', { name: 'To review (3)' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Filed (1)' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Discarded (1)' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'All (5)' })).toBeVisible();

    const table = screen.getByRole('table');
    expect(within(table).getByText('Needs review')).toBeVisible();
    expect(within(table).getByText('invoice.pdf')).toBeVisible();
    expect(within(table).getByText('+2 files')).toBeVisible();

    // The default To review query names the person-waiting statuses and excludes snoozed items.
    expect(itemRequests(fetchMock)[0]).toBe(
      '/api/bff/application/organizations/organization_1/inbox/items?status=needs_review%2Creceived%2Cprocessing%2Cfailed&snoozed=exclude&page=1&pageSize=25',
    );
  });

  it('names the tabs without a count until the counts load, never a fake zero', async () => {
    const base = respondWith([inboxItem]);
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        if (input.includes('/inbox/items?')) {
          await held;
        }
        return base(input, init);
      }),
    );

    renderInboxPage();

    expect(await screen.findByRole('tab', { name: 'To review' })).toBeVisible();
    expect(screen.queryByRole('tab', { name: /\(/ })).toBeNull();

    release();
    expect(
      await screen.findByRole('tab', { name: 'To review (3)' }),
    ).toBeVisible();
  });

  it('links each row to the item with the current tab and reads Review on To review', async () => {
    vi.stubGlobal('fetch', respondWith([inboxItem]));
    renderInboxPage();
    await screen.findByText('Placeholder Holding');

    const link = screen.getByRole('link', { name: 'Review invoice.pdf' });
    expect(link).toHaveTextContent('Review');
    expect(link).toHaveAttribute(
      'href',
      `/inbox/${ITEM_ID}?organization=organization-1&tab=toReview`,
    );
  });

  it('marks an email sender without a DKIM verdict as not verified, and a verified one not at all', async () => {
    const email = {
      ...inboxItem,
      payloadKind: 'email',
      primaryFilename: null,
      sender: 'billing@supplier.test',
    };
    vi.stubGlobal(
      'fetch',
      respondWith([
        email,
        {
          ...email,
          id: '00000000-0000-4000-8000-0000000000e2',
          sender: 'verified@supplier.test',
          senderAuthenticated: true,
        },
      ]),
    );
    renderInboxPage();
    await screen.findByText('billing@supplier.test');

    const rows = screen.getAllByRole('row');
    const unverified = rows.find((row) =>
      within(row).queryByText('billing@supplier.test'),
    )!;
    const verified = rows.find((row) =>
      within(row).queryByText('verified@supplier.test'),
    )!;
    expect(within(unverified).getByText('Sender not verified')).toBeVisible();
    expect(within(verified).queryByText('Sender not verified')).toBeNull();
  });

  it('renders no raw code: no ISO timestamp and no status code', async () => {
    vi.stubGlobal('fetch', respondWith([inboxItem]));
    renderInboxPage();
    await screen.findByText('Placeholder Holding');

    expect(screen.queryByText('2026-09-16T08:00:00.000Z')).toBeNull();
    expect(screen.queryByText('needs_review')).toBeNull();
    expect(screen.queryByText('upload')).toBeNull();
  });

  it('maps the Filed tab from the URL to the routed status with no snooze filter', async () => {
    navigation.search = '?tab=filed';
    const fetchMock = respondWith([inboxItem]);
    vi.stubGlobal('fetch', fetchMock);

    renderInboxPage();
    await screen.findByText('Placeholder Holding');

    expect(itemRequests(fetchMock)[0]).toBe(
      '/api/bff/application/organizations/organization_1/inbox/items?status=routed&page=1&pageSize=25',
    );
  });

  it('maps the All tab to no status filter and keeps snoozed items', async () => {
    navigation.search = '?tab=all';
    const fetchMock = respondWith([inboxItem]);
    vi.stubGlobal('fetch', fetchMock);

    renderInboxPage();
    await screen.findByText('Placeholder Holding');

    expect(itemRequests(fetchMock)[0]).toBe(
      '/api/bff/application/organizations/organization_1/inbox/items?page=1&pageSize=25',
    );
  });

  it('switches the tab to Discarded on a click', async () => {
    const fetchMock = respondWith([inboxItem]);
    vi.stubGlobal('fetch', fetchMock);

    renderInboxPage();
    await screen.findByText('Placeholder Holding');

    fireEvent.click(screen.getByRole('tab', { name: 'Discarded (1)' }));

    await waitFor(() => {
      expect(itemRequests(fetchMock).at(-1)).toBe(
        '/api/bff/application/organizations/organization_1/inbox/items?status=discarded&page=1&pageSize=25',
      );
    });
  });

  it('shows the received time with the full year', async () => {
    vi.stubGlobal('fetch', respondWith([inboxItem]));
    renderInboxPage();
    await screen.findByText('Placeholder Holding');

    const table = screen.getByRole('table');
    expect(within(table).getByText(/2026/)).toBeVisible();
  });

  it('hides Decided by on To review and shows it on the Filed tab', async () => {
    vi.stubGlobal('fetch', respondWith([inboxItem]));
    const { unmount } = renderInboxPage();
    await screen.findByText('Placeholder Holding');
    expect(
      screen.queryByRole('columnheader', { name: 'Decided by' }),
    ).toBeNull();
    unmount();

    navigation.search = '?tab=filed';
    vi.stubGlobal(
      'fetch',
      respondWith([
        {
          ...inboxItem,
          decidedByKind: 'rule',
          decidedByRuleName: 'Fio statements',
          status: 'routed',
        },
      ]),
    );
    renderInboxPage();
    await screen.findByText('Placeholder Holding');
    expect(
      screen.getByRole('columnheader', { name: 'Decided by' }),
    ).toBeVisible();
  });

  it('hides the filters behind the toggle and offers an Unassigned entry', async () => {
    navigation.search = '?tab=all';
    vi.stubGlobal('fetch', respondWith([inboxItem]));

    renderInboxPage();
    await screen.findByText('Placeholder Holding');

    expect(screen.queryByLabelText('Assignee')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));

    const assignee = await screen.findByLabelText('Assignee');
    expect(
      within(assignee).getByRole('option', { name: 'Unassigned' }),
    ).toBeInTheDocument();
    expect(
      within(assignee).getByRole('option', { name: 'Placeholder Reviewer' }),
    ).toBeInTheDocument();

    fireEvent.change(assignee, { target: { value: 'none' } });
    await waitFor(() => {
      expect(window.location.search).toContain('assigneeId=none');
    });
  });

  it('opens the upload modal from the Upload button and uploads an added file', async () => {
    const fetchMock = respondWith([inboxItem]);
    vi.stubGlobal('fetch', fetchMock);

    renderInboxPage();
    await screen.findByText('Placeholder Holding');

    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    const dialog = await screen.findByRole('dialog', { name: 'Upload files' });
    fireEvent.change(
      within(dialog).getByLabelText(
        'Drag and drop files here or click to upload',
      ),
      {
        target: {
          files: [
            new File(['data'], 'dropped.pdf', { type: 'application/pdf' }),
          ],
        },
      },
    );

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((call) =>
          String(call[0]).endsWith('/inbox/uploads'),
        ),
      ).toBe(true);
    });
    // The item carries the file name; the old page-wide summary notification is gone.
    expect(await within(dialog).findByText('dropped.pdf')).toBeVisible();
    expect(screen.queryByText('Uploaded 1 of 1 files.')).toBeNull();
  });

  it('opens the upload modal with files dropped on the page and uploads them', async () => {
    const fetchMock = respondWith([inboxItem]);
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderInboxPage();
    await screen.findByText('Placeholder Holding');

    const wrapper = container.firstElementChild as HTMLElement;
    const file = new File(['data'], 'dropped.png', { type: 'image/png' });
    fireEvent.drop(wrapper, {
      dataTransfer: { files: [file], types: ['Files'] },
    });

    const dialog = await screen.findByRole('dialog', { name: 'Upload files' });
    expect(within(dialog).getByText('dropped.png')).toBeVisible();
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((call) =>
          String(call[0]).endsWith('/inbox/uploads'),
        ),
      ).toBe(true);
    });
  });

  it('clears the drop overlay once the upload modal is open', async () => {
    const fetchMock = respondWith([inboxItem]);
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderInboxPage();
    await screen.findByText('Placeholder Holding');

    const wrapper = container.firstElementChild as HTMLElement;
    const file = new File(['data'], 'dropped.png', { type: 'image/png' });
    const dataTransfer = { files: [file], types: ['Files'] };

    // A drag over the page shows the overlay.
    fireEvent.dragEnter(wrapper, { dataTransfer });
    expect(screen.getByText('Drop files to upload')).toBeVisible();

    // The drop opens the modal and clears the overlay.
    fireEvent.drop(wrapper, { dataTransfer });
    await screen.findByRole('dialog', { name: 'Upload files' });
    expect(screen.queryByText('Drop files to upload')).toBeNull();

    // A drag entering the page while the modal is open never reopens the overlay.
    fireEvent.dragEnter(wrapper, { dataTransfer });
    expect(screen.queryByText('Drop files to upload')).toBeNull();
  });

  it('runs each of the four bulk actions with the right body', async () => {
    async function runAction(
      action: string,
      prepare: (dialog: HTMLElement) => void,
      expected: Record<string, unknown>,
    ) {
      const fetchMock = respondWith([
        inboxItem,
        { ...inboxItem, id: OTHER_ITEM_ID },
      ]);
      vi.stubGlobal('fetch', fetchMock);
      renderInboxPage();
      await screen.findAllByText('Placeholder Holding');

      fireEvent.click(screen.getByLabelText('Select all rows'));
      fireEvent.click(screen.getByRole('button', { name: action }));
      const dialog = await screen.findByRole('dialog', { name: action });
      expect(within(dialog).getByText('2 items selected.')).toBeVisible();
      prepare(dialog);
      fireEvent.click(within(dialog).getByRole('button', { name: action }));

      await waitFor(() => {
        expect(screen.getByText('2 of 2 items done.')).toBeVisible();
      });
      const bulkCall = fetchMock.mock.calls.find((call) =>
        String(call[0]).endsWith('/inbox/items/bulk'),
      )!;
      expect(
        JSON.parse(String((bulkCall[1] as RequestInit).body)),
      ).toMatchObject(expected);
      cleanup();
      vi.unstubAllGlobals();
    }

    await runAction('Approve', () => undefined, {
      action: 'approve',
      itemIds: [ITEM_ID, OTHER_ITEM_ID],
    });
    await runAction(
      'Discard',
      (dialog) => {
        fireEvent.change(within(dialog).getByLabelText('Discard reason'), {
          target: { value: 'spam' },
        });
      },
      { action: 'discard', itemIds: [ITEM_ID, OTHER_ITEM_ID], reason: 'spam' },
    );
    await runAction(
      'Assign',
      (dialog) => {
        fireEvent.change(within(dialog).getByLabelText('Assignee'), {
          target: { value: MEMBER_ID },
        });
      },
      {
        action: 'assign',
        assigneeId: MEMBER_ID,
        itemIds: [ITEM_ID, OTHER_ITEM_ID],
      },
    );
    await runAction(
      'Snooze',
      (dialog) => {
        fireEvent.change(within(dialog).getByLabelText('Snoozed until'), {
          target: { value: '2026-12-01T10:00' },
        });
      },
      { action: 'snooze', itemIds: [ITEM_ID, OTHER_ITEM_ID] },
    );
  });

  it('marks a row received after the stored baseline as New and marks none on a first visit', async () => {
    // A first visit has no baseline yet, so no row lights up even though items exist.
    vi.stubGlobal('fetch', respondWith([inboxItem]));
    const first = renderInboxPage();
    await screen.findByText('Placeholder Holding');
    expect(screen.queryByText('New')).toBeNull();
    first.unmount();
    cleanup();
    vi.unstubAllGlobals();

    // The first visit stored "now" as the baseline; an item received after it is New on reload.
    window.localStorage.setItem(
      'bap.inbox.lastSeen.organization_1',
      '2026-09-15T00:00:00.000Z',
    );
    vi.stubGlobal('fetch', respondWith([inboxItem]));
    renderInboxPage();
    await screen.findByText('Placeholder Holding');
    const table = screen.getByRole('table');
    expect(within(table).getByText('New')).toBeVisible();
  });

  it('hides the selection and the upload button without the manage capability', async () => {
    vi.stubGlobal('fetch', respondWith([inboxItem], false));

    renderInboxPage();
    await screen.findByText('Placeholder Holding');

    expect(screen.queryByLabelText('Select all rows')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Upload' })).toBeNull();
  });

  it('offers Sources and Rules in the overflow menu and no Settings entry', async () => {
    vi.stubGlobal('fetch', respondWith([inboxItem], true, true));

    renderInboxPage();
    await screen.findByText('Placeholder Holding');
    // The overflow button is named by its icon description; its items mount in a portal.
    fireEvent.click(await screen.findByRole('button', { name: 'Actions' }));
    const option = { selector: '.cds--overflow-menu-options__option-content' };
    expect(await screen.findByText('Sources', option)).toBeInTheDocument();
    expect(screen.getByText('Rules', option)).toBeInTheDocument();
    expect(screen.queryByText('Settings', option)).toBeNull();
  });
});
