import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The query the page reads on mount; a test sets it before rendering.
let search = '';

vi.mock('next/navigation', () => ({
  useParams: () => ({}),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}));

import { I18nProvider } from '../../../../i18n/client-provider';
import InboxRulesPage from './page';

const LEGAL_ENTITY_ID = '9b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21';
const CHANNEL_ID = '00000000-0000-4000-8000-000000000060';
const RULE_ID = '00000000-0000-4000-8000-000000000080';
const OTHER_RULE_ID = '00000000-0000-4000-8000-000000000081';
const PAUSED_RULE_ID = '00000000-0000-4000-8000-000000000082';
const PARTNER_ID = '00000000-0000-4000-8000-000000000090';

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

const channels = {
  channels: [
    {
      createdAt: '2026-09-17T08:00:00.000Z',
      credentials: [],
      emailAddress: null,
      enabled: true,
      hintKind: null,
      id: CHANNEL_ID,
      itemCount: 0,
      kind: 'api',
      legalEntityId: null,
      name: 'Payroll push',
      updatedAt: '2026-09-17T08:00:00.000Z',
    },
  ],
};

const baseRule = {
  autoRoute: false,
  channelId: null,
  createdAt: '2026-09-17T08:00:00.000Z',
  createdBy: 'user_1',
  detectedType: null,
  discardReason: null,
  enabled: true,
  keyword: null,
  paused: false,
  senderPattern: null,
  setAssigneeId: null,
  setDocumentKind: null,
  setLegalEntityId: null,
  setPartnerId: null,
  updatedAt: '2026-09-17T08:00:00.000Z',
};

// Three rules: a sender rule, a channel rule with auto-route, and a paused discard rule.
const rules = [
  {
    ...baseRule,
    id: RULE_ID,
    name: 'Supplier mail',
    priority: 1,
    senderPattern: '@dodavatel.cz',
    setDocumentKind: 'contract',
    setLegalEntityId: LEGAL_ENTITY_ID,
  },
  {
    ...baseRule,
    autoRoute: true,
    channelId: CHANNEL_ID,
    id: OTHER_RULE_ID,
    name: 'Payroll channel',
    priority: 2,
    setDocumentKind: 'hr_document',
  },
  {
    ...baseRule,
    createdBy: 'user_gone',
    discardReason: 'spam',
    enabled: false,
    id: PAUSED_RULE_ID,
    keyword: 'newsletter',
    name: 'Newsletters',
    paused: true,
    priority: 3,
  },
];

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

// The pdf row is changed; the other nine are platform defaults, sent out of order.
const targets = [
  ...['text', 'image'].map((detectedType) => ({
    ...platformTarget,
    detectedType,
  })),
  {
    ...platformTarget,
    auto: 'above_threshold',
    autoThreshold: 0.29,
    defaultAssigneeId: 'user_2',
    defaultLegalEntityId: LEGAL_ENTITY_ID,
    requiredFields: ['title'],
    source: 'organization',
  },
  {
    ...platformTarget,
    detectedType: 'isdoc_invoice',
    documentKind: 'received_invoice',
  },
  ...['money_s3_export', 'pohoda_export', 'unknown'].map((detectedType) => ({
    ...platformTarget,
    destination: null,
    detectedType,
    documentKind: null,
  })),
  ...['camt_statement', 'gpc_statement'].map((detectedType) => ({
    ...platformTarget,
    detectedType,
    documentKind: 'bank_statement',
  })),
  {
    ...platformTarget,
    destination: 'datasets',
    detectedType: 'tabular',
    documentKind: null,
  },
];

