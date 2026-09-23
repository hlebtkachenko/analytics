/* eslint-disable @typescript-eslint/no-explicit-any */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getJson = vi.hoisted(() => vi.fn());
const accessMock = vi.hoisted(() => vi.fn());
const organizationMock = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  usePathname: () => '/time',
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('../../../lib/datasets/client', () => ({
  getJson,
  organizationPath: (id: string) => `/api/${id}`,
}));
vi.mock('../../../lib/hr/client', () => ({
  employeesPath: (id: string) => `/api/${id}/employees`,
  withOrganization: (path: string, slug?: string) =>
    slug ? `${path}?organization=${slug}` : path,
}));
vi.mock('../../../lib/organizations/use-organization-access', () => ({
  useOrganizationAccess: accessMock,
}));
vi.mock('../../../lib/organizations/use-organization-selection', () => ({
  useOrganizationSelection: organizationMock,
}));
vi.mock('./time-records-page', () => ({
  TimeRecordsPage: () => <div>records</div>,
}));
vi.mock('./leave-records-page', () => ({
  LeaveRecordsPage: () => <div>leave records</div>,
}));
vi.mock('@bap/design-system/react', () => ({
  Heading: ({ children }: any) => <h2>{children}</h2>,
  InlineNotification: ({ title }: any) => <div>{title}</div>,
  Stack: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@bap/design-system/blocks', () => ({
  DataGrid: () => <div>grid</div>,
}));
vi.mock('../../../components/page-container', () => ({
  default: ({ children }: any) => <main>{children}</main>,
}));
import { I18nProvider } from '../../../i18n/client-provider';
import { TeamTimePage } from './team-time-page';

beforeEach(() => {
  getJson.mockReset();
  organizationMock.mockReturnValue({
    organizationId: 'org_1',
    slug: 'north',
    state: 'ready',
  });
  accessMock.mockReturnValue({
    access: { capabilities: { readHr: true, manageHr: true } },
    state: 'ready',
  });
});
afterEach(cleanup);
describe('TeamTimePage', () => {
  it('preserves the selected organization in overview links without employee fetches', async () => {
    render(
      <I18nProvider>
        <TeamTimePage mode="overview" title="Time" />
      </I18nProvider>,
    );
    await screen.findByRole('link', { name: 'Timesheets' });
    expect(getJson).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Timesheets' })).toHaveAttribute(
      'href',
      '/time/timesheets?organization=north',
    );
    expect(screen.getByRole('link', { name: 'Calendar' })).toHaveAttribute(
      'href',
      '/time/calendar?organization=north',
    );
  });
  it('blocks access and loads employees only for a non-overview selector', async () => {
    accessMock.mockReturnValue({
      access: { capabilities: { readHr: false, manageHr: false } },
      state: 'ready',
    });
    render(
      <I18nProvider>
        <TeamTimePage mode="timesheets" title="Time" />
      </I18nProvider>,
    );
    expect(
      await screen.findByText(
        'This account cannot read HR time data in this organization.',
      ),
    ).toBeVisible();
    expect(getJson).not.toHaveBeenCalled();
    cleanup();
    getJson.mockResolvedValue({ employees: [] });
    accessMock.mockReturnValue({
      access: { capabilities: { readHr: true, manageHr: false } },
      state: 'ready',
    });
    render(
      <I18nProvider>
        <TeamTimePage mode="timesheets" title="Time" />
      </I18nProvider>,
    );
    await waitFor(() => expect(getJson).toHaveBeenCalled());
  });
});
