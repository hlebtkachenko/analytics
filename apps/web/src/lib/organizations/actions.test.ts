// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acceptOrganizationInvitationAction,
  createWorkspaceAction,
  declineOrganizationInvitationAction,
  inviteMemberWithScopeAction,
} from './actions';

const ENTITY_ID = '9b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21';

const mocks = vi.hoisted(() => ({
  acceptInvitation: vi.fn(),
  cancelInvitation: vi.fn(),
  createInvitation: vi.fn(),
  createOrganization: vi.fn(),
  getAuth: vi.fn(),
  getAuthPool: vi.fn(),
  getOrganizationCreationQuota: vi.fn(),
  getSession: vi.fn(),
  redirect: vi.fn(),
  rejectInvitation: vi.fn(),
  resolveOrganizationRouteForRequest: vi.fn(),
  revalidatePath: vi.fn(),
  writeInvitationEntityScope: vi.fn(),
}));

vi.mock('@bap/db/access', () => ({
  getOrganizationCreationQuota: mocks.getOrganizationCreationQuota,
  writeInvitationEntityScope: mocks.writeInvitationEntityScope,
}));
vi.mock('../auth/server', () => ({
  getAuth: mocks.getAuth,
  getAuthPool: mocks.getAuthPool,
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
        acceptInvitation: mocks.acceptInvitation,
        cancelInvitation: mocks.cancelInvitation,
        createInvitation: mocks.createInvitation,
        createOrganization: mocks.createOrganization,
        getSession: mocks.getSession,
        rejectInvitation: mocks.rejectInvitation,
      },
    });
    mocks.getAuthPool.mockResolvedValue({});
    mocks.createInvitation.mockResolvedValue({ id: 'invitation-1' });
    mocks.writeInvitationEntityScope.mockResolvedValue('written');
    mocks.getOrganizationCreationQuota.mockResolvedValue({
      attributedTotal: 0,
      grantedTotal: 3,
      remainingTotal: 3,
    });
    mocks.resolveOrganizationRouteForRequest.mockResolvedValue(organization);
    mocks.createOrganization.mockResolvedValue(organization);
    mocks.getSession.mockResolvedValue({
      user: { emailVerified: true, id: 'user-1' },
    });
  });

  it('creates with normalized input and returns the workspace id and slug', async () => {
    const result = await createWorkspaceAction({
      name: ' Organization Two ',
      slug: 'Organization Two',
    });

    expect(result).toEqual({
      id: 'organization-1',
      ok: true,
      slug: 'organization-one',
    });
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
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/workspaces');
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('rejects a reserved create slug before auth side effects', async () => {
    const result = await createWorkspaceAction({
      name: 'Organizations',
      slug: 'organizations',
    });

    expect(result).toEqual({ ok: false, reason: 'invalid' });
    expect(mocks.createOrganization).not.toHaveBeenCalled();
  });

  it('marks an exhausted quota so the wizard shows it inline', async () => {
    mocks.getOrganizationCreationQuota.mockResolvedValue({
      attributedTotal: 1,
      grantedTotal: 1,
      remainingTotal: 0,
    });

    const result = await createWorkspaceAction({
      name: 'Organization Two',
      slug: 'organization-two',
    });

    expect(result).toEqual({ ok: false, reason: 'quota-exhausted' });
    expect(mocks.createOrganization).not.toHaveBeenCalled();
  });

  it('marks a taken address so the wizard shows it inline', async () => {
    mocks.createOrganization.mockRejectedValue({
      body: { code: 'ORGANIZATION_ALREADY_EXISTS' },
    });

    const result = await createWorkspaceAction({
      name: 'Organization Two',
      slug: 'organization-two',
    });

    expect(result).toEqual({ ok: false, reason: 'slug-taken' });
  });

  it('accepts an invitation from the form body and returns a success marker', async () => {
    await acceptOrganizationInvitationAction(
      form({ invitationId: 'invitation-1' }),
    );

    expect(mocks.acceptInvitation).toHaveBeenCalledWith({
      body: { invitationId: 'invitation-1' },
      headers: expect.any(Headers),
    });
    expect(mocks.redirect).toHaveBeenCalledWith(
      '/workspaces?result=accept-success',
    );
  });

  it('declines an invitation from the form body and returns a decline marker', async () => {
    await declineOrganizationInvitationAction(
      form({ invitationId: 'invitation-1' }),
    );

    expect(mocks.rejectInvitation).toHaveBeenCalledWith({
      body: { invitationId: 'invitation-1' },
      headers: expect.any(Headers),
    });
    expect(mocks.redirect).toHaveBeenCalledWith(
      '/workspaces?result=decline-success',
    );
  });

  it('redacts an invitation response failure behind a fixed marker', async () => {
    mocks.acceptInvitation.mockRejectedValue(
      new Error('private invitation detail'),
    );

    await acceptOrganizationInvitationAction(
      form({ invitationId: 'invitation-1' }),
    );

    expect(mocks.redirect).toHaveBeenCalledWith(
      '/workspaces?result=accept-error',
    );
    expect(JSON.stringify(mocks.redirect.mock.calls)).not.toContain('private');
  });

  it('redacts a decline invitation response failure behind a fixed marker', async () => {
    mocks.rejectInvitation.mockRejectedValue(
      new Error('private invitation detail'),
    );

    await declineOrganizationInvitationAction(
      form({ invitationId: 'invitation-1' }),
    );

    expect(mocks.redirect).toHaveBeenCalledWith(
      '/workspaces?result=decline-error',
    );
    expect(JSON.stringify(mocks.redirect.mock.calls)).not.toContain(
      'invitation-1',
    );
    expect(JSON.stringify(mocks.redirect.mock.calls)).not.toContain('private');
  });

  it('rejects an unverified invitation response before any auth write', async () => {
    mocks.getSession.mockResolvedValue({
      user: { emailVerified: false, id: 'user-1' },
    });

    await acceptOrganizationInvitationAction(
      form({ invitationId: 'invitation-1' }),
    );

    expect(mocks.acceptInvitation).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith(
      '/workspaces?result=accept-error',
    );
  });

  it('creates an invitation and stores its restricted entity scope', async () => {
    const result = await inviteMemberWithScopeAction({
      email: 'New@bap.test',
      organizationId: 'organization-1',
      role: 'member',
      scope: { legalEntityIds: [ENTITY_ID], mode: 'restricted' },
    });

    expect(result).toEqual({ ok: true });
    expect(mocks.createInvitation).toHaveBeenCalledWith({
      body: {
        email: 'new@bap.test',
        organizationId: 'organization-1',
        role: 'member',
      },
      headers: expect.any(Headers),
    });
    expect(mocks.writeInvitationEntityScope).toHaveBeenCalledWith(
      expect.anything(),
      {
        createdBy: 'user-1',
        invitationId: 'invitation-1',
        organizationId: 'organization-1',
        scope: { legalEntityIds: [ENTITY_ID], mode: 'restricted' },
      },
    );
  });

  it('reports a duplicate invitation without writing a scope', async () => {
    mocks.createInvitation.mockRejectedValue({
      body: { code: 'USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION' },
    });

    const result = await inviteMemberWithScopeAction({
      email: 'guest@bap.test',
      organizationId: 'organization-1',
      role: 'member',
      scope: { mode: 'all' },
    });

    expect(result).toEqual({ ok: false, reason: 'already-invited' });
    expect(mocks.writeInvitationEntityScope).not.toHaveBeenCalled();
  });

  it('cancels the invitation when its scope names an unknown entity', async () => {
    mocks.writeInvitationEntityScope.mockResolvedValue('unknown-entity');

    const result = await inviteMemberWithScopeAction({
      email: 'new@bap.test',
      organizationId: 'organization-1',
      role: 'admin',
      scope: { legalEntityIds: [ENTITY_ID], mode: 'restricted' },
    });

    expect(result).toEqual({ ok: false, reason: 'invalid' });
    expect(mocks.cancelInvitation).toHaveBeenCalledWith({
      body: { invitationId: 'invitation-1' },
      headers: expect.any(Headers),
    });
  });

  it('refuses a restricted invite scope with no entity before any auth write', async () => {
    const result = await inviteMemberWithScopeAction({
      email: 'new@bap.test',
      organizationId: 'organization-1',
      role: 'member',
      scope: { legalEntityIds: [], mode: 'restricted' },
    });

    expect(result).toEqual({ ok: false, reason: 'invalid' });
    expect(mocks.createInvitation).not.toHaveBeenCalled();
  });

  it('rejects an unverified create action before writes', async () => {
    mocks.getSession.mockResolvedValue({
      user: { emailVerified: false, id: 'user-1' },
    });

    const result = await createWorkspaceAction({
      name: 'Organization Two',
      slug: 'organization-two',
    });

    expect(result).toEqual({ ok: false, reason: 'error' });
    expect(mocks.createOrganization).not.toHaveBeenCalled();
  });
});
