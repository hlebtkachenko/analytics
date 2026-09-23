import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const accessMock = vi.hoisted(() => vi.fn());
const organizationMock = vi.hoisted(() => vi.fn());
const getJsonMock = vi.hoisted(() => vi.fn());
const replaceMock = vi.hoisted(() => vi.fn());
const searchMock = vi.hoisted(() => vi.fn());
type GridRow = Record<string, string | number | null>;
type GridColumn = {
  key: string;
  renderCell?: (row: GridRow) => ReactNode;
};

vi.mock('@bap/design-system/blocks', () => ({
  DataGrid: ({
    columns,
    emptyLabel,
    errorLabel,
    onPageChange,
    rows,
    state,
  }: {
    columns: GridColumn[];
    emptyLabel: string;
    errorLabel: string;
    onPageChange: (page: number, pageSize: number) => void;
    rows: GridRow[];
    state: string;
  }) => (
    <div>
      {state === 'empty' ? emptyLabel : state === 'error' ? errorLabel : state}
      {rows.map((row) => (
        <div key={String(row.id)}>
          <span>{row.month}</span>
          <span>{row.version}</span>
          <span>{row.status}</span>
          <span>{row.grossPay}</span>
          <span>{row.netPay}</span>
          <span>{row.totalEmployerCost}</span>
          {columns.at(-1)?.renderCell?.(row)}
        </div>
      ))}
      <button onClick={() => onPageChange(3, 25)}>Next</button>
    </div>
  ),
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ employeeId: '00000000-0000-4000-8000-000000000001' }),
  usePathname: () => '/employees/x/payroll',
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: searchMock,
}));
vi.mock('../../../../../lib/datasets/client', () => ({
  getJson: getJsonMock,
  organizationPath: (id: string) => `/api/bff/application/organizations/${id}`,
}));
vi.mock('../../../../../lib/organizations/use-organization-access', () => ({
  useOrganizationAccess: accessMock,
}));
vi.mock('../../../../../lib/organizations/use-organization-selection', () => ({
  useOrganizationSelection: organizationMock,
}));

import { I18nProvider } from '../../../../../i18n/client-provider';
import EmployeePayrollPage from './page';

const payrollResult = {
  payrollRunId: '00000000-0000-4000-8000-000000000002',
  legalEntityId: '00000000-0000-4000-8000-000000000003',
  month: '2026-09',
  version: 1,
  supersedesPayrollRunId: null,
  status: 'finalized',
  origin: 'calculated',
  grossPay: '1000',
  employeeSocial: '65',
  employeeHealth: '45',
  incomeTax: '100',
  otherDeductions: '0',
  netPay: '790',
  employerSocial: '248',
  employerHealth: '90',
  totalEmployerCost: '1338',
  payslipDocumentId: '00000000-0000-4000-8000-000000000004',
  finalizedAt: '2026-09-30T00:00:00.000Z',
  paidAt: null,
};

beforeEach(() => {
  getJsonMock.mockReset();
  organizationMock.mockReturnValue({
    organizationId: 'org_1',
    slug: 'selected',
    state: 'idle',
  });
  accessMock.mockReturnValue({
    access: { capabilities: { readPayroll: true } },
    state: 'idle',
  });
  replaceMock.mockReset();
  searchMock.mockReturnValue(
    new URLSearchParams('page=2&pageSize=50&fromMonth=2026-08&toMonth=2026-09'),
  );
  getJsonMock.mockResolvedValue({
    payrollResults: [payrollResult],
    page: 2,
    pageSize: 50,
    total: 0,
  });
});
afterEach(cleanup);

