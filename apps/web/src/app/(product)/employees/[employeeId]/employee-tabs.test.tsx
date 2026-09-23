import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const employeeId = 'employee/id';

vi.mock('next/navigation', () => ({
  useParams: () => ({ employeeId }),
}));
vi.mock('../../../../lib/organizations/use-organization-selection', () => ({
  useOrganizationSelection: () => ({
    organizationId: 'org_1',
    slug: 'test org',
  }),
}));

import { I18nProvider } from '../../../../i18n/client-provider';
import { EmployeeTabs } from './employee-tabs';

describe('EmployeeTabs', () => {
  it('uses the exact product hrefs with the selected organization query', () => {
    render(
      <I18nProvider>
        <EmployeeTabs />
      </I18nProvider>,
    );
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'href',
      '/employees/employee%2Fid?organization=test%20org',
    );
    expect(screen.getByRole('link', { name: 'Employment' })).toHaveAttribute(
      'href',
      '/employees/employee%2Fid/employment?organization=test%20org',
    );
    expect(screen.getByRole('link', { name: 'Time' })).toHaveAttribute(
      'href',
      '/employees/employee%2Fid/time?organization=test%20org',
    );
    expect(screen.getByRole('link', { name: 'Leave' })).toHaveAttribute(
      'href',
      '/employees/employee%2Fid/leave?organization=test%20org',
    );
    expect(screen.getByRole('link', { name: 'Compensation' })).toHaveAttribute(
      'href',
      '/employees/employee%2Fid/compensation?organization=test%20org',
    );
    expect(screen.getByRole('link', { name: 'Payroll' })).toHaveAttribute(
      'href',
      '/employees/employee%2Fid/payroll?organization=test%20org',
    );
    expect(screen.getByRole('link', { name: 'Documents' })).toHaveAttribute(
      'href',
      '/employees/employee%2Fid/documents?organization=test%20org',
    );
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(
      [
        'Overview',
        'Employment',
        'Compensation',
        'Time',
        'Leave',
        'Payroll',
        'Documents',
        'Workflows',
      ],
    );
  });
});
