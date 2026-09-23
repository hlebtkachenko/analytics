import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cancelInvitation: vi.fn(),
  getSession: vi.fn(),
  inviteMember: vi.fn(),
  inviteMemberWithScopeAction: vi.fn(),
  listInvitations: vi.fn(),
  listInvitationsClient: vi.fn(),
  listMembers: vi.fn(),
  listMembersClient: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  readLegalEntities: vi.fn(),
  readMemberEntityScopes: vi.fn(),
  readOrganizationAccess: vi.fn(),
  removeMember: vi.fn(),
  replace: vi.fn(),
  resolveOrganizationRouteForRequest: vi.fn(),
  search: '',
  transferOwnershipAction: vi.fn(),
  updateMemberRole: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
  usePathname: () => '/organization-one/members',
  useRouter: () => ({ refresh: vi.fn(), replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../../../lib/auth/server', () => ({
  getAuth: async () => ({
    api: {
      getSession: mocks.getSession,
      listInvitations: mocks.listInvitations,
      listMembers: mocks.listMembers,
    },
  }),
}));
vi.mock('../../../../lib/auth/client', () => ({
  authClient: {
    organization: {
      cancelInvitation: mocks.cancelInvitation,
      inviteMember: mocks.inviteMember,
      listInvitations: mocks.listInvitationsClient,
      listMembers: mocks.listMembersClient,
      removeMember: mocks.removeMember,
      updateMemberRole: mocks.updateMemberRole,
    },
  },
}));
vi.mock('../../../../lib/organizations/entities', () => ({
  readLegalEntities: mocks.readLegalEntities,
  readMemberEntityScopes: mocks.readMemberEntityScopes,
  readOrganizationAccess: mocks.readOrganizationAccess,
}));
vi.mock('../../../../lib/organizations/resolver', () => ({
  resolveOrganizationRouteForRequest: mocks.resolveOrganizationRouteForRequest,
}));
vi.mock('../../../../lib/organizations/actions', () => ({
  inviteMemberWithScopeAction: mocks.inviteMemberWithScopeAction,
  transferOwnershipAction: mocks.transferOwnershipAction,
}));

import { ToastProvider } from '../../../../components/shell/toast';
import { I18nProvider } from '../../../../i18n/client-provider';
import OrganizationMembersPage from './page';

const LEGAL_ENTITY_ID = '9b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21';
const OTHER_LEGAL_ENTITY_ID = '4c2f8b11-8c35-4a2e-9f61-1de2f0a7c934';

const owner = {
  createdAt: '2026-09-01T00:00:00.000Z',
  id: 'member-1',
  role: 'owner',
  user: { email: 'owner@bap.test', name: 'Ada Owner' },
  userId: 'user-1',
};
const member = {
  createdAt: '2026-09-02T00:00:00.000Z',
  id: 'member-2',
  role: 'member',
  user: { email: 'member@bap.test', name: 'Ben Member' },
  userId: 'user-2',
};

const pendingInvitation = {
  email: 'guest@bap.test',
  expiresAt: '2999-01-01T00:00:00.000Z',
  id: 'invitation-1',
  role: 'member',
  status: 'pending',
};
const staleInvitation = {
  email: 'stale@bap.test',
  expiresAt: '2000-01-01T00:00:00.000Z',
  id: 'invitation-2',
  role: 'member',
  status: 'pending',
};

const legalEntities = [
  {
    createdAt: '2026-09-10T06:00:00.000Z',
    id: LEGAL_ENTITY_ID,
    kind: 'company',
    name: 'Placeholder Holding',
    registrationNumber: null,
    updatedAt: '2026-09-10T06:00:00.000Z',
  },
  {
    createdAt: '2026-09-10T06:00:00.000Z',
    id: OTHER_LEGAL_ENTITY_ID,
    kind: 'sole_trader',
    name: 'Placeholder Trader',
    registrationNumber: null,
    updatedAt: '2026-09-10T06:00:00.000Z',
  },
];