function capabilities(manageDocuments: boolean, manageOrganization: boolean) {
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
  manageDocuments = true,
  channelsStatus = 200,
  manageOrganization = manageDocuments,
  targetsStatus = 200,
  targetPutStatus = 200,
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
    if (input.endsWith('/inbox/channels')) {
      return channelsStatus === 200
        ? Response.json(channels)
        : Response.json({ error: 'access_denied' }, { status: channelsStatus });
    }
    if (input.endsWith('/inbox/routing-targets')) {
      return targetsStatus === 200
        ? Response.json({ targets })
        : Response.json({ error: 'failed' }, { status: targetsStatus });
    }
    if (input.includes('/inbox/routing-targets/') && init?.method === 'PUT') {
      if (targetPutStatus !== 200) {
        return Response.json({ error: 'failed' }, { status: targetPutStatus });
      }
      return Response.json({
        ...platformTarget,
        ...JSON.parse(String(init.body)),
        detectedType: input.slice(input.lastIndexOf('/') + 1),
        source: 'organization',
      });
    }
    if (
      input.includes('/inbox/routing-targets/') &&
      init?.method === 'DELETE'
    ) {
      return new Response(null, { status: 204 });
    }
    if (input.endsWith('/inbox/rules/order') && init?.method === 'PUT') {
      const { ruleIds } = JSON.parse(String(init.body)) as {
        ruleIds: string[];
      };
      return Response.json({
        rules: ruleIds.map((id, index) => ({
          ...rules.find((rule) => rule.id === id)!,
          priority: index + 1,
        })),
      });
    }
    if (input.endsWith('/adopt') && init?.method === 'POST') {
      return Response.json({ ...rules[2], createdBy: 'user_1', paused: false });
    }
    if (input.endsWith('/inbox/rules') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      if (body.name === 'Too many') {
        return Response.json(
          { code: 'rule_limit', error: 'inbox_rule_rejected' },
          { status: 422 },
        );
      }
      return Response.json(
        { ...baseRule, ...body, id: RULE_ID, priority: 4 },
        { status: 201 },
      );
    }
    if (input.includes('/inbox/rules/') && init?.method === 'PATCH') {
      const id = input.slice(input.lastIndexOf('/') + 1);
      return Response.json({
        ...rules.find((rule) => rule.id === id)!,
        ...JSON.parse(String(init.body)),
      });
    }
    if (input.includes('/inbox/rules/') && init?.method === 'DELETE') {
      return new Response(null, { status: 204 });
    }
    if (input.endsWith('/inbox/rules')) {
      return Response.json({ rules });
    }
    return new Response(null, { status: 404 });
  });
}

function calls(fetchMock: ReturnType<typeof respondWith>, method: string) {
  return fetchMock.mock.calls
    .filter((call) => call[1]?.method === method)
    .map(
      (call) =>
        [
          String(call[0]),
          call[1]?.body === undefined
            ? undefined
            : (JSON.parse(String(call[1].body)) as unknown),
        ] as const,
    );
}

// Waits until the page has settled after a write, so the next control is enabled again.
async function enabledButton(name: string) {
  await screen.findByRole('button', { name });
  await vi.waitFor(() => {
    expect(screen.getByRole('button', { name })).toBeEnabled();
  });
  // The refreshed list re-renders the row, so the element is read again after the wait.
  return screen.getByRole('button', { name });
}

function renderPage() {
  return render(
    <I18nProvider>
      <InboxRulesPage />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  search = '';
});

