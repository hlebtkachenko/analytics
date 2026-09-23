import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/employees',
  useRouter: () => routerMock,
  useSearchParams: () => new URLSearchParams(),
}));

const routerMock = { replace: vi.fn(), push: vi.fn() };
const accessMock = vi.hoisted(() =>
  vi.fn(() => ({
    access: { capabilities: { manageHr: false, readHr: false } },
  })),
);

vi.mock('../../../lib/organizations/use-organization-selection', () => ({
  useOrganizationSelection: () => ({ organizationId: 'org_1', slug: 'test' }),
}));
vi.mock('../../../lib/organizations/use-organization-access', () => ({
  useOrganizationAccess: accessMock,
}));
vi.mock('../../../lib/organizations/use-legal-entities', () => ({
  useLegalEntities: () => [],
}));
vi.mock('../../../lib/datasets/client', () => ({
  getJson: vi.fn(),
  organizationPath: (id: string) => `/api/organizations/${id}`,
}));

import { I18nProvider } from '../../../i18n/client-provider';
import EmployeesPage from './page';
import { getJson } from '../../../lib/datasets/client';

describe('EmployeesPage', () => {
  it('does not fetch or expose creation when HR read capability is absent', () => {
    render(
      <I18nProvider>
        <EmployeesPage />
      </I18nProvider>,
    );
    expect(
      screen.getByText(
        'This account cannot read HR data in this organization.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('New employee')).not.toBeInTheDocument();
  });

  it('uses response total and updates page controls atomically', async () => {
    accessMock.mockReturnValue({
      access: { capabilities: { manageHr: false, readHr: true } },
    });
    vi.mocked(getJson).mockResolvedValue({
      employees: [],
      page: 1,
      pageSize: 25,
      total: 51,
    });
    render(
      <I18nProvider>
        <EmployeesPage />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByText(/51/)).toBeInTheDocument());
    const next = screen.getByRole('button', { name: /next/i });
    fireEvent.click(next);
    expect(routerMock.replace).toHaveBeenCalledWith(
      '/employees?page=2&pageSize=25',
    );
  });
});
