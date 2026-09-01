import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import OrganizationMembersPage from './page';

const mocks = vi.hoisted(() => ({
  inviteOrganizationMemberAction: vi.fn(),
  listInvitations: vi.fn(),
  listMembers: vi.fn(),
  removeOrganizationMemberAction: vi.fn(),
  resolveOrganizationRouteForRequest: vi.fn(),
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
vi.mock('../../../lib/organizations/resolver', () => ({
  resolveOrganizationRouteForRequest: mocks.resolveOrganizationRouteForRequest,
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

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
      members: [
        {
          id: 'member-1',
          role: 'owner',
          user: { email: 'owner@example.test', name: 'Owner' },
          userId: 'user-1',
        },
      ],
      total: 1,
    });
    mocks.listInvitations.mockResolvedValue([
      {
        email: 'invited@example.test',
        id: 'invitation-1',
        role: 'member',
        status: 'pending',
      },
    ]);
  });

  it('uses explicit organization id for member and invitation reads', async () => {
    render(
      await OrganizationMembersPage({
        params: Promise.resolve({ orgSlug: 'organization-one' }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(mocks.listMembers).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      query: { limit: 100, organizationId: 'organization-1' },
    });
    expect(mocks.listInvitations).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      query: { organizationId: 'organization-1' },
    });
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

  it('limits admin controls to non-owner targets and admin or member assignment', async () => {
    mocks.resolveOrganizationRouteForRequest.mockResolvedValue({
      id: 'organization-1',
      name: 'Organization One',
      role: 'admin',
      slug: 'organization-one',
    });
    mocks.listMembers.mockResolvedValue({
      members: [
        {
          id: 'member-owner',
          role: 'owner',
          user: { email: 'owner@example.test', name: 'Owner' },
          userId: 'user-owner',
        },
        {
          id: 'member-ordinary',
          role: 'member',
          user: { email: 'member@example.test', name: 'Member' },
          userId: 'user-member',
        },
      ],
      total: 2,
    });

    render(
      await OrganizationMembersPage({
        params: Promise.resolve({ orgSlug: 'organization-one' }),
        searchParams: Promise.resolve({}),
      }),
    );

    const inviteForm = screen.getByRole('form', { name: 'Invite member' });
    expect(
      within(inviteForm).queryByRole('option', { name: 'Owner' }),
    ).not.toBeInTheDocument();
    expect(
      within(inviteForm).getByRole('option', { name: 'Admin' }),
    ).toBeVisible();
    expect(
      within(inviteForm).getByRole('option', { name: 'Member' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('form', {
        name: 'Change role for owner@example.test',
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('form', { name: 'Remove owner@example.test' }),
    ).not.toBeInTheDocument();

    const memberRoleForm = screen.getByRole('form', {
      name: 'Change role for member@example.test',
    });
    expect(
      within(memberRoleForm).queryByRole('option', { name: 'Owner' }),
    ).not.toBeInTheDocument();
    expect(
      within(memberRoleForm).getByRole('option', { name: 'Admin' }),
    ).toBeVisible();
    expect(
      within(memberRoleForm).getByRole('option', { name: 'Member' }),
    ).toBeVisible();
    expect(
      screen.getByRole('form', { name: 'Remove member@example.test' }),
    ).toBeVisible();
  });

  it('does not offer mutation forms to an ordinary member', async () => {
    mocks.resolveOrganizationRouteForRequest.mockResolvedValue({
      id: 'organization-1',
      name: 'Organization One',
      role: 'member',
      slug: 'organization-one',
    });

    render(
      await OrganizationMembersPage({
        params: Promise.resolve({ orgSlug: 'organization-one' }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(
      screen.queryByRole('form', { name: 'Invite member' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Change role' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Remove member' }),
    ).not.toBeInTheDocument();
  });

  it('reports read failures generically', async () => {
    mocks.listMembers.mockRejectedValue(new Error('private provider detail'));

    render(
      await OrganizationMembersPage({
        params: Promise.resolve({ orgSlug: 'organization-one' }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The organization membership could not be updated.',
    );
    expect(document.body).not.toHaveTextContent('private provider detail');
  });
});
