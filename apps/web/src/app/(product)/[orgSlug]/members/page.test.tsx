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
      manageEntityAccess: role === 'owner',
      manageMembers: role === 'owner',
      manageOrganization: role === 'owner',
      readDocuments: true,
      updateEntities: role !== 'member',
      uploadData: role !== 'member',
      useAi: true,
    },
    organizationId: 'organization-1',
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
  vi.unstubAllGlobals();
});

describe('OrganizationMembersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    mocks.updateMemberRole.mockResolvedValue({ data: {}, error: null });
    mocks.removeMember.mockResolvedValue({ data: {}, error: null });
    mocks.cancelInvitation.mockResolvedValue({ data: {}, error: null });
  });

  it('renders members and pending invitations with an expired label', async () => {
    await renderPage();

    expect(within(rowFor('Ada Owner')).getByText('Owner')).toBeVisible();
    expect(
      within(rowFor('Ben Member')).getByText('All entities'),
    ).toBeVisible();
    expect(screen.getByText('guest@bap.test')).toBeInTheDocument();
    expect(
      within(rowFor('stale@bap.test')).getByText('Expired'),
    ).toBeInTheDocument();
  });

  it('selects the invitations tab from the deep link', async () => {
    mocks.search = 'tab=invitations';

    await renderPage();

    expect(screen.getByRole('tab', { name: 'Invitations' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('replaces the query when switching tabs', async () => {
    await renderPage();

    fireEvent.click(screen.getByRole('tab', { name: 'Invitations' }));

    expect(mocks.replace).toHaveBeenCalledWith(
      '/organization-one/members?tab=invitations',
    );
  });

  it('invites a member and re-reads the invitations', async () => {
    await renderPage();

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Invite member' })[0]!,
    );
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'new@bap.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));

    await screen.findByText('The invitation was sent.');
    expect(mocks.inviteMember).toHaveBeenCalledWith({
      email: 'new@bap.test',
      organizationId: 'organization-1',
      role: 'member',
    });
    await waitFor(() => {
      expect(mocks.listInvitationsClient).toHaveBeenCalled();
    });
  });

  it('keeps the invite modal open with an inline duplicate error', async () => {
    mocks.inviteMember.mockResolvedValue({
      error: { code: 'USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION' },
    });

    await renderPage();

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Invite member' })[0]!,
    );
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'guest@bap.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));

    await screen.findByText('This address already has a pending invitation.');
    expect(
      screen.queryByText('The invitation was sent.'),
    ).not.toBeInTheDocument();
  });

  it('changes a member role', async () => {
    await renderPage();

    fireEvent.click(within(rowFor('Ben Member')).getByRole('button'));
    fireEvent.click(screen.getByText('Change role'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('The member role was updated.');
    expect(mocks.updateMemberRole).toHaveBeenCalledWith({
      memberId: 'member-2',
      organizationId: 'organization-1',
      role: 'member',
    });
  });

  it('removes a member after confirmation', async () => {
    await renderPage();

    fireEvent.click(within(rowFor('Ben Member')).getByRole('button'));
    fireEvent.click(screen.getByText('Remove'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove member' }));

    await screen.findByText('The member was removed.');
    expect(mocks.removeMember).toHaveBeenCalledWith({
      memberIdOrEmail: 'member-2',
      organizationId: 'organization-1',
    });
  });

  it('hides remove on the caller row and scope on the owner row', async () => {
    await renderPage();

    fireEvent.click(within(rowFor('Ada Owner')).getByRole('button'));

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

    fireEvent.click(within(rowFor('Ben Member')).getByRole('button'));
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

    fireEvent.click(within(rowFor('guest@bap.test')).getByRole('button'));
    fireEvent.click(screen.getByText('Resend'));

    await screen.findByText('The invitation was resent.');
    expect(mocks.inviteMember).toHaveBeenCalledWith({
      email: 'guest@bap.test',
      organizationId: 'organization-1',
      resend: true,
      role: 'member',
    });

    fireEvent.click(within(rowFor('guest@bap.test')).getByRole('button'));
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
      within(rowFor('Ben Member')).queryByRole('button'),
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
