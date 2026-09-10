import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import OrganizationEntitiesPage from './page';

const mocks = vi.hoisted(() => ({
  createLegalEntityAction: vi.fn(),
  deleteLegalEntityAction: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  readLegalEntities: vi.fn(),
  readOrganizationAccess: vi.fn(),
  resolveOrganizationRouteForRequest: vi.fn(),
  updateLegalEntityAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));
vi.mock('../../../lib/organizations/entity-actions', () => ({
  createLegalEntityAction: mocks.createLegalEntityAction,
  deleteLegalEntityAction: mocks.deleteLegalEntityAction,
  updateLegalEntityAction: mocks.updateLegalEntityAction,
}));
vi.mock('../../../lib/organizations/entities', () => ({
  readLegalEntities: mocks.readLegalEntities,
  readOrganizationAccess: mocks.readOrganizationAccess,
}));
vi.mock('../../../lib/organizations/resolver', () => ({
  resolveOrganizationRouteForRequest: mocks.resolveOrganizationRouteForRequest,
}));

const LEGAL_ENTITY_ID = '9b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21';

const capabilities = {
  createEntities: false,
  deleteEntities: false,
  manageEntityAccess: false,
  manageMembers: false,
  manageOrganization: false,
  updateEntities: false,
  uploadData: false,
  useAi: true,
};

function accessFor(
  role: 'admin' | 'member' | 'owner',
  entityScope: unknown = { mode: 'all' },
) {
  return {
    capabilities: {
      ...capabilities,
      createEntities: role !== 'member',
      deleteEntities: role === 'owner',
      manageEntityAccess: role === 'owner',
      manageMembers: role === 'owner',
      manageOrganization: role === 'owner',
      updateEntities: role !== 'member',
      uploadData: role !== 'member',
    },
    entityScope,
    organizationId: 'organization-1',
    role,
    service: 'application-api',
  };
}

afterEach(cleanup);

describe('OrganizationEntitiesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveOrganizationRouteForRequest.mockResolvedValue({
      id: 'organization-1',
      name: 'Organization One',
      role: 'owner',
      slug: 'organization-one',
    });
    mocks.readOrganizationAccess.mockResolvedValue(accessFor('owner'));
    mocks.readLegalEntities.mockResolvedValue([
      {
        createdAt: '2026-09-10T06:00:00.000Z',
        id: LEGAL_ENTITY_ID,
        kind: 'company',
        name: 'Placeholder Holding',
        registrationNumber: 'HRB-1',
        updatedAt: '2026-09-10T06:05:00.000Z',
      },
    ]);
  });

  async function renderPage(result?: string): Promise<void> {
    render(
      await OrganizationEntitiesPage({
        params: Promise.resolve({ orgSlug: 'organization-one' }),
        searchParams: Promise.resolve(result === undefined ? {} : { result }),
      }),
    );
  }

  it('offers an owner the full entity lifecycle', async () => {
    await renderPage();

    expect(mocks.readLegalEntities).toHaveBeenCalledWith('organization-1');
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(
      within(breadcrumb).getByRole('link', { name: 'Organizations' }),
    ).toHaveAttribute('href', '/organizations');
    expect(
      within(breadcrumb).getByRole('link', { name: 'Organization One' }),
    ).toHaveAttribute('href', '/organization-one');
    expect(
      within(breadcrumb).getByText('Entities', { selector: 'li' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText(/Placeholder Holding/)).toBeVisible();
    expect(screen.getByText(/HRB-1/)).toBeVisible();
    expect(screen.getByText('Your entity scope: All entities')).toBeVisible();

    const editForm = screen.getByRole('form', {
      name: 'Edit Placeholder Holding',
    });
    expect(within(editForm).getByLabelText('Name')).toHaveValue(
      'Placeholder Holding',
    );
    expect(within(editForm).getByLabelText('Kind')).toHaveValue('company');
    expect(within(editForm).getByLabelText('Registration number')).toHaveValue(
      'HRB-1',
    );
    expect(
      screen.getByRole('form', { name: 'Delete Placeholder Holding' }),
    ).toBeVisible();
    expect(
      screen.getByRole('form', { name: 'Add legal entity' }),
    ).toBeVisible();
  });

  it('offers an admin creation and editing but never deletion', async () => {
    mocks.readOrganizationAccess.mockResolvedValue(accessFor('admin'));

    await renderPage();

    expect(
      screen.getByRole('form', { name: 'Add legal entity' }),
    ).toBeVisible();
    expect(
      screen.getByRole('form', { name: 'Edit Placeholder Holding' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Delete entity' }),
    ).not.toBeInTheDocument();
  });

  it('shows a restricted member the list without any form', async () => {
    mocks.readOrganizationAccess.mockResolvedValue(
      accessFor('member', {
        legalEntityIds: [LEGAL_ENTITY_ID],
        mode: 'restricted',
      }),
    );

    await renderPage();

    expect(screen.getByText(/Placeholder Holding/)).toBeVisible();
    expect(
      screen.getByText('Your entity scope: Selected entities'),
    ).toBeVisible();
    expect(
      screen.queryByRole('form', { name: 'Add legal entity' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Save entity' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Delete entity' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports an unavailable list and a failed action generically', async () => {
    mocks.readLegalEntities.mockResolvedValue(null);

    await renderPage();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The legal entity list could not be updated.',
    );

    cleanup();
    mocks.readLegalEntities.mockResolvedValue([]);
    await renderPage('success');

    expect(screen.getByRole('status')).toHaveTextContent(
      'The legal entity list was updated.',
    );
    expect(screen.getByText('No legal entities are available.')).toBeVisible();
  });

  it('returns not found when the member-gated resolver fails', async () => {
    mocks.resolveOrganizationRouteForRequest.mockResolvedValue(null);

    await expect(
      OrganizationEntitiesPage({
        params: Promise.resolve({ orgSlug: 'unknown-organization' }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.readLegalEntities).not.toHaveBeenCalled();
  });
});
