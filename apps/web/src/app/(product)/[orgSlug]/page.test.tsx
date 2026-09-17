import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listInvitations: vi.fn(),
  listMembers: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  readDatasets: vi.fn(),
  readLegalEntities: vi.fn(),
  readOrganizationAccess: vi.fn(),
  resolveOrganizationRouteForRequest: vi.fn(),
}));

vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../../lib/auth/server', () => ({
  getAuth: async () => ({
    api: {
      listInvitations: mocks.listInvitations,
      listMembers: mocks.listMembers,
    },
  }),
  organizationCreationConfiguration: { membershipLimit: 100 },
}));
vi.mock('../../../lib/organizations/entities', () => ({
  readDatasets: mocks.readDatasets,
  readLegalEntities: mocks.readLegalEntities,
  readOrganizationAccess: mocks.readOrganizationAccess,
}));
vi.mock('../../../lib/organizations/resolver', () => ({
  resolveOrganizationRouteForRequest: mocks.resolveOrganizationRouteForRequest,
}));

import OrganizationLandingPage from './page';

const allCapabilities = {
  createEntities: true,
  deleteEntities: true,
  manageDocuments: true,
  manageEntityAccess: true,
  manageMembers: true,
  manageOrganization: true,
  readDocuments: true,
  updateEntities: true,
  uploadData: true,
  useAi: true,
};

function accessWith(overrides: Partial<typeof allCapabilities>) {
  return {
    capabilities: { ...allCapabilities, ...overrides },
    organizationId: 'organization-1',
  };
}

function legalEntity(id: string) {
  return {
    createdAt: '2026-09-10T06:00:00.000Z',
    id,
    kind: 'company' as const,
    name: `Entity ${id}`,
    registrationNumber: null,
    updatedAt: '2026-09-10T06:05:00.000Z',
  };
}

function dataset(id: string) {
  return {
    createdAt: '2026-09-11T06:00:00.000Z',
    description: null,
    id,
    legalEntityId: 'legal-entity-1',
    name: `Dataset ${id}`,
    rowCount: 1,
    status: 'ready' as const,
    updatedAt: '2026-09-11T06:05:00.000Z',
  };
}

async function renderPage() {
  const ui = await OrganizationLandingPage({
    params: Promise.resolve({ orgSlug: 'organization-one' }),
  });
  return render(ui);
}

function hrefFor(container: HTMLElement, href: string) {
  return container.querySelector(`a[href="${href}"]`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveOrganizationRouteForRequest.mockResolvedValue({
    id: 'organization-1',
    name: 'Workspace One',
    role: 'owner',
    slug: 'organization-one',
  });
  mocks.readOrganizationAccess.mockResolvedValue(accessWith({}));
  mocks.readLegalEntities.mockResolvedValue([
    legalEntity('a'),
    legalEntity('b'),
    legalEntity('c'),
  ]);
  mocks.readDatasets.mockResolvedValue([dataset('a'), dataset('b')]);
  mocks.listMembers.mockResolvedValue({ members: [], total: 5 });
  mocks.listInvitations.mockResolvedValue([
    { email: 'a@bap.test', id: 'i1', role: 'member', status: 'pending' },
    { email: 'b@bap.test', id: 'i2', role: 'member', status: 'pending' },
    { email: 'c@bap.test', id: 'i3', role: 'member', status: 'accepted' },
  ]);
});

afterEach(cleanup);

describe('OrganizationLandingPage', () => {
  it('renders the workspace name, slug, role, counts, and tile links', async () => {
    const { container } = await renderPage();

    expect(
      screen.getByRole('heading', { name: 'Workspace One' }),
    ).toBeDefined();
    expect(screen.getByText('organization-one')).toBeDefined();
    expect(screen.getByText('Owner')).toBeDefined();

    expect(screen.getByText('5 of 100')).toBeDefined();
    // Only the two pending invitations are counted, not the accepted one.
    expect(screen.getByText('2')).toBeDefined();
    expect(screen.getByText('3')).toBeDefined();

    expect(hrefFor(container, '/organization-one/members')).not.toBeNull();
    expect(
      hrefFor(container, '/organization-one/members?tab=invitations'),
    ).not.toBeNull();
    expect(hrefFor(container, '/organization-one/entities')).not.toBeNull();
    expect(hrefFor(container, '/documents')).not.toBeNull();
    expect(hrefFor(container, '/datasets')).not.toBeNull();
    expect(hrefFor(container, '/organization-one/settings')).not.toBeNull();

    expect(screen.queryByText('Next steps')).toBeNull();
    expect(
      screen.queryByText('Some workspace details could not be loaded.'),
    ).toBeNull();
  });

  it('labels the caller role from the workspace role labels', async () => {
    mocks.resolveOrganizationRouteForRequest.mockResolvedValue({
      id: 'organization-1',
      name: 'Workspace One',
      role: 'member',
      slug: 'organization-one',
    });

    await renderPage();

    expect(screen.getByText('Member')).toBeDefined();
  });

  it('shows the create-entity next step when there are no entities and the capability holds', async () => {
    mocks.readLegalEntities.mockResolvedValue([]);

    await renderPage();

    expect(screen.getByText('Next steps')).toBeDefined();
    expect(
      screen.getByRole('link', { name: 'Add your first legal entity' }),
    ).toBeDefined();
    expect(screen.queryByText('Invite people to the workspace')).toBeNull();
    expect(screen.queryByText('Upload your first dataset')).toBeNull();
  });

  it('hides the create-entity next step without the capability', async () => {
    mocks.readLegalEntities.mockResolvedValue([]);
    mocks.readOrganizationAccess.mockResolvedValue(
      accessWith({ createEntities: false }),
    );

    await renderPage();

    expect(screen.queryByText('Next steps')).toBeNull();
    expect(screen.queryByText('Add your first legal entity')).toBeNull();
  });

  it('shows the invite next step for a lone member with manageMembers', async () => {
    mocks.listMembers.mockResolvedValue({ members: [], total: 1 });

    await renderPage();

    expect(screen.getByText('1 of 100')).toBeDefined();
    expect(
      screen.getByRole('link', { name: 'Invite people to the workspace' }),
    ).toBeDefined();
  });

  it('shows the upload-data next step with no datasets and uploadData', async () => {
    mocks.readDatasets.mockResolvedValue([]);

    const { container } = await renderPage();

    const uploadLink = screen.getByRole('link', {
      name: 'Upload your first dataset',
    });
    expect(uploadLink).toBeDefined();
    expect(uploadLink.getAttribute('href')).toBe('/datasets');
    expect(container).toBeDefined();
  });

  it('calls notFound when the tenant does not resolve', async () => {
    mocks.resolveOrganizationRouteForRequest.mockResolvedValue(null);

    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it('shows the load error notification when a read returns null', async () => {
    mocks.readOrganizationAccess.mockResolvedValue(null);

    await renderPage();

    expect(
      screen.getByText('Some workspace details could not be loaded.'),
    ).toBeDefined();
    // Capabilities fail closed, so no next step renders even with zero entities.
    expect(screen.queryByText('Next steps')).toBeNull();
  });

  it('shows the load error notification when a list read rejects', async () => {
    mocks.listMembers.mockRejectedValue(new Error('unreachable'));

    await renderPage();

    expect(
      screen.getByText('Some workspace details could not be loaded.'),
    ).toBeDefined();
  });
});
