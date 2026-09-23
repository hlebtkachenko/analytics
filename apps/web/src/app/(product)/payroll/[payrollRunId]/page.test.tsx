import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const accessMock = vi.hoisted(() => vi.fn());
const getJsonMock = vi.hoisted(() => vi.fn());
const postPayrollJsonMock = vi.hoisted(() => vi.fn());
const paramsMock = vi.hoisted(() => ({ payrollRunId: 'run_1' }));
vi.mock('next/navigation', () => ({ useParams: () => paramsMock }));
vi.mock('../../../../lib/organizations/use-organization-selection', () => ({
  useOrganizationSelection: () => ({ organizationId: 'org_1', slug: 'test' }),
}));
vi.mock('../../../../lib/organizations/use-organization-access', () => ({
  useOrganizationAccess: accessMock,
}));
vi.mock('../../../../lib/datasets/client', () => ({
  getJson: getJsonMock,
  organizationPath: (id: string) => `/api/bff/application/organizations/${id}`,
}));
vi.mock('../../../../lib/payroll/client', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../lib/payroll/client')
  >('../../../../lib/payroll/client');
  return { ...actual, postPayrollJson: postPayrollJsonMock };
});
import { I18nProvider } from '../../../../i18n/client-provider';
import PayrollDetailPage from './page';
import PayrollRunPage from './payroll-run-page';
const run = {
  id: '00000000-0000-4000-8000-000000000001',
  legalEntityId: '00000000-0000-4000-8000-000000000002',
  month: '2026-09',
  version: 1,
  supersedesPayrollRunId: null,
  documentId: '00000000-0000-4000-8000-000000000003',
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
  createdAt: '2026-01-01T00:00:00Z',
  results: [],
};
const result = {
  employeeId: '00000000-0000-4000-8000-000000000004',
  grossPay: '100.1234',
  employeeSocial: '6.0000',
  employeeHealth: '4.0000',
  incomeTax: '10.0000',
  otherDeductions: '1.0000',
  netPay: '79.1234',
  employerSocial: '24.0000',
  employerHealth: '9.0000',
  totalEmployerCost: '133.1234',
};
const renderPage = () =>
  render(
    <I18nProvider>
      <PayrollDetailPage />
    </I18nProvider>,
  );
const renderSection = (
  section: Parameters<typeof PayrollRunPage>[0]['section'],
) =>
  render(
    <I18nProvider>
      <PayrollRunPage section={section} />
    </I18nProvider>,
  );
