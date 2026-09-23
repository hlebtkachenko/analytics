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
const leaveTypeId = '00000000-0000-4000-8000-000000000003';
const leaveRequestId = '00000000-0000-4000-8000-000000000004';
const absenceId = '00000000-0000-4000-8000-000000000005';
const replace = vi.fn();
let query =
  'page=2&pageSize=50&from=2026-01-01&to=2026-01-31&status=requested&leaveTypeId=00000000-0000-4000-8000-000000000003&kind=sickness';
const accessMock = vi.hoisted(() => vi.fn());
const client = vi.hoisted(() => ({
  cancelLeaveRequest: vi.fn(),
  createAbsence: vi.fn(),
  createLeaveLedger: vi.fn(),
  createLeaveRequest: vi.fn(),
  decideLeaveRequest: vi.fn(),
  getLeaveBalances: vi.fn(),
  listAbsences: vi.fn(),
  listLeaveRequests: vi.fn(),
  listLeaveTypes: vi.fn(),
  updateAbsence: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/time/leave',
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(query),
}));
vi.mock('../../../lib/organizations/use-organization-selection', () => ({
  useOrganizationSelection: () => ({ organizationId: 'org_1', state: 'ready' }),
}));
vi.mock('../../../lib/organizations/use-organization-access', () => ({
  useOrganizationAccess: accessMock,
}));
vi.mock('../../../lib/hr-time/client', () => client);
vi.mock('@bap/design-system/react', () => ({
  Button: ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button {...props}>{children}</button>
  ),
  Heading: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  InlineNotification: ({ title }: { title: string }) => <div>{title}</div>,
  Modal: ({
    children,
    open,
    onRequestSubmit,
    primaryButtonText,
  }: {
    children: React.ReactNode;
    open: boolean;
    onRequestSubmit: () => void;
    primaryButtonText: string;
  }) =>
    open ? (
      <div>
        {children}
        <button onClick={onRequestSubmit}>{primaryButtonText}</button>
      </div>
    ) : null,
  Select: ({
    children,
    labelText,
    ...props
  }: React.ComponentProps<'select'> & { labelText: string }) => (
    <label>
      {labelText}
      <select {...props}>{children}</select>
    </label>
  ),
  SelectItem: ({
    text,
    ...props
  }: React.ComponentProps<'option'> & { text: string }) => (
    <option {...props}>{text}</option>
  ),
  Stack: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TextInput: ({
    labelText,
    ...props
  }: React.ComponentProps<'input'> & { labelText: string }) => (
    <label>
      {labelText}
      <input {...props} />
    </label>
  ),
}));
vi.mock('@bap/design-system/blocks', () => ({
  DataGrid: ({
    rows,
    rowActions,
    onPageChange,
    totalItems,
  }: {
    rows: Array<Record<string, string>>;
    rowActions?: (
      row: Record<string, string>,
    ) => Array<{ id: string; label: string; onClick: () => void }>;
    onPageChange?: (page: number, pageSize: number) => void;
    totalItems?: number;
  }) => (
    <section data-total={totalItems}>
      {rows.map((row) => (
        <div key={row.id}>
          {row.id}
          {rowActions?.(row).map((action) => (
            <button key={action.id} onClick={action.onClick}>
              {action.label}
            </button>
          ))}
        </div>
      ))}
      {onPageChange ? (
        <button onClick={() => onPageChange(3, 25)}>page</button>
      ) : null}
    </section>
  ),
}));
vi.mock('../../../components/page-container', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
}));

import { I18nProvider } from '../../../i18n/client-provider';
import { LeaveRecordsPage } from './leave-records-page';

const request = {
  id: leaveRequestId,
  status: 'requested',
  startsOn: '2026-01-10',
  endsOn: '2026-01-11',
  requestedAmount: '2',
};
const absence = {
  id: absenceId,
  relationshipId,
  kind: 'sickness',
  startsOn: '2026-01-10',
  endsOn: null,
  payrollCode: 'SICK',
};

function renderPage() {
  return render(
    <I18nProvider>
      <LeaveRecordsPage employeeId={employeeId} title="Leave" />
    </I18nProvider>,
  );
}

beforeEach(() => {
  replace.mockReset();
  query =
    'page=2&pageSize=50&from=2026-01-01&to=2026-01-31&status=requested&leaveTypeId=00000000-0000-4000-8000-000000000003&kind=sickness';
  accessMock.mockReturnValue({
    access: { capabilities: { readHr: true, manageHr: true } },
    state: 'ready',
  });
  Object.values(client).forEach((mock) => mock.mockReset());
  client.listLeaveRequests.mockResolvedValue({
    items: [request],
    page: 2,
    pageSize: 50,
    total: 71,
  });
  client.listAbsences.mockResolvedValue({
    items: [absence],
    page: 2,
    pageSize: 50,
    total: 51,
  });
  client.getLeaveBalances.mockResolvedValue({ items: [] });
  client.listLeaveTypes.mockResolvedValue({
    items: [{ id: leaveTypeId, name: 'Annual leave' }],
  });
  client.createLeaveRequest.mockResolvedValue({});
  client.createAbsence.mockResolvedValue({});
  client.updateAbsence.mockResolvedValue({});
  client.createLeaveLedger.mockResolvedValue({});
  client.decideLeaveRequest.mockResolvedValue({});
  client.cancelLeaveRequest.mockResolvedValue({});
});

