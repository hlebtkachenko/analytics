import { describe, expect, it } from 'vitest';

import {
  MAX_PAYROLL_IMPORT_BYTES,
  payrollImportErrorSchema,
  payrollImportJobSchema,
} from './contract.js';

describe('payroll import contract', () => {
  it('limits uploads to five megabytes', () => {
    expect(MAX_PAYROLL_IMPORT_BYTES).toBe(5_000_000);
  });

  it('accepts only identifier-only queue payloads', () => {
    expect(
      payrollImportJobSchema.parse({
        organizationId: 'org',
        payrollImportId: '00000000-0000-4000-8000-000000000001',
        userId: 'subject_1',
      }),
    ).toMatchObject({ organizationId: 'org', userId: 'subject_1' });
    expect(() =>
      payrollImportJobSchema.parse({
        organizationId: 'org',
        payrollImportId: '00000000-0000-4000-8000-000000000001',
        userId: 'subject_1',
        filename: 'leak.csv',
      }),
    ).toThrow();
  });

  it('rejects error payloads that include submitted values', () => {
    expect(() =>
      payrollImportErrorSchema.parse({
        row: 2,
        field: 'grossPay',
        code: 'invalid_amount',
        value: '100',
      }),
    ).toThrow();
  });
});
