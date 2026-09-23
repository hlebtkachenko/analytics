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
const componentId = '00000000-0000-4000-8000-000000000003';
const relationshipId = '00000000-0000-4000-8000-000000000004';
const accessMock = vi.hoisted(() => vi.fn());
const organizationMock = vi.hoisted(() => vi.fn());

vi.mock('@bap/design-system/blocks', () => ({
  DataGrid: ({ emptyLabel, errorLabel, rowActions, rows, state }: any) => (
    <div data-testid="grid">
      <span>
        {state === 'empty'
          ? emptyLabel
          : state === 'error'
            ? errorLabel
            : state}
      </span>
      {state === 'ready' &&
        rows.map((row: any) => (
          <div key={row.id}>
            <span>{row.amount}</span>
            {rowActions(row).map((action: any) => (
              <button key={action.id} onClick={action.onClick}>
                {action.label}
              </button>
            ))}
          </div>
        ))}
    </div>
  ),
}));

vi.mock('next/navigation', () => ({ useParams: () => ({ employeeId }) }));
vi.mock('../../../../../lib/organizations/use-organization-access', () => ({
  useOrganizationAccess: accessMock,
}));
vi.mock('../../../../../lib/organizations/use-organization-selection', () => ({
  useOrganizationSelection: organizationMock,
}));
vi.mock('../../../../../lib/datasets/client', () => ({
  getJson: vi.fn(),
  organizationPath: (id: string) => `/api/bff/application/organizations/${id}`,
}));
import { getJson } from '../../../../../lib/datasets/client';
import { I18nProvider } from '../../../../../i18n/client-provider';
import CompensationPage from './page';

const item = {
  id: '00000000-0000-4000-8000-000000000005',
  employeeId,
  relationshipId,
  componentDefinitionId: componentId,
  validFrom: '2026-09-01',
  validTo: null,
  amount: '1000',
  currency: 'CZK',
  createdAt: '2026-09-21T00:00:00.000Z',
  updatedAt: '2026-09-21T00:00:00.000Z',
};
const renderPage = () =>
  render(
    <I18nProvider>
      <CompensationPage />
    </I18nProvider>,
  );

