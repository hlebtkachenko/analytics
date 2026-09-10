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
  createEntities: false,
  deleteEntities: false,
  manageEntityAccess: false,
  manageMembers: false,
  manageOrganization: false,
  updateEntities: false,
  uploadData: false,
  useAi: true,
};
const adminCapabilities = {
  ...memberCapabilities,
  createEntities: true,
  updateEntities: true,
  uploadData: true,
};
const ownerCapabilities = {
  createEntities: true,
  deleteEntities: true,
  manageEntityAccess: true,
  manageMembers: true,
  manageOrganization: true,
  updateEntities: true,
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
          {
            id: 'organization_1',
            name: 'Organization 1',
            slug: 'organization-1',
          },
        ]);
      }
      if (input.includes('/application/')) {
        return Response.json({
          capabilities: memberCapabilities,
          entityScope: { mode: 'all' },
          organizationId: 'organization_1',
          role: 'member',
          service: 'application-api',
        });
      }
      return Response.json({
        capabilities: memberCapabilities,
        entityScope: { mode: 'all' },
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
    const respondWithRole = (
      role: 'admin' | 'member' | 'owner',
      entityScope: unknown = { mode: 'all' },
    ) =>
      vi.fn(async (input: string) => {
        if (input === '/api/auth/organization/list') {
          return Response.json([
            {
              id: 'organization_1',
              name: 'Organization 1',
              slug: 'organization-1',
            },
          ]);
        }
        return Response.json({
          capabilities:
            role === 'owner'
              ? ownerCapabilities
              : role === 'admin'
                ? adminCapabilities
                : memberCapabilities,
          entityScope,
          organizationId: 'organization_1',
          role,
          service: input.includes('/application/')
            ? 'application-api'
            : 'reporting-api',
        });
      });

    vi.stubGlobal(
      'fetch',
      respondWithRole('member', {
        legalEntityIds: ['00000000-0000-4000-8000-000000000001'],
        mode: 'restricted',
      }),
    );
    renderAccessPage();

    expect(await screen.findByText('Ask the assistant: Allowed')).toBeVisible();
    expect(screen.getByText('Upload data: Not allowed')).toBeVisible();
    expect(
      screen.getByText('Entity scope: Selected legal entities: 1'),
    ).toBeVisible();
    expect(
      screen.queryByRole('link', { name: 'Manage members' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Manage entity access' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Manage legal entities' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Upload data' }),
    ).not.toBeInTheDocument();

    cleanup();
    vi.stubGlobal('fetch', respondWithRole('admin'));
    renderAccessPage();

    expect(
      await screen.findByRole('link', { name: 'Manage legal entities' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('link', { name: 'Manage entity access' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('Delete legal entities: Not allowed'),
    ).toBeVisible();

    cleanup();
    vi.stubGlobal('fetch', respondWithRole('owner'));
    renderAccessPage();

    expect(
      await screen.findByRole('link', { name: 'Manage members' }),
    ).toBeVisible();
    expect(screen.getByText('Entity scope: All legal entities')).toBeVisible();
    expect(screen.getAllByText('Unavailable')).toHaveLength(1);
    expect(
      screen.getByRole('link', { name: 'Manage members' }),
    ).toHaveAttribute('href', '/organization-1/members');
    expect(
      screen.getByRole('link', { name: 'Manage entity access' }),
    ).toHaveAttribute('href', '/organization-1/members');
    expect(
      screen.getByRole('link', { name: 'Manage legal entities' }),
    ).toHaveAttribute('href', '/organization-1/entities');
    expect(screen.getByRole('link', { name: 'Upload data' })).toHaveAttribute(
      'href',
      '/datasets?organization=organization-1#upload-dataset',
    );
    for (const capability of [
      'Manage organization',
      'Manage members',
      'Manage entity access',
      'Create legal entities',
      'Edit legal entities',
      'Delete legal entities',
      'Upload data',
      'Ask the assistant',
    ]) {
      expect(screen.getByText(`${capability}: Allowed`)).toBeVisible();
    }
  });

  it('shows an access error without presenting role results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input === '/api/auth/organization/list') {
          return Response.json([
            {
              id: 'organization_1',
              name: 'Organization 1',
              slug: 'organization-1',
            },
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
