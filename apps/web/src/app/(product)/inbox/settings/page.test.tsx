import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useParams: () => ({}),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));

import { I18nProvider } from '../../../../i18n/client-provider';
import InboxSettingsPage from './page';

const LEGAL_ENTITY_ID = '9b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21';
const PLATFORM_QUOTA_BYTES = 10_000_000_000;

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

const platformTarget = {
  auto: 'never',
  autoThreshold: null,
  defaultAssigneeId: null,
  defaultLegalEntityId: null,
  destination: 'documents',
  detectedType: 'pdf',
  documentKind: 'other',
  partnerPolicy: 'match_only',
  requiredFields: [],
  source: 'platform',
};

// Ten detected types: one organization override, one invoice kind, one discard, one with no destination yet.
const targets = [
  {
    ...platformTarget,
    auto: 'above_threshold',
    autoThreshold: 0.85,
    defaultAssigneeId: 'user_2',
    defaultLegalEntityId: LEGAL_ENTITY_ID,
    documentKind: 'contract',
    requiredFields: ['title', 'documentDate'],
    source: 'organization',
  },
  {
    ...platformTarget,
    detectedType: 'isdoc_invoice',
    documentKind: 'received_invoice',
  },
  {
    ...platformTarget,
    destination: 'discard',
    detectedType: 'spam_like',
    documentKind: null,
  },
  {
    ...platformTarget,
    destination: null,
    detectedType: 'unknown',
    documentKind: null,
  },
  ...['image', 'email', 'csv', 'xlsx', 'xml', 'text'].map((detectedType) => ({
    ...platformTarget,
    detectedType,
  })),
];

const settings = {
  blobQuotaBytes: null,
  platformQuotaBytes: PLATFORM_QUOTA_BYTES,
  usedBytes: 2_500_000,
};

function capabilities(manageOrganization: boolean) {
  return {
    createEntities: false,
    deleteEntities: false,
    manageDocuments: true,
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
function respondWith(manageOrganization = true) {
  let quotaBytes: number | null = null;
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
        capabilities: capabilities(manageOrganization),
        organizationId: 'organization_1',
      });
    }
    if (input.endsWith('/legal-entities')) {
      return Response.json(legalEntities);
    }
    if (input.endsWith('/inbox/routing-targets')) {
      return Response.json({ targets });
    }
    if (input.includes('/inbox/routing-targets/') && init?.method === 'PUT') {
      const type = input.slice(input.lastIndexOf('/') + 1);
      return Response.json({
        ...platformTarget,
        ...JSON.parse(String(init.body)),
        detectedType: type,
        source: 'organization',
      });
    }
    if (
      input.includes('/inbox/routing-targets/') &&
      init?.method === 'DELETE'
    ) {
      return new Response(null, { status: 204 });
    }
    if (input.endsWith('/inbox/settings') && init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body));
      return body.blobQuotaBytes > PLATFORM_QUOTA_BYTES
        ? Response.json({ error: 'inbox_settings_rejected' }, { status: 422 })
        : ((quotaBytes = body.blobQuotaBytes),
          Response.json({ ...settings, blobQuotaBytes: quotaBytes }));
    }
    if (input.endsWith('/inbox/settings')) {
      return Response.json({ ...settings, blobQuotaBytes: quotaBytes });
    }
    return new Response(null, { status: 404 });
  });
}

function calls(fetchMock: ReturnType<typeof respondWith>, method: string) {
  return fetchMock.mock.calls
    .filter((call) => call[1]?.method === method)
    .map((call) => [String(call[0]), call[1]?.body] as const);
}

