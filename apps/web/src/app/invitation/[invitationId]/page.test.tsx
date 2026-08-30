import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../../i18n/client-provider';
import InvitationPage from './page';

const mocks = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ invitationId: 'invitation_1' }),
  useRouter: () => ({ replace: mocks.replace }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const pendingInvitation = {
  id: 'invitation_1',
  organizationName: 'Organization 1',
  role: 'member',
};

function renderInvitationPage() {
  return render(
    <I18nProvider>
      <InvitationPage />
    </I18nProvider>,
  );
}

describe('InvitationPage', () => {
  it('presents the invited organization and role without naming a credential', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(pendingInvitation)),
    );

    const { container } = renderInvitationPage();

    expect(
      await screen.findByText('Organization: Organization 1'),
    ).toBeVisible();
    expect(screen.getByText('Role: member')).toBeVisible();
    expect(container.textContent).not.toMatch(/token|jwt|bearer/i);
  });

  it('reads the invitation with the identifier from the route', async () => {
    const fetchMock = vi.fn(async () => Response.json(pendingInvitation));
    vi.stubGlobal('fetch', fetchMock);

    renderInvitationPage();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/organization/get-invitation?id=invitation_1',
        expect.any(Object),
      );
    });
  });

  it('continues to the access page after acceptance', async () => {
    const fetchMock = vi.fn(async (input: string) =>
      input.startsWith('/api/auth/organization/get-invitation')
        ? Response.json(pendingInvitation)
        : Response.json({ member: {} }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderInvitationPage();

    (await screen.findByRole('button', { name: 'Accept invitation' })).click();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/organization/accept-invitation',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(mocks.replace).toHaveBeenCalledWith('/access');
    });
  });

  it('accepts a comma-joined multi-role invitation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ ...pendingInvitation, role: 'admin,member' }),
      ),
    );

    renderInvitationPage();

    expect(await screen.findByText('Role: admin, member')).toBeVisible();
    expect(
      screen.queryByText('This invitation is no longer valid.'),
    ).not.toBeInTheDocument();
  });

  it('rejects a role list that contains an unknown role', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ ...pendingInvitation, role: 'member,auditor' }),
      ),
    );

    renderInvitationPage();

    expect(
      await screen.findByText('This invitation is no longer valid.'),
    ).toBeVisible();
  });

  it('surfaces a rejected acceptance request instead of failing silently', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input.startsWith('/api/auth/organization/get-invitation')) {
        return Response.json(pendingInvitation);
      }
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    renderInvitationPage();

    (await screen.findByRole('button', { name: 'Accept invitation' })).click();

    expect(
      await screen.findByText('The invitation could not be accepted.'),
    ).toBeVisible();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('reports an expired invitation without offering acceptance', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 400 })),
    );

    renderInvitationPage();

    expect(
      await screen.findByText('This invitation is no longer valid.'),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Accept invitation' }),
    ).not.toBeInTheDocument();
  });
});
