import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const accessMock = vi.hoisted(() =>
  vi.fn<
    () => {
      access:
        { capabilities: { manageHr: boolean; readHr: boolean } } | undefined;
    }
  >(() => ({ access: { capabilities: { manageHr: false, readHr: false } } })),
);
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('../../../../lib/organizations/use-organization-selection', () => ({
  useOrganizationSelection: () => ({ organizationId: 'org_1', slug: 'test' }),
}));
vi.mock('../../../../lib/organizations/use-organization-access', () => ({
  useOrganizationAccess: accessMock,
}));
vi.mock('../../../../lib/organizations/use-legal-entities', () => ({
  useLegalEntities: () => [
    {
      id: '00000000-0000-4000-8000-000000000010',
      name: 'Example entity',
    },
  ],
}));

import { I18nProvider } from '../../../../i18n/client-provider';
import NewEmployeePage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('NewEmployeePage', () => {
  it('denies creation and does not submit without manage HR access', async () => {
    vi.stubGlobal('fetch', fetchMock);
    render(
      <I18nProvider>
        <NewEmployeePage />
      </I18nProvider>,
    );
    expect(
      screen.getByText(
        'This account cannot read HR data in this organization.',
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Create employee' }),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });

  it('keeps the form hidden while access is loading', () => {
    accessMock.mockReturnValue({ access: undefined });
    render(
      <I18nProvider>
        <NewEmployeePage />
      </I18nProvider>,
    );
    expect(screen.getByText(/Loading/)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Create employee' }),
    ).toBeNull();
  });

  it('posts the exact employee create body without status', async () => {
    accessMock.mockReturnValue({
      access: { capabilities: { manageHr: true, readHr: true } },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          id: '00000000-0000-4000-8000-000000000001',
          legalEntityId: '00000000-0000-4000-8000-000000000010',
          employeeNumber: 'EMP-001',
          firstName: 'Ada',
          lastName: 'Lovelace',
          workEmail: null,
          workPhone: null,
          status: 'preboarding',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
      ),
    );
    render(
      <I18nProvider>
        <NewEmployeePage />
      </I18nProvider>,
    );
    expect(screen.queryByLabelText('Status')).toBeNull();
    fireEvent.change(screen.getByLabelText('Legal entity'), {
      target: { value: '00000000-0000-4000-8000-000000000010' },
    });
    fireEvent.change(screen.getByLabelText('Employee number'), {
      target: { value: 'EMP-001' },
    });
    fireEvent.change(screen.getByLabelText('First name'), {
      target: { value: 'Ada' },
    });
    fireEvent.change(screen.getByLabelText('Last name'), {
      target: { value: 'Lovelace' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create employee' }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/bff/application/organizations/org_1/employees',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            legalEntityId: '00000000-0000-4000-8000-000000000010',
            employeeNumber: 'EMP-001',
            firstName: 'Ada',
            lastName: 'Lovelace',
          }),
        }),
      ),
    );
  });
});