function renderPage() {
  return render(
    <I18nProvider>
      <InboxSettingsPage />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('InboxSettingsPage', () => {
  it('renders the ten detected types with destination, kind, entity, policy, threshold, assignee and source', async () => {
    vi.stubGlobal('fetch', respondWith());

    renderPage();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Inbox settings' }),
    ).toBeVisible();
    await screen.findByText('isdoc_invoice');
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(11);
    expect(within(table).getByText('Placeholder Holding')).toBeVisible();
    expect(within(table).getByText('Contract')).toBeVisible();
    expect(within(table).getByText('Received invoice')).toBeVisible();
    expect(within(table).getByText('Above threshold')).toBeVisible();
    expect(within(table).getByText('Takes effect with rules.')).toBeVisible();
    expect(within(table).getByText('0.85')).toBeVisible();
    expect(within(table).getByText('user_2')).toBeVisible();
    expect(within(table).getByText('Discard')).toBeVisible();
    expect(within(table).getByText('No destination')).toBeVisible();
    expect(within(table).getByText('Organization')).toBeVisible();
    expect(within(table).getAllByText('Platform default')).toHaveLength(9);
    expect(
      within(table).getByRole('button', {
        name: 'Reset pdf to platform default',
      }),
    ).toBeVisible();
    expect(
      within(table).queryByRole('button', {
        name: 'Reset isdoc_invoice to platform default',
      }),
    ).toBeNull();
    expect(
      screen.getByText(
        'Platform cap 10,000 MB. In use 2.5 MB. Leave empty to use the platform default.',
      ),
    ).toBeVisible();
  });

  it('hides the edit controls and the quota form for a non-owner', async () => {
    vi.stubGlobal('fetch', respondWith(false));

    renderPage();

    expect(
      await screen.findByText(
        'Only an organization owner can change inbox settings.',
      ),
    ).toBeVisible();
    await screen.findByText('isdoc_invoice');
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Reset / })).toBeNull();
    expect(screen.queryByRole('form', { name: 'Storage quota' })).toBeNull();
    expect(
      screen.getByText(/Storage quota \(MB\): Platform default/),
    ).toBeVisible();
  });

  it('prefills the edit modal from the effective target and puts the whole target', async () => {
    const fetchMock = respondWith();
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit pdf' }));

    const dialog = screen.getByRole('dialog', {
      name: 'Routing target for pdf',
    });
    expect(within(dialog).getByLabelText('Destination')).toHaveValue(
      'documents',
    );
    expect(within(dialog).getByLabelText('Document kind')).toHaveValue(
      'contract',
    );
    expect(within(dialog).getByLabelText('Default entity')).toHaveValue(
      LEGAL_ENTITY_ID,
    );
    expect(within(dialog).getByLabelText('Auto policy')).toHaveValue(
      'above_threshold',
    );
    expect(within(dialog).getByLabelText('Threshold (0 to 1)')).toHaveValue(
      '0.85',
    );
    expect(within(dialog).getByLabelText('Required fields')).toHaveValue(
      'title, documentDate',
    );
    expect(
      within(dialog).getByText(
        'Automatic routing runs under the account that saved this row.',
      ),
    ).toBeVisible();
    expect(within(dialog).getByText('Takes effect with rules.')).toBeVisible();

    fireEvent.change(within(dialog).getByLabelText('Threshold (0 to 1)'), {
      target: { value: '0.9' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => {
      expect(calls(fetchMock, 'PUT')).toEqual([
        [
          '/api/bff/application/organizations/organization_1/inbox/routing-targets/pdf',
          JSON.stringify({
            auto: 'above_threshold',
            autoThreshold: 0.9,
            defaultAssigneeId: 'user_2',
            defaultLegalEntityId: LEGAL_ENTITY_ID,
            destination: 'documents',
            documentKind: 'contract',
            partnerPolicy: 'match_only',
            requiredFields: ['title', 'documentDate'],
          }),
        ],
      ]);
    });
  });

  it('explains the invoice kind wait and refuses an incomplete target before sending', async () => {
    const fetchMock = respondWith();
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Edit isdoc_invoice' }),
    );

    const dialog = screen.getByRole('dialog', {
      name: 'Routing target for isdoc_invoice',
    });
    expect(
      within(dialog).getByText(/waits for the ISDOC parser/),
    ).toBeVisible();
    expect(within(dialog).getByLabelText('Auto policy')).toBeEnabled();

    // A threshold policy with no threshold is refused here, exactly as the API would refuse it.
    fireEvent.change(within(dialog).getByLabelText('Auto policy'), {
      target: { value: 'above_threshold' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(within(dialog).getByText(/The target is incomplete/)).toBeVisible();
    expect(calls(fetchMock, 'PUT')).toEqual([]);
  });

  it('prefills a null destination as unset and requires a choice before saving', async () => {
    const fetchMock = respondWith();
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Edit unknown' }),
    );

    const dialog = screen.getByRole('dialog', {
      name: 'Routing target for unknown',
    });
    expect(within(dialog).getByLabelText('Destination')).toHaveValue('');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(within(dialog).getByText(/The target is incomplete/)).toBeVisible();
    expect(calls(fetchMock, 'PUT')).toEqual([]);

    fireEvent.change(within(dialog).getByLabelText('Destination'), {
      target: { value: 'discard' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => {
      expect(calls(fetchMock, 'PUT')).toHaveLength(1);
    });
  });

  it('resets an organization row to the platform default', async () => {
    const fetchMock = respondWith();
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Reset pdf to platform default',
      }),
    );

    await vi.waitFor(() => {
      expect(calls(fetchMock, 'DELETE')).toEqual([
        [
          '/api/bff/application/organizations/organization_1/inbox/routing-targets/pdf',
          undefined,
        ],
      ]);
    });
  });

  it('saves the quota in bytes and names a quota above the platform cap', async () => {
    const fetchMock = respondWith();
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    const form = await screen.findByRole('form', { name: 'Storage quota' });
    fireEvent.change(within(form).getByLabelText('Storage quota (MB)'), {
      target: { value: '500' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Save quota' }));

    await vi.waitFor(() => {
      expect(calls(fetchMock, 'PATCH')).toEqual([
        [
          '/api/bff/application/organizations/organization_1/inbox/settings',
          JSON.stringify({ blobQuotaBytes: 500_000_000 }),
        ],
      ]);
    });

    // A saved quota rereads the settings, so the form is a fresh render.
    await vi.waitFor(() => {
      expect(screen.getByLabelText('Storage quota (MB)')).toHaveValue('500');
    });
    fireEvent.change(screen.getByLabelText('Storage quota (MB)'), {
      target: { value: '20000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save quota' }));

    expect(
      await screen.findByText(
        'The quota cannot exceed the platform cap of 10,000 MB.',
      ),
    ).toBeVisible();

    fireEvent.change(screen.getByLabelText('Storage quota (MB)'), {
      target: { value: '1.5' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save quota' }));

    expect(screen.getByLabelText('Storage quota (MB)')).toBeInvalid();
    expect(calls(fetchMock, 'PATCH')).toHaveLength(2);
  });
});