describe('InboxRulesPage', () => {
  it('renders the rules in priority order with conditions, actions and the paused tag', async () => {
    vi.stubGlobal('fetch', respondWith());

    renderPage();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Inbox rules' }),
    ).toBeVisible();
    await screen.findByText('Newsletters');
    const table = screen.getByRole('table');
    const bodyRows = within(table).getAllByRole('row').slice(1);
    expect(bodyRows).toHaveLength(3);
    expect(bodyRows[0]).toHaveTextContent('Supplier mail');
    expect(bodyRows[0]).toHaveTextContent('sender @dodavatel.cz');
    expect(bodyRows[0]).toHaveTextContent(
      'entity Placeholder Holding, kind Contract',
    );
    expect(bodyRows[1]).toHaveTextContent('channel Payroll push');
    expect(bodyRows[1]).toHaveTextContent('kind HR document, auto-route');
    expect(bodyRows[2]).toHaveTextContent('keyword "newsletter"');
    expect(bodyRows[2]).toHaveTextContent('discard: Spam');
    expect(bodyRows[2]).toHaveTextContent('Paused: author unavailable');
    expect(bodyRows[2]).toHaveTextContent('Off');
    expect(
      within(table).getByRole('button', { name: 'Adopt Newsletters' }),
    ).toBeVisible();
    expect(
      within(table).queryByRole('button', { name: 'Adopt Supplier mail' }),
    ).toBeNull();
    expect(
      within(table).getByRole('button', { name: 'Move Supplier mail up' }),
    ).toBeDisabled();
    expect(
      within(table).getByRole('button', { name: 'Move Newsletters down' }),
    ).toBeDisabled();
  });

  it('hides every control for a member', async () => {
    vi.stubGlobal('fetch', respondWith(false, 403));

    renderPage();

    expect(
      await screen.findByText(
        'Only an organization owner or admin can change inbox rules.',
      ),
    ).toBeVisible();
    await screen.findByText('Supplier mail');
    expect(screen.queryByRole('button', { name: 'Create rule' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Delete / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Adopt / })).toBeNull();
    // A refused channel list still shows the channel id in the condition.
    expect(screen.getByText(`channel ${CHANNEL_ID}`)).toBeVisible();
  });

  it('moves a rule down by putting the whole order', async () => {
    const fetchMock = respondWith();
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Move Supplier mail down' }),
    );

    await vi.waitFor(() => {
      expect(calls(fetchMock, 'PUT')).toEqual([
        [
          '/api/bff/application/organizations/organization_1/inbox/rules/order',
          { ruleIds: [OTHER_RULE_ID, RULE_ID, PAUSED_RULE_ID] },
        ],
      ]);
    });
  });

  it('disables, adopts and soft-deletes through the rule routes', async () => {
    const fetchMock = respondWith();
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Disable Supplier mail' }),
    );
    await vi.waitFor(() => {
      expect(calls(fetchMock, 'PATCH')).toEqual([
        [
          `/api/bff/application/organizations/organization_1/inbox/rules/${RULE_ID}`,
          { enabled: false },
        ],
      ]);
    });

    fireEvent.click(await enabledButton('Adopt Newsletters'));
    await vi.waitFor(() => {
      expect(calls(fetchMock, 'POST')).toEqual([
        [
          `/api/bff/application/organizations/organization_1/inbox/rules/${PAUSED_RULE_ID}/adopt`,
          undefined,
        ],
      ]);
    });

    fireEvent.click(await enabledButton('Delete Payroll channel'));
    await vi.waitFor(() => {
      expect(calls(fetchMock, 'DELETE')).toEqual([
        [
          `/api/bff/application/organizations/organization_1/inbox/rules/${OTHER_RULE_ID}`,
          undefined,
        ],
      ]);
    });
  });

  it('opens the create modal prefilled from the query and posts the scope choice', async () => {
    search = new URLSearchParams({
      assigneeId: 'user_2',
      channelId: CHANNEL_ID,
      detectedType: 'pdf',
      kind: 'contract',
      legalEntityId: LEGAL_ENTITY_ID,
      partnerId: PARTNER_ID,
      sender: '@dodavatel.cz',
    }).toString();
    const fetchMock = respondWith();
    vi.stubGlobal('fetch', fetchMock);

    renderPage();

    const dialog = await screen.findByRole('dialog', { name: 'New rule' });
    await within(dialog).findByText('Payroll push');
    expect(within(dialog).getByLabelText('Sender')).toHaveValue(
      '@dodavatel.cz',
    );
    expect(within(dialog).getByLabelText('Channel')).toHaveValue(CHANNEL_ID);
    expect(within(dialog).getByLabelText('Detected type')).toHaveValue('pdf');
    expect(within(dialog).getByLabelText('Legal entity')).toHaveValue(
      LEGAL_ENTITY_ID,
    );
    expect(within(dialog).getByLabelText('Document kind')).toHaveValue(
      'contract',
    );
    expect(within(dialog).getByLabelText('Partner id')).toHaveValue(PARTNER_ID);
    expect(within(dialog).getByLabelText('Assignee id')).toHaveValue('user_2');
    expect(within(dialog).getByLabelText('Discard reason')).toHaveValue('');
    expect(within(dialog).getByLabelText('Future items only')).toBeChecked();

    fireEvent.change(within(dialog).getByLabelText('Name'), {
      target: { value: 'Supplier contracts' },
    });
    fireEvent.click(
      within(dialog).getByLabelText(
        'Future items and the current review queue',
      ),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => {
      expect(calls(fetchMock, 'POST')).toEqual([
        [
          '/api/bff/application/organizations/organization_1/inbox/rules',
          {
            applyToExisting: true,
            autoRoute: false,
            channelId: CHANNEL_ID,
            detectedType: 'pdf',
            discardReason: null,
            enabled: true,
            keyword: null,
            name: 'Supplier contracts',
            senderPattern: '@dodavatel.cz',
            setAssigneeId: 'user_2',
            setDocumentKind: 'contract',
            setLegalEntityId: LEGAL_ENTITY_ID,
            setPartnerId: PARTNER_ID,
          },
        ],
      ]);
    });
  });

  it('prefills a discard rule, refuses an incomplete rule before sending, and names the rule limit', async () => {
    search = new URLSearchParams({
      discardReason: 'spam',
      sender: 'news@example.org',
    }).toString();
    const fetchMock = respondWith();
    vi.stubGlobal('fetch', fetchMock);

    renderPage();

    const dialog = await screen.findByRole('dialog', { name: 'New rule' });
    expect(within(dialog).getByLabelText('Discard reason')).toHaveValue('spam');

    // No name yet, so the contract refuses it here.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText(/The rule is incomplete/)).toBeVisible();
    expect(calls(fetchMock, 'POST')).toEqual([]);

    fireEvent.change(within(dialog).getByLabelText('Name'), {
      target: { value: 'Too many' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(
      await within(dialog).findByText(
        'This organization already has 200 enabled rules.',
      ),
    ).toBeVisible();
    expect(calls(fetchMock, 'POST')).toHaveLength(1);
  });

  it('shows the invoice-kind note and edits with a partial patch', async () => {
    const fetchMock = respondWith();
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Edit Supplier mail' }),
    );

    const dialog = screen.getByRole('dialog', {
      name: 'Edit rule Supplier mail',
    });
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Supplier mail');
    expect(within(dialog).queryByLabelText('Future items only')).toBeNull();
    expect(within(dialog).getByText(/Runs under your account/)).toBeVisible();

    fireEvent.change(within(dialog).getByLabelText('Document kind'), {
      target: { value: 'received_invoice' },
    });
    expect(
      within(dialog).getByText(/only from a clean parsed ISDOC/),
    ).toBeVisible();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => {
      expect(calls(fetchMock, 'PATCH')).toEqual([
        [
          `/api/bff/application/organizations/organization_1/inbox/rules/${RULE_ID}`,
          {
            autoRoute: false,
            channelId: null,
            detectedType: null,
            discardReason: null,
            keyword: null,
            name: 'Supplier mail',
            senderPattern: '@dodavatel.cz',
            setAssigneeId: null,
            setDocumentKind: 'received_invoice',
            setLegalEntityId: LEGAL_ENTITY_ID,
            setPartnerId: null,
          },
        ],
      ]);
    });
  });

  it('states the changed defaults before the collapsed platform defaults, with Change and Reset for an owner', async () => {
    vi.stubGlobal('fetch', respondWith());

    renderPage();

    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: 'Defaults by file type',
      }),
    ).toBeVisible();
    expect(screen.getByText(/Your rules above and a source's/)).toBeVisible();
    const changed = await screen.findByRole('list', {
      name: 'Changed defaults',
    });
    expect(within(changed).getAllByRole('listitem')).toHaveLength(1);
    expect(changed).toHaveTextContent(
      'A PDF goes to Documents as Other for Placeholder Holding; it is filed without review from 29% confidence, otherwise a person confirms it.',
    );
    const toggle = screen.getByRole('button', { name: 'Defaults (9)' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(
      changed.compareDocumentPosition(toggle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The platform rows keep the detected-type order, whatever order the API sent.
    const platform = screen.getByRole('list', { name: 'Platform defaults' });
    expect(
      within(platform)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'An ISDOC invoice goes to Documents as Received invoice; a person confirms every one.Change',
      'A Money S3 export waits in the inbox for a person to decide.Change',
      'A Pohoda export waits in the inbox for a person to decide.Change',
      'A CAMT bank statement goes to Documents as Bank statement; a person confirms every one.Change',
      'A GPC bank statement goes to Documents as Bank statement; a person confirms every one.Change',
      'A spreadsheet or CSV file goes to Datasets; a person confirms every one.Change',
      'An image goes to Documents as Other; a person confirms every one.Change',
      'A text file goes to Documents as Other; a person confirms every one.Change',
      'Any other file waits in the inbox for a person to decide.Change',
    ]);
    expect(
      screen.getByRole('button', { name: 'Change what happens to a PDF' }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Reset to default for a PDF' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Reset to default for an image' }),
    ).toBeNull();
    expect(
      screen.queryByText('Only an owner can change the defaults.'),
    ).toBeNull();
  });

  it('shows the defaults read only to an admin', async () => {
    vi.stubGlobal('fetch', respondWith(true, 403, false));

    renderPage();

    expect(
      await screen.findByText('Only an owner can change the defaults.'),
    ).toBeVisible();
    expect(
      screen.getByRole('list', { name: 'Changed defaults' }),
    ).toHaveTextContent('A PDF goes to Documents as Other');
    expect(screen.queryByRole('button', { name: /^Change what/ })).toBeNull();
    expect(
      screen.queryByRole('button', { name: /^Reset to default/ }),
    ).toBeNull();
    // Rule controls stay with manageDocuments.
    expect(screen.getByRole('button', { name: 'Create rule' })).toBeVisible();
  });

  it('prefills a whole-percent confidence, previews the form and puts the whole target', async () => {
    const fetchMock = respondWith();
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Change what happens to a PDF',
      }),
    );

    const dialog = screen.getByRole('dialog', { name: 'Edit default' });
    expect(within(dialog).getByLabelText('Confidence (%)')).toHaveValue('29');
    expect(within(dialog).getByLabelText('Legal entity')).toHaveValue(
      LEGAL_ENTITY_ID,
    );
    expect(
      within(dialog).getByText(
        'A PDF goes to Documents as Other for Placeholder Holding; it is filed without review from 29% confidence, otherwise a person confirms it.',
      ),
    ).toBeVisible();
    expect(within(dialog).queryByLabelText(/assignee/i)).toBeNull();

    fireEvent.change(within(dialog).getByLabelText('Confidence (%)'), {
      target: { value: '90' },
    });
    expect(
      within(dialog).getByText(/filed without review from 90% confidence/),
    ).toBeVisible();
    fireEvent.change(within(dialog).getByLabelText('Legal entity'), {
      target: { value: '' },
    });
    fireEvent.change(within(dialog).getByLabelText('Document kind'), {
      target: { value: 'received_invoice' },
    });
    expect(
      within(dialog).getByText(
        'A PDF goes to Documents as Received invoice; it may file without review after a clean ISDOC parse and matching legal entity and partner, otherwise a person confirms it.',
      ),
    ).toBeVisible();
    fireEvent.change(within(dialog).getByLabelText('Document kind'), {
      target: { value: 'contract' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => {
      expect(calls(fetchMock, 'PUT')).toEqual([
        [
          '/api/bff/application/organizations/organization_1/inbox/routing-targets/pdf',
          {
            auto: 'above_threshold',
            autoThreshold: 0.9,
            defaultAssigneeId: 'user_2',
            defaultLegalEntityId: null,
            destination: 'documents',
            documentKind: 'contract',
            partnerPolicy: 'match_only',
            requiredFields: ['title'],
          },
        ],
      ]);
    });
  });

  it('refuses a confidence outside 0 to 100 before sending', async () => {
    const fetchMock = respondWith();
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Change what happens to a PDF',
      }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Edit default' });
    fireEvent.change(within(dialog).getByLabelText('Confidence (%)'), {
      target: { value: '150' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(within(dialog).getByText(/The default is incomplete/)).toBeVisible();
    expect(calls(fetchMock, 'PUT')).toEqual([]);
  });

  it('shows a failed save inside the still open dialog, and clears it when Change opens it again', async () => {
    vi.stubGlobal('fetch', respondWith(true, 200, true, 200, 500));

    renderPage();
    const change = await screen.findByRole('button', {
      name: 'Change what happens to a PDF',
    });
    fireEvent.click(change);
    const dialog = screen.getByRole('dialog', { name: 'Edit default' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(
      await within(dialog).findByText('The default could not be saved.'),
    ).toBeVisible();
    expect(screen.getAllByText('The default could not be saved.')).toHaveLength(
      1,
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(await enabledButton('Change what happens to a PDF'));
    expect(screen.queryByText('The default could not be saved.')).toBeNull();
  });

  it('resets a changed default through the target route', async () => {
    const fetchMock = respondWith();
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Reset to default for a PDF' }),
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

  it('keeps the rules grid when the defaults read fails', async () => {
    vi.stubGlobal('fetch', respondWith(true, 200, true, 500));

    renderPage();

    expect(
      await screen.findByText('The defaults could not be loaded.'),
    ).toBeVisible();
    expect(screen.getByText('Supplier mail')).toBeVisible();
    expect(
      screen.queryByText('The inbox rules could not be loaded.'),
    ).toBeNull();
    expect(screen.queryByText('You have not changed any default.')).toBeNull();
  });
});
