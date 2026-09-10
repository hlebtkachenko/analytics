import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../../i18n/client-provider';
import InvitationClient from './invitation-client';
import InvitationPage from './page';

const mocks = vi.hoisted(() => ({
  getAuth: vi.fn(),
  getSession: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('../../../lib/auth/server', () => ({
  getAuth: mocks.getAuth,
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}));

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
      <InvitationClient />
    </I18nProvider>,
  );
}

describe('InvitationPage', () => {
  it('guides a signed-out recipient without looking up or forwarding the invitation', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mocks.getSession.mockResolvedValue(null);
    mocks.getAuth.mockResolvedValue({ api: { getSession: mocks.getSession } });

    const page = await InvitationPage();
    const { container } = render(<I18nProvider>{page}</I18nProvider>);

    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/sign-in',
    );
    expect(
      screen.getByRole('link', { name: 'Create invited account' }),
    ).toHaveAttribute('href', '/sign-up');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).not.toMatch(/invitation_1|token|email=/i);
    expect(
      [...container.querySelectorAll('a')].map((link) => link.href).join(' '),
    ).not.toContain('invitation_1');
  });

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
