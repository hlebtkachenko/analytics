import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  push: vi.fn(),
  readOrganizationAccess: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  resolveOrganizationRouteForRequest: vi.fn(),
  update: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
  useRouter: () => ({
    push: mocks.push,
    refresh: mocks.refresh,
    replace: mocks.replace,
  }),
}));
vi.mock('../../../../lib/auth/client', () => ({
  authClient: {
    getSession: mocks.getSession,
    organization: {
      update: mocks.update,
    },
  },
}));
vi.mock('../../../../lib/organizations/entities', () => ({
  readOrganizationAccess: mocks.readOrganizationAccess,
}));
vi.mock('../../../../lib/organizations/resolver', () => ({
  resolveOrganizationRouteForRequest: mocks.resolveOrganizationRouteForRequest,
}));

import { ToastProvider } from '../../../../components/shell/toast';
import { I18nProvider } from '../../../../i18n/client-provider';
import OrganizationSettingsPage from './page';

function accessFor(manageOrganization: boolean) {
  return {
    capabilities: { manageOrganization },
    organizationId: 'organization-1',
  };
}

async function renderPage() {
  const ui = await OrganizationSettingsPage({
    params: Promise.resolve({ orgSlug: 'organization-one' }),
  });
  return render(
    <I18nProvider>
      <ToastProvider>{ui}</ToastProvider>
    </I18nProvider>,
  );
}

afterEach(cleanup);

describe('OrganizationSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    }));
    mocks.resolveOrganizationRouteForRequest.mockResolvedValue({
      id: 'organization-1',
      name: 'Organization One',
      role: 'owner',
      slug: 'organization-one',
    });
    mocks.readOrganizationAccess.mockResolvedValue(accessFor(true));
    mocks.update.mockResolvedValue({ data: {}, error: null });
    mocks.getSession.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    // Self-deactivate goes through the members status BFF route; the default is a success.
    global.fetch = vi.fn(async () => ({
      json: async () => ({ status: 'inactive' }),
      ok: true,
      status: 200,
    })) as unknown as typeof fetch;
  });

  it('prefills the general form for an owner', async () => {
    await renderPage();

    expect(screen.getByRole('form', { name: 'General' })).toBeVisible();
    expect(screen.getByLabelText('Name')).toHaveValue('Organization One');
    expect(screen.getByLabelText('Slug')).toHaveValue('organization-one');
    expect(
      screen.getByRole('button', { name: 'Save changes' }),
    ).toBeInTheDocument();
  });

  it('saves a slug change, navigates to the new URL, and refreshes', async () => {
    await renderPage();

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Organization Renamed' },
    });
    fireEvent.change(screen.getByLabelText('Slug'), {
      target: { value: 'organization-renamed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(mocks.update).toHaveBeenCalledWith({
        data: { name: 'Organization Renamed', slug: 'organization-renamed' },
        organizationId: 'organization-1',
      });
    });
    expect(mocks.push).toHaveBeenCalledWith('/organization-renamed/settings');
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('refreshes without navigating on a name-only save', async () => {
    await renderPage();

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Organization Renamed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(mocks.update).toHaveBeenCalledWith({
        data: { name: 'Organization Renamed', slug: 'organization-one' },
        organizationId: 'organization-1',
      });
    });
    expect(mocks.refresh).toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('disables save while the slug is invalid', async () => {
    await renderPage();

    fireEvent.change(screen.getByLabelText('Slug'), {
      target: { value: 'ab' },
    });

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('shows an inline error for a taken slug and keeps the form', async () => {
    mocks.update.mockResolvedValue({
      error: { code: 'ORGANIZATION_SLUG_ALREADY_TAKEN' },
    });

    await renderPage();

    fireEvent.change(screen.getByLabelText('Slug'), {
      target: { value: 'organization-taken' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await screen.findByText('That workspace address is already taken.');
    expect(screen.getByRole('form', { name: 'General' })).toBeVisible();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(
      screen.queryByText('The workspace was updated.'),
    ).not.toBeInTheDocument();
  });

  it('renders read-only fields with no save for a member', async () => {
    mocks.resolveOrganizationRouteForRequest.mockResolvedValue({
      id: 'organization-1',
      name: 'Organization One',
      role: 'member',
      slug: 'organization-one',
    });
    mocks.readOrganizationAccess.mockResolvedValue(accessFor(false));

    await renderPage();

    expect(screen.getByLabelText('Name')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Slug')).toHaveAttribute('readonly');
    expect(
      screen.queryByRole('button', { name: 'Save changes' }),
    ).not.toBeInTheDocument();
  });

  it('falls back to read-only when the access read fails', async () => {
    mocks.readOrganizationAccess.mockResolvedValue(null);

    await renderPage();

    expect(screen.getByLabelText('Name')).toHaveAttribute('readonly');
    expect(
      screen.queryByRole('button', { name: 'Save changes' }),
    ).not.toBeInTheDocument();
  });

  it('self-deactivates the membership and navigates to the workspace list', async () => {
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Leave workspace' }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/bff/application/organizations/organization-1/members/user-1/status',
        expect.objectContaining({
          body: JSON.stringify({ status: 'inactive' }),
          method: 'PUT',
        }),
      );
    });
    expect(mocks.push).toHaveBeenCalledWith(
      '/organizations?result=workspace-left',
    );
  });

  it('keeps the leave modal open with an inline sole-owner error', async () => {
    // The API refuses the last active owner with 409.
    global.fetch = vi.fn(async () => ({
      json: async () => ({}),
      ok: false,
      status: 409,
    })) as unknown as typeof fetch;

    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Leave workspace' }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));

    await screen.findByText('The workspace must keep at least one owner.');
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('returns not found when the resolver denies the slug', async () => {
    mocks.resolveOrganizationRouteForRequest.mockResolvedValue(null);

    await expect(
      OrganizationSettingsPage({
        params: Promise.resolve({ orgSlug: 'unknown-organization' }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
