/* eslint-disable @typescript-eslint/no-explicit-any */
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
const timesheetId = '00000000-0000-4000-8000-000000000003';
let query = 'page=2&pageSize=50&from=2026-01-01&to=2026-01-31';
const replace = vi.fn();
const accessMock = vi.hoisted(() => vi.fn());
const client = vi.hoisted(() => ({
  approveTimesheet: vi.fn(),
  correctTimesheet: vi.fn(),
  createSchedule: vi.fn(),
  createTimesheet: vi.fn(),
  listAbsences: vi.fn(),
  listSchedules: vi.fn(),
  listTimesheets: vi.fn(),
  publishSchedule: vi.fn(),
  rejectTimesheet: vi.fn(),
  submitTimesheet: vi.fn(),
  updateTimesheet: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/time/timesheets',
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
  Button: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
  Heading: ({ children }: any) => <h2>{children}</h2>,
  InlineNotification: ({ title }: any) => <div>{title}</div>,
  Modal: ({ open, children, primaryButtonText, onRequestSubmit }: any) =>
    open ? (
      <div>
        {children}
        <button onClick={onRequestSubmit}>{primaryButtonText}</button>
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
  DataGrid: ({ rows, rowActions, onPageChange, totalItems }: any) => (
    <section data-total={totalItems}>
      {rows.map((row: any) => (
        <div key={row.id}>
          {row.id}
          {rowActions?.(row).map((action: any) => (
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
import { TimeRecordsPage } from './time-records-page';

const sheet = {
  id: timesheetId,
  relationshipId,
  periodStart: '2026-01-01',
  periodEnd: '2026-01-31',
  status: 'submitted',
  totalWorkedMinutes: 480,
  entries: [],
  legalEntityId: employeeId,
  employeeId,
  version: 1,
  submittedAt: null,
  approvedBy: null,
  approvedAt: null,
  rejectionReason: null,
  supersedesTimesheetId: null,
  totalBreakMinutes: 0,
  totalOvertimeMinutes: 0,
  totalNightMinutes: 0,
  totalHolidayMinutes: 0,
  totalStandbyMinutes: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const renderPage = (
  mode: 'timesheets' | 'approvals' | 'calendar' = 'timesheets',
) =>
  render(
    <I18nProvider>
      <TimeRecordsPage employeeId={employeeId} title="Time" mode={mode} />
    </I18nProvider>,
  );
beforeEach(() => {
  query = 'page=2&pageSize=50&from=2026-01-01&to=2026-01-31';
  replace.mockReset();
  accessMock.mockReturnValue({
    access: { capabilities: { readHr: true, manageHr: true } },
    state: 'ready',
  });
  Object.values(client).forEach((mock) => mock.mockReset());
  client.listTimesheets.mockResolvedValue({
    items: [sheet],
    page: 2,
    pageSize: 50,
    total: 71,
  });
  client.listSchedules.mockResolvedValue({
    items: [],
    page: 2,
    pageSize: 50,
    total: 51,
  });
  client.listAbsences.mockResolvedValue({
    items: [],
    page: 2,
    pageSize: 50,
    total: 61,
  });
  client.approveTimesheet.mockResolvedValue({});
  client.rejectTimesheet.mockResolvedValue({});
});
afterEach(cleanup);

describe('TimeRecordsPage', () => {
  it('uses only the timesheet endpoint and keeps URL paging totals', async () => {
    renderPage();
    await waitFor(() =>
      expect(client.listTimesheets).toHaveBeenCalledWith('org_1', employeeId, {
        page: 2,
        pageSize: 50,
        from: '2026-01-01',
        to: '2026-01-31',
        status: undefined,
      }),
    );
    expect(client.listSchedules).not.toHaveBeenCalled();
    expect(client.listAbsences).not.toHaveBeenCalled();
    expect(screen.getByText(timesheetId).closest('section')).toHaveAttribute(
      'data-total',
      '71',
    );
    fireEvent.click(screen.getByRole('button', { name: 'page' }));
    expect(replace).toHaveBeenCalledWith(
      '/time/timesheets?page=3&pageSize=25&from=2026-01-01&to=2026-01-31',
    );
  });
  it('limits approvals to submitted timesheets and calendar to published schedules and absences', async () => {
    const view = renderPage('approvals');
    await waitFor(() =>
      expect(client.listTimesheets).toHaveBeenCalledWith(
        'org_1',
        employeeId,
        expect.objectContaining({ status: 'submitted' }),
      ),
    );
    expect(client.listSchedules).not.toHaveBeenCalled();
    view.unmount();
    client.listTimesheets.mockClear();
    client.listSchedules.mockClear();
    client.listAbsences.mockClear();
    renderPage('calendar');
    await waitFor(() =>
      expect(client.listSchedules).toHaveBeenCalledWith(
        'org_1',
        employeeId,
        expect.objectContaining({ status: 'published' }),
      ),
    );
    expect(client.listTimesheets).not.toHaveBeenCalled();
    expect(client.listAbsences).toHaveBeenCalled();
  });
  it('hides mutations without manageHr and sends a typed reject reason', async () => {
    accessMock.mockReturnValue({
      access: { capabilities: { readHr: true, manageHr: false } },
      state: 'ready',
    });
    const view = renderPage();
    await screen.findByText(timesheetId);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    view.unmount();
    accessMock.mockReturnValue({
      access: { capabilities: { readHr: true, manageHr: true } },
      state: 'ready',
    });
    renderPage();
    await screen.findByText(timesheetId);
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Missing evidence' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(client.rejectTimesheet).toHaveBeenCalledWith(
        'org_1',
        employeeId,
        timesheetId,
        { reason: 'Missing evidence' },
      ),
    );
  });
});
