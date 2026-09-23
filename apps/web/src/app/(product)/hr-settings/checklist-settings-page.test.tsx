import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const templateId = '00000000-0000-4000-8000-000000000001';
const entityId = '00000000-0000-4000-8000-000000000002';
const itemId = '00000000-0000-4000-8000-000000000003';
const accessMock = vi.hoisted(() => vi.fn());
const organizationMock = vi.hoisted(() => vi.fn());
const entitiesMock = vi.hoisted(() => vi.fn());
const searchMock = vi.hoisted(() => vi.fn());
const routerReplace = vi.hoisted(() => vi.fn());
const notifyMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  usePathname: () => '/hr-settings/checklists',
  useRouter: () => ({ replace: routerReplace }),
  useSearchParams: searchMock,
}));
vi.mock('../../../lib/organizations/use-organization-selection', () => ({
  useOrganizationSelection: organizationMock,
}));
vi.mock('../../../lib/organizations/use-organization-access', () => ({
  useOrganizationAccess: accessMock,
}));
vi.mock('../../../lib/organizations/use-legal-entities', () => ({
  useLegalEntities: entitiesMock,
}));
vi.mock('../../../lib/datasets/client', () => ({
  getJson: vi.fn(),
  organizationPath: (id: string) => `/api/bff/application/organizations/${id}`,
}));
vi.mock('../../../components/shell/toast', () => ({
  useToast: () => ({ notify: notifyMock }),
}));

import { getJson } from '../../../lib/datasets/client';
import ChecklistSettingsPage from './checklist-settings-page';

const item = {
  active: true,
  createdAt: '2026-09-21T00:00:00.000Z',
  defaultDueOffsetDays: 3,
  documentCategoryId: null,
  id: itemId,
  position: 1,
  templateId,
  title: 'Collect contract',
  updatedAt: '2026-09-21T00:00:00.000Z',
};
const template = {
  active: true,
  code: 'ONBOARD',
  createdAt: item.createdAt,
  id: templateId,
  items: [item],
  kind: 'onboarding',
  legalEntityId: entityId,
  name: 'Onboarding',
  updatedAt: item.updatedAt,
};
const result = { items: [template], page: 2, pageSize: 50, total: 1 };

