import { describe, expect, it } from 'vitest';

import { payrollImportErrorSchema } from './contract.js';

describe('validatePayrollImport', () => {
  it.each([
    'invalid_header',
    'duplicate_employee',
    'employee_not_found',
    'arithmetic_mismatch',
    'component_not_found',
    'row_limit_exceeded',
  ] as const)('keeps %s as a coded, value-free validation error', (code) => {
    expect(
      payrollImportErrorSchema.parse({ row: 2, field: 'employeeNumber', code }),
    ).toEqual({ row: 2, field: 'employeeNumber', code });
  });

  it('caps stored errors independently from observed error count', () => {
    const report = Array.from({ length: 1_000 }, (_, index) =>
      payrollImportErrorSchema.parse({
        row: index + 2,
        field: 'grossPay',
        code: 'invalid_amount',
      }),
    );
    expect(report).toHaveLength(1_000);
  });
});
