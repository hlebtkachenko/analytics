import { describe, expect, it } from 'vitest';

import {
  isValidPayrollImportInput,
  payrollImportConsumePath,
  payrollImportPath,
  payrollImportsPath,
  employeePayrollResultsPath,
} from './client';

const entityId = '00000000-0000-4000-8000-000000000001';

describe('payroll import client', () => {
  it('builds only the fixed import paths', () => {
    expect(payrollImportsPath('org_1')).toBe(
      '/api/bff/application/organizations/org_1/payroll/imports',
    );
    expect(payrollImportPath('org_1', entityId)).toBe(
      '/api/bff/application/organizations/org_1/payroll/imports/00000000-0000-4000-8000-000000000001',
    );
    expect(payrollImportConsumePath('org_1', entityId)).toMatch(
      '/imports/00000000-0000-4000-8000-000000000001/consume',
    );
  });

  it('builds the fixed employee payroll history path', () => {
    expect(
      employeePayrollResultsPath(
        'org_1',
        entityId,
        new URLSearchParams({ page: '2' }),
      ),
    ).toBe(
      `/api/bff/application/organizations/org_1/employees/${entityId}/payroll-results?page=2`,
    );
  });

  it('enforces file type, 5 MB limit, and first-day payroll month before upload', () => {
    expect(
      isValidPayrollImportInput(
        new File(['x'], 'import.csv'),
        entityId,
        '2026-09-01',
      ),
    ).toBe(true);
    expect(
      isValidPayrollImportInput(
        new File(['x'], 'import.txt'),
        entityId,
        '2026-09-01',
      ),
    ).toBe(false);
    expect(
      isValidPayrollImportInput(
        new File([new Uint8Array(5_000_001)], 'import.xlsx'),
        entityId,
        '2026-09-01',
      ),
    ).toBe(false);
    expect(
      isValidPayrollImportInput(
        new File(['x'], 'import.csv'),
        entityId,
        '2026-09-02',
      ),
    ).toBe(false);
  });
});
