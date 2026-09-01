import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import OrganizationsPage from './page';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listOrganizations: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));

vi.mock('../../../lib/auth/server', () => ({
  getAuth: async () => ({
    api: {
      getSession: mocks.getSession,
      listOrganizations: mocks.listOrganizations,
    },
  }),
}));

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

afterEach(cleanup);

describe('OrganizationsPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists only the authenticated memberships and links creation', async () => {
    mocks.getSession.mockResolvedValue({ user: { emailVerified: true } });
    mocks.listOrganizations.mockResolvedValue([
      {
        id: 'organization-1',
        name: 'Organization One',
        slug: 'organization-one',
      },
    ]);

    render(await OrganizationsPage());

    expect(
      screen.getByRole('heading', { name: 'Organizations' }),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Create organization' }),
    ).toHaveAttribute('href', '/organizations/new');
    expect(
      screen.getByRole('link', { name: 'Organization One' }),
    ).toHaveAttribute('href', '/organization-one');
  });

  it('redirects an unverified request before listing memberships', async () => {
    mocks.getSession.mockResolvedValue({ user: { emailVerified: false } });

    await expect(OrganizationsPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith('/sign-in');
    expect(mocks.listOrganizations).not.toHaveBeenCalled();
  });

  it('reports a generic list failure', async () => {
    mocks.getSession.mockResolvedValue({ user: { emailVerified: true } });
    mocks.listOrganizations.mockRejectedValue(new Error('private detail'));

    render(await OrganizationsPage());

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Organizations could not be loaded.',
    );
    expect(document.body).not.toHaveTextContent('private detail');
  });
});
