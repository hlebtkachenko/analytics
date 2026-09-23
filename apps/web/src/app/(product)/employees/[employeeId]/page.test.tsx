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
const documentId = '00000000-0000-4000-8000-000000000003';
const effectiveAtInput = '2026-02-01T10:00';
const effectiveAtInstant = new Date(effectiveAtInput).toISOString();
const accessMock = vi.hoisted(() =>
  vi.fn(() => ({
    access: { capabilities: { readHr: true, manageHr: true } },
  })),
);

vi.mock('next/navigation', () => ({
  useParams: () => ({ employeeId }),
  usePathname: () => `/employees/${employeeId}`,
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('../../../../lib/organizations/use-organization-selection', () => ({
  useOrganizationSelection: () => ({ organizationId: 'org_1', slug: 'test' }),
}));
vi.mock('../../../../lib/organizations/use-organization-access', () => ({
  useOrganizationAccess: accessMock,
}));
vi.mock('../../../../lib/datasets/client', () => ({
  getJson: vi.fn(),
  organizationPath: (organizationId: string) =>
    `/api/organizations/${organizationId}`,
}));

import { I18nProvider } from '../../../../i18n/client-provider';
import { ToastProvider } from '../../../../components/shell/toast';
import { getJson } from '../../../../lib/datasets/client';
import EmployeeDetailPage from './page';

const employee = {
  id: employeeId,
  legalEntityId: '00000000-0000-4000-8000-000000000010',
  employeeNumber: 'EMP-1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  workEmail: 'ada@example.com',
  workPhone: null,
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  relationships: [
    {
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
    },
  ],
  documents: [
    {
      documentId,
      title: 'Contract',
      documentDate: '2026-01-01',
      categoryId: '00000000-0000-4000-8000-000000000004',
      relationshipId,
      approvalStatus: 'approved',
      approvedBy: '00000000-0000-4000-8000-000000000005',
      approvedAt: '2026-01-02T00:00:00.000Z',
      supersedesDocumentId: '00000000-0000-4000-8000-000000000006',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
};

const emptyEmployee = { ...employee, relationships: [], documents: [] };
const baseEmployee = { ...employee };
delete (baseEmployee as { relationships?: unknown }).relationships;
delete (baseEmployee as { documents?: unknown }).documents;
const json = vi.mocked(getJson);

function renderPage() {
  return render(
    <I18nProvider>
      <ToastProvider>
        <EmployeeDetailPage />
      </ToastProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  accessMock.mockReturnValue({
    access: { capabilities: { readHr: true, manageHr: true } },
  });
  json.mockReset();
  json.mockImplementation((path) =>
    Promise.resolve(
      String(path).includes('/status-history')
        ? { items: [], page: 1, pageSize: 25, total: 0 }
        : employee,
    ),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) =>
      Promise.resolve(
        input.endsWith('/documents')
          ? Response.json({ linked: true })
          : input.includes('/relationships')
            ? Response.json(employee.relationships[0]!)
            : Response.json(baseEmployee),
      ),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('EmployeeDetailPage', () => {
  it.each([
    ['preboarding', ['Activate', 'Cancel']],
    ['active', ['Deactivate']],
    ['inactive', ['Reactivate', 'Archive']],
    ['archived', []],
    ['cancelled', []],
  ] as const)(
    'shows only the legal %s lifecycle actions',
    async (status, actions) => {
      json.mockImplementation((path) =>
        Promise.resolve(
          String(path).includes('/status-history')
            ? { items: [], page: 1, pageSize: 25, total: 0 }
            : { ...employee, status },
        ),
      );
      const view = renderPage();
      await screen.findByDisplayValue('Ada');
      for (const action of [
        'Activate',
        'Cancel',
        'Deactivate',
        'Reactivate',
        'Archive',
      ])
        expect(screen.queryByRole('button', { name: action }) !== null).toBe(
          actions.includes(action as never),
        );
      view.unmount();
    },
  );

  it('submits only the reactivation reason in the exact transition command', async () => {
    json.mockImplementation((path) =>
      Promise.resolve(
        String(path).includes('/status-history')
          ? { items: [], page: 1, pageSize: 25, total: 0 }
          : { ...employee, status: 'inactive' },
      ),
    );
    renderPage();
    await screen.findByRole('button', { name: 'Reactivate' });
    fireEvent.click(screen.getByRole('button', { name: 'Reactivate' }));
    fireEvent.change(screen.getByLabelText('Effective at'), {
      target: { value: effectiveAtInput },
    });
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: '  Return  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm transition' }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/status-transitions'),
        expect.objectContaining({
          body: JSON.stringify({
            toStatus: 'active',
            effectiveAt: effectiveAtInstant,
            reason: 'Return',
          }),
          method: 'POST',
        }),
      ),
    );
  });

  it.each([
    ['preboarding', 'Activate', 'active'],
    ['preboarding', 'Cancel', 'cancelled'],
    ['active', 'Deactivate', 'inactive'],
    ['inactive', 'Archive', 'archived'],
  ] as const)(
    'submits the exact %s %s transition without a reason',
    async (status, action, toStatus) => {
      json.mockImplementation((path) =>
        Promise.resolve(
          String(path).includes('/status-history')
            ? { items: [], page: 1, pageSize: 25, total: 0 }
            : { ...employee, status },
        ),
      );
      renderPage();
      await screen.findByRole('button', { name: action });
      fireEvent.click(screen.getByRole('button', { name: action }));
      fireEvent.change(screen.getByLabelText('Effective at'), {
        target: { value: effectiveAtInput },
      });
      expect(screen.queryByLabelText('Reason')).toBeNull();
      fireEvent.click(
        screen.getByRole('button', { name: 'Confirm transition' }),
      );
      await waitFor(() =>
        expect(fetch).toHaveBeenCalledWith(
          expect.stringContaining('/status-transitions'),
          expect.objectContaining({
            body: JSON.stringify({
              toStatus,
              effectiveAt: effectiveAtInstant,
            }),
            method: 'POST',
          }),
        ),
      );
    },
  );

  it('loads and renders employee details', async () => {
    renderPage();
    expect(await screen.findByDisplayValue('Ada')).toBeVisible();
    expect(json).toHaveBeenCalledWith(
      `/api/organizations/org_1/employees/${employeeId}/status-history?page=1&pageSize=25`,
      expect.any(AbortSignal),
    );
    expect(screen.getByRole('link', { name: 'Employment' })).toHaveAttribute(
      'href',
      `/employees/${employeeId}/employment?organization=test`,
    );
    expect(screen.getByRole('link', { name: 'Documents' })).toHaveAttribute(
      'href',
      `/employees/${employeeId}/documents?organization=test`,
    );
  });

  it('does not fetch the employee when HR read access is denied', async () => {
    accessMock.mockReturnValue({
      access: { capabilities: { readHr: false, manageHr: false } } as never,
    });
    renderPage();
    expect(
      await screen.findByText(
        'This account cannot read HR data in this organization.',
      ),
    ).toBeVisible();
    expect(json).not.toHaveBeenCalled();
  });

  it('shows loading and then an upstream failure', async () => {
    json.mockRejectedValue(new Error('upstream'));
    renderPage();
    expect(screen.getByText(/Loading .*\./)).toBeVisible();
    expect(
      await screen.findByText('Employees could not be loaded.'),
    ).toBeVisible();
  });

  it('shows the empty status history state', async () => {
    json.mockImplementation((path) =>
      Promise.resolve(
        String(path).includes('/status-history')
          ? { items: [], page: 1, pageSize: 25, total: 0 }
          : emptyEmployee,
      ),
    );
    renderPage();
    expect(
      await screen.findByText('No status transitions are recorded.'),
    ).toBeVisible();
  });

  it('does not render document controls in the overview', async () => {
    renderPage();
    await screen.findByDisplayValue('Ada');
    expect(screen.queryByRole('button', { name: 'Link document' })).toBeNull();
  });

  it('renders ready status history rows', async () => {
    json.mockImplementation((path) =>
      Promise.resolve(
        String(path).includes('/status-history')
          ? {
              items: [
                {
                  id: '00000000-0000-4000-8000-000000000005',
                  employeeId,
                  fromStatus: 'inactive',
                  toStatus: 'active',
                  effectiveAt: '2026-02-01T09:00:00.000Z',
                  reason: 'Return from leave',
                  createdAt: '2026-02-01T09:00:00.000Z',
                },
              ],
              page: 1,
              pageSize: 25,
              total: 1,
            }
          : employee,
      ),
    );
    renderPage();
    expect(await screen.findByText('Return from leave')).toBeVisible();
  });

  it('hides mutation controls without manage HR access', async () => {
    accessMock.mockReturnValue({
      access: { capabilities: { readHr: true, manageHr: false } } as never,
    });
    renderPage();
    await screen.findByDisplayValue('Ada');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Add relationship' }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Link document' })).toBeNull();
  });

  it('updates the employee and refreshes details', async () => {
    renderPage();
    await screen.findByDisplayValue('Ada');
    fireEvent.change(screen.getByLabelText('First name'), {
      target: { value: 'Grace' },
    });
    fireEvent.submit(screen.getByLabelText('First name').closest('form')!);
    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        expect.stringContaining('/employees/'),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            firstName: 'Grace',
            lastName: 'Lovelace',
            workEmail: 'ada@example.com',
            workPhone: null,
          }),
        }),
      ),
    );
    expect(json).toHaveBeenCalledTimes(4);
  });

  it('does not mutate for malformed employee input', async () => {
    renderPage();
    await screen.findByDisplayValue('Ada');
    const form = screen.getByLabelText('First name').closest('form')!;
    fireEvent.change(screen.getByLabelText('First name'), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByLabelText('Last name'), {
      target: { value: '' },
    });
    fireEvent.submit(form);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'Check the transition details and try again.'],
    [409, 'This status was changed by another user.'],
    [500, 'The status transition could not be saved.'],
  ])(
    'keeps the transition modal open and maps a %i failure',
    async (status, message) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string) =>
          input.includes('/status-transitions')
            ? new Response(null, { status })
            : Response.json(baseEmployee),
        ),
      );
      renderPage();
      await screen.findByRole('button', { name: 'Deactivate' });
      fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
      fireEvent.change(screen.getByLabelText('Effective at'), {
        target: { value: '2026-02-01T10:00' },
      });
      fireEvent.click(
        screen.getByRole('button', { name: 'Confirm transition' }),
      );
      expect(await screen.findByText(message)).toBeVisible();
      expect(screen.getByLabelText('Effective at')).toBeVisible();
    },
  );

  it('closes, reloads, and confirms a successful transition', async () => {
    const transitionItem = {
      id: '00000000-0000-4000-8000-000000000005',
      employeeId,
      fromStatus: 'active',
      toStatus: 'inactive',
      effectiveAt: '2026-02-01T09:00:00.000Z',
      reason: null,
      createdAt: '2026-02-01T09:00:00.000Z',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) =>
        input.includes('/status-transitions')
          ? Response.json(transitionItem)
          : Response.json(baseEmployee),
      ),
    );
    renderPage();
    await screen.findByRole('button', { name: 'Deactivate' });
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    fireEvent.change(screen.getByLabelText('Effective at'), {
      target: { value: '2026-02-01T10:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm transition' }));
    expect(
      await screen.findByText('Employee status was updated.'),
    ).toBeVisible();
    await waitFor(() => expect(json).toHaveBeenCalledTimes(4));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
