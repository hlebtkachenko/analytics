import { describe, expect, it } from 'vitest';

import {
  createPayrollRunSchema,
  payrollImportResponseSchema,
  payrollLiabilitiesSchema,
  employeePayrollResultListSchema,
  payrollRunSchema,
} from './contract';

const importId = '00000000-0000-4000-8000-000000000001';

describe('payroll import contract', () => {
  it('accepts identifier-only validation errors', () => {
    expect(
      payrollImportResponseSchema.parse({
        payrollImport: {
          createdAt: '2026-09-01T00:00:00.000Z',
          errorCount: 1,
          errorReport: [{ row: 2, field: 'grossPay', code: 'invalid_amount' }],
          format: 'csv',
          id: importId,
          legalEntityId: importId,
          payrollMonth: '2026-09-01',
          payrollRunId: null,
          rowCount: 1,
          sourceDocumentId: importId,
          status: 'failed',
        },
      }).payrollImport.errorReport[0],
    ).toEqual({ row: 2, field: 'grossPay', code: 'invalid_amount' });
  });

  it('rejects a validation error that carries a submitted value', () => {
    expect(() =>
      payrollImportResponseSchema.parse({
        payrollImport: {
          createdAt: '2026-09-01T00:00:00.000Z',
          errorCount: 1,
          errorReport: [
            {
              row: 2,
              field: 'grossPay',
              code: 'invalid_amount',
              value: '1000',
            },
          ],
          format: 'csv',
          id: importId,
          legalEntityId: importId,
          payrollMonth: '2026-09-01',
          payrollRunId: null,
          rowCount: 1,
          sourceDocumentId: importId,
          status: 'failed',
        },
      }),
    ).toThrow();
  });
});

describe('payroll run contract', () => {
  const run = {
    id: importId,
    legalEntityId: importId,
    documentId: null,
    month: '2026-09',
    version: 1,
    supersedesPayrollRunId: null,
    status: 'draft',
    origin: 'calculated',
    validationSummary: {
      valid: false,
      issues: [{ code: 'missing_results', count: 1 }],
    },
    approvedBy: null,
    approvedAt: null,
    finalizedBy: null,
    finalizedAt: null,
    paidBy: null,
    paidAt: null,
    paymentReference: null,
    ruleSetId: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    results: [],
  };
  it('accepts only the strict payroll-run response', () => {
    expect(payrollRunSchema.parse(run).status).toBe('draft');
    expect(
      payrollRunSchema.safeParse({ ...run, reason: 'private' }).success,
    ).toBe(false);
  });
  it('rejects client-controlled versions and unknown creation fields', () => {
    expect(
      createPayrollRunSchema.safeParse({
        legalEntityId: importId,
        month: '2026-09',
        results: [],
        version: 1,
      }).success,
    ).toBe(false);
  });
  it('keeps liabilities strict without payment references in errors', () => {
    expect(
      payrollLiabilitiesSchema.safeParse({
        liabilities: [
          {
            kind: 'net_wages',
            creditorReference: null,
            amount: '1',
            dueOn: '2026-09-30',
            status: 'open',
            paidAt: null,
            paymentReference: 'secret',
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('employee payroll history contract', () => {
  it('fails closed when an item drifts from the exact response shape', () => {
    const result = {
      payrollRunId: importId,
      legalEntityId: importId,
      month: '2026-09',
      version: 1,
      supersedesPayrollRunId: null,
      status: 'finalized',
      origin: 'calculated',
      grossPay: '1000',
      employeeSocial: '65',
      employeeHealth: '45',
      incomeTax: '100',
      otherDeductions: '0',
      netPay: '790',
      employerSocial: '248',
      employerHealth: '90',
      totalEmployerCost: '1338',
      payslipDocumentId: null,
      finalizedAt: null,
      paidAt: null,
    };
    expect(
      employeePayrollResultListSchema.safeParse({
        payrollResults: [{ ...result, unexpected: true }],
        page: 1,
        pageSize: 25,
        total: 1,
      }).success,
    ).toBe(false);
  });
});