describe('EmployeePayrollPage', () => {
  it('uses filters, paging, result values, and the organization-preserving payslip link', async () => {
    render(
      <I18nProvider>
        <EmployeePayrollPage />
      </I18nProvider>,
    );
    expect(await screen.findByText('1000')).toBeVisible();
    expect(getJsonMock).toHaveBeenCalledWith(
      '/api/bff/application/organizations/org_1/employees/00000000-0000-4000-8000-000000000001/payroll-results?page=2&pageSize=50&fromMonth=2026-08&toMonth=2026-09',
      expect.any(AbortSignal),
    );
    expect(screen.getByText('2026-09')).toBeVisible();
    expect(screen.getByText('790')).toBeVisible();
    expect(screen.getByText('1338')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Payslip' })).toHaveAttribute(
      'href',
      '/documents/00000000-0000-4000-8000-000000000004?organization=selected',
    );
    fireEvent.change(screen.getByLabelText('Effective from'), {
      target: { value: '2026-07' },
    });
    expect(replaceMock).toHaveBeenLastCalledWith(
      '/employees/x/payroll?page=1&pageSize=50&fromMonth=2026-07&toMonth=2026-09',
    );
    fireEvent.change(screen.getByLabelText('Effective to'), {
      target: { value: '2026-10' },
    });
    expect(replaceMock).toHaveBeenLastCalledWith(
      '/employees/x/payroll?page=1&pageSize=50&fromMonth=2026-08&toMonth=2026-10',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(replaceMock).toHaveBeenLastCalledWith(
      '/employees/x/payroll?page=3&pageSize=25&fromMonth=2026-08&toMonth=2026-09',
    );
  });

  it('shows neutral organization and access loading without a history request', () => {
    organizationMock.mockReturnValue({
      organizationId: '',
      slug: '',
      state: 'loading',
    });
    render(
      <I18nProvider>
        <EmployeePayrollPage />
      </I18nProvider>,
    );
    expect(screen.getByText('loading')).toBeVisible();
    expect(getJsonMock).not.toHaveBeenCalled();
    cleanup();
    organizationMock.mockReturnValue({
      organizationId: 'org_1',
      slug: 'selected',
      state: 'idle',
    });
    accessMock.mockReturnValue({ access: undefined, state: 'loading' });
    render(
      <I18nProvider>
        <EmployeePayrollPage />
      </I18nProvider>,
    );
    expect(screen.getByText('loading')).toBeVisible();
    expect(getJsonMock).not.toHaveBeenCalled();
  });

  it('shows access error and forbidden without a history request', () => {
    organizationMock.mockReturnValue({
      organizationId: '',
      slug: '',
      state: 'error',
    });
    render(
      <I18nProvider>
        <EmployeePayrollPage />
      </I18nProvider>,
    );
    expect(
      screen.getByText('Organization access could not be checked.'),
    ).toBeVisible();
    expect(getJsonMock).not.toHaveBeenCalled();
    cleanup();
    organizationMock.mockReturnValue({
      organizationId: 'org_1',
      slug: 'selected',
      state: 'idle',
    });
    accessMock.mockReturnValue({ access: undefined, state: 'error' });
    render(
      <I18nProvider>
        <EmployeePayrollPage />
      </I18nProvider>,
    );
    expect(
      screen.getByText('Organization access could not be checked.'),
    ).toBeVisible();
    expect(getJsonMock).not.toHaveBeenCalled();
    cleanup();
    accessMock.mockReturnValue({
      access: { capabilities: { readPayroll: false } },
      state: 'idle',
    });
    render(
      <I18nProvider>
        <EmployeePayrollPage />
      </I18nProvider>,
    );
    expect(
      screen.getByText(
        'This account cannot read payroll data in this organization.',
      ),
    ).toBeVisible();
    expect(getJsonMock).not.toHaveBeenCalled();
  });

  it('renders data error and empty states after an authorized request', async () => {
    getJsonMock.mockRejectedValue(new Error('down'));
    render(
      <I18nProvider>
        <EmployeePayrollPage />
      </I18nProvider>,
    );
    expect(
      await screen.findByText('Payroll results could not be loaded.'),
    ).toBeVisible();
    cleanup();
    getJsonMock.mockResolvedValue({
      payrollResults: [],
      page: 2,
      pageSize: 50,
      total: 0,
    });
    render(
      <I18nProvider>
        <EmployeePayrollPage />
      </I18nProvider>,
    );
    expect(
      await screen.findByText('No payroll results are available.'),
    ).toBeVisible();
  });
});