describe('PayrollDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    paramsMock.payrollRunId = 'run_1';
    accessMock.mockReturnValue({
      access: { capabilities: { readPayroll: true } },
    });
    getJsonMock.mockResolvedValue(run);
    postPayrollJsonMock.mockResolvedValue(run);
  });
  afterEach(cleanup);
  it('shows access loading without requesting payroll', () => {
    accessMock.mockReturnValue({ access: undefined });
    renderPage();
    expect(screen.getByText('Loading payroll run.')).toBeInTheDocument();
    expect(getJsonMock).not.toHaveBeenCalled();
  });
  it('denies access without requesting payroll', () => {
    accessMock.mockReturnValue({
      access: { capabilities: { readPayroll: false } },
    });
    renderPage();
    expect(
      screen.getByText(
        'This account cannot read payroll data in this organization.',
      ),
    ).toBeInTheDocument();
    expect(getJsonMock).not.toHaveBeenCalled();
  });
  it('shows upstream error', async () => {
    getJsonMock.mockRejectedValueOnce(new Error('upstream'));
    renderPage();
    await waitFor(() =>
      expect(
        screen.getByText('Payroll runs could not be loaded.'),
      ).toBeInTheDocument(),
    );
  });
  it('renders the shared ordered payroll tabs', async () => {
    renderPage();
    await waitFor(() =>
      expect(
        screen.getByRole('link', { name: 'Overview' }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole('link', { name: 'Validation' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Corrections' }),
    ).toBeInTheDocument();
  });
  it('renders the payroll identity', async () => {
    getJsonMock.mockResolvedValueOnce({
      ...run,
      results: [],
    });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/Payroll run: 00000000/)).toBeInTheDocument(),
    );
    expect(getJsonMock).toHaveBeenCalled();
  });

  it.each([
    [
      'draft',
      { managePayroll: true },
      ['Validate'],
      ['Submit for approval', 'Approve', 'Reject', 'Finalize'],
    ],
    [
      'validating',
      { managePayroll: true },
      ['Submit for approval'],
      ['Validate', 'Approve', 'Reject', 'Finalize'],
    ],
    [
      'ready_for_approval',
      { approvePayroll: true },
      ['Approve'],
      ['Validate', 'Submit for approval', 'Reject', 'Finalize'],
    ],
    [
      'ready_for_approval',
      { managePayroll: true },
      ['Reject'],
      ['Validate', 'Submit for approval', 'Approve', 'Finalize'],
    ],
    [
      'approved',
      { managePayroll: true },
      ['Finalize'],
      ['Validate', 'Submit for approval', 'Approve', 'Reject'],
    ],
  ])(
    'exposes only legal validation actions for %s',
    async (status, capabilities, visible, hidden) => {
      cleanup();
      accessMock.mockReturnValue({
        access: { capabilities: { readPayroll: true, ...capabilities } },
      });
      getJsonMock.mockResolvedValueOnce({
        ...run,
        status,
        validationSummary: { valid: true, issues: [] },
      });
      renderSection('validation');
      await screen.findByRole('link', { name: 'Validation' });
      for (const label of visible)
        expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
      for (const label of hidden)
        expect(
          screen.queryByRole('button', { name: label }),
        ).not.toBeInTheDocument();
    },
  );

  it('keeps all tabs ordered and organization-preserving', async () => {
    renderSection('overview');
    const nav = await screen.findByRole('navigation', {
      name: 'Payroll sections',
    });
    expect(
      [...nav.querySelectorAll('a')].map((a) => [
        a.textContent,
        a.getAttribute('href'),
      ]),
    ).toEqual([
      ['Overview', '/payroll/run_1?organization=test'],
      ['Validation', '/payroll/run_1/validation?organization=test'],
      ['Results', '/payroll/run_1/results?organization=test'],
      ['Taxes and insurance', '/payroll/run_1/taxes?organization=test'],
      ['Accounting', '/payroll/run_1/accounting?organization=test'],
      ['Documents', '/payroll/run_1/documents?organization=test'],
      ['Submissions', '/payroll/run_1/submissions?organization=test'],
      ['Corrections', '/payroll/run_1/corrections?organization=test'],
    ]);
  });

  it('retries failed validation with the same idempotency key, then refreshes', async () => {
    postPayrollJsonMock
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(run);
    accessMock.mockReturnValue({
      access: { capabilities: { readPayroll: true, managePayroll: true } },
    });
    getJsonMock.mockResolvedValue({ ...run, status: 'draft' });
    renderSection('validation');
    await screen.findByRole('button', { name: 'Validate' });
    const button = screen.getByRole('button', { name: 'Validate' });
    button.click();
    await screen.findByText(
      'The payroll command could not be completed. Try again.',
    );
    button.click();
    await waitFor(() => expect(postPayrollJsonMock).toHaveBeenCalledTimes(2));
    expect(postPayrollJsonMock.mock.calls[0]![3]).toBe(
      postPayrollJsonMock.mock.calls[1]![3],
    );
  });

  it('validates rejection reason, sends its payload, and rotates key after close', async () => {
    accessMock.mockReturnValue({
      access: { capabilities: { readPayroll: true, managePayroll: true } },
    });
    getJsonMock.mockResolvedValue({ ...run, status: 'ready_for_approval' });
    renderSection('validation');
    await screen.findByRole('button', { name: 'Reject' });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const modal = (await screen.findByLabelText('Reason')).closest(
      '[role="dialog"]',
    )! as HTMLElement;
    const submit = within(modal).getByRole('button', { name: 'Reject' });
    expect(submit).toBeDisabled();
    const input = screen.getByLabelText('Reason') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  because  ' } });
    await waitFor(() => expect(submit).not.toBeDisabled());
    submit.click();
    await waitFor(() => expect(postPayrollJsonMock).toHaveBeenCalled());
    expect(postPayrollJsonMock.mock.calls[0]![1]).toEqual({
      reason: 'because',
    });
    expect(screen.queryByLabelText('Reason')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const retryModal = (await screen.findByLabelText('Reason')).closest(
      '[role="dialog"]',
    )! as HTMLElement;
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'again' },
    });
    fireEvent.click(within(retryModal).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(postPayrollJsonMock).toHaveBeenCalledTimes(2));
    expect(postPayrollJsonMock.mock.calls[1]![3]).not.toBe(
      postPayrollJsonMock.mock.calls[0]![3],
    );
  });

  it.each(['results', 'taxes'] as const)(
    'renders representative %s values',
    async (section) => {
      getJsonMock.mockResolvedValue({ ...run, results: [result] });
      renderSection(section);
      expect(
        await screen.findByText(section === 'taxes' ? '6.0000' : '100.1234'),
      ).toBeInTheDocument();
      expect(
        screen.getByText(section === 'taxes' ? '10.0000' : '79.1234'),
      ).toBeInTheDocument();
    },
  );

  it('renders precise accounting categories and totals', async () => {
    getJsonMock.mockResolvedValue({ ...run, results: [result] });
    renderSection('accounting');
    expect(
      await screen.findByText(/Wages expense: 100.1234/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Debit total/)).toHaveTextContent('133.1234');
    expect(screen.getByText(/Credit total/)).toHaveTextContent('133.1234');
    expect(screen.getByText('Accounting preview')).toBeInTheDocument();
  });

  it('shows documents guidance without inventing a header link', async () => {
    getJsonMock.mockResolvedValue({ ...run, documentId: null });
    renderSection('documents');
    expect(
      await screen.findByText('No header payroll document is available.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/payslip/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Header document' }),
    ).not.toBeInTheDocument();
  });

  it('loads submissions from approvals and liabilities', async () => {
    getJsonMock.mockImplementation((path: string) =>
      path.endsWith('/approvals')
        ? Promise.resolve({ approvals: [] })
        : path.endsWith('/liabilities')
          ? Promise.resolve({ liabilities: [] })
          : Promise.resolve(run),
    );
    renderSection('submissions');
    await waitFor(() =>
      expect(getJsonMock).toHaveBeenCalledWith(
        expect.stringContaining('/approvals'),
        expect.anything(),
      ),
    );
    expect(
      await screen.findAllByText(/No payroll runs are registered/),
    ).toHaveLength(2);
  });

  it('shows access error and data retry states', async () => {
    accessMock.mockReturnValue({ state: 'error', access: undefined });
    renderSection('overview');
    expect(
      screen.getByText('Organization access could not be checked.'),
    ).toBeInTheDocument();
    cleanup();
    accessMock.mockReturnValue({
      access: { capabilities: { readPayroll: true } },
    });
    getJsonMock.mockRejectedValueOnce(new Error('upstream'));
    renderSection('overview');
    await screen.findByText('Payroll runs could not be loaded.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it.each([
    ['draft', false],
    ['finalized', true],
    ['paid', false],
  ] as const)(
    'shows payment only for finalized managed runs (%s)',
    async (status, visible) => {
      accessMock.mockReturnValue({
        access: { capabilities: { readPayroll: true, managePayroll: true } },
      });
      getJsonMock.mockImplementation((path: string) =>
        path.endsWith('/approvals')
          ? Promise.resolve({ approvals: [] })
          : path.endsWith('/liabilities')
            ? Promise.resolve({ liabilities: [] })
            : Promise.resolve({ ...run, status }),
      );
      renderSection('submissions');
      await screen.findByRole('navigation');
      if (visible)
        expect(
          screen.getByRole('button', { name: 'Record payment' }),
        ).toBeInTheDocument();
      else
        expect(
          screen.queryByRole('button', { name: 'Record payment' }),
        ).not.toBeInTheDocument();
    },
  );

  it('renders correction predecessor link and restricts correction action', async () => {
    accessMock.mockReturnValue({
      access: { capabilities: { readPayroll: true, managePayroll: true } },
    });
    getJsonMock.mockResolvedValue({
      ...run,
      status: 'paid',
      supersedesPayrollRunId: run.id,
    });
    renderSection('corrections');
    expect(
      await screen.findByRole('link', { name: 'Predecessor' }),
    ).toHaveAttribute('href', `/payroll/${run.id}?organization=test`);
    fireEvent.click(screen.getByRole('button', { name: 'Create correction' }));
    const modal = (await screen.findByLabelText('Reason')).closest(
      '[role="dialog"]',
    )! as HTMLElement;
    const submit = within(modal).getByRole('button', {
      name: 'Create correction',
    });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: '  fix  ' },
    });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(postPayrollJsonMock).toHaveBeenCalledWith(
        expect.stringContaining('/corrections'),
        { reason: 'fix' },
        expect.anything(),
        expect.anything(),
      ),
    );
  });

  it('renders all accounting categories and finalized header link', async () => {
    getJsonMock.mockResolvedValue({
      ...run,
      status: 'finalized',
      documentId: run.documentId,
      results: [result],
    });
    renderSection('accounting');
    for (const label of [
      'Wages expense',
      'Employer contributions expense',
      'Net wages payable',
      'Insurance payable',
      'Income tax payable',
      'Other deductions payable',
    ])
      expect(await screen.findByText(new RegExp(label))).toBeInTheDocument();
    expect(screen.getByText(/Debit total/)).toHaveTextContent('133.1234');
    expect(screen.getByText(/Credit total/)).toHaveTextContent('133.1234');
    expect(
      screen.getByRole('link', { name: 'Header payroll document' }),
    ).toHaveAttribute('href', expect.stringContaining(run.documentId));
  });
});
