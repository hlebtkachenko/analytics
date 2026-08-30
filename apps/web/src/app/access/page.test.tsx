import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../i18n/client-provider';
import AccessPage from './page';

vi.mock('../../lib/auth/client', () => ({
  authClient: { signOut: vi.fn() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const memberCapabilities = {
  manageGrants: false,
  manageMembers: false,
  uploadData: true,
  useAi: true,
};
const ownerCapabilities = {
  manageGrants: true,
  manageMembers: true,
  uploadData: true,
  useAi: true,
};

function renderAccessPage() {
  return render(
    <I18nProvider>
      <AccessPage />
    </I18nProvider>,
  );
}

describe('AccessPage', () => {
  it('uses the authenticated organization list and both BFF access routes', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input === '/api/auth/organization/list') {
        return Response.json([
          { id: 'organization_1', name: 'Organization 1' },
        ]);
      }
      if (input.includes('/application/')) {
        return Response.json({
          capabilities: memberCapabilities,
          organizationId: 'organization_1',
          role: 'member',
          service: 'application-api',
        });
      }
      return Response.json({
        capabilities: memberCapabilities,
        organizationId: 'organization_1',
        role: 'member',
        service: 'reporting-api',
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderAccessPage();

    expect(
      await screen.findByRole('option', { name: 'Organization 1' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('Application API role: member'),
    ).toBeVisible();
    expect(screen.getByText('Reporting API role: member')).toBeVisible();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/bff/application/organizations/organization_1/access',
        expect.any(Object),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/bff/reporting/organizations/organization_1/access',
        expect.any(Object),
      );
    });
  });

  it('hides administrative actions from a member and offers them to an owner', async () => {
    const respondWithRole = (role: 'member' | 'owner') =>
      vi.fn(async (input: string) => {
        if (input === '/api/auth/organization/list') {
          return Response.json([
            { id: 'organization_1', name: 'Organization 1' },
          ]);
        }
        return Response.json({
          capabilities:
            role === 'owner' ? ownerCapabilities : memberCapabilities,
          organizationId: 'organization_1',
          role,
          service: input.includes('/application/')
            ? 'application-api'
            : 'reporting-api',
        });
      });

    vi.stubGlobal('fetch', respondWithRole('member'));
    renderAccessPage();

    expect(
      await screen.findByRole('button', { name: 'Upload data' }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Ask the assistant' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Manage members' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Manage data grants' }),
    ).not.toBeInTheDocument();

    cleanup();
    vi.stubGlobal('fetch', respondWithRole('owner'));
    renderAccessPage();

    expect(
      await screen.findByRole('button', { name: 'Manage members' }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Manage data grants' }),
    ).toBeVisible();
  });

  it('shows an access error without presenting role results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input === '/api/auth/organization/list') {
          return Response.json([
            { id: 'organization_1', name: 'Organization 1' },
          ]);
        }
        return new Response(null, { status: 403 });
      }),
    );

    renderAccessPage();

    expect(
      await screen.findByText('Organization access could not be checked.'),
    ).toBeVisible();
    expect(screen.queryByText('Application API role:')).not.toBeInTheDocument();
  });
});
