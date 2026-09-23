/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
            <span>{row.name ?? row.accountCode}</span>
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
vi.mock('../../../../lib/organizations/use-organization-access', () => ({
  useOrganizationAccess: accessMock,
}));
vi.mock('../../../../lib/organizations/use-organization-selection', () => ({
  useOrganizationSelection: organizationMock,
}));
vi.mock('../../../../lib/datasets/client', () => ({
  getJson: vi.fn(),
  organizationPath: (id: string) => `/api/bff/application/organizations/${id}`,
}));
import { getJson } from '../../../../lib/datasets/client';
import { I18nProvider } from '../../../../i18n/client-provider';
import PayrollSettingsPage from './page';

const component = {
  id: '00000000-0000-4000-8000-000000000001',
  legalEntityId: '00000000-0000-4000-8000-000000000002',
  code: 'BASE',
  name: 'Base pay',
  kind: 'earning',
  recurrence: 'recurring',
  accountingKey: 'BASE_PAY',
  active: true,
  createdAt: '2026-09-21T00:00:00.000Z',
  updatedAt: '2026-09-21T00:00:00.000Z',
};
const mapping = {
  id: '00000000-0000-4000-8000-000000000003',
  legalEntityId: component.legalEntityId,
  accountingKey: 'BASE_PAY',
  accountCode: '521000',
  side: 'debit',
  validFrom: '2026-09-01',
  validTo: null,
  createdAt: component.createdAt,
  updatedAt: component.updatedAt,
};
const renderPage = () =>
  render(
    <I18nProvider>
      <PayrollSettingsPage />
    </I18nProvider>,
  );