function accessFor(role: 'admin' | 'member' | 'owner') {
  return {
    capabilities: {
      createEntities: role !== 'member',
      deleteEntities: role === 'owner',
      manageDocuments: role !== 'member',
      manageHr: false,
      managePayroll: false,
      manageSensitiveHr: false,
      readHr: false,
      readPayroll: false,
      readSensitiveHr: false,
      approvePayroll: false,
      manageEntityAccess: role === 'owner',
      manageMembers: role === 'owner',
      manageOrganization: role === 'owner',
      readDocuments: true,
      updateEntities: role !== 'member',
      uploadData: role !== 'member',
      useAi: true,
    },
    organizationId: 'organization-1',
    role,
  };
}

async function renderPage() {
  const ui = await OrganizationMembersPage({
    params: Promise.resolve({ orgSlug: 'organization-one' }),
  });
  return render(
    <I18nProvider>
      <ToastProvider>{ui}</ToastProvider>
    </I18nProvider>,
  );
}

function rowFor(text: string): HTMLElement {
  const row = screen.getByText(text).closest('tr');
  if (row === null) {
    throw new Error('row not found');
  }
  return row;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('OrganizationMembersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom lacks scrollIntoView, which Carbon MultiSelect calls on open.
    Element.prototype.scrollIntoView = vi.fn();
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
    mocks.search = '';
    mocks.resolveOrganizationRouteForRequest.mockResolvedValue({
      id: 'organization-1',
      name: 'Organization One',
      role: 'owner',
      slug: 'organization-one',
    });
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } });
    mocks.readOrganizationAccess.mockResolvedValue(accessFor('owner'));
    mocks.listMembers.mockResolvedValue({ members: [owner, member] });
    mocks.listInvitations.mockResolvedValue([
      pendingInvitation,
      staleInvitation,
    ]);
    mocks.readLegalEntities.mockResolvedValue(legalEntities);
    mocks.readMemberEntityScopes.mockResolvedValue(new Map());
    mocks.listMembersClient.mockResolvedValue({
      data: { members: [owner, member] },
      error: null,
    });
    mocks.listInvitationsClient.mockResolvedValue({
      data: [pendingInvitation, staleInvitation],
      error: null,
    });
    mocks.inviteMember.mockResolvedValue({ data: {}, error: null });
    mocks.inviteMemberWithScopeAction.mockResolvedValue({ ok: true });
    mocks.updateMemberRole.mockResolvedValue({ data: {}, error: null });
    mocks.removeMember.mockResolvedValue({ data: {}, error: null });
    mocks.cancelInvitation.mockResolvedValue({ data: {}, error: null });
    mocks.transferOwnershipAction.mockResolvedValue({ ok: true });
  });

  it('renders members and pending invitations with an expired label', async () => {
    await renderPage();

    expect(
      screen.getByRole('heading', { name: 'Active members (2)' }),
    ).toBeVisible();
    expect(within(rowFor('Ada Owner')).getByText('Owner')).toBeVisible();
    expect(
      within(rowFor('Ben Member')).getByText('All entities'),
    ).toBeVisible();
  });

  it('expands a member with supplementary access details only', async () => {
    mocks.readMemberEntityScopes.mockResolvedValue(
      new Map([
        ['user-2', { legalEntityIds: [LEGAL_ENTITY_ID], mode: 'restricted' }],
      ]),
    );

    await renderPage();

    fireEvent.click(
      within(rowFor('Ben Member')).getByRole('button', {
        name: 'Toggle detail for row member-2',
      }),
    );

    const expandedRow = screen
      .getByText('A member has read-only access.')
      .closest('tr');
    expect(expandedRow).not.toBeNull();
    expect(within(expandedRow!).getByText('Placeholder Holding')).toBeVisible();
    expect(
      within(expandedRow!).queryByText('Ben Member'),
    ).not.toBeInTheDocument();
    expect(
      within(expandedRow!).queryByText('member@bap.test'),
    ).not.toBeInTheDocument();
  });

  it('hides inactive members under the default active filter', async () => {
    mocks.listMembers.mockResolvedValue({
      members: [owner, { ...member, status: 'inactive' }],
    });

    await renderPage();

    expect(within(rowFor('Ada Owner')).getByText('Active')).toBeVisible();
    expect(screen.queryByText('Ben Member')).not.toBeInTheDocument();
  });

  it('reveals inactive members after staging and applying the status filter', async () => {
    mocks.listMembers.mockResolvedValue({
      members: [owner, { ...member, status: 'inactive' }],
    });

    await renderPage();

    expect(screen.queryByText('Ben Member')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    fireEvent.click(screen.getByLabelText('Active'));
    fireEvent.click(screen.getByLabelText('Inactive'));
    // Staging alone must not filter until the panel is applied.
    expect(screen.queryByText('Ben Member')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    expect(screen.getByText('Ben Member')).toBeVisible();
    expect(screen.queryByText('Ada Owner')).not.toBeInTheDocument();
  });

  it('applies and resets the role filter through the panel', async () => {
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    fireEvent.click(screen.getByLabelText('Owner'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    expect(screen.getByText('Ada Owner')).toBeVisible();
    expect(screen.queryByText('Ben Member')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    expect(screen.getByText('Ada Owner')).toBeVisible();
    expect(screen.getByText('Ben Member')).toBeVisible();
  });

  it('sorts the members by the email header', async () => {
    await renderPage();

    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Ada Owner');

    fireEvent.click(screen.getByRole('button', { name: 'Email' }));

    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Ben Member');
  });

  it('exports the filtered members as a CSV download', async () => {
    // jsdom ships no object URL implementation, so the blob is captured on the way out.
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return 'blob:members';
    });
    URL.revokeObjectURL = vi.fn();
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });

    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(clicked.map((anchor) => anchor.getAttribute('download'))).toEqual([
      'members.csv',
    ]);
    await expect(blobs[0]!.text()).resolves.toContain('Ada Owner');
  });

  it('renders the empty workspace text inside the table', async () => {
    mocks.listMembers.mockResolvedValue({ members: [] });

    await renderPage();

    expect(
      screen.getByText('No members are available in this workspace.'),
    ).toBeVisible();
  });

  it('renders the no-results text when the search matches nothing', async () => {
    await renderPage();

    fireEvent.change(
      screen.getByRole('searchbox', { name: 'Search Active members (2)' }),
      {
        target: { value: 'nobody' },
      },
    );

    expect(
      screen.getByText('No rows match the current search and filters.'),
    ).toBeVisible();
    expect(screen.queryByText('Ada Owner')).not.toBeInTheDocument();
  });

  it('selects the invitations tab from the deep link', async () => {
    mocks.search = 'tab=invitations';

    await renderPage();

    expect(screen.getByRole('tab', { name: 'Invitations' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(
      screen.getByRole('heading', { name: 'Pending invitations (2)' }),
    ).toBeVisible();
    expect(screen.getByText('guest@bap.test')).toBeInTheDocument();
    expect(
      within(rowFor('stale@bap.test')).getByText('Expired'),
    ).toBeInTheDocument();
  });

  it('replaces the query when switching tabs', async () => {
    await renderPage();

    fireEvent.click(screen.getByRole('tab', { name: 'Invitations' }));

    expect(mocks.replace).toHaveBeenCalledWith(
      '/organization-one/members?tab=invitations',
    );
  });

  it('invites a member with a chosen entity scope and re-reads the invitations', async () => {
    await renderPage();

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Invite member' })[0]!,
    );
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'new@bap.test' },
    });
    // The picker starts empty, so grant one entity to enable the invitation.
    fireEvent.click(screen.getByLabelText('Placeholder Holding'));
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));

    await screen.findByText('The invitation was sent.');
    expect(mocks.inviteMemberWithScopeAction).toHaveBeenCalledWith({
      email: 'new@bap.test',
      organizationId: 'organization-1',
      role: 'member',
      scope: { legalEntityIds: [LEGAL_ENTITY_ID], mode: 'restricted' },
    });
    await waitFor(() => {
      expect(mocks.listInvitationsClient).toHaveBeenCalled();
    });
  });

  it('invites a member with all entities when that option is chosen', async () => {
    await renderPage();

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Invite member' })[0]!,
    );
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'new@bap.test' },
    });
    fireEvent.change(screen.getByLabelText('Entity access'), {
      target: { value: 'all' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));

    await screen.findByText('The invitation was sent.');
    expect(mocks.inviteMemberWithScopeAction).toHaveBeenCalledWith({
      email: 'new@bap.test',
      organizationId: 'organization-1',
      role: 'member',
      scope: { mode: 'all' },
    });
  });

  it('offers all entities when the workspace has none', async () => {
    mocks.readLegalEntities.mockResolvedValue([]);

    await renderPage();

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Invite member' })[0]!,
    );
    expect(
      (screen.getByLabelText('Entity access') as HTMLSelectElement).value,
    ).toBe('all');
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'new@bap.test' },
    });
    expect(
      screen.getByRole('button', { name: 'Send invitation' }),
    ).toBeEnabled();
  });

  it('keeps the invite modal open with an inline duplicate error', async () => {
    mocks.inviteMemberWithScopeAction.mockResolvedValue({
      ok: false,
      reason: 'already-invited',
    });

    await renderPage();

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Invite member' })[0]!,
    );
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'guest@bap.test' },
    });
    fireEvent.change(screen.getByLabelText('Entity access'), {
      target: { value: 'all' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));

    await screen.findByText('This address already has a pending invitation.');
    expect(
      screen.queryByText('The invitation was sent.'),
    ).not.toBeInTheDocument();
  });

  it('changes a member role', async () => {
    await renderPage();

    fireEvent.click(
      within(rowFor('Ben Member')).getByRole('button', {
        name: 'Actions for Ben Member',
      }),
    );
    fireEvent.click(screen.getByText('Change role'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('The member role was updated.');
    expect(mocks.updateMemberRole).toHaveBeenCalledWith({
      memberId: 'member-2',
      organizationId: 'organization-1',
      role: 'member',
    });
  });

  it('never offers owner as an assignable invite role', async () => {
    await renderPage();

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Invite member' })[0]!,
    );
    const select = document.getElementById('invite-role')!;
    expect(within(select).getByText('Admin')).toBeTruthy();
    expect(within(select).getByText('Member')).toBeTruthy();
    expect(within(select).queryByText('Owner')).toBeNull();
  });

  it('transfers ownership to an active member', async () => {
    await renderPage();

    fireEvent.click(
      within(rowFor('Ben Member')).getByRole('button', {
        name: 'Actions for Ben Member',
      }),
    );
    fireEvent.click(screen.getByText('Transfer ownership'));
    // The confirm button stays disabled until the workspace name is typed exactly.
    expect(
      screen.getByRole('button', { name: 'Transfer ownership' }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: 'Organization One' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Transfer ownership' }));

    await screen.findByText('Ownership was transferred.');
    expect(mocks.transferOwnershipAction).toHaveBeenCalledWith({
      organizationId: 'organization-1',
      toUserId: 'user-2',
    });
  });

  it('never offers ownership transfer to a non-owner caller', async () => {
    mocks.resolveOrganizationRouteForRequest.mockResolvedValue({
      id: 'organization-1',
      name: 'Organization One',
      role: 'admin',
      slug: 'organization-one',
    });
    mocks.readOrganizationAccess.mockResolvedValue(accessFor('admin'));

    await renderPage();

    expect(
      within(rowFor('Ben Member')).queryByRole('button', {
        name: 'Actions for Ben Member',
      }),
    ).not.toBeInTheDocument();
  });

  it('removes a member by marking them inactive over the BFF', async () => {
    const calls: { body: unknown; method: string | undefined; path: string }[] =
      [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init?: RequestInit) => {
        calls.push({
          body:
            init?.body === undefined
              ? undefined
              : JSON.parse(String(init.body)),
          method: init?.method,
          path,
        });
        return new Response(null, { status: 204 });
      }),
    );

    await renderPage();

    fireEvent.click(
      within(rowFor('Ben Member')).getByRole('button', {
        name: 'Actions for Ben Member',
      }),
    );
    fireEvent.click(screen.getByText('Remove'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove member' }));

    await screen.findByText('The member was removed.');
    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.path).toBe(
      '/api/bff/application/organizations/organization-1/members/user-2/status',
    );
    expect(put?.body).toEqual({ status: 'inactive' });
  });

  it('hides remove on the caller row and scope on the owner row', async () => {
    await renderPage();

    fireEvent.click(
      within(rowFor('Ada Owner')).getByRole('button', {
        name: 'Actions for Ada Owner',
      }),
    );

    expect(screen.getByText('Change role')).toBeInTheDocument();
    expect(screen.queryByText('Remove')).not.toBeInTheDocument();
    expect(screen.queryByText('Edit entity scope')).not.toBeInTheDocument();
  });

  it('saves an entity scope over the BFF with PUT', async () => {
    const calls: { body: unknown; method: string | undefined; path: string }[] =
      [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init?: RequestInit) => {
        calls.push({
          body:
            init?.body === undefined
              ? undefined
              : JSON.parse(String(init.body)),
          method: init?.method,
          path,
        });
        return new Response(null, { status: 204 });
      }),
    );

    await renderPage();

    fireEvent.click(
      within(rowFor('Ben Member')).getByRole('button', {
        name: 'Actions for Ben Member',
      }),
    );
    fireEvent.click(screen.getByText('Edit entity scope'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('Entity access was updated.');
    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.path).toBe(
      '/api/bff/application/organizations/organization-1/members/user-2/entity-scope',
    );
    expect(put?.body).toEqual({ mode: 'all' });
  });

  it('cancels and resends invitations', async () => {
    mocks.search = 'tab=invitations';

    await renderPage();

    fireEvent.click(
      within(rowFor('guest@bap.test')).getByRole('button', {
        name: 'Actions for guest@bap.test',
      }),
    );
    fireEvent.click(screen.getByText('Resend'));

    await screen.findByText('The invitation was resent.');
    expect(mocks.inviteMember).toHaveBeenCalledWith({
      email: 'guest@bap.test',
      organizationId: 'organization-1',
      resend: true,
      role: 'member',
    });

    fireEvent.click(
      within(rowFor('guest@bap.test')).getByRole('button', {
        name: 'Actions for guest@bap.test',
      }),
    );
    fireEvent.click(screen.getByText('Cancel invitation'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel invitation' }));

    await screen.findByText('The invitation was cancelled.');
    expect(mocks.cancelInvitation).toHaveBeenCalledWith({
      invitationId: 'invitation-1',
    });
  });

  it('hides every mutation control from a member', async () => {
    mocks.readOrganizationAccess.mockResolvedValue(accessFor('member'));

    await renderPage();

    expect(
      screen.queryByRole('button', { name: 'Invite member' }),
    ).not.toBeInTheDocument();
    expect(
      within(rowFor('Ben Member')).queryByRole('button', {
        name: 'Actions for Ben Member',
      }),
    ).not.toBeInTheDocument();
    expect(mocks.readLegalEntities).not.toHaveBeenCalled();
    expect(mocks.readMemberEntityScopes).not.toHaveBeenCalled();
  });

  it('shows entity access as unavailable when the scope editor is withheld', async () => {
    mocks.readOrganizationAccess.mockResolvedValue(accessFor('member'));

    await renderPage();

    expect(
      within(rowFor('Ben Member')).getByText('Entity access is unavailable.'),
    ).toBeVisible();
    expect(
      within(rowFor('Ada Owner')).getByText('Entity access is unavailable.'),
    ).toBeVisible();
  });

  it('reports a failed load with a notification', async () => {
    mocks.listMembers.mockRejectedValue(new Error('private provider detail'));

    await renderPage();

    expect(screen.getByText('Membership could not be loaded.')).toBeVisible();
    expect(document.body).not.toHaveTextContent('private provider detail');
    expect(
      screen.queryByRole('tab', { name: 'Members' }),
    ).not.toBeInTheDocument();
  });

  it('returns not found when the resolver denies the slug', async () => {
    mocks.resolveOrganizationRouteForRequest.mockResolvedValue(null);

    await expect(
      OrganizationMembersPage({
        params: Promise.resolve({ orgSlug: 'unknown-organization' }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
