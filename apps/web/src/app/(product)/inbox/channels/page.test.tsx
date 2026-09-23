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
import InboxChannelsPage from './page';

const LEGAL_ENTITY_ID = '9b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21';
const CHANNEL_ID = '00000000-0000-4000-8000-000000000060';
const CREDENTIAL_ID = '00000000-0000-4000-8000-000000000061';
const SECRET = `bap_intake_${'A'.repeat(43)}`;
const EMAIL_CHANNEL_ID = '00000000-0000-4000-8000-000000000062';
const EMAIL_CREDENTIAL_ID = '00000000-0000-4000-8000-000000000063';
const ADDRESS = `in-${'b'.repeat(32)}@in.bap.localhost`;

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

const channel = {
  createdAt: '2026-09-17T08:00:00.000Z',
  credentials: [
    {
      createdAt: '2026-09-17T08:00:00.000Z',
      credentialId: CREDENTIAL_ID,
      displayPrefix: 'AAAAAAAA',
      lastUsedAt: '2026-09-17T09:00:00.000Z',
    },
  ],
  emailAddress: null,
  enabled: true,
  hintKind: 'invoice',
  id: CHANNEL_ID,
  itemCount: 4,
  kind: 'api',
  legalEntityId: LEGAL_ENTITY_ID,
  name: 'Placeholder push',
  updatedAt: '2026-09-17T08:00:00.000Z',
};

const emailChannel = {
  ...channel,
  credentials: [
    {
      createdAt: '2026-09-17T08:00:00.000Z',
      credentialId: EMAIL_CREDENTIAL_ID,
      displayPrefix: 'bbbbbbbb',
      lastUsedAt: null,
    },
  ],
  emailAddress: ADDRESS,
  hintKind: null,
  id: EMAIL_CHANNEL_ID,
  itemCount: 1,
  kind: 'email',
  name: 'Placeholder mailbox',
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
function respondWith(channels: unknown[], manageOrganization = true) {
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
    if (input.endsWith('/credentials') && init?.method === 'POST') {
      return Response.json(
        input.includes(EMAIL_CHANNEL_ID)
          ? {
              credentialId: EMAIL_CREDENTIAL_ID,
              displayPrefix: 'bbbbbbbb',
              secret: ADDRESS,
            }
          : {
              credentialId: CREDENTIAL_ID,
              displayPrefix: 'AAAAAAAA',
              secret: SECRET,
            },
        { status: 201 },
      );
    }
    if (
      input.endsWith(`/credentials/${CREDENTIAL_ID}`) ||
      input.endsWith(`/credentials/${EMAIL_CREDENTIAL_ID}`)
    ) {
      return new Response(null, { status: 204 });
    }
    if (input.endsWith('/inbox/channels') && init?.method === 'POST') {
      return Response.json(
        { ...channel, ...JSON.parse(String(init.body)) },
        { status: 201 },
      );
    }
    if (input.endsWith(`/inbox/channels/${CHANNEL_ID}`)) {
      return Response.json({ ...channel, ...JSON.parse(String(init?.body)) });
    }
    if (input.endsWith(`/inbox/channels/${EMAIL_CHANNEL_ID}`)) {
      return Response.json({
        ...emailChannel,
        ...JSON.parse(String(init?.body)),
      });
    }
    if (input.endsWith('/inbox/channels')) {
      return Response.json({ channels });
    }
    return new Response(null, { status: 404 });
  });
}

function calls(fetchMock: ReturnType<typeof respondWith>, method: string) {
  return fetchMock.mock.calls
    .filter((call) => call[1]?.method === method)
    .map((call) => [String(call[0]), call[1]?.body] as const);
}

function listReads(fetchMock: ReturnType<typeof respondWith>): number {
  return fetchMock.mock.calls.filter(
    (call) =>
      String(call[0]).endsWith('/inbox/channels') &&
      call[1]?.method === undefined,
  ).length;
}

