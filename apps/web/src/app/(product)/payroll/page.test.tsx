import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
const search = vi.hoisted(() => ({ value: 'page=2&pageSize=10' }));
const accessMock = vi.hoisted(() => vi.fn());
const organizationMock = vi.hoisted(() => vi.fn());
const entitiesMock = vi.hoisted(() => vi.fn());
const getJsonMock = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  usePathname: () => '/payroll',
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(search.value),
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
  getJson: getJsonMock,
  organizationPath: (id: string) => `/api/bff/application/organizations/${id}`,
}));
import { I18nProvider } from '../../../i18n/client-provider';
import PayrollPage from './page';
const entityId = '00000000-0000-4000-8000-000000000001';
const runId = '00000000-0000-4000-8000-000000000002';
const run = {
  id: runId,
  legalEntityId: entityId,
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
  createdAt: '2026-09-01T00:00:00.000Z',
  results: [],
};
const renderPage = () =>
  render(
    <I18nProvider>
      <PayrollPage />
    </I18nProvider>,
  );
describe('PayrollPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    search.value = 'page=2&pageSize=10';
    organizationMock.mockReturnValue({
      organizationId: 'org_1',
      slug: 'test',
      state: 'ready',
    });
    accessMock.mockReturnValue({
      access: { capabilities: { managePayroll: true, readPayroll: true } },
    });
    entitiesMock.mockReturnValue([{ id: entityId, name: 'Entity' }]);
    getJsonMock.mockResolvedValue({
      payrollRuns: [run],
      page: 2,
      pageSize: 10,
      total: 51,
    });
  });
  afterEach(cleanup);
  it('shows access loading without payroll request', () => {
    accessMock.mockReturnValue({ access: undefined });
    renderPage();
    expect(screen.getByText('Loading payroll run.')).toBeInTheDocument();
    expect(getJsonMock).not.toHaveBeenCalled();
  });
  it('shows organization loading and error without payroll request', () => {
    organizationMock.mockReturnValue({
      organizationId: 'org_1',
      slug: 'test',
      state: 'loading',
    });
    renderPage();
    expect(screen.getByText('Loading payroll run.')).toBeInTheDocument();
    expect(getJsonMock).not.toHaveBeenCalled();
    cleanup();
    organizationMock.mockReturnValue({
      organizationId: 'org_1',
      slug: 'test',
      state: 'error',
    });
    renderPage();
    expect(
      screen.getByText('Organization access could not be checked.'),
    ).toBeInTheDocument();
    expect(getJsonMock).not.toHaveBeenCalled();
  });
  it('shows access error without payroll request', () => {
    accessMock.mockReturnValue({ access: undefined, state: 'error' });
    renderPage();
    expect(
      screen.getByText('Organization access could not be checked.'),
    ).toBeInTheDocument();
    expect(getJsonMock).not.toHaveBeenCalled();
  });
  it('denies access without payroll request', () => {
    accessMock.mockReturnValue({
      access: { capabilities: { managePayroll: false, readPayroll: false } },
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
  it('shows empty results', async () => {
    getJsonMock.mockResolvedValueOnce({
      payrollRuns: [],
      page: 2,
      pageSize: 10,
      total: 0,
    });
    renderPage();
    await waitFor(() =>
      expect(
        screen.getByText(
          'No payroll runs are registered for this organization yet.',
        ),
      ).toBeInTheDocument(),
    );
  });
  it('renders total, filters, pagination, row navigation, and manage button', async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText('2026-09')).toBeInTheDocument(),
    );
    expect(screen.getByText(/51/)).toBeInTheDocument();
    expect(getJsonMock).toHaveBeenCalledWith(
      '/api/bff/application/organizations/org_1/payroll-runs?page=2&pageSize=10',
      expect.any(AbortSignal),
    );
    fireEvent.change(screen.getByLabelText('Legal entity'), {
      target: { value: entityId },
    });
    expect(router.replace).toHaveBeenLastCalledWith(
      `/payroll?page=1&pageSize=10&legalEntityId=${entityId}`,
    );
    fireEvent.change(screen.getByLabelText('Month'), {
      target: { value: '2026-10' },
    });
    expect(router.replace).toHaveBeenLastCalledWith(
      '/payroll?page=1&pageSize=10&month=2026-10',
    );
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(router.replace).toHaveBeenLastCalledWith(
      '/payroll?page=3&pageSize=10',
    );
    fireEvent.click(screen.getByText('2026-09'));
    expect(router.push).toHaveBeenCalledWith(
      `/payroll/${runId}?organization=test`,
    );
    expect(
      screen.getByRole('link', { name: 'New payroll run' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Import' })).toBeInTheDocument();
  });
  it('hides new button without managePayroll', async () => {
    accessMock.mockReturnValue({
      access: { capabilities: { managePayroll: false, readPayroll: true } },
    });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText('2026-09')).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('link', { name: 'New payroll run' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Import' }),
    ).not.toBeInTheDocument();
  });
  it('canonicalizes invalid URL values before requesting data', async () => {
    search.value = 'page=nope&pageSize=0&month=2026-99';
    renderPage();
    await waitFor(() => expect(getJsonMock).toHaveBeenCalled());
    expect(getJsonMock).toHaveBeenCalledWith(
      '/api/bff/application/organizations/org_1/payroll-runs?page=1&pageSize=25',
      expect.any(AbortSignal),
    );
  });
});