beforeEach(() => {
  vi.mocked(getJson).mockReset();
  organizationMock.mockReturnValue({ organizationId: 'org_1', slug: 'one' });
  accessMock.mockReturnValue({
    access: { capabilities: { readPayroll: true, managePayroll: true } },
    state: 'idle',
  });
  vi.mocked(getJson).mockImplementation((path: string) =>
    Promise.resolve(
      path.includes('account-mappings')
        ? { mappings: [mapping], page: 1, pageSize: 25, total: 1 }
        : { components: [component], page: 1, pageSize: 25, total: 1 },
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PayrollSettingsPage', () => {
  it('suppresses both grids for access loading, error, and no-read and hides all mutations for read-only payroll access', async () => {
    accessMock.mockReturnValue({ access: undefined, state: 'loading' });
    renderPage();
    expect(
      screen.getByText('HR settings access could not be resolved.'),
    ).toBeVisible();
    expect(getJson).not.toHaveBeenCalled();
    cleanup();
    vi.mocked(getJson).mockClear();
    accessMock.mockReturnValue({ access: undefined, state: 'error' });
    renderPage();
    expect(
      screen.getByText('HR settings access could not be resolved.'),
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
        'This account cannot read HR settings in this organization.',
      ),
    ).toBeVisible();
    expect(getJson).not.toHaveBeenCalled();
    cleanup();
    accessMock.mockReturnValue({
      access: { capabilities: { readPayroll: true, managePayroll: false } },
      state: 'idle',
    });
    renderPage();
    await screen.findByText('Base pay');
    expect(screen.queryByRole('button', { name: 'Create' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Create new effective version' }),
    ).toBeNull();
  });

  it('renders both empty and load-error grids', async () => {
    vi.mocked(getJson).mockImplementation((path: string) =>
      Promise.resolve(
        path.includes('account-mappings')
          ? { mappings: [], page: 1, pageSize: 25, total: 0 }
          : { components: [], page: 1, pageSize: 25, total: 0 },
      ),
    );
    renderPage();
    expect(
      await screen.findAllByText(
        'No payroll configuration matches the current filters.',
      ),
    ).toHaveLength(2);
    cleanup();
    vi.mocked(getJson).mockRejectedValue(new Error('down'));
    renderPage();
    expect(
      await screen.findAllByText('Payroll configuration could not be loaded.'),
    ).toHaveLength(2);
  });

  it('keeps the component form and both grids after a failed mutation, then reloads both after retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 500 }))
        .mockResolvedValueOnce(Response.json(component, { status: 201 })),
    );
    renderPage();
    await screen.findByText('Base pay');
    const initialComponentGets = vi
      .mocked(getJson)
      .mock.calls.filter(([path]) =>
        path.includes('payroll/components'),
      ).length;
    const initialMappingGets = vi
      .mocked(getJson)
      .mock.calls.filter(([path]) => path.includes('account-mappings')).length;
    fireEvent.click(screen.getAllByRole('button', { name: 'Create' })[0]!);
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'New base' },
    });
    fireEvent.change(screen.getByLabelText('Legal entity'), {
      target: { value: component.legalEntityId },
    });
    fireEvent.change(screen.getByLabelText('Code'), {
      target: { value: 'NEW' },
    });
    fireEvent.change(screen.getByLabelText('Details'), {
      target: { value: 'NEW_KEY' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('The reference data could not be saved.'),
    ).toBeVisible();
    expect(screen.getByLabelText('Name')).toHaveValue('New base');
    expect(screen.getByLabelText('Code')).toHaveValue('NEW');
    expect(screen.getAllByTestId('grid')).toHaveLength(2);
    expect(screen.getByText('Base pay')).toBeVisible();
    expect(screen.getByText('521000')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('Legal entity')).toHaveValue('');
    expect(
      screen.queryByText('The reference data could not be saved.'),
    ).toBeNull();
    await waitFor(() => {
      const componentGets = vi
        .mocked(getJson)
        .mock.calls.filter(([path]) =>
          path.includes('payroll/components'),
        ).length;
      const mappingGets = vi
        .mocked(getJson)
        .mock.calls.filter(([path]) =>
          path.includes('account-mappings'),
        ).length;
      expect(componentGets).toBeGreaterThan(initialComponentGets);
      expect(mappingGets).toBeGreaterThan(initialMappingGets);
    });
  });

  it('sends component create and allowed-field edit payloads and mapping create/version payloads', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json(component, { status: 201 }))),
    );
    renderPage();
    await screen.findByText('Base pay');
    fireEvent.click(screen.getAllByRole('button', { name: 'Create' })[0]!);
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'New base' },
    });
    fireEvent.change(screen.getByLabelText('Legal entity'), {
      target: { value: component.legalEntityId },
    });
    fireEvent.change(screen.getByLabelText('Code'), {
      target: { value: 'NEW' },
    });
    fireEvent.change(screen.getByLabelText('Details'), {
      target: { value: 'NEW_KEY' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      '/api/bff/application/organizations/org_1/payroll/components',
    );
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.method).toBe('POST');
    expect(
      JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)),
    ).toEqual({
      legalEntityId: component.legalEntityId,
      code: 'NEW',
      name: 'New base',
      kind: 'earning',
      recurrence: 'recurring',
      accountingKey: 'NEW_KEY',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Renamed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(1),
    );
    expect(vi.mocked(fetch).mock.calls[1]?.[0]).toBe(
      `/api/bff/application/organizations/org_1/payroll/components/${component.id}`,
    );
    expect(vi.mocked(fetch).mock.calls[1]?.[1]?.method).toBe('PATCH');
    expect(
      JSON.parse(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body)),
    ).toEqual({ name: 'Renamed', active: true });
    fireEvent.click(screen.getAllByRole('button', { name: 'Create' })[1]!);
    fireEvent.change(screen.getByLabelText('Legal entity'), {
      target: { value: component.legalEntityId },
    });
    fireEvent.change(screen.getByLabelText('Details'), {
      target: { value: 'BASE_PAY' },
    });
    fireEvent.change(screen.getByLabelText('Code'), {
      target: { value: '521000' },
    });
    fireEvent.change(screen.getByLabelText('Effective from'), {
      target: { value: '2026-10-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(2),
    );
    expect(vi.mocked(fetch).mock.calls[2]?.[0]).toBe(
      '/api/bff/application/organizations/org_1/payroll/account-mappings',
    );
    expect(vi.mocked(fetch).mock.calls[2]?.[1]?.method).toBe('POST');
    expect(
      JSON.parse(String(vi.mocked(fetch).mock.calls[2]?.[1]?.body)),
    ).toEqual({
      legalEntityId: component.legalEntityId,
      accountingKey: 'BASE_PAY',
      accountCode: '521000',
      side: 'debit',
      validFrom: '2026-10-01',
      validTo: null,
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Create new effective version' }),
    );
    fireEvent.change(screen.getByLabelText('Code'), {
      target: { value: '522000' },
    });
    fireEvent.change(screen.getByLabelText('Effective from'), {
      target: { value: '2026-11-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(3),
    );
    expect(vi.mocked(fetch).mock.calls[3]?.[0]).toBe(
      `/api/bff/application/organizations/org_1/payroll/account-mappings/${mapping.id}`,
    );
    expect(vi.mocked(fetch).mock.calls[3]?.[1]?.method).toBe('PATCH');
    expect(
      JSON.parse(String(vi.mocked(fetch).mock.calls[3]?.[1]?.body)),
    ).toEqual({
      accountCode: '522000',
      side: 'debit',
      validFrom: '2026-11-01',
      validTo: null,
    });
  });

  it('loads both grids, gates actions, and hides stale tenant rows while the next tenant loads', async () => {
    const view = renderPage();
    await screen.findByText('Base pay');
    expect(screen.getAllByRole('button', { name: 'Create' })).toHaveLength(2);
    organizationMock.mockReturnValue({ organizationId: 'org_2', slug: 'two' });
    vi.mocked(getJson).mockReturnValue(new Promise(() => {}));
    view.rerender(
      <I18nProvider>
        <PayrollSettingsPage />
      </I18nProvider>,
    );
    expect(screen.queryByText('Base pay')).toBeNull();
    cleanup();
    accessMock.mockReturnValue({
      access: { capabilities: { readPayroll: false, managePayroll: false } },
      state: 'idle',
    });
    renderPage();
    expect(
      await screen.findByText(
        'This account cannot read HR settings in this organization.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Create' })).toBeNull();
  });
});
