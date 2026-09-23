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
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  readLegalEntities: vi.fn(),
  readOrganizationAccess: vi.fn(),
  resolveOrganizationRouteForRequest: vi.fn(),
}));

vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));
vi.mock('../../../../lib/organizations/entities', () => ({
  readLegalEntities: mocks.readLegalEntities,
  readOrganizationAccess: mocks.readOrganizationAccess,
}));
vi.mock('../../../../lib/organizations/resolver', () => ({
  resolveOrganizationRouteForRequest: mocks.resolveOrganizationRouteForRequest,
}));

import { ToastProvider } from '../../../../components/shell/toast';
import { I18nProvider } from '../../../../i18n/client-provider';
import OrganizationEntitiesPage from './page';

const LEGAL_ENTITY_ID = '9b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21';

const entity = {
  createdAt: '2026-09-10T06:00:00.000Z',
  id: LEGAL_ENTITY_ID,
  kind: 'company',
  name: 'Placeholder Entity',
  registrationNumber: 'HRB-1',
  updatedAt: '2026-09-10T06:05:00.000Z',
};

function accessFor(role: 'admin' | 'member' | 'owner') {
  return {
    capabilities: {
      createEntities: role !== 'member',
      deleteEntities: role === 'owner',
      manageDocuments: role !== 'member',
      managePayroll: false,
      manageSensitiveHr: false,
      readPayroll: false,
      readSensitiveHr: false,
      approvePayroll: false,
      manageHr: role !== 'member',
      manageEntityAccess: role === 'owner',
      manageMembers: role === 'owner',
      manageOrganization: role === 'owner',
      readHr: role !== 'member',
      updateEntities: role !== 'member',
      uploadData: role !== 'member',
      useAi: true,
    },
    organizationId: 'organization-1',
  };
}

async function renderPage() {
  const ui = await OrganizationEntitiesPage({
    params: Promise.resolve({ orgSlug: 'organization-one' }),
  });
  return render(
    <I18nProvider>
      <ToastProvider>{ui}</ToastProvider>
    </I18nProvider>,
  );
}

function rowFor(name: string): HTMLElement {
  const cell = screen.getByText(name);
  const row = cell.closest('tr');
  if (row === null) {
    throw new Error('row not found');
  }
  return row;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
    mocks.readLegalEntities.mockResolvedValue([entity]);
  });

  it('renders the list of legal entities for an owner', async () => {
    await renderPage();

    const row = rowFor('Placeholder Entity');
    expect(within(row).getByText('Company')).toBeVisible();
    expect(within(row).getByText('HRB-1')).toBeVisible();
    expect(within(row).getByText('2026-09-10')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Add legal entity' }),
    ).toBeVisible();
  });

  it('creates a legal entity and re-reads the list', async () => {
    const calls: { body: unknown; method: string | undefined; path: string }[] =
      [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init?: RequestInit) => {
        calls.push({
          body:
            init?.body === undefined
              ? undefined
              : JSON.parse(String(init.body)),
          method: init?.method,
          path,
        });
        if (init?.method === 'POST') {
          return Response.json(entity, { status: 201 });
        }
        return Response.json({ legalEntities: [entity] });
      }),
    );

    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Add legal entity' }));
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Placeholder Entity' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('The legal entity was created.');
    const post = calls.find((call) => call.method === 'POST');
    expect(post?.path).toBe(
      '/api/bff/application/organizations/organization-1/legal-entities',
    );
    expect(post?.body).toEqual({ kind: 'company', name: 'Placeholder Entity' });
    expect(calls.some((call) => call.method === undefined)).toBe(true);
  });

  it('keeps the modal open with an inline name error on a 409', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_path: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? Response.json({ error: 'legal_entity_rejected' }, { status: 409 })
          : Response.json({ legalEntities: [entity] }),
      ),
    );

    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Add legal entity' }));
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Placeholder Entity' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('A legal entity with this name already exists.');
    expect(
      screen.queryByText('The legal entity was created.'),
    ).not.toBeInTheDocument();
  });

  it('deletes the selected entity and re-reads the list', async () => {
    const calls: { method: string | undefined; path: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init?: RequestInit) => {
        calls.push({ method: init?.method, path });
        if (init?.method === 'DELETE') {
          return new Response(null, { status: 204 });
        }
        return Response.json({ legalEntities: [] });
      }),
    );

    await renderPage();

    fireEvent.click(within(rowFor('Placeholder Entity')).getByRole('button'));
    fireEvent.click(screen.getByText('Delete'));
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete legal entity' }),
    );

    await screen.findByText('The legal entity was deleted.');
    const del = calls.find((call) => call.method === 'DELETE');
    expect(del?.path).toBe(
      `/api/bff/application/organizations/organization-1/legal-entities/${LEGAL_ENTITY_ID}`,
    );
    await waitFor(() => {
      expect(calls.some((call) => call.method === undefined)).toBe(true);
    });
  });

  it('hides every action from a member', async () => {
    mocks.readOrganizationAccess.mockResolvedValue(accessFor('member'));

    await renderPage();

    expect(
      screen.queryByRole('button', { name: 'Add legal entity' }),
    ).not.toBeInTheDocument();
    expect(
      within(rowFor('Placeholder Entity')).queryByRole('button'),
    ).not.toBeInTheDocument();
  });

  it('reports a failed list load with a notification', async () => {
    mocks.readLegalEntities.mockResolvedValue(null);

    await renderPage();

    expect(
      screen.getByText('Legal entities could not be loaded.'),
    ).toBeVisible();
    expect(screen.queryByText('Placeholder Entity')).not.toBeInTheDocument();
  });

  it('offers creation from the empty state to a capable user only', async () => {
    mocks.readLegalEntities.mockResolvedValue([]);

    await renderPage();

    expect(
      screen.getByText('Add the first legal entity to this workspace.'),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Add legal entity' }),
    ).toBeVisible();

    cleanup();
    mocks.readOrganizationAccess.mockResolvedValue(accessFor('member'));
    await renderPage();

    expect(
      screen.getByText('No legal entities are available in this workspace.'),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Add legal entity' }),
    ).not.toBeInTheDocument();
  });

  it('returns not found when the resolver denies the slug', async () => {
    mocks.resolveOrganizationRouteForRequest.mockResolvedValue(null);

    await expect(
      OrganizationEntitiesPage({
        params: Promise.resolve({ orgSlug: 'unknown-organization' }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.readLegalEntities).not.toHaveBeenCalled();
  });
});
