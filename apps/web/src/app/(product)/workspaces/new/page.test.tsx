import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createWorkspaceAction: vi.fn(),
  getOrganizationCreationQuota: vi.fn(),
  getSession: vi.fn(),
  inviteMemberWithScopeAction: vi.fn(),
  pool: {},
  push: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));

vi.mock('@bap/db/access', () => ({
  getOrganizationCreationQuota: mocks.getOrganizationCreationQuota,
}));
vi.mock('../../../../lib/auth/server', () => ({
  getAuth: async () => ({ api: { getSession: mocks.getSession } }),
  getAuthPool: async () => mocks.pool,
}));
vi.mock('../../../../lib/organizations/actions', () => ({
  createWorkspaceAction: mocks.createWorkspaceAction,
  inviteMemberWithScopeAction: mocks.inviteMemberWithScopeAction,
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ push: mocks.push }),
}));

import { I18nProvider } from '../../../../i18n/client-provider';
import NewOrganizationPage from './page';

async function renderPage() {
  const ui = await NewOrganizationPage();
  return render(<I18nProvider>{ui}</I18nProvider>);
}

afterEach(cleanup);

describe('NewOrganizationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { emailVerified: true, id: 'user-1', name: 'Initial Name' },
    });
  });

  it('shows remaining quota and keeps the slug derived from the name', async () => {
    mocks.getOrganizationCreationQuota.mockResolvedValue({
      attributedTotal: 1,
      grantedTotal: 3,
      remainingTotal: 2,
    });

    await renderPage();

    expect(screen.getByText('Remaining of granted quota: 2')).toBeVisible();
    const name = screen.getByLabelText('Name');
    const slug = screen.getByLabelText('Slug');
    expect(name).toHaveValue('Initial Name');
    expect(slug).toHaveValue('initial-name');
    fireEvent.change(name, { target: { value: 'Revised Workspace' } });
    expect(slug).toHaveValue('revised-workspace');
  });

  it('keeps the wizard mounted at zero quota with the warning shown', async () => {
    mocks.getOrganizationCreationQuota.mockResolvedValue({
      attributedTotal: 1,
      grantedTotal: 1,
      remainingTotal: 0,
    });

    await renderPage();

    expect(
      screen.getByText('Workspace creation is not available for this account.'),
    ).toBeVisible();
    // The wizard is never swapped out, so its first step stays mounted.
    expect(
      screen.getByRole('form', { name: 'Create workspace' }),
    ).toBeInTheDocument();
  });

  it('fails closed to zero when quota cannot be read', async () => {
    mocks.getOrganizationCreationQuota.mockRejectedValue(
      new Error('private database detail'),
    );

    await renderPage();

    expect(screen.getByText('Remaining of granted quota: 0')).toBeVisible();
    expect(document.body).not.toHaveTextContent('private database detail');
  });
});
