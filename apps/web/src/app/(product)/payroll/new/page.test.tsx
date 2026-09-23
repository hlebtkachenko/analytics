import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ push: vi.fn() }));
const organizationMock = vi.hoisted(() => vi.fn());
const accessMock = vi.hoisted(() => vi.fn());
const entitiesMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('../../../../lib/organizations/use-organization-selection', () => ({
  useOrganizationSelection: organizationMock,
}));
vi.mock('../../../../lib/organizations/use-organization-access', () => ({
  useOrganizationAccess: accessMock,
}));
vi.mock('../../../../lib/organizations/use-legal-entities', () => ({
  useLegalEntities: entitiesMock,
}));

import { I18nProvider } from '../../../../i18n/client-provider';
import NewPayrollPage from './page';

const entityId = '00000000-0000-4000-8000-000000000001';
const employeeOne = {
  id: '00000000-0000-4000-8000-000000000011',
  legalEntityId: entityId,
  employeeNumber: 'E001',
  firstName: 'Ada',
  lastName: 'Lovelace',
  workEmail: null,
  workPhone: null,
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const employeeTwo = {
  id: '00000000-0000-4000-8000-000000000012',
  legalEntityId: entityId,
  employeeNumber: 'E002',
  firstName: 'Grace',
  lastName: 'Hopper',
  workEmail: null,
  workPhone: null,
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const fullAccess = { capabilities: { managePayroll: true, readPayroll: true } };

function renderPage() {
  return render(
    <I18nProvider>
      <NewPayrollPage />
    </I18nProvider>,
  );
}

function hasPostCall() {
  return fetchMock.mock.calls.some((call) => {
    const options = call[1] as { method?: string } | undefined;
    return options?.method === 'POST';
  });
}

function fillRow(index: number, employeeId: string, netPay = '90') {
  const employeeSelect = document.getElementById(
    index === 0 ? 'employeeId' : `employee-${index}`,
  )!;
  fireEvent.input(employeeSelect, { target: { value: employeeId } });
  fireEvent.change(employeeSelect, { target: { value: employeeId } });
  const suffix = index === 0 ? '' : `-${index}`;
  for (const [key, value] of Object.entries({
    grossPay: '100',
    employeeSocial: '5',
    employeeHealth: '5',
    incomeTax: '0',
    otherDeductions: '0',
    netPay,
    employerSocial: '24',
    employerHealth: '9',
    totalEmployerCost: '133',
  }))
    fireEvent.change(document.getElementById(`${key}${suffix}`)!, {
      target: { value },
    });
}

describe('NewPayrollPage', () => {
  beforeEach(() => {
    router.push.mockReset();
    organizationMock.mockReturnValue({
      organizationId: 'org_1',
      slug: 'test',
      state: 'ready',
    });
    accessMock.mockReturnValue({ access: fullAccess });
    entitiesMock.mockReturnValue([{ id: entityId, name: 'Entity' }]);
    fetchMock.mockReset();
    fetchMock.mockImplementation(
      async (path: string, options?: { method?: string }) => {
        if (options?.method === 'POST' && path.endsWith('/payroll-runs'))
          return {
            ok: true,
            json: async () => ({
              id: '00000000-0000-4000-8000-000000000099',
              legalEntityId: entityId,
              month: '2026-09',
              version: 1,
              supersedesPayrollRunId: null,
              documentId: '00000000-0000-4000-8000-000000000098',
              status: 'draft',
              origin: 'calculated',
              validationSummary: { valid: false, issues: [] },
              approvedBy: null,
              approvedAt: null,
              finalizedBy: null,
              finalizedAt: null,
              paidBy: null,
              paidAt: null,
              paymentReference: null,
              ruleSetId: null,
              createdAt: '2026-09-01T00:00:00.000Z',
              results: [],
            }),
          };
        if (options?.method === undefined && path.includes('/employees?'))
          return {
            ok: true,
            json: async () => ({
              employees: [employeeOne, employeeTwo],
              page: 1,
              pageSize: 100,
              total: 2,
            }),
          };
        throw new Error(`Unexpected fetch: ${path}`);
      },
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('keeps the form hidden while access is loading', () => {
    accessMock.mockReturnValue({ access: undefined });
    renderPage();
    expect(screen.getByText('Loading payroll run.')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Create payroll run' }),
    ).toBeNull();
  });
  it('handles organization and access errors before rendering the form', () => {
    organizationMock.mockReturnValue({
      organizationId: 'org_1',
      slug: 'test',
      state: 'error',
    });
    renderPage();
    expect(
      screen.getByText('Organization access could not be checked.'),
    ).toBeVisible();
    cleanup();
    organizationMock.mockReturnValue({
      organizationId: 'org_1',
      slug: 'test',
      state: 'ready',
    });
    accessMock.mockReturnValue({ access: undefined, state: 'error' });
    renderPage();
    expect(
      screen.getByText('Organization access could not be checked.'),
    ).toBeVisible();
  });

  it('denies access without loading employees or posting', () => {
    accessMock.mockReturnValue({
      access: { capabilities: { managePayroll: false, readPayroll: false } },
    });
    renderPage();
    expect(
      screen.getByText(
        'This account cannot read payroll data in this organization.',
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Create payroll run' }),
    ).toBeNull();
    expect(hasPostCall()).toBe(false);
  });

  it('creates a payroll run with two distinct employee results', async () => {
    renderPage();
    fireEvent.input(document.getElementById('legalEntityId')!, {
      target: { value: entityId },
    });
    fireEvent.change(document.getElementById('legalEntityId')!, {
      target: { value: entityId },
    });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/employees?'),
        expect.anything(),
      ),
    );
    fireEvent.change(screen.getByLabelText('Month'), {
      target: { value: '2026-09' },
    });
    fillRow(0, employeeOne.id);
    fireEvent.click(screen.getByRole('button', { name: 'Add employee row' }));
    fillRow(1, employeeTwo.id);
    fireEvent.click(screen.getByRole('button', { name: 'Create payroll run' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/bff/application/organizations/org_1/payroll-runs',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    const postCall = fetchMock.mock.calls.find((call) => {
      const options = call[1] as { method?: string } | undefined;
      return options?.method === 'POST';
    });
    const body = JSON.parse(postCall![1].body as string);
    expect(body).toEqual({
      legalEntityId: entityId,
      month: '2026-09',
      results: expect.arrayContaining([
        expect.objectContaining({
          employeeId: employeeOne.id,
          grossPay: '100',
          netPay: '90',
        }),
        expect.objectContaining({
          employeeId: employeeTwo.id,
          grossPay: '100',
          netPay: '90',
        }),
      ]),
    });
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(
        '/payroll/00000000-0000-4000-8000-000000000099?organization=test',
      ),
    );
  });

  it('rejects duplicate employees without posting', async () => {
    renderPage();
    fireEvent.input(document.getElementById('legalEntityId')!, {
      target: { value: entityId },
    });
    fireEvent.change(document.getElementById('legalEntityId')!, {
      target: { value: entityId },
    });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/employees?'),
        expect.anything(),
      ),
    );
    fireEvent.change(screen.getByLabelText('Month'), {
      target: { value: '2026-09' },
    });
    fillRow(0, employeeOne.id);
    fireEvent.click(screen.getByRole('button', { name: 'Add employee row' }));
    fillRow(1, employeeOne.id);
    fireEvent.click(screen.getByRole('button', { name: 'Create payroll run' }));
    await waitFor(() =>
      expect(
        screen.getByText(
          'Each row must have valid payroll arithmetic and unique employees.',
        ),
      ).toBeVisible(),
    );
    expect(hasPostCall()).toBe(false);
  });

  it('rejects invalid arithmetic without posting', async () => {
    renderPage();
    fireEvent.input(document.getElementById('legalEntityId')!, {
      target: { value: entityId },
    });
    fireEvent.change(document.getElementById('legalEntityId')!, {
      target: { value: entityId },
    });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/employees?'),
        expect.anything(),
      ),
    );
    fireEvent.change(screen.getByLabelText('Month'), {
      target: { value: '2026-09' },
    });
    fillRow(0, employeeOne.id, '89');
    fireEvent.click(screen.getByRole('button', { name: 'Create payroll run' }));
    await waitFor(() =>
      expect(
        screen.getByText(
          'Each row must have valid payroll arithmetic and unique employees.',
        ),
      ).toBeVisible(),
    );
    expect(hasPostCall()).toBe(false);
  });

  it('shows an explicit empty employee state', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path.includes('/employees?'))
        return {
          ok: true,
          json: async () => ({
            employees: [],
            page: 1,
            pageSize: 100,
            total: 0,
          }),
        };
      throw new Error(`Unexpected fetch: ${path}`);
    });
    renderPage();
    fireEvent.change(document.getElementById('legalEntityId')!, {
      target: { value: entityId },
    });
    expect(
      await screen.findByText(
        'No employees are available for this legal entity.',
      ),
    ).toBeVisible();
  });

  it('shows employee loading and error states', async () => {
    let rejectEmployees!: (error: Error) => void;
    fetchMock.mockImplementation(async (path: string) => {
      if (path.includes('/employees?'))
        return new Promise((_, reject) => {
          rejectEmployees = reject;
        });
      throw new Error(`Unexpected fetch: ${path}`);
    });
    renderPage();
    fireEvent.change(document.getElementById('legalEntityId')!, {
      target: { value: entityId },
    });
    expect(
      screen.getByText('Loading employees for this legal entity.'),
    ).toBeVisible();
    rejectEmployees(new Error('employees'));
    expect(
      await screen.findByText(
        'Employees could not be loaded for this legal entity.',
      ),
    ).toBeVisible();
  });

  it('accepts exact arithmetic beyond Number safe integers', async () => {
    renderPage();
    fireEvent.change(document.getElementById('legalEntityId')!, {
      target: { value: entityId },
    });
    await screen.findByRole('option', { name: /E001/ });
    fireEvent.change(screen.getByLabelText('Month'), {
      target: { value: '2026-09' },
    });
    fillRow(0, employeeOne.id, '9999999999990');
    for (const [id, value] of [
      ['grossPay', '10000000000000'],
      ['employeeSocial', '5'],
      ['employeeHealth', '5'],
      ['incomeTax', '0'],
      ['otherDeductions', '0'],
      ['netPay', '9999999999990'],
      ['employerSocial', '24'],
      ['employerHealth', '9'],
      ['totalEmployerCost', '10000000000033'],
    ] as const)
      fireEvent.change(document.getElementById(id)!, { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Create payroll run' }));
    await waitFor(() => expect(hasPostCall()).toBe(true));
  });

  it('reuses the create key after failure and rotates it on reset', async () => {
    let postAttempts = 0;
    fetchMock.mockImplementation(
      async (path: string, options?: { method?: string }) => {
        if (options?.method === undefined && path.includes('/employees?'))
          return {
            ok: true,
            json: async () => ({
              employees: [employeeOne],
              page: 1,
              pageSize: 100,
              total: 1,
            }),
          };
        if (options?.method === 'POST') {
          postAttempts += 1;
          return { ok: false, status: 500 };
        }
        throw new Error(`Unexpected fetch: ${path}`);
      },
    );
    renderPage();
    fireEvent.change(document.getElementById('legalEntityId')!, {
      target: { value: entityId },
    });
    await screen.findByRole('option', { name: /E001/ });
    fireEvent.change(screen.getByLabelText('Month'), {
      target: { value: '2026-09' },
    });
    fillRow(0, employeeOne.id);
    fireEvent.click(screen.getByRole('button', { name: 'Create payroll run' }));
    await screen.findByText('The payroll run could not be created.');
    const firstKey = (
      fetchMock.mock.calls.find(
        ([, options]) => (options as { method?: string })?.method === 'POST',
      )![1] as { headers: Record<string, string> }
    ).headers['idempotency-key'];
    fireEvent.click(screen.getByRole('button', { name: 'Create payroll run' }));
    await waitFor(() => expect(postAttempts).toBe(2));
    const postCalls = fetchMock.mock.calls.filter(
      ([, options]) => (options as { method?: string })?.method === 'POST',
    );
    expect(
      (postCalls[1]![1] as { headers: Record<string, string> }).headers[
        'idempotency-key'
      ],
    ).toBe(firstKey);
    fireEvent.click(screen.getByRole('button', { name: 'Reset form' }));
    expect((screen.getByLabelText('Month') as HTMLInputElement).value).toBe('');
    expect(
      (document.getElementById('legalEntityId') as HTMLSelectElement).value,
    ).toBe('');
    expect(
      (document.getElementById('grossPay') as HTMLInputElement).value,
    ).toBe('');
    fireEvent.change(document.getElementById('legalEntityId')!, {
      target: { value: entityId },
    });
    await screen.findByRole('option', { name: /E001/ });
    fireEvent.change(screen.getByLabelText('Month'), {
      target: { value: '2026-09' },
    });
    fillRow(0, employeeOne.id);
    fireEvent.click(screen.getByRole('button', { name: 'Create payroll run' }));
    await waitFor(() => expect(postAttempts).toBe(3));
    const thirdPost = fetchMock.mock.calls.filter(
      ([, options]) => (options as { method?: string })?.method === 'POST',
    )[2]!;
    expect(
      (thirdPost[1] as { headers: Record<string, string> }).headers[
        'idempotency-key'
      ],
    ).not.toBe(firstKey);
  });
});