afterEach(cleanup);

describe('LeaveRecordsPage', () => {
  it('hides every mutation control without manageHr', async () => {
    accessMock.mockReturnValue({
      access: { capabilities: { readHr: true, manageHr: false } },
      state: 'ready',
    });
    renderPage();
    await screen.findByText(leaveRequestId);
    expect(screen.queryByRole('button', { name: 'Create' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Leave ledger' })).toBeNull();
  });

  it('passes URL filters and paging to both lists, preserves totals, and updates query paging', async () => {
    renderPage();
    await waitFor(() => expect(client.listLeaveRequests).toHaveBeenCalled());
    expect(client.listLeaveRequests).toHaveBeenCalledWith('org_1', employeeId, {
      page: 2,
      pageSize: 50,
      from: '2026-01-01',
      to: '2026-01-31',
      status: 'requested',
      leaveTypeId,
    });
    expect(client.listAbsences).toHaveBeenCalledWith('org_1', employeeId, {
      page: 2,
      pageSize: 50,
      from: '2026-01-01',
      to: '2026-01-31',
      kind: 'sickness',
    });
    expect(
      screen.getAllByText(leaveRequestId)[0]!.closest('section'),
    ).toHaveAttribute('data-total', '71');
    expect(screen.getByText(absenceId).closest('section')).toHaveAttribute(
      'data-total',
      '51',
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'page' })[0]!);
    expect(replace).toHaveBeenCalledWith(
      '/time/leave?page=3&pageSize=25&from=2026-01-01&to=2026-01-31&status=requested&leaveTypeId=00000000-0000-4000-8000-000000000003&kind=sickness',
    );
  });

  it('submits leave and required rejection inputs', async () => {
    renderPage();
    await screen.findAllByRole('button', { name: 'Create' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Create' })[0]!);
    fireEvent.change(document.querySelector('#leave-relationship')!, {
      target: { value: relationshipId },
    });
    fireEvent.change(document.querySelector('#leave-type')!, {
      target: { value: leaveTypeId },
    });
    fireEvent.change(document.querySelector('#leave-start')!, {
      target: { value: '2026-01-10' },
    });
    fireEvent.change(document.querySelector('#leave-end')!, {
      target: { value: '2026-01-11' },
    });
    fireEvent.change(document.querySelector('#leave-amount')!, {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(client.createLeaveRequest).toHaveBeenCalledWith(
        'org_1',
        employeeId,
        {
          relationshipId,
          leaveTypeId,
          startsOn: '2026-01-10',
          endsOn: '2026-01-11',
          requestedAmount: '2',
        },
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(client.decideLeaveRequest).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Insufficient balance' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(client.decideLeaveRequest).toHaveBeenCalledWith(
        'org_1',
        employeeId,
        leaveRequestId,
        { decision: 'rejected', reason: 'Insufficient balance' },
      ),
    );
  });

  it('creates and edits absences and posts a manual opening ledger entry', async () => {
    renderPage();
    await screen.findAllByRole('button', { name: 'Create' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Create' })[1]!);
    fireEvent.change(document.querySelector('#absence-relationship')!, {
      target: { value: relationshipId },
    });
    fireEvent.change(document.querySelector('#absence-kind')!, {
      target: { value: 'care' },
    });
    fireEvent.change(document.querySelector('#absence-start')!, {
      target: { value: '2026-02-01' },
    });
    fireEvent.change(document.querySelector('#absence-payroll-code')!, {
      target: { value: 'CARE' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(client.createAbsence).toHaveBeenCalledWith('org_1', employeeId, {
        relationshipId,
        kind: 'care',
        startsOn: '2026-02-01',
        endsOn: null,
        payrollCode: 'CARE',
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(document.querySelector('#absence-payroll-code')!, {
      target: { value: 'UPDATED' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(client.updateAbsence).toHaveBeenCalledWith(
        'org_1',
        employeeId,
        absenceId,
        expect.objectContaining({ payrollCode: 'UPDATED' }),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Leave ledger' }));
    fireEvent.change(document.querySelector('#ledger-relationship')!, {
      target: { value: relationshipId },
    });
    fireEvent.change(document.querySelector('#ledger-type')!, {
      target: { value: leaveTypeId },
    });
    fireEvent.change(document.querySelector('#ledger-source')!, {
      target: { value: 'opening' },
    });
    fireEvent.change(document.querySelector('#ledger-amount')!, {
      target: { value: '8' },
    });
    fireEvent.change(document.querySelector('#ledger-date')!, {
      target: { value: '2026-01-01' },
    });
    fireEvent.change(document.querySelector('#ledger-reason')!, {
      target: { value: 'Opening allocation' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(client.createLeaveLedger).toHaveBeenCalledWith(
        'org_1',
        employeeId,
        {
          relationshipId,
          leaveTypeId,
          effectiveOn: '2026-01-01',
          amount: '8',
          source: 'opening',
          reason: 'Opening allocation',
        },
      ),
    );
  });

  it('keeps a failed mutation modal open with an inline error', async () => {
    client.createLeaveRequest.mockRejectedValueOnce(new Error('failed'));
    renderPage();
    await screen.findAllByRole('button', { name: 'Create' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Create' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Time records could not be loaded.'),
    ).toBeVisible();
    expect(document.querySelector('#leave-relationship')).not.toBeNull();
  });
});
