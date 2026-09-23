import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const s = vi.hoisted(() => ({
  access: undefined as unknown,
  file: undefined as File | undefined,
  org: 'org_1',
}));
const getJson = vi.hoisted(() => vi.fn());
const postPayrollImport = vi.hoisted(() => vi.fn());
const postPayrollImportConsume = vi.hoisted(() => vi.fn());
vi.mock('@bap/design-system/react', async (original) => {
  const actual = await original<typeof import('@bap/design-system/react')>();
  return {
    ...actual,
    FileUploader: ({
      onAddFiles,
    }: {
      onAddFiles: (event: unknown, content: { addedFiles: File[] }) => void;
    }) => (
      <button
        type="button"
        onClick={() => s.file && onAddFiles({}, { addedFiles: [s.file] })}
      >
        Choose file
      </button>
    ),
  };
});
vi.mock('../../../../lib/organizations/use-organization-selection', () => ({
  useOrganizationSelection: () => ({ organizationId: s.org, slug: 'test' }),
}));
vi.mock('../../../../lib/organizations/use-organization-access', () => ({
  useOrganizationAccess: () => ({ access: s.access }),
}));
vi.mock('../../../../lib/organizations/use-legal-entities', () => ({
  useLegalEntities: () => [{ id, name: 'Entity' }],
}));
vi.mock('../../../../lib/datasets/client', () => ({ getJson }));
vi.mock('../../../../lib/payroll/client', () => ({
  isValidPayrollImportInput: (file: File, entity: string, month: string) =>
    Boolean(file && entity && month.endsWith('-01')),
  payrollImportsPath: (org: string) => `/imports/${org}`,
  payrollImportPath: (org: string, importId: string) =>
    `/imports/${org}/${importId}`,
  payrollImportConsumePath: (org: string, importId: string) =>
    `/imports/${org}/${importId}/consume`,
  postPayrollImport,
  postPayrollImportConsume,
}));
import { I18nProvider } from '../../../../i18n/client-provider';
import Page from './page';

const id = '123e4567-e89b-42d3-a456-426614174000';
const caps = {
  approvePayroll: false,
  createEntities: false,
  deleteEntities: false,
  manageDocuments: false,
  manageEntityAccess: false,
  manageHr: false,
  manageMembers: false,
  manageOrganization: false,
  managePayroll: true,
  manageSensitiveHr: false,
  readDocuments: false,
  readHr: false,
  readPayroll: true,
  readSensitiveHr: false,
  updateEntities: false,
  uploadData: false,
  useAi: false,
};
const item = (
  status: 'staged' | 'validated' | 'failed' | 'consumed',
  extra = {},
) => ({
  createdAt: '2026-09-01T00:00:00.000Z',
  errorCount: status === 'failed' ? 1 : 0,
  errorReport:
    status === 'failed'
      ? [{ code: 'invalid_amount', field: 'grossPay', row: 2 }]
      : [],
  format: 'csv',
  id,
  legalEntityId: id,
  payrollMonth: '2026-09-01',
  payrollRunId: null,
  rowCount: 1,
  sourceDocumentId: id,
  status,
  ...extra,
});
const page = () =>
  render(
    <I18nProvider>
      <Page />
    </I18nProvider>,
  );
const submit = () => {
  fireEvent.change(document.getElementById('legalEntityId')!, {
    target: { value: id },
  });
  fireEvent.change(screen.getByLabelText('Payroll month'), {
    target: { value: '2026-09' },
  });
  fireEvent.click(screen.getByText('Choose file'));
  fireEvent.click(screen.getByRole('button', { name: 'Upload payroll file' }));
};
describe('PayrollImportPage behavior', () => {
  beforeEach(() => {
    s.access = { capabilities: caps };
    s.file = new File(['x'], 'import.csv');
    s.org = 'org_1';
    getJson.mockReset();
    postPayrollImport.mockReset();
    postPayrollImportConsume.mockReset();
  });
  afterEach(() => cleanup());
  it('hides mutations for read-only access', () => {
    s.access = { capabilities: { ...caps, managePayroll: false } };
    page();
    expect(
      screen.queryByRole('button', { name: 'Upload payroll file' }),
    ).toBeNull();
  });
  it('renders the access loading state', () => {
    s.access = undefined;
    page();
    expect(screen.getByText('Loading payroll import.')).toBeVisible();
  });
  it('denies an account without readPayroll', () => {
    s.access = { capabilities: { ...caps, readPayroll: false } };
    page();
    expect(
      screen.getByText(
        'This account cannot read payroll imports in this organization.',
      ),
    ).toBeVisible();
  });
  it('submits exact form fields and preserves them after upload failure', async () => {
    postPayrollImport.mockRejectedValueOnce(Error());
    page();
    submit();
    await waitFor(() => expect(postPayrollImport).toHaveBeenCalledOnce());
    const [path, form] = postPayrollImport.mock.calls[0]!;
    expect(path).toBe('/imports/org_1');
    expect((form as FormData).get('file')).toMatchObject({
      name: 'import.csv',
      size: 1,
    });
    expect((form as FormData).get('legalEntityId')).toBe(id);
    expect((form as FormData).get('payrollMonth')).toBe('2026-09-01');
    await waitFor(() =>
      expect(
        screen.getByText(
          'The payroll import could not be completed. Try again.',
        ),
      ).toBeVisible(),
    );
    expect(document.getElementById('legalEntityId')).toHaveValue(id);
  });
  it('polls staged to failed, renders coded errors only, and resets', async () => {
    postPayrollImport.mockResolvedValueOnce({ payrollImport: item('staged') });
    getJson.mockResolvedValueOnce({ payrollImport: item('failed') });
    page();
    submit();
    await waitFor(() =>
      expect(screen.getByText('invalid_amount')).toBeVisible(),
    );
    expect(screen.getByText('grossPay')).toBeVisible();
    expect(screen.getByText('2')).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', { name: 'Import another file' }),
    );
    expect(
      screen.getByRole('button', { name: 'Upload payroll file' }),
    ).toBeVisible();
  });
  it('preserves validated import on consume failure, then shows durable consumed run and resets', async () => {
    postPayrollImport.mockResolvedValueOnce({ payrollImport: item('staged') });
    getJson.mockResolvedValueOnce({ payrollImport: item('validated') });
    postPayrollImportConsume
      .mockRejectedValueOnce(Error())
      .mockResolvedValueOnce({ payrollRunId: id, status: 'draft' });
    page();
    submit();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Create draft payroll run' }),
      ).toBeVisible(),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Create draft payroll run' }),
    );
    await waitFor(() =>
      expect(
        screen.getByText(
          'The payroll import could not be completed. Try again.',
        ),
      ).toBeVisible(),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Create draft payroll run' }),
    );
    await waitFor(() => expect(screen.getByDisplayValue(id)).toBeVisible());
    fireEvent.click(
      screen.getByRole('button', { name: 'Import another file' }),
    );
    expect(
      screen.getByRole('button', { name: 'Upload payroll file' }),
    ).toBeVisible();
  });
  it('suppresses stale upload settlement after an organization switch', async () => {
    let settle: ((value: unknown) => void) | undefined;
    postPayrollImport.mockReturnValueOnce(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const view = page();
    submit();
    s.org = 'org_2';
    view.rerender(
      <I18nProvider>
        <Page />
      </I18nProvider>,
    );
    settle?.({ payrollImport: item('staged') });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Choose file' })).toBeVisible(),
    );
    expect(getJson).not.toHaveBeenCalled();
  });
});
