import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const router = { replace: vi.fn() };
let browserQuery = '';
const access = vi.hoisted(() => vi.fn());
const organizations = vi.hoisted(() => vi.fn());
const entities = vi.hoisted(() => vi.fn());
const getJson = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  usePathname: () => '/hr-settings/structure',
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(browserQuery),
}));
vi.mock('../../../lib/organizations/use-organization-access', () => ({
  useOrganizationAccess: access,
}));
vi.mock('../../../lib/organizations/use-organization-selection', () => ({
  useOrganizationSelection: organizations,
}));
vi.mock('../../../lib/organizations/use-legal-entities', () => ({
  useLegalEntities: entities,
}));
vi.mock('../../../lib/datasets/client', () => ({
  getJson,
  organizationPath: (organizationId: string) =>
    `/api/bff/application/organizations/${organizationId}`,
}));

import { I18nProvider } from '../../../i18n/client-provider';
import { ToastProvider } from '../../../components/shell/toast';
import ReferencePage from './reference-page';

HTMLElement.prototype.scrollIntoView = vi.fn();

const entityId = '00000000-0000-4000-8000-000000000001';
const item = {
  active: true,
  code: 'OPS',
  createdAt: '2026-09-20T00:00:00.000Z',
  id: '00000000-0000-4000-8000-000000000002',
  legalEntityId: entityId,
  name: 'Placeholder department',
  parentId: null,
  updatedAt: '2026-09-20T00:00:00.000Z',
};

function renderPage(
  collection:
    'departments' | 'positions' | 'document-categories' = 'departments',
) {
  return render(
    <I18nProvider>
      <ToastProvider>
        <ReferencePage
          collection={collection}
          structure={collection !== 'document-categories'}
        />
      </ToastProvider>
    </I18nProvider>,
  );
}

function ready(manageHr = true) {
  organizations.mockReturnValue({
    organizationId: 'org_1',
    slug: 'placeholder',
    state: 'idle',
  });
  access.mockReturnValue({
    access: { capabilities: { manageHr, readHr: true } },
    state: 'idle',
  });
  entities.mockReturnValue([{ id: entityId, name: 'Placeholder entity' }]);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  browserQuery = '';
  router.replace.mockReset();
  getJson.mockReset();
});

