import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createOrganizationAction: vi.fn(),
  getOrganizationCreationQuota: vi.fn(),
  getSession: vi.fn(),
  pool: {},
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
  createOrganizationAction: mocks.createOrganizationAction,
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import { I18nProvider } from '../../../../i18n/client-provider';
import NewOrganizationPage from './page';

async function renderPage(result?: string) {
  const ui = await NewOrganizationPage({
    searchParams: Promise.resolve(result === undefined ? {} : { result }),
  });
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

  it('replaces the form with one message at zero quota', async () => {
    mocks.getOrganizationCreationQuota.mockResolvedValue({
      attributedTotal: 1,
      grantedTotal: 1,
      remainingTotal: 0,
    });

    await renderPage();

    expect(
      screen.getByText('Workspace creation is not available for this account.'),
    ).toBeVisible();
    expect(
      screen.queryByRole('form', { name: 'Create workspace' }),
    ).not.toBeInTheDocument();
  });

  it('shows an inline error when the address is already taken', async () => {
    mocks.getOrganizationCreationQuota.mockResolvedValue({
      attributedTotal: 0,
      grantedTotal: 1,
      remainingTotal: 1,
    });

    await renderPage('slug-taken');

    expect(
      screen.getByText('That workspace address is already taken.'),
    ).toBeVisible();
  });

  it('replaces the form with the quota-exhausted marker even with remaining quota', async () => {
    mocks.getOrganizationCreationQuota.mockResolvedValue({
      attributedTotal: 1,
      grantedTotal: 3,
      remainingTotal: 2,
    });

    await renderPage('quota-exhausted');

    expect(
      screen.getByText('Workspace creation is not available for this account.'),
    ).toBeVisible();
    expect(
      screen.queryByRole('form', { name: 'Create workspace' }),
    ).not.toBeInTheDocument();
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
