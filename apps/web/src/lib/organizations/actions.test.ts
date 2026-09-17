// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acceptOrganizationInvitationAction,
  createOrganizationAction,
  declineOrganizationInvitationAction,
  updateOrganizationAction,
} from './actions';

const mocks = vi.hoisted(() => ({
  acceptInvitation: vi.fn(),
  createOrganization: vi.fn(),
  getAuth: vi.fn(),
  getAuthPool: vi.fn(),
  getOrganizationCreationQuota: vi.fn(),
  getSession: vi.fn(),
  redirect: vi.fn(),
  rejectInvitation: vi.fn(),
  resolveOrganizationRouteForRequest: vi.fn(),
  revalidatePath: vi.fn(),
  updateOrganization: vi.fn(),
}));

vi.mock('@bap/db/access', () => ({
  getOrganizationCreationQuota: mocks.getOrganizationCreationQuota,
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
        createOrganization: mocks.createOrganization,
        getSession: mocks.getSession,
        rejectInvitation: mocks.rejectInvitation,
        updateOrganization: mocks.updateOrganization,
      },
    });
    mocks.getAuthPool.mockResolvedValue({});
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

  it('marks an exhausted quota so the create page shows it inline', async () => {
    mocks.getOrganizationCreationQuota.mockResolvedValue({
      attributedTotal: 1,
      grantedTotal: 1,
      remainingTotal: 0,
    });

    await createOrganizationAction(
      form({ name: 'Organization Two', slug: 'organization-two' }),
    );

    expect(mocks.createOrganization).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith(
      '/organizations/new?result=quota-exhausted',
    );
  });

  it('marks a taken address so the create page shows it inline', async () => {
    mocks.createOrganization.mockRejectedValue({
      body: { code: 'ORGANIZATION_ALREADY_EXISTS' },
    });

    await createOrganizationAction(
      form({ name: 'Organization Two', slug: 'organization-two' }),
    );

    expect(mocks.redirect).toHaveBeenCalledWith(
      '/organizations/new?result=slug-taken',
    );
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
      '/organizations?result=accept-success',
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
      '/organizations?result=decline-success',
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
      '/organizations?result=accept-error',
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
      '/organizations?result=decline-error',
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
      '/organizations?result=accept-error',
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

  it.each(['admin', 'member'] as const)(
    'refuses the owner-only settings update to an %s',
    async (role) => {
      mocks.resolveOrganizationRouteForRequest.mockResolvedValue({
        ...organization,
        role,
      });

      await updateOrganizationAction(
        'organization-one',
        form({ name: 'Organization Renamed', slug: 'organization-renamed' }),
      );

      expect(mocks.updateOrganization).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
      expect(mocks.redirect).toHaveBeenCalledWith(
        '/organization-one/settings?result=error',
      );
    },
  );

  it('rejects an invalid settings action scope with one fixed same-origin redirect', async () => {
    await updateOrganizationAction(
      'organization%2Fsettings',
      form({ name: 'Organization Renamed', slug: 'organization-renamed' }),
    );

    expect(mocks.redirect).toHaveBeenCalledOnce();
    expect(mocks.redirect).toHaveBeenCalledWith('/organizations?result=error');
    expect(
      new URL(mocks.redirect.mock.calls[0]?.[0], 'https://bap.invalid').origin,
    ).toBe('https://bap.invalid');
    expect(mocks.resolveOrganizationRouteForRequest).not.toHaveBeenCalled();
    expect(mocks.getAuth).not.toHaveBeenCalled();
    expect(mocks.updateOrganization).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