describe('ReferencePage', () => {
  it('waits for organization and access resolution before requesting a collection', () => {
    organizations.mockReturnValue({
      organizationId: '',
      slug: '',
      state: 'loading',
    });
    access.mockReturnValue({ access: undefined, state: 'loading' });
    entities.mockReturnValue([]);
    renderPage();
    expect(getJson).not.toHaveBeenCalled();
    expect(screen.getByText('Loading HR settings.')).toBeVisible();
  });

  it('distinguishes access resolution failure and forbidden access without a reference call', () => {
    organizations.mockReturnValue({
      organizationId: 'org_1',
      slug: 'placeholder',
      state: 'idle',
    });
    access.mockReturnValue({ access: undefined, state: 'error' });
    entities.mockReturnValue([]);
    const view = renderPage();
    expect(
      screen.getByText('HR settings access could not be resolved.'),
    ).toBeVisible();
    expect(getJson).not.toHaveBeenCalled();
    view.unmount();
    access.mockReturnValue({
      access: { capabilities: { manageHr: false, readHr: false } },
      state: 'idle',
    });
    renderPage();
    expect(
      screen.getByText(
        'This account cannot read HR settings in this organization.',
      ),
    ).toBeVisible();
    expect(getJson).not.toHaveBeenCalled();
  });

  it('requests only the selected collection with sanitized browser filters', async () => {
    ready(false);
    browserQuery = `organization=forged&kind=workplaces&legalEntityId=bad&q=${'x'.repeat(120)}&active=forged&page=0&pageSize=999`;
    getJson.mockResolvedValue({
      departments: [],
      page: 1,
      pageSize: 25,
      total: 0,
    });
    renderPage();
    await waitFor(() => expect(getJson).toHaveBeenCalledOnce());
    expect(String(getJson.mock.calls[0]?.[0])).toBe(
      '/api/bff/application/organizations/org_1/hr/departments?page=1&pageSize=25&q=' +
        'x'.repeat(100),
    );
  });

  it('shows success and no mutation controls without manageHr', async () => {
    ready(false);
    getJson.mockResolvedValue({
      departments: [item],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    renderPage();
    expect(await screen.findByText('Placeholder department')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Create' }),
    ).not.toBeInTheDocument();
  });

  it('shows empty and load-error grid states', async () => {
    ready(false);
    getJson.mockResolvedValueOnce({
      departments: [],
      page: 1,
      pageSize: 25,
      total: 0,
    });
    const view = renderPage();
    expect(
      await screen.findByText('No reference data matches the current filters.'),
    ).toBeVisible();
    view.unmount();
    getJson.mockRejectedValueOnce(new Error('unavailable'));
    renderPage();
    expect(
      await screen.findByText('Reference data could not be loaded.'),
    ).toBeVisible();
  });

  it('resets pagination when changing an entity, status, or search filter', async () => {
    ready(false);
    browserQuery = `legalEntityId=${entityId}&page=3&pageSize=25`;
    getJson.mockResolvedValue({
      departments: [],
      page: 3,
      pageSize: 25,
      total: 0,
    });
    renderPage();
    await screen.findByText('No reference data matches the current filters.');
    fireEvent.change(screen.getByLabelText('Status'), {
      target: { value: 'false' },
    });
    expect(router.replace).toHaveBeenLastCalledWith(
      `/hr-settings/structure?legalEntityId=${entityId}&page=1&pageSize=25&active=false`,
    );
  });

  it('does not submit a document category without its required retention key', async () => {
    ready();
    browserQuery = `legalEntityId=${entityId}`;
    getJson.mockResolvedValue({
      documentCategories: [],
      page: 1,
      pageSize: 25,
      total: 0,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderPage('document-categories');
    await screen.findByRole('button', { name: 'Create' });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    fireEvent.change(screen.getByLabelText('Code'), {
      target: { value: 'DOC' },
    });
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Placeholder category' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates a position with the exact POST body, then reloads and closes the modal', async () => {
    ready();
    browserQuery = `legalEntityId=${entityId}`;
    const position = Object.fromEntries(
      Object.entries(item).filter(([key]) => key !== 'parentId'),
    );
    getJson.mockResolvedValue({
      positions: [],
      page: 1,
      pageSize: 25,
      total: 0,
    });
    const fetchMock = vi.fn(async () =>
      Response.json(position, { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderPage('positions');
    await screen.findByRole('button', { name: 'Create' });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    fireEvent.change(screen.getByLabelText('Code'), {
      target: { value: 'NEW' },
    });
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'New position' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/bff/application/organizations/org_1/hr/positions',
      expect.objectContaining({
        body: JSON.stringify({
          legalEntityId: entityId,
          code: 'NEW',
          name: 'New position',
        }),
        method: 'POST',
      }),
    );
    await waitFor(() =>
      expect(screen.queryByLabelText('Code')).not.toBeInTheDocument(),
    );
    expect(getJson.mock.calls.length).toBeGreaterThan(1);
  });

  it('patches only changed fields and does not submit an unchanged edit', async () => {
    ready();
    const position = Object.fromEntries(
      Object.entries(item).filter(([key]) => key !== 'parentId'),
    );
    getJson.mockResolvedValue({
      positions: [position],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    const fetchMock = vi.fn(async () => Response.json(position));
    vi.stubGlobal('fetch', fetchMock);
    renderPage('positions');
    fireEvent.click(await screen.findByText('Placeholder department'));
    await screen.findByText('Edit');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Updated position' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/bff/application/organizations/org_1/hr/positions/${item.id}`,
      expect.objectContaining({
        body: JSON.stringify({ name: 'Updated position' }),
        method: 'PATCH',
      }),
    );
  });

  it('retires active items with only active false and hides retire for retired items', async () => {
    ready();
    const position = Object.fromEntries(
      Object.entries(item).filter(([key]) => key !== 'parentId'),
    );
    getJson.mockResolvedValue({
      positions: [position],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    const fetchMock = vi.fn(async () => Response.json(position));
    vi.stubGlobal('fetch', fetchMock);
    renderPage('positions');
    fireEvent.click(await screen.findByText('Placeholder department'));
    await screen.findByRole('button', { name: 'Retire' });
    fireEvent.click(screen.getByRole('button', { name: 'Retire' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/bff/application/organizations/org_1/hr/positions/${item.id}`,
      expect.objectContaining({
        body: JSON.stringify({ active: false }),
        method: 'PATCH',
      }),
    );
    cleanup();
    getJson.mockResolvedValue({
      positions: [{ ...position, active: false }],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    renderPage('positions');
    fireEvent.click(await screen.findByText('Placeholder department'));
    await screen.findByText('Edit');
    expect(
      screen.queryByRole('button', { name: 'Retire' }),
    ).not.toBeInTheDocument();
  });

  it.each([
    [409, 'This code is already used in the selected legal entity.'],
    [500, 'The reference data could not be saved.'],
  ])(
    'keeps the modal open and shows the correct mutation failure for %i',
    async (status, message) => {
      ready();
      browserQuery = `legalEntityId=${entityId}`;
      getJson.mockResolvedValue({
        positions: [],
        page: 1,
        pageSize: 25,
        total: 0,
      });
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(null, { status })),
      );
      renderPage('positions');
      fireEvent.click(await screen.findByRole('button', { name: 'Create' }));
      fireEvent.change(screen.getByLabelText('Code'), {
        target: { value: 'OPS' },
      });
      fireEvent.change(screen.getByLabelText('Name'), {
        target: { value: 'Placeholder' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(await screen.findByText(message)).toBeVisible();
      expect(screen.getByRole('heading', { name: 'Create' })).toBeVisible();
    },
  );

  it('uses the selected entity and bounded remote parent search without collection keys', async () => {
    ready();
    browserQuery = `legalEntityId=${entityId}`;
    getJson.mockImplementation(async (path: string) =>
      path.includes('q=parent')
        ? { departments: [item], page: 1, pageSize: 100, total: 1 }
        : { departments: [], page: 1, pageSize: 25, total: 0 },
    );
    renderPage();
    await screen.findByRole('button', { name: 'Create' });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    const input = screen.getByRole('combobox', { name: 'Parent department' });
    fireEvent.change(input, { target: { value: 'parent' } });
    await waitFor(() =>
      expect(
        getJson.mock.calls.some(([path]) =>
          String(path).includes(
            `legalEntityId=${entityId}&active=true&page=1&pageSize=100&q=parent`,
          ),
        ),
      ).toBe(true),
    );
    const parentPath = getJson.mock.calls
      .map(([path]) => String(path))
      .find((path) => path.includes('q=parent'))!;
    expect(parentPath).not.toContain('kind=');
    expect(parentPath).not.toContain('organization=');
  });
});
