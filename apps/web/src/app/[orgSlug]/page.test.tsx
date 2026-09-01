import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import OrganizationPage from './page';

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  resolveOrganizationRouteForRequest: vi.fn(),
}));

vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));
vi.mock('../../lib/organizations/resolver', () => ({
  resolveOrganizationRouteForRequest: mocks.resolveOrganizationRouteForRequest,
}));

afterEach(cleanup);

describe('OrganizationPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders member-scoped organization navigation', async () => {
    mocks.resolveOrganizationRouteForRequest.mockResolvedValue({
      id: 'organization-1',
      name: 'Organization One',
      role: 'owner',
      slug: 'organization-one',
    });

    render(
      await OrganizationPage({
        params: Promise.resolve({ orgSlug: 'organization-one' }),
      }),
    );

    expect(
      screen.getByRole('heading', { name: 'Organization One' }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Members' })).toHaveAttribute(
      'href',
      '/organization-one/members',
    );
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/organization-one/settings',
    );
  });

  it('returns not found when the member-gated resolver fails', async () => {
    mocks.resolveOrganizationRouteForRequest.mockResolvedValue(null);

    await expect(
      OrganizationPage({
        params: Promise.resolve({ orgSlug: 'unknown-organization' }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
