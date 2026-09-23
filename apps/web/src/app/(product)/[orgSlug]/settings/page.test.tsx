import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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

function accessFor(manageOrganization: boolean, manageDocuments = false) {
  return {
    capabilities: { manageDocuments, manageOrganization },
    organizationId: 'organization-1',
  };
}

const STORAGE_PATH =
  '/api/bff/application/organizations/organization-1/inbox/settings';
const PLATFORM_QUOTA_BYTES = 10_000_000_000;

// The inbox settings route answers the storage section; every other call is the leave request.
function respondWith(leaveStatus = 200) {
  let quotaBytes: number | null = null;
  return vi.fn(async (input: string, init?: RequestInit) => {
    if (input === STORAGE_PATH && init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as {
        blobQuotaBytes: number | null;
      };
      if (
        body.blobQuotaBytes !== null &&
        body.blobQuotaBytes > PLATFORM_QUOTA_BYTES
      ) {
        return Response.json(
          { error: 'inbox_settings_rejected' },
          { status: 422 },
        );
      }
      quotaBytes = body.blobQuotaBytes;
    }
    if (input === STORAGE_PATH) {
      return Response.json({
        blobQuotaBytes: quotaBytes,
        platformQuotaBytes: PLATFORM_QUOTA_BYTES,
        usedBytes: 2_500_000,
      });
    }
    return Response.json(leaveStatus === 200 ? { status: 'inactive' } : {}, {
      status: leaveStatus,
    });
  });
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
    mocks.readOrganizationAccess.mockResolvedValue(accessFor(true, true));
    mocks.update.mockResolvedValue({ data: {}, error: null });
    mocks.getSession.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    // Self-deactivate goes through the members status BFF route; the default is a success.
    global.fetch = respondWith() as unknown as typeof fetch;
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
      '/workspaces?result=workspace-left',
    );
  });

  it('keeps the leave modal open with an inline sole-owner error', async () => {
    // The API refuses the last active owner with 409.
    global.fetch = respondWith(409) as unknown as typeof fetch;

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

  it('hides the inbox storage from a member', async () => {
    mocks.readOrganizationAccess.mockResolvedValue(accessFor(false));

    await renderPage();

    expect(
      screen.queryByRole('heading', { name: 'Inbox storage' }),
    ).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalledWith(
      STORAGE_PATH,
      expect.anything(),
    );
  });

  it('shows the inbox storage read only to an admin', async () => {
    mocks.readOrganizationAccess.mockResolvedValue(accessFor(false, true));

    await renderPage();

    expect(
      await screen.findByText(
        'Storage quota (MB): Platform default. Platform cap 10,000 MB. In use 2.5 MB. Leave empty to use the platform default.',
      ),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Inbox storage' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('form', { name: 'Inbox storage' }),
    ).not.toBeInTheDocument();
  });

  it('lets an owner save the quota in bytes and names a quota above the cap', async () => {
    await renderPage();

    const form = await screen.findByRole('form', { name: 'Inbox storage' });
    expect(
      within(form).getByText(
        'Platform cap 10,000 MB. In use 2.5 MB. Leave empty to use the platform default.',
      ),
    ).toBeVisible();
    fireEvent.change(within(form).getByLabelText('Storage quota (MB)'), {
      target: { value: '500' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Save quota' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        STORAGE_PATH,
        expect.objectContaining({
          body: JSON.stringify({ blobQuotaBytes: 500_000_000 }),
          method: 'PATCH',
        }),
      );
    });
    expect(
      await screen.findByText('The storage quota was saved.'),
    ).toBeVisible();

    fireEvent.change(screen.getByLabelText('Storage quota (MB)'), {
      target: { value: '20000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save quota' }));

    expect(
      await screen.findByText(
        'The quota cannot exceed the platform cap of 10,000 MB.',
      ),
    ).toBeVisible();
  });
});
