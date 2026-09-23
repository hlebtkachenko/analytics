/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const organization = vi.hoisted(() => ({
  current: {
    organizationId: 'org_1' as string | undefined,
    state: 'ready' as 'error' | 'loading' | 'ready',
  },
}));
const client = vi.hoisted(() => ({
  cancelMyHrLeaveRequest: vi.fn(),
  createMyHrLeaveRequest: vi.fn(),
  createMyHrTimesheet: vi.fn(),
  getMyHrAccess: vi.fn(),
  getMyHrProfile: vi.fn(),
  listMyHrDocuments: vi.fn(),
  listMyHrLeaveRequests: vi.fn(),
  listMyHrLeaveTypes: vi.fn(),
  listMyHrPayslips: vi.fn(),
  listMyHrTimesheets: vi.fn(),
  submitMyHrTimesheet: vi.fn(),
  updateMyHrTimesheet: vi.fn(),
}));
const notify = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/organizations/use-organization-selection', () => ({
  useOrganizationSelection: () => organization.current,
}));
vi.mock('../../../lib/hr-self-service/client', () => client);
vi.mock('../../../components/shell/toast', () => ({
  useToast: () => ({ notify }),
}));
vi.mock('@bap/design-system/react', () => ({
  Button: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
  InlineNotification: ({ title }: any) => <div role="alert">{title}</div>,
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
  Modal: ({
    children,
    open,
    onRequestSubmit,
    primaryButtonDisabled,
    primaryButtonText,
  }: any) =>
    open ? (
      <div role="dialog">
        {children}
        <button disabled={primaryButtonDisabled} onClick={onRequestSubmit}>
          {primaryButtonText}
        </button>
      </div>
    ) : null,
  Select: ({ children, labelText, ...props }: any) => (
    <label>
      {labelText}
      <select {...props}>{children}</select>
    </label>
  ),
  SelectItem: ({ text, ...props }: any) => <option {...props}>{text}</option>,
  Stack: ({ children }: any) => <div>{children}</div>,
  TextInput: ({ labelText, ...props }: any) => (
    <label>
      {labelText}
      <input {...props} />
    </label>
  ),
}));
vi.mock('@bap/design-system/blocks', () => ({
  DataGrid: ({
    columns,
    emptyLabel,
    onPageChange,
    rowActions,
    rows,
    state,
    totalItems,
  }: any) => (
    <section data-state={state} data-total={totalItems}>
      {rows.map((row: any) => (
        <div key={row.id}>
          {columns.map((column: any) => (
            <span key={column.key}>{String(row[column.key] ?? '')}</span>
          ))}
          {rowActions?.(row).map((action: any) => (
            <button key={action.id} onClick={action.onClick}>
              {action.label}
            </button>
          ))}
        </div>
      ))}
      {state === 'empty' ? <span>{emptyLabel}</span> : null}
      {onPageChange ? (
        <button onClick={() => onPageChange(2)}>Next page</button>
      ) : null}
    </section>
  ),
}));
vi.mock('../../../components/page-container', () => ({
  default: ({ children }: any) => <main>{children}</main>,
}));

import { I18nProvider } from '../../../i18n/client-provider';
import MyHrDocumentsPage from './documents/page';
import MyHrLeavePage from './leave/page';
import { useMyHr } from './my-hr-state';
import MyHrPage from './page';
import MyHrPayslipsPage from './payslips/page';
import MyHrTimePage from './time/page';

