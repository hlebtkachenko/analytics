import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import OrganizationSettingsPage from './page';

const mocks = vi.hoisted(() => ({
  resolveOrganizationRouteForRequest: vi.fn(),
  updateOrganizationAction: vi.fn(),
}));

vi.mock('../../../lib/organizations/actions', () => ({
  updateOrganizationAction: mocks.updateOrganizationAction,
}));
vi.mock('../../../lib/organizations/resolver', () => ({
  resolveOrganizationRouteForRequest: mocks.resolveOrganizationRouteForRequest,
}));

afterEach(cleanup);

describe('OrganizationSettingsPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('prefills settings for an owner', async () => {
    mocks.resolveOrganizationRouteForRequest.mockResolvedValue({
      id: 'organization-1',
      name: 'Organization One',
      role: 'owner',
      slug: 'organization-one',
    });

    render(
      await OrganizationSettingsPage({
        params: Promise.resolve({ orgSlug: 'organization-one' }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(
      screen.getByRole('form', { name: 'Organization settings' }),
    ).toBeVisible();
    expect(screen.getByLabelText('Name')).toHaveValue('Organization One');
    expect(screen.getByLabelText('Slug')).toHaveValue('organization-one');
  });

  it('does not offer the update form to a member', async () => {
    mocks.resolveOrganizationRouteForRequest.mockResolvedValue({
      id: 'organization-1',
      name: 'Organization One',
      role: 'member',
      slug: 'organization-one',
    });

    render(
      await OrganizationSettingsPage({
        params: Promise.resolve({ orgSlug: 'organization-one' }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(
      screen.queryByRole('form', { name: 'Organization settings' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'You do not have permission to update this organization.',
      ),
    ).toBeVisible();
  });
});
