// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createOrganizationAction,
  inviteOrganizationMemberAction,
  removeOrganizationMemberAction,
  updateOrganizationAction,
  updateOrganizationMemberRoleAction,
} from './actions';

const mocks = vi.hoisted(() => ({
  createInvitation: vi.fn(),
  createOrganization: vi.fn(),
  getAuth: vi.fn(),
  getSession: vi.fn(),
  listMembers: vi.fn(),
  redirect: vi.fn(),
  removeMember: vi.fn(),
  resolveOrganizationRouteForRequest: vi.fn(),
  revalidatePath: vi.fn(),
  updateMemberRole: vi.fn(),
  updateOrganization: vi.fn(),
}));

vi.mock('../auth/server', () => ({
  getAuth: mocks.getAuth,
}));
vi.mock('./resolver', () => ({
  resolveOrganizationRouteForRequest: mocks.resolveOrganizationRouteForRequest,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) {
    data.set(name, value);
  }
  return data;
}

const organization = {
  id: 'organization-1',
  name: 'Organization One',
  role: 'owner',
  slug: 'organization-one',
} as const;

describe('organization server actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuth.mockResolvedValue({
      api: {
        createInvitation: mocks.createInvitation,
        createOrganization: mocks.createOrganization,
        getSession: mocks.getSession,
        listMembers: mocks.listMembers,
        removeMember: mocks.removeMember,
        updateMemberRole: mocks.updateMemberRole,
        updateOrganization: mocks.updateOrganization,
      },
    });
    mocks.resolveOrganizationRouteForRequest.mockResolvedValue(organization);
    mocks.createOrganization.mockResolvedValue(organization);
    mocks.getSession.mockResolvedValue({
      user: { emailVerified: true, id: 'user-1' },
    });
    mocks.listMembers.mockResolvedValue({
      members: [
        {
          id: 'member-1',
          role: 'owner',
          userId: 'user-1',
        },
        {
          id: 'member-2',
          role: 'member',
          userId: 'user-2',
        },
      ],
      total: 2,
    });
  });

  it('creates with normalized input without changing ambient organization state', async () => {
    await createOrganizationAction(
      form({ name: ' Organization Two ', slug: 'Organization Two' }),
    );

    expect(mocks.createOrganization).toHaveBeenCalledWith({
      body: {
        keepCurrentActiveOrganization: true,
        name: 'Organization Two',
        slug: 'organization-two',
      },
      headers: expect.any(Headers),
    });
    expect(mocks.getSession).toHaveBeenCalledWith({
      headers: expect.any(Headers),
    });
    expect(mocks.redirect).toHaveBeenCalledWith('/organization-two');
  });

  it('rejects a reserved create slug before auth side effects', async () => {
    await createOrganizationAction(
      form({ name: 'Organizations', slug: 'organizations' }),
    );

    expect(mocks.createOrganization).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith(
      '/organizations/new?result=error',
    );
  });

  it('rejects an unverified direct create action before writes', async () => {
    mocks.getSession.mockResolvedValue({
      user: { emailVerified: false, id: 'user-1' },
    });

    await createOrganizationAction(
      form({ name: 'Organization Two', slug: 'organization-two' }),
    );

    expect(mocks.createOrganization).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith(
      '/organizations/new?result=error',
    );
  });

  it('invites with the resolved id and ignores a forged form id', async () => {
    await inviteOrganizationMemberAction(
      'organization-one',
      form({
        email: 'INVITED@EXAMPLE.TEST',
        organizationId: 'forged-organization',
        role: 'member',
      }),
    );

    expect(mocks.createInvitation).toHaveBeenCalledWith({
      body: {
        email: 'invited@example.test',
        organizationId: 'organization-1',
        role: 'member',
      },
      headers: expect.any(Headers),
    });
    expect(mocks.redirect).toHaveBeenCalledWith(
      '/organization-one/members?result=success',
    );
  });

  it('refuses the temporary UI path that would demote the final owner', async () => {
    mocks.listMembers.mockResolvedValue({
      members: [{ id: 'member-1', role: 'owner', userId: 'user-1' }],
      total: 1,
    });

    await updateOrganizationMemberRoleAction(
      'organization-one',
      form({ memberId: 'member-1', role: 'admin' }),
    );

    expect(mocks.updateMemberRole).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith(
      '/organization-one/members?result=error',
    );
  });

  it('allows an explicit co-owner demotion through Better Auth permissions', async () => {
    mocks.listMembers.mockResolvedValue({
      members: [
        { id: 'member-1', role: 'owner', userId: 'user-1' },
        { id: 'member-2', role: 'owner', userId: 'user-2' },
      ],
      total: 2,
    });

    await updateOrganizationMemberRoleAction(
      'organization-one',
      form({ memberId: 'member-2', role: 'admin' }),
    );

    expect(mocks.updateMemberRole).toHaveBeenCalledWith({
      body: {
        memberId: 'member-2',
        organizationId: 'organization-1',
        role: 'admin',
      },
      headers: expect.any(Headers),
    });
  });

  it('refuses the temporary UI path that would remove the final owner', async () => {
    mocks.listMembers.mockResolvedValue({
      members: [{ id: 'member-1', role: 'owner', userId: 'user-1' }],
      total: 1,
    });

    await removeOrganizationMemberAction(
      'organization-one',
      form({ memberId: 'member-1' }),
    );

    expect(mocks.removeMember).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith(
      '/organization-one/members?result=error',
    );
  });

  it('updates settings with the resolved id and a safe renamed route', async () => {
    await updateOrganizationAction(
      'organization-one',
      form({
        name: ' Organization Renamed ',
        organizationId: 'forged-organization',
        slug: 'Organization Renamed',
      }),
    );

    expect(mocks.updateOrganization).toHaveBeenCalledWith({
      body: {
        data: {
          name: 'Organization Renamed',
          slug: 'organization-renamed',
        },
        organizationId: 'organization-1',
      },
      headers: expect.any(Headers),
    });
    expect(mocks.redirect).toHaveBeenCalledWith(
      '/organization-renamed/settings?result=success',
    );
  });

  it('redacts Better Auth failures behind a fixed result path', async () => {
    mocks.createInvitation.mockRejectedValue(
      new Error('private provider and membership detail'),
    );

    await inviteOrganizationMemberAction(
      'organization-one',
      form({ email: 'invited@example.test', role: 'member' }),
    );

    expect(mocks.redirect).toHaveBeenCalledWith(
      '/organization-one/members?result=error',
    );
    expect(JSON.stringify(mocks.redirect.mock.calls)).not.toContain('private');
  });

  it.each([
    ['invite', '/attacker.example'],
    ['update role', '//attacker.example'],
    ['remove', 'organization--one'],
    ['update settings', 'organization%2Fsettings'],
  ])(
    'rejects an invalid %s action scope with one fixed same-origin redirect',
    async (action, unsafeSlug) => {
      if (action === 'invite') {
        await inviteOrganizationMemberAction(
          unsafeSlug,
          form({ email: 'invited@example.test', role: 'member' }),
        );
      } else if (action === 'update role') {
        await updateOrganizationMemberRoleAction(
          unsafeSlug,
          form({ memberId: 'member-2', role: 'admin' }),
        );
      } else if (action === 'remove') {
        await removeOrganizationMemberAction(
          unsafeSlug,
          form({ memberId: 'member-2' }),
        );
      } else {
        await updateOrganizationAction(
          unsafeSlug,
          form({ name: 'Organization Renamed', slug: 'organization-renamed' }),
        );
      }

      expect(mocks.redirect).toHaveBeenCalledOnce();
      expect(mocks.redirect).toHaveBeenCalledWith(
        '/organizations?result=error',
      );
      expect(
        new URL(mocks.redirect.mock.calls[0]?.[0], 'https://bap.invalid')
          .origin,
      ).toBe('https://bap.invalid');
      expect(mocks.resolveOrganizationRouteForRequest).not.toHaveBeenCalled();
      expect(mocks.getAuth).not.toHaveBeenCalled();
      expect(mocks.createInvitation).not.toHaveBeenCalled();
      expect(mocks.listMembers).not.toHaveBeenCalled();
      expect(mocks.removeMember).not.toHaveBeenCalled();
      expect(mocks.updateMemberRole).not.toHaveBeenCalled();
      expect(mocks.updateOrganization).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    },
  );
});