const id = '00000000-0000-4000-8000-000000000001';
const relationshipId = '00000000-0000-4000-8000-000000000002';
const otherId = '00000000-0000-4000-8000-000000000003';
const profile = {
  employee: {
    id,
    legalEntityId: otherId,
    employeeNumber: 'EMP-1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    workEmail: 'ada@example.test',
    workPhone: null,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  relationships: [
    {
      id: relationshipId,
      employeeId: id,
      legalEntityId: otherId,
      kind: 'employment',
      position: 'Analyst',
      department: 'Finance',
      costCentre: 'CC-1',
      weeklyHours: 40,
      startDate: '2026-01-01',
      endDate: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
};
const timesheet = {
  id: otherId,
  relationshipId,
  periodStart: '2026-01-01',
  periodEnd: '2026-01-31',
  status: 'draft',
  totalWorkedMinutes: 480,
  entries: [
    {
      workDate: '2026-01-02',
      startedAt: '2026-01-02T09:00:00.000Z',
      endedAt: '2026-01-02T17:00:00.000Z',
    },
  ],
};

const renderPage = (page: React.ReactNode) =>
  render(<I18nProvider>{page}</I18nProvider>);
const resolveAccess = () => {
  client.getMyHrAccess.mockResolvedValue({
    available: true,
    employeeId: id,
    legalEntityId: otherId,
  });
  client.getMyHrProfile.mockResolvedValue(profile);
};

beforeEach(() => {
  organization.current = { organizationId: 'org_1', state: 'ready' };
  Object.values(client).forEach((mock) => mock.mockReset());
  notify.mockReset();
  resolveAccess();
  client.listMyHrDocuments.mockResolvedValue({
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
  });
  client.listMyHrPayslips.mockResolvedValue({
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
  });
  client.listMyHrTimesheets.mockResolvedValue({
    items: [timesheet],
    page: 1,
    pageSize: 25,
    total: 1,
  });
  client.listMyHrLeaveRequests.mockResolvedValue({
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
  });
  client.listMyHrLeaveTypes.mockResolvedValue({
    items: [{ id: id, name: 'Annual leave' }],
    page: 1,
    pageSize: 100,
    total: 1,
  });
  client.createMyHrTimesheet.mockResolvedValue(timesheet);
  client.updateMyHrTimesheet.mockResolvedValue(timesheet);
  client.submitMyHrTimesheet.mockResolvedValue({
    ...timesheet,
    status: 'submitted',
  });
  client.createMyHrLeaveRequest.mockResolvedValue({ id: id });
  client.cancelMyHrLeaveRequest.mockResolvedValue({ id: id });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useMyHr and overview', () => {
  it('shows organization loading, unavailable access, profile errors, and profile relationships', async () => {
    organization.current = { organizationId: undefined, state: 'loading' };
    const view = renderPage(<MyHrPage />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Loading your records.',
    );
    expect(client.getMyHrAccess).not.toHaveBeenCalled();
    view.unmount();
    organization.current = { organizationId: undefined, state: 'error' };
    renderPage(<MyHrPage />);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'could not be checked',
      ),
    );
    cleanup();
    organization.current = { organizationId: 'org_1', state: 'ready' };
    client.getMyHrAccess.mockResolvedValue({ available: false });
    renderPage(<MyHrPage />);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'unavailable or has been revoked',
      ),
    );
    cleanup();
    client.getMyHrAccess.mockResolvedValue({
      available: true,
      employeeId: id,
      legalEntityId: otherId,
    });
    client.getMyHrProfile.mockRejectedValue(new Error('no profile'));
    renderPage(<MyHrPage />);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'could not be checked',
      ),
    );
    cleanup();
    resolveAccess();
    renderPage(<MyHrPage />);
    expect(await screen.findByText('Ada')).toBeVisible();
    expect(screen.getByText('Analyst')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Documents' })).toHaveAttribute(
      'href',
      '/my-hr/documents',
    );
  });

  it('clears stale profiles and returns to loading when the organization changes', async () => {
    function StateProbe() {
      const { profile: current, state } = useMyHr();
      return <div>{`${state}:${current?.employee.firstName ?? 'none'}`}</div>;
    }
    const view = render(<StateProbe />);
    expect(await screen.findByText('ready:Ada')).toBeVisible();
    organization.current = { organizationId: 'org_2', state: 'ready' };
    client.getMyHrAccess.mockResolvedValue({
      available: true,
      employeeId: id,
      legalEntityId: otherId,
    });
    client.getMyHrProfile.mockReturnValue(new Promise(() => {}));
    view.rerender(<StateProbe />);
    await waitFor(() => expect(screen.getByText('loading:none')).toBeVisible());
  });
});

