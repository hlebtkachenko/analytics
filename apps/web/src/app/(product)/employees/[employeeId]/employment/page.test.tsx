import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const employeeId = '00000000-0000-4000-8000-000000000001';
const relationshipId = '00000000-0000-4000-8000-000000000002';
const termId = '00000000-0000-4000-8000-000000000003';
const accessMock = vi.hoisted(() => vi.fn());
const organizationMock = vi.hoisted(() => vi.fn());
const searchMock = vi.hoisted(() =>
  vi.fn(() => new URLSearchParams('relationshipId=nope&page=0&pageSize=999')),
);

vi.mock('next/navigation', () => ({
  useParams: () => ({ employeeId }),
  usePathname: () => `/employees/${employeeId}/employment`,
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: searchMock,
}));
vi.mock('../../../../../lib/organizations/use-organization-selection', () => ({
  useOrganizationSelection: organizationMock,
}));
vi.mock('../../../../../lib/organizations/use-organization-access', () => ({
  useOrganizationAccess: accessMock,
}));
vi.mock('../../../../../lib/datasets/client', () => ({
  getJson: vi.fn(),
  organizationPath: (id: string) => `/api/organizations/${id}`,
}));
vi.mock('../../../../../components/shell/toast', () => ({
  useToast: () => ({ notify: vi.fn() }),
}));

import { I18nProvider } from '../../../../../i18n/client-provider';
import { getJson } from '../../../../../lib/datasets/client';
import EmploymentPage from './page';

