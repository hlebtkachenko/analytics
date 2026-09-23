import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const employeeId = '00000000-0000-4000-8000-000000000101';
const checklistId = '00000000-0000-4000-8000-000000000102';
const taskId = '00000000-0000-4000-8000-000000000103';
const templateId = '00000000-0000-4000-8000-000000000104';
const entityId = '00000000-0000-4000-8000-000000000105';
const accessMock = vi.hoisted(() => vi.fn());
const organizationMock = vi.hoisted(() => vi.fn());
const searchMock = vi.hoisted(() => vi.fn());
const routerReplace = vi.hoisted(() => vi.fn());
const notifyMock = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useParams: () => ({ employeeId }),
  usePathname: () => `/employees/${employeeId}/workflows`,
  useRouter: () => ({ replace: routerReplace }),
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
  organizationPath: (id: string) => `/api/bff/application/organizations/${id}`,
}));
vi.mock('../../../../../components/shell/toast', () => ({
  useToast: () => ({ notify: notifyMock }),
}));
vi.mock('../employee-tabs', () => ({ EmployeeTabs: () => <div>Tabs</div> }));
import { getJson } from '../../../../../lib/datasets/client';
import WorkflowsPage from './page';

const now = '2026-09-21T00:00:00.000Z';
const task = {
  checklistId,
  completedAt: null,
  completedBy: null,
  createdAt: now,
  documentCategoryId: null,
  documentId: null,
  dueOn: '2026-09-24',
  id: taskId,
  ownerUserId: 'owner_1',
  skipReason: null,
  status: 'pending',
  templateItemId: null,
  title: 'Collect contract',
  updatedAt: now,
};
const checklist = {
  completedAt: null,
  createdAt: now,
  employeeId,
  id: checklistId,
  kind: 'onboarding',
  legalEntityId: entityId,
  relationshipId: null,
  startedOn: '2026-09-21',
  status: 'open',
  tasks: [task],
  templateId,
  updatedAt: now,
};
const employee = {
  id: employeeId,
  legalEntityId: entityId,
  employeeNumber: 'EMP-1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  workEmail: null,
  workPhone: null,
  status: 'active',
  createdAt: now,
  updatedAt: now,
  relationships: [],
  documents: [],
};
const template = {
  active: true,
  code: 'ONBOARD',
  createdAt: now,
  id: templateId,
  items: [],
  kind: 'onboarding',
  legalEntityId: entityId,
  name: 'Onboarding',
  updatedAt: now,
};
function renderPage() {
  return render(<WorkflowsPage />);
}
beforeEach(() => {
  organizationMock.mockReturnValue({ organizationId: 'org_1', state: 'ready' });
  accessMock.mockReturnValue({
    access: { capabilities: { readHr: true, manageHr: true } },
    state: 'ready',
  });
  searchMock.mockReturnValue(
    new URLSearchParams(
      `kind=onboarding&status=open&ownerUserId=owner_1&dueBefore=2026-10-01&page=2&pageSize=25&checklistId=${checklistId}`,
    ),
  );
  vi.mocked(getJson).mockImplementation((path: string) =>
    Promise.resolve(
      path.includes('/checklists?')
        ? { items: [checklist], page: 2, pageSize: 25, total: 1 }
        : employee,
    ),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(Response.json(checklist))),
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('WorkflowsPage', () => {
  it('loads URL-filtered checklist paging and exposes only the pending next action', async () => {
    renderPage();
    expect(await screen.findByText('Collect contract')).toBeVisible();
    expect(getJson).toHaveBeenCalledWith(
      `/api/bff/application/organizations/org_1/employees/${employeeId}/checklists?page=2&pageSize=25&kind=onboarding&status=open&ownerUserId=owner_1&dueBefore=2026-10-01`,
      expect.any(AbortSignal),
    );
    fireEvent.change(screen.getByLabelText('checklists.kind'), {
      target: { value: 'change' },
    });
    expect(routerReplace).toHaveBeenCalledWith(
      expect.stringContaining('page=1'),
    );
  });
  it('is read-only without manageHr and makes no request without readHr', async () => {
    accessMock.mockReturnValue({
      access: { capabilities: { readHr: true, manageHr: false } },
      state: 'ready',
    });
    renderPage();
    await screen.findByText('Collect contract');
    expect(
      screen.queryByRole('button', { name: 'checklists.startChecklist' }),
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
  it('starts with the exact null relationship body, reloads after success, and resets on close and reopen', async () => {
    vi.mocked(getJson).mockImplementation((path: string) =>
      Promise.resolve(
        path.includes('checklist-templates')
          ? { items: [template], page: 1, pageSize: 100, total: 1 }
          : path.includes('/checklists?')
            ? { items: [checklist], page: 2, pageSize: 25, total: 1 }
            : employee,
      ),
    );
    renderPage();
    await screen.findByText('Collect contract');
    fireEvent.click(
      screen.getByRole('button', { name: 'checklists.startChecklist' }),
    );
    await screen.findByText('Onboarding');
    fireEvent.change(screen.getByLabelText('checklists.template'), {
      target: { value: templateId },
    });
    fireEvent.change(screen.getByLabelText('checklists.startDate'), {
      target: { value: '2026-09-21' },
    });
    fireEvent.change(document.querySelector('#owner-user')!, {
      target: { value: 'owner_1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'checklists.start' }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(
      JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)),
    ).toEqual({
      templateId,
      relationshipId: null,
      startedOn: '2026-09-21',
      ownerUserId: 'owner_1',
    });
    expect(notifyMock).toHaveBeenCalled();
    expect(vi.mocked(getJson).mock.calls.length).toBeGreaterThan(3);

    fireEvent.click(
      screen.getByRole('button', { name: 'checklists.startChecklist' }),
    );
    fireEvent.change(screen.getByLabelText('checklists.template'), {
      target: { value: templateId },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]!);
    fireEvent.click(
      screen.getByRole('button', { name: 'checklists.startChecklist' }),
    );
    expect(screen.getByLabelText('checklists.template')).toHaveValue('');
    expect(screen.getByLabelText('checklists.startDate')).toHaveValue('');
    expect(document.querySelector('#owner-user')).toHaveValue('');
  });

  it('exposes only legal actions and sends exact start, complete, and skip bodies', async () => {
    const taskWithDocument = {
      ...task,
      documentCategoryId: '00000000-0000-4000-8000-000000000106',
      status: 'in_progress' as const,
    };
    const checklistWithTask = { ...checklist, tasks: [taskWithDocument] };
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json(taskWithDocument))),
    );
    vi.mocked(getJson).mockImplementation((path: string) =>
      Promise.resolve(
        path.includes('/checklists?')
          ? { items: [checklistWithTask], page: 2, pageSize: 25, total: 1 }
          : employee,
      ),
    );
    renderPage();
    const row = (await screen.findByText('Collect contract')).closest('tr')!;
    fireEvent.click(row);
    expect(screen.getByLabelText('checklists.command')).toHaveValue(
      'completed',
    );
    expect(
      screen.queryByRole('option', { name: 'checklists.start' }),
    ).toBeNull();
    fireEvent.change(screen.getByLabelText('checklists.documentId'), {
      target: { value: '00000000-0000-4000-8000-000000000107' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'checklists.save' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(
      JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)),
    ).toEqual({
      status: 'completed',
      documentId: '00000000-0000-4000-8000-000000000107',
    });
    await waitFor(() => expect(notifyMock).toHaveBeenCalled());
    expect(vi.mocked(getJson).mock.calls.length).toBeGreaterThan(2);

    fireEvent.click(row);
    fireEvent.change(screen.getByLabelText('checklists.command'), {
      target: { value: 'skipped' },
    });
    expect(screen.queryByLabelText('checklists.documentId')).toBeNull();
    fireEvent.change(screen.getByLabelText('checklists.skipReason'), {
      target: { value: 'Not applicable' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'checklists.save' }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBe(2));
    expect(
      JSON.parse(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body)),
    ).toEqual({
      status: 'skipped',
      skipReason: 'Not applicable',
    });
    await waitFor(() => expect(notifyMock).toHaveBeenCalledTimes(2));
  });

  it('offers Start and Skip for pending work, then clears a closed task command modal on reopen', async () => {
    renderPage();
    const row = (await screen.findByText('Collect contract')).closest('tr')!;
    fireEvent.click(row);
    expect(screen.getByLabelText('checklists.command')).toHaveValue(
      'in_progress',
    );
    expect(
      screen.getByRole('option', { name: 'checklists.start' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('option', { name: 'checklists.complete' }),
    ).toBeNull();
    fireEvent.change(screen.getByLabelText('checklists.command'), {
      target: { value: 'skipped' },
    });
    fireEvent.change(screen.getByLabelText('checklists.skipReason'), {
      target: { value: 'Old reason' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[1]!);
    fireEvent.click(row);
    expect(screen.getByLabelText('checklists.command')).toHaveValue(
      'in_progress',
    );
    fireEvent.change(screen.getByLabelText('checklists.command'), {
      target: { value: 'skipped' },
    });
    expect(screen.getByLabelText('checklists.skipReason')).toHaveValue('');
  });

  it.each([
    [400, 'checklists.pageError'],
    [409, 'checklists.conflict'],
    [500, 'checklists.pageError'],
  ])(
    'keeps a failed task command open with its inline error for %i',
    async (status, message) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(new Response(null, { status }))),
      );
      renderPage();
      fireEvent.click(
        (await screen.findByText('Collect contract')).closest('tr')!,
      );
      fireEvent.click(screen.getByRole('button', { name: 'checklists.save' }));
      await waitFor(() =>
        expect(screen.getAllByText(message).length).toBeGreaterThan(0),
      );
      expect(screen.getByLabelText('checklists.command')).toHaveValue(
        'in_progress',
      );
    },
  );

  it('renders loading, empty, and request errors', async () => {
    accessMock.mockReturnValue({ access: undefined, state: 'loading' });
    renderPage();
    expect(screen.getByText('checklists.loading')).toBeVisible();
    cleanup();
    accessMock.mockReturnValue({
      access: { capabilities: { readHr: true, manageHr: true } },
      state: 'ready',
    });
    vi.mocked(getJson).mockImplementation((path: string) =>
      Promise.resolve(
        path.includes('/checklists?')
          ? { items: [], page: 1, pageSize: 25, total: 0 }
          : employee,
      ),
    );
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole('table', { name: 'Data grid' })).toBeVisible(),
    );
    cleanup();
    vi.mocked(getJson).mockRejectedValue(new Error('down'));
    renderPage();
    expect(await screen.findByText('checklists.error')).toBeVisible();
  });

  it('does not activate completed or skipped tasks', async () => {
    const terminalChecklist = {
      ...checklist,
      tasks: [
        { ...task, status: 'completed' as const },
        {
          ...task,
          id: '00000000-0000-4000-8000-000000000108',
          status: 'skipped' as const,
        },
      ],
    };
    vi.mocked(getJson).mockImplementation((path: string) =>
      Promise.resolve(
        path.includes('/checklists?')
          ? { items: [terminalChecklist], page: 2, pageSize: 25, total: 1 }
          : employee,
      ),
    );
    renderPage();
    const terminalRows = (await screen.findAllByText('Collect contract')).map(
      (element) => element.closest('tr')!,
    );
    expect(document.body).not.toHaveClass('cds--body--with-modal-open');
    fireEvent.click(terminalRows[0]!);
    fireEvent.click(terminalRows[1]!);
    expect(document.body).not.toHaveClass('cds--body--with-modal-open');
  });
});