describe('My HR records pages', () => {
  it('loads documents with server paging and shows empty and data errors', async () => {
    const view = renderPage(<MyHrDocumentsPage />);
    await waitFor(() =>
      expect(client.listMyHrDocuments).toHaveBeenCalledWith('org_1', {
        page: 1,
        pageSize: 25,
      }),
    );
    expect(screen.getByText('No records are available.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() =>
      expect(client.listMyHrDocuments).toHaveBeenLastCalledWith('org_1', {
        page: 2,
        pageSize: 25,
      }),
    );
    view.unmount();
    client.listMyHrDocuments.mockRejectedValue(new Error('failed'));
    renderPage(<MyHrDocumentsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'could not be loaded',
    );
  });

  it('filters payslips by month and preserves server paging', async () => {
    renderPage(<MyHrPayslipsPage />);
    await waitFor(() =>
      expect(client.listMyHrPayslips).toHaveBeenCalledWith('org_1', {
        page: 1,
        pageSize: 25,
        fromMonth: undefined,
        toMonth: undefined,
      }),
    );
    fireEvent.change(screen.getByLabelText('Period start'), {
      target: { value: '2026-01' },
    });
    fireEvent.change(screen.getByLabelText('Period end'), {
      target: { value: '2026-02' },
    });
    await waitFor(() =>
      expect(client.listMyHrPayslips).toHaveBeenLastCalledWith('org_1', {
        page: 1,
        pageSize: 25,
        fromMonth: '2026-01',
        toMonth: '2026-02',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() =>
      expect(client.listMyHrPayslips).toHaveBeenLastCalledWith('org_1', {
        page: 2,
        pageSize: 25,
        fromMonth: '2026-01',
        toMonth: '2026-02',
      }),
    );
  });

  it('permits only draft time edits and submissions, with validated forms and success toasts', async () => {
    renderPage(<MyHrTimePage />);
    await screen.findByRole('button', { name: 'Edit' });
    expect(
      screen.queryByRole('button', {
        name: /approve|reject|correct|decide|ledger|balance|absence/i,
      }),
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(client.createMyHrTimesheet).not.toHaveBeenCalled();
    fireEvent.change(document.getElementById('my-hr-period-start')!, {
      target: { value: '2026-01-01' },
    });
    fireEvent.change(document.getElementById('my-hr-period-end')!, {
      target: { value: '2026-01-31' },
    });
    fireEvent.change(screen.getByLabelText('Date'), {
      target: { value: '2026-01-02' },
    });
    fireEvent.change(document.getElementById('my-hr-start')!, {
      target: { value: '2026-01-02T09:00' },
    });
    fireEvent.change(document.getElementById('my-hr-end')!, {
      target: { value: '2026-01-02T17:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(client.createMyHrTimesheet).toHaveBeenCalled());
    expect(notify).toHaveBeenCalledWith({
      kind: 'success',
      title: 'Time record saved.',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(client.updateMyHrTimesheet).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() =>
      expect(client.submitMyHrTimesheet).toHaveBeenCalledWith('org_1', otherId),
    );
    expect(notify).toHaveBeenCalledWith({
      kind: 'success',
      title: 'Time record submitted.',
    });
  });

  it('hides time actions outside draft and keeps create disabled without a profile', async () => {
    client.listMyHrTimesheets.mockResolvedValue({
      items: [{ ...timesheet, status: 'submitted' }],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    client.getMyHrProfile.mockResolvedValue({ ...profile, relationships: [] });
    renderPage(<MyHrTimePage />);
    await screen.findByText('submitted');
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull();
  });

  it('permits leave create and cancellation only when options and status allow it', async () => {
    client.listMyHrLeaveRequests.mockResolvedValue({
      items: [
        {
          id: otherId,
          startsOn: '2026-01-01',
          endsOn: '2026-01-03',
          requestedAmount: '3',
          status: 'requested',
        },
        {
          id,
          startsOn: '2026-02-01',
          endsOn: '2026-02-01',
          requestedAmount: '1',
          status: 'cancelled',
        },
      ],
      page: 1,
      pageSize: 25,
      total: 2,
    });
    renderPage(<MyHrLeavePage />);
    await screen.findByRole('button', { name: 'Cancel request' });
    expect(
      screen.queryAllByRole('button', { name: 'Cancel request' }),
    ).toHaveLength(1);
    expect(
      screen.queryByRole('button', {
        name: /approve|reject|correct|decide|ledger|balance|absence/i,
      }),
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(client.createMyHrLeaveRequest).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Period start'), {
      target: { value: '2026-01-01' },
    });
    fireEvent.change(screen.getByLabelText('Period end'), {
      target: { value: '2026-01-03' },
    });
    fireEvent.change(screen.getByLabelText('Leave'), {
      target: { value: '3' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(client.createMyHrLeaveRequest).toHaveBeenCalled(),
    );
    expect(notify).toHaveBeenCalledWith({
      kind: 'success',
      title: 'Leave request saved.',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
    await waitFor(() =>
      expect(client.cancelMyHrLeaveRequest).toHaveBeenCalledWith(
        'org_1',
        otherId,
      ),
    );
    expect(notify).toHaveBeenCalledWith({
      kind: 'success',
      title: 'Leave request cancelled.',
    });
    expect(
      screen.queryByLabelText(/employee|entity|leave type.*id/i),
    ).toBeNull();
  });

  it('keeps leave creation disabled until leave types are ready', async () => {
    client.listMyHrLeaveTypes.mockReturnValue(new Promise(() => {}));
    renderPage(<MyHrLeavePage />);
    await waitFor(() => expect(client.listMyHrLeaveTypes).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  });
});