function renderPage() {
  return render(
    <I18nProvider>
      <InboxChannelsPage />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubClipboard() {
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

describe('InboxChannelsPage', () => {
  it('lists the API channels with entity, hint, count, prefixes and last use', async () => {
    vi.stubGlobal('fetch', respondWith([channel]));

    renderPage();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sources' }),
    ).toBeVisible();
    expect(await screen.findByText('Placeholder push')).toBeVisible();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Enabled')).toBeVisible();
    expect(within(table).getByText('Placeholder Holding')).toBeVisible();
    expect(within(table).getByText('invoice')).toBeVisible();
    expect(within(table).getByText('4')).toBeVisible();
    expect(within(table).getByText('AAAAAAAA')).toBeVisible();
    expect(within(table).getByText('2026-09-17T09:00:00.000Z')).toBeVisible();
    expect(
      within(table).getByRole('button', { name: 'Revoke AAAAAAAA' }),
    ).toBeVisible();
  });

  it('lists an email channel with its address, a copy button and address wording', async () => {
    vi.stubGlobal('fetch', respondWith([channel, emailChannel]));
    const writeText = stubClipboard();

    renderPage();
    await screen.findByText('Placeholder mailbox');
    const table = screen.getByRole('table');

    expect(within(table).getByText(ADDRESS)).toBeVisible();
    expect(within(table).getByText('Email')).toBeVisible();
    expect(within(table).getByText('API')).toBeVisible();
    expect(
      within(table).getByRole('button', { name: 'Issue address' }),
    ).toBeVisible();
    expect(
      within(table).getByRole('button', { name: 'Issue credential' }),
    ).toBeVisible();
    expect(
      within(table).getByRole('button', { name: 'Revoke address bbbbbbbb' }),
    ).toBeVisible();
    fireEvent.click(
      within(table).getByRole('button', { name: 'Copy address' }),
    );
    expect(writeText).toHaveBeenCalledWith(ADDRESS);
  });

  it('creates an email channel from the kind selector', async () => {
    const fetchMock = respondWith([]);
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    const form = await screen.findByRole('form', { name: 'New channel' });
    fireEvent.change(within(form).getByLabelText('Name'), {
      target: { value: 'Placeholder mailbox' },
    });
    fireEvent.change(within(form).getByLabelText('Kind'), {
      target: { value: 'email' },
    });
    expect(
      within(form).getByText(
        'People forward messages to an address issued for this channel.',
      ),
    ).toBeVisible();
    fireEvent.click(
      within(form).getByRole('button', { name: 'Create channel' }),
    );

    await vi.waitFor(() => {
      expect(calls(fetchMock, 'POST')).toEqual([
        [
          '/api/bff/application/organizations/organization_1/inbox/channels',
          JSON.stringify({ kind: 'email', name: 'Placeholder mailbox' }),
        ],
      ]);
    });
    await vi.waitFor(() => {
      expect(within(form).getByLabelText('Kind')).toHaveValue('api');
    });
  });

  it('shows an issued address with copy and forwarding guidance, no curl example', async () => {
    const fetchMock = respondWith([emailChannel]);
    vi.stubGlobal('fetch', fetchMock);
    const writeText = stubClipboard();

    renderPage();
    await screen.findByText('Placeholder mailbox');
    fireEvent.click(
      within(screen.getByRole('table')).getByRole('button', {
        name: 'Issue address',
      }),
    );

    const dialog = await screen.findByRole('dialog', {
      name: 'Address issued',
    });
    expect(within(dialog).getByLabelText('Address')).toHaveValue(ADDRESS);
    expect(
      within(dialog).getByText(
        /Forwarding a message to this address delivers it into this channel/,
      ),
    ).toBeVisible();
    expect(within(dialog).queryByText(/curl -X POST/)).toBeNull();
    expect(screen.queryByLabelText('Secret')).toBeNull();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Copy address' }),
    );
    expect(writeText).toHaveBeenCalledWith(ADDRESS);
    expect(calls(fetchMock, 'POST').map(([path]) => path)).toEqual([
      `/api/bff/application/organizations/organization_1/inbox/channels/${EMAIL_CHANNEL_ID}/credentials`,
    ]);
  });

  it('revokes an address with address wording', async () => {
    const fetchMock = respondWith([emailChannel]);
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    await screen.findByText('Placeholder mailbox');
    fireEvent.click(
      within(screen.getByRole('table')).getByRole('button', {
        name: 'Revoke address bbbbbbbb',
      }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Revoke address' });
    expect(
      within(dialog).getByText(
        'Revoke the address starting in-bbbbbbbb? Mail sent to it is refused from now on; issue a new address afterwards.',
      ),
    ).toBeVisible();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Revoke address' }),
    );

    await vi.waitFor(() => {
      expect(calls(fetchMock, 'DELETE')).toEqual([
        [
          `/api/bff/application/organizations/organization_1/inbox/channels/${EMAIL_CHANNEL_ID}/credentials/${EMAIL_CREDENTIAL_ID}`,
          undefined,
        ],
      ]);
    });
  });

  it('creates a channel from the form and refreshes the list', async () => {
    const fetchMock = respondWith([]);
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    const form = await screen.findByRole('form', { name: 'New channel' });
    fireEvent.change(within(form).getByLabelText('Name'), {
      target: { value: 'Placeholder push' },
    });
    fireEvent.change(within(form).getByLabelText('Legal entity'), {
      target: { value: LEGAL_ENTITY_ID },
    });
    fireEvent.change(within(form).getByLabelText('Kind hint'), {
      target: { value: 'invoice' },
    });
    fireEvent.click(
      within(form).getByRole('button', { name: 'Create channel' }),
    );

    await vi.waitFor(() => {
      expect(calls(fetchMock, 'POST')).toEqual([
        [
          '/api/bff/application/organizations/organization_1/inbox/channels',
          JSON.stringify({
            hintKind: 'invoice',
            kind: 'api',
            legalEntityId: LEGAL_ENTITY_ID,
            name: 'Placeholder push',
          }),
        ],
      ]);
    });
    await vi.waitFor(() => {
      expect(listReads(fetchMock)).toBe(2);
    });
  });

  it('marks an invalid kind hint instead of dropping it', async () => {
    const fetchMock = respondWith([]);
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    const form = await screen.findByRole('form', { name: 'New channel' });
    fireEvent.change(within(form).getByLabelText('Name'), {
      target: { value: 'Placeholder push' },
    });
    fireEvent.change(within(form).getByLabelText('Kind hint'), {
      target: { value: 'Not A Token' },
    });
    fireEvent.click(
      within(form).getByRole('button', { name: 'Create channel' }),
    );

    expect(within(form).getByLabelText('Kind hint')).toBeInvalid();
    expect(
      within(form).getByText(/A kind hint is lowercase letters/),
    ).toBeInTheDocument();
    expect(calls(fetchMock, 'POST')).toEqual([]);

    // A corrected hint clears the mark and the request carries it.
    fireEvent.change(within(form).getByLabelText('Kind hint'), {
      target: { value: 'invoice' },
    });
    fireEvent.click(
      within(form).getByRole('button', { name: 'Create channel' }),
    );

    await vi.waitFor(() => {
      expect(calls(fetchMock, 'POST')).toHaveLength(1);
    });
    expect(within(form).getByLabelText('Kind hint')).toBeValid();
    expect(JSON.parse(String(calls(fetchMock, 'POST')[0]?.[1]))).toMatchObject({
      hintKind: 'invoice',
    });
  });

  it('shows an issued secret once with the curl example, then disables and deletes', async () => {
    const fetchMock = respondWith([channel]);
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    await screen.findByText('Placeholder push');
    const table = screen.getByRole('table');
    fireEvent.click(
      within(table).getByRole('button', { name: 'Issue credential' }),
    );

    const secretField = await screen.findByLabelText('Secret');
    expect(secretField).toHaveValue(SECRET);
    expect(
      screen.getByText(
        'Copy the secret now. It is shown once and cannot be recovered.',
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        new RegExp(
          `curl -X POST .*/api/intake/v1/items -H "Authorization: Bearer ${SECRET}" -F file=@invoice.pdf`,
        ),
      ),
    ).toBeVisible();

    fireEvent.click(
      within(
        screen.getByRole('dialog', { name: 'Credential issued' }),
      ).getByRole('button', { name: 'Close' }),
    );
    expect(screen.queryByLabelText('Secret')).toBeNull();
    // Issuing refreshed the list, so the grid is a fresh render.
    await screen.findByText('Placeholder push');
    fireEvent.click(await screen.findByRole('button', { name: 'Disable' }));
    await vi.waitFor(() => {
      expect(calls(fetchMock, 'PATCH')).toEqual([
        [
          `/api/bff/application/organizations/organization_1/inbox/channels/${CHANNEL_ID}`,
          JSON.stringify({ enabled: false }),
        ],
      ]);
    });

    // The list stub always answers the same row, so the grid settles on the original channel.
    await vi.waitFor(() => {
      expect(listReads(fetchMock)).toBe(3);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(
      screen.getByText(
        'Delete the channel Placeholder push? Its credentials stop working immediately. Items already received stay in the inbox.',
      ),
    ).toBeVisible();
    const dialog = screen.getByRole('dialog', { name: 'Delete channel' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await vi.waitFor(() => {
      expect(calls(fetchMock, 'PATCH').at(-1)?.[1]).toBe(
        JSON.stringify({ deleted: true, enabled: false }),
      );
    });
  });

  it('revokes a credential after confirmation', async () => {
    const fetchMock = respondWith([channel]);
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    await screen.findByText('Placeholder push');
    const table = screen.getByRole('table');
    fireEvent.click(
      within(table).getByRole('button', { name: 'Revoke AAAAAAAA' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Revoke credential' });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Revoke credential' }),
    );

    await vi.waitFor(() => {
      expect(calls(fetchMock, 'DELETE')).toEqual([
        [
          `/api/bff/application/organizations/organization_1/inbox/channels/${CHANNEL_ID}/credentials/${CREDENTIAL_ID}`,
          undefined,
        ],
      ]);
    });
  });

  it('hides the form and the actions without manageOrganization', async () => {
    vi.stubGlobal('fetch', respondWith([channel], false));

    renderPage();

    expect(
      await screen.findByText(
        'Only an organization owner can manage channels.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('form', { name: 'New channel' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Issue credential' }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });
});
