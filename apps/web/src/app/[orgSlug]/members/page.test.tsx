import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import OrganizationMembersPage from './page';

const mocks = vi.hoisted(() => ({
  inviteOrganizationMemberAction: vi.fn(),
  listInvitations: vi.fn(),
  listMembers: vi.fn(),
  readLegalEntities: vi.fn(),
  readMemberEntityScope: vi.fn(),
  removeOrganizationMemberAction: vi.fn(),
  resolveOrganizationRouteForRequest: vi.fn(),
  updateMemberEntityScopeAction: vi.fn(),
  updateOrganizationMemberRoleAction: vi.fn(),
}));

vi.mock('../../../lib/auth/server', () => ({
  getAuth: async () => ({
    api: {
      listInvitations: mocks.listInvitations,
      listMembers: mocks.listMembers,
    },
  }),
}));
vi.mock('../../../lib/organizations/actions', () => ({
  inviteOrganizationMemberAction: mocks.inviteOrganizationMemberAction,
  removeOrganizationMemberAction: mocks.removeOrganizationMemberAction,
  updateOrganizationMemberRoleAction: mocks.updateOrganizationMemberRoleAction,
}));
vi.mock('../../../lib/organizations/entity-actions', () => ({
  updateMemberEntityScopeAction: mocks.updateMemberEntityScopeAction,
}));
vi.mock('../../../lib/organizations/entities', () => ({
  readLegalEntities: mocks.readLegalEntities,
  readMemberEntityScope: mocks.readMemberEntityScope,
}));
vi.mock('../../../lib/organizations/resolver', () => ({
  resolveOrganizationRouteForRequest: mocks.resolveOrganizationRouteForRequest,
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

const LEGAL_ENTITY_ID = '9b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21';
const OTHER_LEGAL_ENTITY_ID = '4c2f8b11-8c35-4a2e-9f61-1de2f0a7c934';

const ownerMember = {
  id: 'member-1',
  role: 'owner',
  user: { email: 'owner@example.test', name: 'Owner' },
  userId: 'user-1',
};
const ordinaryMember = {
  id: 'member-2',
  role: 'member',
  user: { email: 'member@example.test', name: 'Member' },
  userId: 'user-2',
};

afterEach(cleanup);

describe('OrganizationMembersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveOrganizationRouteForRequest.mockResolvedValue({
      id: 'organization-1',
      name: 'Organization One',
      role: 'owner',
      slug: 'organization-one',
    });
    mocks.listMembers.mockResolvedValue({
      members: [ownerMember, ordinaryMember],
      total: 2,
    });
    mocks.listInvitations.mockResolvedValue([
      {
        email: 'invited@example.test',
        id: 'invitation-1',
        role: 'member',
        status: 'pending',
      },
    ]);
    mocks.readLegalEntities.mockResolvedValue([
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
    ]);
    mocks.readMemberEntityScope.mockResolvedValue({ mode: 'all' });
  });

  async function renderPage(): Promise<void> {
    render(
      await OrganizationMembersPage({
        params: Promise.resolve({ orgSlug: 'organization-one' }),
        searchParams: Promise.resolve({}),
      }),
    );
  }

  it('uses explicit organization id for member and invitation reads', async () => {
    await renderPage();

    expect(mocks.listMembers).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      query: { limit: 100, organizationId: 'organization-1' },
    });
    expect(mocks.listInvitations).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      query: { organizationId: 'organization-1' },
    });
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(
      within(breadcrumb).getByRole('link', { name: 'Organizations' }),
    ).toHaveAttribute('href', '/organizations');
    expect(
      within(breadcrumb).getByRole('link', { name: 'Organization One' }),
    ).toHaveAttribute('href', '/organization-one');
    expect(
      within(breadcrumb).getByText('Members', { selector: 'li' }),
    ).toHaveAttribute('aria-current', 'page');
    const inviteForm = screen.getByRole('form', { name: 'Invite member' });
    expect(inviteForm).toBeVisible();
    expect(
      within(inviteForm).getByRole('option', { name: 'Owner' }),
    ).toBeVisible();
    expect(
      screen.getByRole('form', { name: 'Change role for owner@example.test' }),
    ).toBeVisible();
    expect(
      screen.getByRole('form', { name: 'Remove owner@example.test' }),
    ).toBeVisible();
    expect(screen.getByText(/invited@example\.test/)).toBeVisible();
  });

  it('offers an owner an entity scope editor for every non-owner member only', async () => {
    mocks.readMemberEntityScope.mockResolvedValue({
      legalEntityIds: [OTHER_LEGAL_ENTITY_ID],
      mode: 'restricted',
    });

    await renderPage();

    expect(mocks.readLegalEntities).toHaveBeenCalledWith('organization-1');
    expect(mocks.readMemberEntityScope).toHaveBeenCalledExactlyOnceWith(
      'organization-1',
      'user-2',
    );
    expect(
      screen.queryByRole('form', {
        name: 'Entity access for owner@example.test',
      }),
    ).not.toBeInTheDocument();

    const scopeForm = screen.getByRole('form', {
      name: 'Entity access for member@example.test',
    });
    expect(within(scopeForm).getByLabelText('All entities')).not.toBeChecked();
    expect(within(scopeForm).getByLabelText('Selected entities')).toBeChecked();
    expect(
      within(scopeForm).getByLabelText('Placeholder Holding'),
    ).not.toBeChecked();
    expect(
      within(scopeForm).getByLabelText('Placeholder Trader'),
    ).toBeChecked();
    expect(
      within(scopeForm).getByRole('button', { name: 'Save entity access' }),
    ).toBeVisible();
  });

  it.each(['admin', 'member'] as const)(
    'does not offer mutation forms to an %s',
    async (role) => {
      mocks.resolveOrganizationRouteForRequest.mockResolvedValue({
        id: 'organization-1',
        name: 'Organization One',
        role,
        slug: 'organization-one',
      });

      await renderPage();

      expect(
        screen.queryByRole('form', { name: 'Invite member' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Change role' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Remove member' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Save entity access' }),
      ).not.toBeInTheDocument();
      expect(mocks.readLegalEntities).not.toHaveBeenCalled();
      expect(mocks.readMemberEntityScope).not.toHaveBeenCalled();
    },
  );

  it('reports read failures generically', async () => {
    mocks.listMembers.mockRejectedValue(new Error('private provider detail'));

    await renderPage();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The organization membership could not be updated.',
    );
    expect(document.body).not.toHaveTextContent('private provider detail');
  });

  it('omits the scope editor when the entity list is unavailable', async () => {
    mocks.readLegalEntities.mockResolvedValue(null);

    await renderPage();

    expect(
      screen.queryByRole('button', { name: 'Save entity access' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('form', { name: 'Change role for member@example.test' }),
    ).toBeVisible();
  });
});
