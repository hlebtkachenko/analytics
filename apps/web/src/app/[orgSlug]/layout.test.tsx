import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import OrganizationLayout from './layout';

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

describe('OrganizationLayout', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the organization subtree for a member', async () => {
    mocks.resolveOrganizationRouteForRequest.mockResolvedValue({
      id: 'organization-1',
      name: 'Organization One',
      role: 'member',
      slug: 'organization-one',
    });

    render(
      await OrganizationLayout({
        children: <p>Organization content</p>,
        params: Promise.resolve({ orgSlug: 'organization-one' }),
      }),
    );

    expect(screen.getByText('Organization content')).toBeVisible();
    expect(mocks.resolveOrganizationRouteForRequest).toHaveBeenCalledWith(
      'organization-one',
    );
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it.each(['a nonmember', 'an unknown organization'])(
    'returns the same not-found result for %s',
    async () => {
      mocks.resolveOrganizationRouteForRequest.mockResolvedValue(null);

      await expect(
        OrganizationLayout({
          children: <p>Private content</p>,
          params: Promise.resolve({ orgSlug: 'organization-one' }),
        }),
      ).rejects.toThrow('NEXT_NOT_FOUND');
      expect(mocks.notFound).toHaveBeenCalledOnce();
    },
  );
});