const employee = {
  id: employeeId,
  legalEntityId: '00000000-0000-4000-8000-000000000010',
  employeeNumber: 'E1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  workEmail: null,
  workPhone: null,
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  relationships: [],
  documents: [],
};
const relationship = {
  id: relationshipId,
  employeeId,
  kind: 'employment',
  position: 'Engineer',
  department: null,
  costCentre: null,
  weeklyHours: '40',
  startDate: '2026-01-01',
  endDate: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const term = {
  id: termId,
  employeeId,
  relationshipId,
  version: 1,
  supersedesEmploymentTermId: null,
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  positionId: '00000000-0000-4000-8000-000000000011',
  departmentId: '00000000-0000-4000-8000-000000000012',
  costCentreId: '00000000-0000-4000-8000-000000000013',
  workplaceId: '00000000-0000-4000-8000-000000000014',
  managerEmployeeId: '00000000-0000-4000-8000-000000000015',
  weeklyHours: '40',
  workingTimePattern: 'standard',
  createdAt: '2026-01-01T00:00:00.000Z',
};
const list = (items: unknown[], total = items.length) => ({
  items,
  page: 1,
  pageSize: 25,
  total,
});
const ref = (key: string, id: string) => ({
  [key]: [
    {
      id,
      legalEntityId: employee.legalEntityId,
      code: key,
      name: key,
      active: true,
      ...(key === 'departments' ? { parentId: null } : {}),
      ...(key === 'workplaces' ? { addressLabel: null } : {}),
      createdAt: employee.createdAt,
      updatedAt: employee.updatedAt,
    },
  ],
  page: 1,
  pageSize: 100,
  total: 1,
});
function renderPage() {
  return render(
    <I18nProvider>
      <EmploymentPage />
    </I18nProvider>,
  );
}

beforeEach(() => {
  organizationMock.mockReturnValue({
    organizationId: 'org_1',
    slug: 'test',
    state: 'idle',
  });
  accessMock.mockReturnValue({
    access: { capabilities: { readHr: true, manageHr: true } },
    state: 'ready',
  });
  searchMock.mockReturnValue(
    new URLSearchParams('relationshipId=nope&page=0&pageSize=999'),
  );
  vi.mocked(getJson).mockReset();
  vi.mocked(getJson).mockImplementation((path: string) => {
    if (path.includes('/employment-terms?'))
      return Promise.resolve(list([], 0));
    if (path.endsWith('/relationships'))
      return Promise.resolve({ relationships: [relationship] });
    if (path.endsWith(`/employees/${employeeId}`))
      return Promise.resolve(employee);
    if (path.includes('/departments'))
      return Promise.resolve(ref('departments', term.departmentId));
    if (path.includes('/positions'))
      return Promise.resolve(ref('positions', term.positionId));
    if (path.includes('/cost-centres'))
      return Promise.resolve(ref('costCentres', term.costCentreId));
    if (path.includes('/workplaces'))
      return Promise.resolve(ref('workplaces', term.workplaceId));
    const manager = {
      id: employee.id,
      legalEntityId: employee.legalEntityId,
      employeeNumber: employee.employeeNumber,
      firstName: employee.firstName,
      lastName: employee.lastName,
      workEmail: employee.workEmail,
      workPhone: employee.workPhone,
      status: employee.status,
      createdAt: employee.createdAt,
      updatedAt: employee.updatedAt,
    };
    return Promise.resolve({
      employees: [{ ...manager, id: term.managerEmployeeId }],
      page: 1,
      pageSize: 100,
      total: 1,
    });
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(Response.json(term, { status: 201 }))),
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('EmploymentPage', () => {
  it('does not request before access, when denied, or after an access error', async () => {
    accessMock.mockReturnValue({ access: undefined, state: 'loading' });
    renderPage();
    expect(getJson).not.toHaveBeenCalled();
    cleanup();
    accessMock.mockReturnValue({
      access: { capabilities: { readHr: false, manageHr: false } },
      state: 'ready',
    });
    renderPage();
    expect(await screen.findByText(/cannot read HR/)).toBeVisible();
    expect(getJson).not.toHaveBeenCalled();
    cleanup();
    accessMock.mockReturnValue({ access: undefined, state: 'error' });
    renderPage();
    expect(
      await screen.findByText('Employment terms could not be loaded.'),
    ).toBeVisible();
    expect(getJson).not.toHaveBeenCalled();
  });

  it('does not request while organization selection loads or fails', async () => {
    organizationMock.mockReturnValue({
      organizationId: '',
      slug: '',
      state: 'loading',
    });
    renderPage();
    expect(await screen.findByText('Loading employee.')).toBeVisible();
    expect(getJson).not.toHaveBeenCalled();
    cleanup();
    organizationMock.mockReturnValue({
      organizationId: '',
      slug: '',
      state: 'error',
    });
    renderPage();
    expect(
      await screen.findByText('Employment terms could not be loaded.'),
    ).toBeVisible();
    expect(getJson).not.toHaveBeenCalled();
  });

  it('sanitizes browser terms query and loads bounded entity references and manager employees', async () => {
    renderPage();
    await screen.findByText('No employment terms are recorded.');
    const paths = vi.mocked(getJson).mock.calls.map(([path]) => String(path));
    expect(paths).toContain(
      `/api/organizations/org_1/employees/${employeeId}/employment-terms?page=1&pageSize=25`,
    );
    for (const collection of [
      'departments',
      'positions',
      'cost-centres',
      'workplaces',
    ])
      expect(paths).toContain(
        `/api/organizations/org_1/hr/${collection}?legalEntityId=${employee.legalEntityId}&active=true&page=1&pageSize=100`,
      );
    expect(paths).toContain(
      `/api/organizations/org_1/employees?legalEntityId=${employee.legalEntityId}&status=active&page=1&pageSize=100`,
    );
    expect(paths).toContain(
      `/api/organizations/org_1/employees/${employeeId}/employment-terms?relationshipId=${relationshipId}&page=1&pageSize=1`,
    );
  });

  it('shows the page error when a reference request fails', async () => {
    vi.mocked(getJson).mockImplementation((path: string) => {
      if (path.includes('/departments'))
        return Promise.reject(new Error('reference unavailable'));
      if (path.includes('/employment-terms?'))
        return Promise.resolve(list([], 0));
      if (path.endsWith('/relationships'))
        return Promise.resolve({ relationships: [relationship] });
      if (path.endsWith(`/employees/${employeeId}`))
        return Promise.resolve(employee);
      return Promise.resolve({
        employees: [],
        page: 1,
        pageSize: 100,
        total: 0,
      });
    });
    renderPage();
    expect(
      await screen.findByText('Employment terms could not be loaded.'),
    ).toBeVisible();
  });

  it('posts a complete first-term snapshot', async () => {
    renderPage();
    const button = await screen.findByRole('button', {
      name: 'Add first term',
    });
    fireEvent.click(button);
    fireEvent.change(screen.getByLabelText('Effective from'), {
      target: { value: '2026-01-01' },
    });
    fireEvent.change(document.getElementById('weeklyHours')!, {
      target: { value: '40' },
    });
    fireEvent.change(screen.getByLabelText('Working-time pattern'), {
      target: { value: 'standard' },
    });
    fireEvent.submit(document.getElementById('employment-term-form')!);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(
      JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body)),
    ).toEqual(
      expect.objectContaining({
        relationshipId,
        supersedesEmploymentTermId: null,
        positionId: null,
        departmentId: null,
        costCentreId: null,
        workplaceId: null,
        managerEmployeeId: null,
      }),
    );
  });

  it('activates a leaf row with its complete predecessor snapshot', async () => {
    vi.mocked(getJson).mockImplementation((path: string) => {
      if (path.includes('/employment-terms?relationshipId='))
        return Promise.resolve(list([term]));
      if (path.includes('/employment-terms?'))
        return Promise.resolve(list([term]));
      if (path.endsWith('/relationships'))
        return Promise.resolve({ relationships: [relationship] });
      if (path.endsWith(`/employees/${employeeId}`))
        return Promise.resolve(employee);
      if (path.includes('/departments'))
        return Promise.resolve(ref('departments', term.departmentId));
      if (path.includes('/positions'))
        return Promise.resolve(ref('positions', term.positionId));
      if (path.includes('/cost-centres'))
        return Promise.resolve(ref('costCentres', term.costCentreId));
      if (path.includes('/workplaces'))
        return Promise.resolve(ref('workplaces', term.workplaceId));
      return Promise.resolve({
        employees: [
          {
            id: term.managerEmployeeId,
            legalEntityId: employee.legalEntityId,
            employeeNumber: employee.employeeNumber,
            firstName: employee.firstName,
            lastName: employee.lastName,
            workEmail: employee.workEmail,
            workPhone: employee.workPhone,
            status: employee.status,
            createdAt: employee.createdAt,
            updatedAt: employee.updatedAt,
          },
        ],
        page: 1,
        pageSize: 100,
        total: 1,
      });
    });
    renderPage();
    await screen.findByText('standard');
    fireEvent.click(screen.getByText('standard'));
    expect(await screen.findByText('Correct term')).toBeVisible();
    fireEvent.submit(document.getElementById('employment-term-form')!);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(
      JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body)),
    ).toEqual({
      relationshipId,
      supersedesEmploymentTermId: termId,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      positionId: term.positionId,
      departmentId: term.departmentId,
      costCentreId: term.costCentreId,
      workplaceId: term.workplaceId,
      managerEmployeeId: term.managerEmployeeId,
      weeklyHours: '40',
      workingTimePattern: 'standard',
    });
  });

  it('renders correction history after the corrected term exists', async () => {
    const correctedTerm = {
      ...term,
      id: '00000000-0000-4000-8000-000000000017',
      version: 2,
      supersedesEmploymentTermId: term.id,
      effectiveFrom: '2026-02-01',
      weeklyHours: '37.5',
    };
    vi.mocked(getJson).mockImplementation((path: string) => {
      if (path.includes('/employment-terms?'))
        return Promise.resolve(list([correctedTerm, term], 2));
      if (path.endsWith('/relationships'))
        return Promise.resolve({ relationships: [relationship] });
      if (path.endsWith(`/employees/${employeeId}`))
        return Promise.resolve(employee);
      if (path.includes('/departments'))
        return Promise.resolve(ref('departments', term.departmentId));
      if (path.includes('/positions'))
        return Promise.resolve(ref('positions', term.positionId));
      if (path.includes('/cost-centres'))
        return Promise.resolve(ref('costCentres', term.costCentreId));
      if (path.includes('/workplaces'))
        return Promise.resolve(ref('workplaces', term.workplaceId));
      return Promise.resolve({
        employees: [],
        page: 1,
        pageSize: 100,
        total: 0,
      });
    });
    renderPage();
    expect(
      await screen.findByRole('heading', { name: 'Employment' }),
    ).toBeVisible();
    expect(await screen.findByText('37.5')).toBeVisible();
    expect(screen.queryByText('Loading employee.')).toBeNull();
  });

  it('does not activate a predecessor row that has a successor', async () => {
    const successor = {
      ...term,
      id: '00000000-0000-4000-8000-000000000016',
      version: 2,
      supersedesEmploymentTermId: termId,
      effectiveFrom: '2026-02-01',
    };
    vi.mocked(getJson).mockImplementation((path: string) => {
      if (path.includes('/employment-terms?relationshipId='))
        return Promise.resolve(list([term, successor], 2));
      if (path.includes('/employment-terms?'))
        return Promise.resolve(list([term, successor], 2));
      if (path.endsWith('/relationships'))
        return Promise.resolve({ relationships: [relationship] });
      if (path.endsWith(`/employees/${employeeId}`))
        return Promise.resolve(employee);
      if (path.includes('/departments'))
        return Promise.resolve(ref('departments', term.departmentId));
      if (path.includes('/positions'))
        return Promise.resolve(ref('positions', term.positionId));
      if (path.includes('/cost-centres'))
        return Promise.resolve(ref('costCentres', term.costCentreId));
      if (path.includes('/workplaces'))
        return Promise.resolve(ref('workplaces', term.workplaceId));
      return Promise.resolve({
        employees: [],
        page: 1,
        pageSize: 100,
        total: 0,
      });
    });
    renderPage();
    await screen.findByText('2026-02-01 -');
    fireEvent.click(screen.getByText('2026-01-01 -'));
    expect(screen.queryByText('Correct term')).toBeNull();
  });

  it('keeps conflict and generic employment-term failures open with distinct messages', async () => {
    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Add first term' }),
    );
    fireEvent.change(screen.getByLabelText('Effective from'), {
      target: { value: '2026-01-01' },
    });
    fireEvent.change(document.getElementById('weeklyHours')!, {
      target: { value: '40' },
    });
    fireEvent.change(screen.getByLabelText('Working-time pattern'), {
      target: { value: 'standard' },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({}, { status: 409 }))),
    );
    fireEvent.submit(document.getElementById('employment-term-form')!);
    expect(
      await screen.findByText('This term was changed by another user.'),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Add first term' }),
    ).toBeVisible();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({}, { status: 500 }))),
    );
    fireEvent.submit(document.getElementById('employment-term-form')!);
    expect(
      await screen.findByText('The employee change could not be saved.'),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Add first term' }),
    ).toBeVisible();
  });

  it('hides relationship and term mutations for read-only access', async () => {
    accessMock.mockReturnValue({
      access: { capabilities: { readHr: true, manageHr: false } },
      state: 'ready',
    });
    renderPage();
    await screen.findByText('No employment terms are recorded.');
    expect(
      screen.queryByRole('button', { name: 'Add relationship' }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add first term' })).toBeNull();
    expect(screen.queryByText('Correct term')).toBeNull();
  });

  it('uses the same trimmed bounded query for references and active managers', async () => {
    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Add first term' }),
    );
    fireEvent.input(document.getElementById('term-positions')!, {
      target: { value: `  ${'x'.repeat(101)}  ` },
    });
    await waitFor(() => {
      const paths = vi.mocked(getJson).mock.calls.map(([path]) => String(path));
      const query = `q=${'x'.repeat(100)}`;
      for (const collection of [
        'departments',
        'positions',
        'cost-centres',
        'workplaces',
      ])
        expect(paths).toContain(
          `/api/organizations/org_1/hr/${collection}?legalEntityId=${employee.legalEntityId}&active=true&page=1&pageSize=100&${query}`,
        );
      expect(paths).toContain(
        `/api/organizations/org_1/employees?legalEntityId=${employee.legalEntityId}&status=active&page=1&pageSize=100&${query}`,
      );
    });
  });

  it('posts the existing relationship-create contract', async () => {
    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Add relationship' }),
    );
    fireEvent.change(document.getElementById('relationship-position')!, {
      target: { value: 'Engineer' },
    });
    fireEvent.change(document.getElementById('relationship-hours')!, {
      target: { value: '40' },
    });
    fireEvent.change(document.getElementById('relationship-start')!, {
      target: { value: '2026-01-01' },
    });
    fireEvent.submit(document.getElementById('relationship-form')!);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe(
      `/api/organizations/org_1/employees/${employeeId}/relationships`,
    );
    expect(
      JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body)),
    ).toEqual({
      kind: 'employment',
      position: 'Engineer',
      department: null,
      costCentre: null,
      weeklyHours: '40',
      startDate: '2026-01-01',
      endDate: null,
    });
  });
});
