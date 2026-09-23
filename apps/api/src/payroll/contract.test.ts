import { describe, expect, it } from 'vitest';

import {
  componentListQuerySchema,
  createCompensationSchema,
  createMappingSchema,
  approvalSchema,
  employeePayrollResultsQuerySchema,
  updateCompensationSchema,
  updateComponentSchema,
  updateMappingSchema,
} from './contract.js';

const id = '11111111-1111-4111-8111-111111111111';
describe('payroll contract', () => {
  it('is strict, bounded and applies permitted defaults', () => {
    expect(componentListQuerySchema.parse({ q: 'code' })).toMatchObject({
      page: 1,
      pageSize: 25,
      q: 'code',
    });
    expect(() =>
      componentListQuerySchema.parse({ q: 'x'.repeat(101) }),
    ).toThrow();
    expect(() => updateComponentSchema.parse({ code: 'immutable' })).toThrow();
    expect(
      createCompensationSchema.parse({
        relationshipId: id,
        componentDefinitionId: id,
        validFrom: '2026-01-01',
        amount: '1',
      }),
    ).toMatchObject({ validTo: null, currency: 'CZK' });
    expect(
      createMappingSchema.parse({
        legalEntityId: id,
        accountingKey: 'wage',
        accountCode: '321',
        side: 'credit',
        validFrom: '2026-01-01',
      }),
    ).toMatchObject({ validTo: null });
    expect(
      updateCompensationSchema.parse({
        validFrom: '2026-02-01',
        amount: '2',
        currency: 'CZK',
      }),
    ).toMatchObject({ validTo: null });
    expect(
      updateMappingSchema.parse({
        validFrom: '2026-02-01',
        accountCode: '322',
        side: 'debit',
      }),
    ).toMatchObject({ validTo: null });
  });
  it('exposes approval actors under the written API field name', () => {
    expect(
      approvalSchema.parse({
        action: 'approved',
        reason: null,
        actor: 'user-1',
        actedAt: '2026-09-21T00:00:00.000Z',
      }),
    ).toMatchObject({ actor: 'user-1' });
    expect(() =>
      approvalSchema.parse({
        action: 'approved',
        reason: null,
        actorUserId: 'user-1',
        actedAt: '2026-09-21T00:00:00.000Z',
      }),
    ).toThrow();
  });
  it('accepts only a valid ordered employee payroll-history range', () => {
    expect(employeePayrollResultsQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 25,
    });
    expect(() =>
      employeePayrollResultsQuerySchema.parse({ fromMonth: '2026-13' }),
    ).toThrow();
    expect(() =>
      employeePayrollResultsQuerySchema.parse({
        fromMonth: '2026-02',
        toMonth: '2026-01',
      }),
    ).toThrow();
    expect(() =>
      employeePayrollResultsQuerySchema.parse({ unexpected: 'value' }),
    ).toThrow();
  });
});