function renderPage() {
  return render(<ChecklistSettingsPage />);
}
beforeEach(() => {
  organizationMock.mockReturnValue({ organizationId: 'org_1', state: 'ready' });
  accessMock.mockReturnValue({
    access: { capabilities: { readHr: true, manageHr: true } },
    state: 'ready',
  });
  entitiesMock.mockReturnValue([{ id: entityId, name: 'Entity' }]);
  searchMock.mockReturnValue(
    new URLSearchParams(
      `legalEntityId=${entityId}&kind=onboarding&active=true&q=onboard&page=2&pageSize=50&selected=${templateId}`,
    ),
  );
  vi.mocked(getJson).mockResolvedValue(result);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(Response.json(template))),
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('ChecklistSettingsPage', () => {
  it('rebuilds URL-backed filters and paging, then renders the selected ordered items', async () => {
    renderPage();
    expect(await screen.findByText('Collect contract')).toBeVisible();
    expect(getJson).toHaveBeenCalledWith(
      `/api/bff/application/organizations/org_1/hr/checklist-templates?page=2&pageSize=50&legalEntityId=${entityId}&kind=onboarding&active=true&q=onboard`,
      expect.any(AbortSignal),
    );
    fireEvent.change(screen.getByLabelText('checklists.kind'), {
      target: { value: 'change' },
    });
    expect(routerReplace).toHaveBeenCalledWith(
      expect.stringContaining('kind=change'),
    );
    expect(routerReplace).toHaveBeenCalledWith(
      expect.stringContaining('page=1'),
    );
  });

  it('does not activate mutations for read-only access and does not fetch without HR read access', async () => {
    accessMock.mockReturnValue({
      access: { capabilities: { readHr: true, manageHr: false } },
      state: 'ready',
    });
    renderPage();
    await screen.findByText('Onboarding');
    expect(
      screen.queryByRole('button', { name: 'checklists.createTemplate' }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'checklists.createItem' }),
    ).toBeNull();
    cleanup();
    vi.mocked(getJson).mockClear();
    accessMock.mockReturnValue({
      access: { capabilities: { readHr: false, manageHr: false } },
      state: 'ready',
    });
    renderPage();
    expect(await screen.findByText('checklists.denied')).toBeVisible();
    expect(getJson).not.toHaveBeenCalled();
  });

  it('covers loading, empty, and request failure states', async () => {
    accessMock.mockReturnValue({ access: undefined, state: 'loading' });
    renderPage();
    expect(screen.getByText('checklists.loading')).toBeVisible();
    cleanup();
    accessMock.mockReturnValue({
      access: { capabilities: { readHr: true, manageHr: true } },
      state: 'ready',
    });
    vi.mocked(getJson).mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 25,
      total: 0,
    });
    searchMock.mockReturnValue(new URLSearchParams());
    renderPage();
    await waitFor(() => expect(getJson).toHaveBeenCalled());
    expect(screen.getByRole('table', { name: 'Data grid' })).toBeVisible();
    cleanup();
    vi.mocked(getJson).mockRejectedValue(new Error('down'));
    renderPage();
    expect(await screen.findByText('checklists.error')).toBeVisible();
  });

  it('sends the exact create body, reloads after success, and resets a closed template form on reopen', async () => {
    searchMock.mockReturnValue(
      new URLSearchParams(`legalEntityId=${entityId}`),
    );
    renderPage();
    await screen.findByText('Onboarding');
    fireEvent.click(
      screen.getByRole('button', { name: 'checklists.createTemplate' }),
    );
    fireEvent.change(screen.getByLabelText('checklists.code'), {
      target: { value: 'NEW' },
    });
    fireEvent.change(screen.getByLabelText('checklists.name'), {
      target: { value: 'New template' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'checklists.save' }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(
      JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)),
    ).toEqual({
      legalEntityId: entityId,
      kind: 'onboarding',
      code: 'NEW',
      name: 'New template',
    });
    expect(notifyMock).toHaveBeenCalled();
    expect(vi.mocked(getJson).mock.calls.length).toBeGreaterThan(1);

    fireEvent.click(
      screen.getByRole('button', { name: 'checklists.createTemplate' }),
    );
    fireEvent.change(screen.getByLabelText('checklists.code'), {
      target: { value: 'DISCARD' },
    });
    fireEvent.change(screen.getByLabelText('checklists.name'), {
      target: { value: 'Discard this draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'checklists.createTemplate' }),
    );
    expect(screen.getByLabelText('checklists.code')).toHaveValue('');
    expect(screen.getByLabelText('checklists.name')).toHaveValue('');
  });

  it('sends changed-only template updates and the exact retire body', async () => {
    renderPage();
    await screen.findByText('Collect contract');
    fireEvent.click(screen.getByRole('button', { name: 'checklists.edit' }));
    fireEvent.change(screen.getByLabelText('checklists.name'), {
      target: { value: 'Renamed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'checklists.save' }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(
      JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)),
    ).toEqual({ name: 'Renamed' });
    fireEvent.click(screen.getByRole('button', { name: 'checklists.edit' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'checklists.retireTemplate' }),
    );
    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(1),
    );
    expect(
      JSON.parse(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body)),
    ).toEqual({ active: false });
  });

  it('creates, changes, and retires items, including an explicit null category and bounded remote category search', async () => {
    const categoryId = '00000000-0000-4000-8000-000000000004';
    const categorizedItem = { ...item, documentCategoryId: categoryId };
    const categorizedTemplate = { ...template, items: [categorizedItem] };
    vi.mocked(getJson).mockImplementation((path: string) =>
      Promise.resolve(
        path.includes('document-categories')
          ? {
              documentCategories: [
                { id: categoryId, code: 'CONTRACT', name: 'Contract' },
              ],
              page: 1,
              pageSize: 100,
              total: 1,
            }
          : { ...result, items: [categorizedTemplate] },
      ),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json(categorizedTemplate))),
    );
    renderPage();
    await screen.findByText('Collect contract');
    fireEvent.click(
      screen.getByRole('button', { name: 'checklists.createItem' }),
    );
    await waitFor(() =>
      expect(getJson).toHaveBeenCalledWith(
        `/api/bff/application/organizations/org_1/hr/document-categories?legalEntityId=${entityId}&active=true&page=1&pageSize=100`,
        expect.any(AbortSignal),
      ),
    );
    fireEvent.change(screen.getByLabelText('checklists.title'), {
      target: { value: 'New item' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'checklists.save' }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(
      JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)),
    ).toEqual({
      position: 2,
      title: 'New item',
      defaultDueOffsetDays: 0,
      documentCategoryId: null,
    });

    await screen.findByText('Collect contract');
    fireEvent.click(screen.getByText('Collect contract').closest('tr')!);
    await screen.findByRole('button', { name: 'checklists.retireItem' });
    const categoryInput = screen.getByRole('combobox', {
      name: 'checklists.documentCategory',
    });
    fireEvent.change(categoryInput, { target: { value: 'contract' } });
    await waitFor(() =>
      expect(
        vi
          .mocked(getJson)
          .mock.calls.some(([path]) =>
            String(path).includes('page=1&pageSize=100&q=contract'),
          ),
      ).toBe(true),
    );
    fireEvent.click(await screen.findByText('checklists.noCategory'));
    fireEvent.click(screen.getByRole('button', { name: 'checklists.save' }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBe(2));
    expect(
      JSON.parse(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body)),
    ).toEqual({
      documentCategoryId: null,
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'checklists.retireItem' }),
    );
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBe(3));
    expect(
      JSON.parse(String(vi.mocked(fetch).mock.calls[2]?.[1]?.body)),
    ).toEqual({
      active: false,
    });
  });

  it.each([
    [400, 'checklists.pageError'],
    [409, 'checklists.conflict'],
    [500, 'checklists.pageError'],
  ])(
    'keeps a template modal open with its inline error for %i',
    async (status, message) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(new Response(null, { status }))),
      );
      renderPage();
      await screen.findByText('Onboarding');
      fireEvent.click(screen.getByRole('button', { name: 'checklists.edit' }));
      fireEvent.change(screen.getByLabelText('checklists.name'), {
        target: { value: 'Renamed' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'checklists.save' }));
      expect(await screen.findByText(message)).toBeVisible();
      expect(screen.getByLabelText('checklists.name')).toHaveValue('Renamed');
    },
  );
});
