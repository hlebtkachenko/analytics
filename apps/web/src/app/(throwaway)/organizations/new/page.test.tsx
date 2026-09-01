import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import NewOrganizationPage from './page';

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

afterEach(cleanup);

describe('NewOrganizationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { emailVerified: true, id: 'user-1', name: 'Initial Name' },
    });
  });

  it('shows remaining quota and keeps the slug prefilled from name', async () => {
    mocks.getOrganizationCreationQuota.mockResolvedValue({
      attributedTotal: 1,
      grantedTotal: 3,
      remainingTotal: 2,
    });

    render(await NewOrganizationPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText('Remaining creation quota: 2')).toBeVisible();
    const name = screen.getByLabelText('Name');
    const slug = screen.getByLabelText('Slug');
    expect(name).toHaveValue('Initial Name');
    expect(slug).toHaveValue('initial-name');
    fireEvent.change(name, { target: { value: 'Revised Organization' } });
    expect(slug).toHaveValue('revised-organization');
  });

  it('replaces the complete form with one sentence at zero quota', async () => {
    mocks.getOrganizationCreationQuota.mockResolvedValue({
      attributedTotal: 1,
      grantedTotal: 1,
      remainingTotal: 0,
    });

    render(await NewOrganizationPage({ searchParams: Promise.resolve({}) }));

    expect(
      screen.getByText(
        'Organization creation is not available for this account.',
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole('form', { name: 'Create organization' }),
    ).not.toBeInTheDocument();
  });

  it('fails closed to zero when quota cannot be read', async () => {
    mocks.getOrganizationCreationQuota.mockRejectedValue(
      new Error('private database detail'),
    );

    render(await NewOrganizationPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText('Remaining creation quota: 0')).toBeVisible();
    expect(document.body).not.toHaveTextContent('private database detail');
  });
});
