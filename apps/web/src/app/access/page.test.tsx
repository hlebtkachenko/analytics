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
          organizationId: 'organization_1',
          role: 'member',
          service: 'application-api',
        });
      }
      return Response.json({
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
