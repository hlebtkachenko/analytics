import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const access = vi.hoisted(() => vi.fn());
const organizations = vi.hoisted(() => vi.fn());
const getJson = vi.hoisted(() => vi.fn());

vi.mock('../../../../lib/organizations/use-organization-access', () => ({
  useOrganizationAccess: access,
}));
vi.mock('../../../../lib/organizations/use-organization-selection', () => ({
  useOrganizationSelection: organizations,
}));
vi.mock('../../../../lib/datasets/client', () => ({
  getJson,
  organizationPath: (organizationId: string) =>
    `/api/bff/application/organizations/${organizationId}`,
}));
vi.mock('@bap/design-system/blocks', () => ({
  DataGrid: ({
    emptyLabel,
    errorLabel,
    rowActions,
    rows,
    state,
  }: {
    emptyLabel: string;
    errorLabel: string;
    rowActions: (row: {
      id: string;
    }) => { label: string; onClick: () => void }[];
    rows: { id: string; accessRole: string; userId: string }[];
    state: string;
  }) => (
    <div data-state={state}>
      {state === 'loading' && 'Loading grid'}
      {state === 'error' && errorLabel}
      {state === 'empty' && emptyLabel}
      {rows.map((row) => (
        <div key={row.id}>
          {row.userId} {row.accessRole}
          <button onClick={rowActions(row)[0]!.onClick} type="button">
            {rowActions(row)[0]!.label}
          </button>
        </div>
      ))}
    </div>
  ),
}));

import { I18nProvider } from '../../../../i18n/client-provider';
import HrAccessAssignmentsPage from './page';

const entityId = '00000000-0000-4000-8000-000000000010';
const assignmentId = '00000000-0000-4000-8000-000000000011';
const assignment = {
  accessRole: 'payroll_approver',
  createdAt: '2026-09-21T00:00:00.000Z',
  id: assignmentId,
  legalEntityId: entityId,
  userId: 'member_1',
};

function owner(organizationId = 'org_1') {
  organizations.mockReturnValue({
    organizationId,
    slug: 'placeholder',
    state: 'idle',
  });
  access.mockReturnValue({
    access: { role: 'owner', capabilities: { manageOrganization: true } },
    state: 'idle',
  });
}

function renderPage() {
  return render(
    <I18nProvider>
      <HrAccessAssignmentsPage />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  getJson.mockReset();
  access.mockReset();
  organizations.mockReset();
  vi.unstubAllGlobals();
});

describe('HrAccessAssignmentsPage', () => {
  it('shows loading, access failure, and owner-only forbidden states without an assignment request', () => {
    organizations.mockReturnValue({
      organizationId: 'org_1',
      slug: 'placeholder',
      state: 'idle',
    });
    access.mockReturnValue({ access: undefined, state: 'loading' });
    const view = renderPage();
    expect(screen.getByText('Loading access assignments.')).toBeVisible();
    expect(getJson).not.toHaveBeenCalled();
    view.unmount();

    access.mockReturnValue({ access: undefined, state: 'error' });
    renderPage();
    expect(
      screen.getByText('HR settings access could not be resolved.'),
    ).toBeVisible();
    expect(getJson).not.toHaveBeenCalled();
    cleanup();

    access.mockReturnValue({ access: { role: 'admin' }, state: 'idle' });
    renderPage();
    expect(
      screen.getByText(
        'Only organization owners can manage HR access assignments.',
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Create assignment' }),
    ).not.toBeInTheDocument();
    expect(getJson).not.toHaveBeenCalled();
  });

  it('shows owner loading, empty, load-error, and translated success states', async () => {
    owner();
    getJson.mockResolvedValueOnce({ assignments: [] });
    renderPage();
    expect(screen.getByText('Loading grid')).toBeVisible();
    expect(
      await screen.findByText('No HR access assignments exist.'),
    ).toBeVisible();
    cleanup();

    owner();
    getJson.mockRejectedValueOnce(new Error('unavailable'));
    renderPage();
    expect(
      await screen.findByText('Access assignments could not be loaded.'),
    ).toBeVisible();
    cleanup();

    owner();
    getJson.mockResolvedValueOnce({ assignments: [assignment] });
    renderPage();
    expect(await screen.findByText('Payroll approver')).toBeVisible();
  });

  it('posts the exact validated payload and refreshes after success', async () => {
    owner();
    getJson
      .mockResolvedValueOnce({ assignments: [] })
      .mockResolvedValueOnce({ assignments: [assignment] });
    const fetchMock = vi.fn(async () =>
      Response.json(assignment, { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await screen.findByText('No HR access assignments exist.');
    fireEvent.change(screen.getByLabelText('User ID'), {
      target: { value: 'member_1' },
    });
    fireEvent.change(screen.getByLabelText('Legal entity'), {
      target: { value: entityId },
    });
    fireEvent.change(screen.getByLabelText('Access role'), {
      target: { value: 'payroll_approver' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create assignment' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/bff/application/organizations/org_1/hr/access-assignments',
      expect.objectContaining({
        body: JSON.stringify({
          accessRole: 'payroll_approver',
          legalEntityId: entityId,
          userId: 'member_1',
        }),
        method: 'POST',
      }),
    );
    expect(await screen.findByText('Payroll approver')).toBeVisible();
  });

  it('preserves the form and list after mutation failures, then refreshes after revoke success', async () => {
    owner();
    getJson
      .mockResolvedValueOnce({ assignments: [assignment] })
      .mockResolvedValueOnce({ assignments: [] });
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) =>
      init?.method === 'DELETE'
        ? fetchMock.mock.calls.filter(([, call]) => call?.method === 'DELETE')
            .length === 1
          ? Response.json({}, { status: 400 })
          : Response.json({ revoked: true })
        : Response.json({}, { status: 400 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await screen.findByRole('button', { name: 'Revoke' });
    fireEvent.change(screen.getByLabelText('User ID'), {
      target: { value: 'member_2' },
    });
    fireEvent.change(screen.getByLabelText('Legal entity'), {
      target: { value: entityId },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create assignment' }));
    expect(
      await screen.findByText('Access assignment could not be created.'),
    ).toBeVisible();
    expect(screen.getByDisplayValue('member_2')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `/api/bff/application/organizations/org_1/hr/access-assignments/${assignmentId}`,
    );
    expect(
      await screen.findByText('Access assignment could not be revoked.'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(
      await screen.findByText('No HR access assignments exist.'),
    ).toBeVisible();
  });

  it('clears a previous tenant list before loading the new tenant', async () => {
    owner('org_1');
    getJson.mockResolvedValueOnce({ assignments: [assignment] });
    const view = renderPage();
    expect(await screen.findByRole('button', { name: 'Revoke' })).toBeVisible();
    owner('org_2');
    getJson.mockReturnValueOnce(new Promise(() => {}));
    view.rerender(
      <I18nProvider>
        <HrAccessAssignmentsPage />
      </I18nProvider>,
    );
    await waitFor(() => expect(getJson).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole('button', { name: 'Revoke' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Loading grid')).toBeVisible();
  });
});