beforeEach(() => {
  vi.mocked(getJson).mockReset();
  organizationMock.mockReturnValue({
    organizationId: 'org_1',
    slug: 'selected',
  });
  accessMock.mockReturnValue({
    access: { capabilities: { readPayroll: true, managePayroll: true } },
    state: 'idle',
  });
  vi.mocked(getJson).mockResolvedValue({
    compensationComponents: [item],
    page: 1,
    pageSize: 25,
    total: 1,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(Response.json(item, { status: 201 }))),
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('CompensationPage', () => {
  it('suppresses fetch and grid for access loading, error, and no-read states', async () => {
    accessMock.mockReturnValue({ access: undefined, state: 'loading' });
    renderPage();
    expect(
      screen.getByText('Organization access could not be checked.'),
    ).toBeVisible();
    expect(getJson).not.toHaveBeenCalled();
    expect(screen.queryByTestId('grid')).toBeNull();
    cleanup();
    vi.mocked(getJson).mockClear();
    accessMock.mockReturnValue({ access: undefined, state: 'error' });
    renderPage();
    expect(
      screen.getByText('Organization access could not be checked.'),
    ).toBeVisible();
    expect(getJson).not.toHaveBeenCalled();
    cleanup();
    vi.mocked(getJson).mockClear();
    accessMock.mockReturnValue({
      access: { capabilities: { readPayroll: false, managePayroll: false } },
      state: 'idle',
    });
    renderPage();
    expect(
      await screen.findByText(
        'This account cannot read HR data in this organization.',
      ),
    ).toBeVisible();
    expect(getJson).not.toHaveBeenCalled();
  });

  it('renders load error and empty states and hides mutations for a read-only payroll user', async () => {
    accessMock.mockReturnValue({
      access: { capabilities: { readPayroll: true, managePayroll: false } },
      state: 'idle',
    });
    renderPage();
    await screen.findByText('1000');
    expect(screen.queryByRole('button', { name: 'Create' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Create new effective version' }),
    ).toBeNull();
    cleanup();
    vi.mocked(getJson).mockResolvedValue({
      compensationComponents: [],
      page: 1,
      pageSize: 25,
      total: 0,
    });
    renderPage();
    expect(
      await screen.findByText('No compensation components are recorded.'),
    ).toBeVisible();
    cleanup();
    vi.mocked(getJson).mockRejectedValue(new Error('down'));
    renderPage();
    expect(
      await screen.findByText('Compensation components could not be loaded.'),
    ).toBeVisible();
  });

  it('versions with immutable successor payload and hides stale rows on employee or organization change', async () => {
    const view = renderPage();
    await screen.findByText('1000');
    fireEvent.click(
      screen.getByRole('button', { name: 'Create new effective version' }),
    );
    fireEvent.change(screen.getByLabelText('Effective from'), {
      target: { value: '2026-10-01' },
    });
    fireEvent.change(screen.getByLabelText('Gross pay'), {
      target: { value: '1300' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      `/api/bff/application/organizations/org_1/employees/${employeeId}/compensation-components/${item.id}`,
    );
    expect(
      JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)),
    ).toEqual({
      validFrom: '2026-10-01',
      validTo: null,
      amount: '1300',
      currency: 'CZK',
    });
    organizationMock.mockReturnValue({ organizationId: 'org_2', slug: 'two' });
    vi.mocked(getJson).mockReturnValue(new Promise(() => {}));
    view.rerender(
      <I18nProvider>
        <CompensationPage />
      </I18nProvider>,
    );
    expect(screen.queryByText('1000')).toBeNull();
  });

  it('keeps the create form and grid after a failed mutation, then reloads after retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 500 }))
        .mockResolvedValueOnce(Response.json(item, { status: 201 })),
    );
    renderPage();
    await screen.findByText('1000');
    const initialGetCalls = vi.mocked(getJson).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    fireEvent.change(screen.getByLabelText('Relationship'), {
      target: { value: relationshipId },
    });
    fireEvent.change(screen.getByLabelText('Code'), {
      target: { value: componentId },
    });
    fireEvent.change(screen.getByLabelText('Effective from'), {
      target: { value: '2026-10-01' },
    });
    fireEvent.change(screen.getByLabelText('Gross pay'), {
      target: { value: '1200' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Compensation components could not be loaded.'),
    ).toBeVisible();
    expect(screen.getByLabelText('Relationship')).toHaveValue(relationshipId);
    expect(screen.getByLabelText('Gross pay')).toHaveValue('1200');
    expect(screen.getByText('1000')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('Relationship')).toHaveValue('');
    expect(
      screen.queryByText('Compensation components could not be loaded.'),
    ).toBeNull();
    await waitFor(() =>
      expect(vi.mocked(getJson).mock.calls.length).toBeGreaterThan(
        initialGetCalls,
      ),
    );
  });

  it('gates reads and controls, renders all data states, and sends exact create and immutable successor bodies', async () => {
    renderPage();
    await screen.findByText('1000');
    expect(getJson).toHaveBeenCalledWith(
      `/api/bff/application/organizations/org_1/employees/${employeeId}/compensation-components?page=1&pageSize=25`,
      expect.any(AbortSignal),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    fireEvent.change(screen.getByLabelText('Relationship'), {
      target: { value: relationshipId },
    });
    fireEvent.change(screen.getByLabelText('Code'), {
      target: { value: componentId },
    });
    fireEvent.change(screen.getByLabelText('Effective from'), {
      target: { value: '2026-10-01' },
    });
    fireEvent.change(screen.getByLabelText('Gross pay'), {
      target: { value: '1200' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(
      JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)),
    ).toEqual({
      relationshipId,
      componentDefinitionId: componentId,
      validFrom: '2026-10-01',
      validTo: null,
      amount: '1200',
      currency: 'CZK',
    });

    cleanup();
    vi.mocked(getJson).mockClear();
    accessMock.mockReturnValue({
      access: { capabilities: { readPayroll: false, managePayroll: false } },
      state: 'idle',
    });
    renderPage();
    expect(
      await screen.findByText(
        'This account cannot read HR data in this organization.',
      ),
    ).toBeVisible();
    expect(getJson).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Create' })).toBeNull();
  });
});
