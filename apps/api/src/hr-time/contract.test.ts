import { describe, expect, it } from 'vitest';

import {
  createScheduleSchema,
  createTimesheetSchema,
  scheduleListSchema,
  timesheetListSchema,
  updateTimesheetSchema,
  createLeaveLedgerSchema,
  leaveTypeListQuerySchema,
  updateAbsenceSchema,
  createAbsenceSchema,
} from './contract.js';

const id = '11111111-1111-4111-8111-111111111111';
const entry = {
  workDate: '2026-10-25',
  startedAt: '2026-10-25T00:30:00.000Z',
  endedAt: '2026-10-25T02:30:00.000Z',
};

describe('HR time contract', () => {
  it('is strict and applies only documented entry defaults', () => {
    expect(
      createTimesheetSchema.parse({
        relationshipId: id,
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        entries: [entry],
      }).entries[0],
    ).toMatchObject({
      breakMinutes: 0,
      overtimeMinutes: 0,
      nightMinutes: 0,
      holidayMinutes: 0,
      standbyMinutes: 0,
      activityCode: null,
    });
    expect(() =>
      createTimesheetSchema.parse({ ...entry, entries: [entry] }),
    ).toThrow();
    expect(() => updateTimesheetSchema.parse({})).toThrow();
    expect(() =>
      updateTimesheetSchema.parse({ entries: [], extra: true }),
    ).toThrow();
  });

  it('requires positive whole-minute ranges and valid categorized minutes', () => {
    const body = {
      relationshipId: id,
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      entries: [entry],
    };
    expect(() =>
      createTimesheetSchema.parse({
        ...body,
        entries: [{ ...entry, endedAt: entry.startedAt }],
      }),
    ).toThrow();
    expect(() =>
      createTimesheetSchema.parse({
        ...body,
        entries: [{ ...entry, endedAt: '2026-10-25T02:30:30.000Z' }],
      }),
    ).toThrow();
    expect(() =>
      createTimesheetSchema.parse({
        ...body,
        entries: [{ ...entry, breakMinutes: 120 }],
      }),
    ).toThrow();
    expect(() =>
      createTimesheetSchema.parse({
        ...body,
        entries: [{ ...entry, overtimeMinutes: 121 }],
      }),
    ).toThrow();
  });

  it('validates schedule ranges and defaults regular shifts', () => {
    expect(
      createScheduleSchema.parse({
        relationshipId: id,
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        shifts: [{ startsAt: entry.startedAt, endsAt: entry.endedAt }],
      }).shifts[0],
    ).toMatchObject({ breakMinutes: 0, kind: 'regular' });
    expect(() =>
      createScheduleSchema.parse({
        relationshipId: id,
        periodStart: '2026-10-02',
        periodEnd: '2026-10-01',
        shifts: [{ startsAt: entry.startedAt, endsAt: entry.endedAt }],
      }),
    ).toThrow();
    expect(() =>
      createScheduleSchema.parse({
        relationshipId: id,
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        shifts: [{ startsAt: entry.startedAt, endsAt: entry.startedAt }],
      }),
    ).toThrow();
  });

  it('accepts only strict items collection envelopes', () => {
    for (const schema of [scheduleListSchema, timesheetListSchema]) {
      expect(() =>
        schema.parse({ items: [], page: 1, pageSize: 25, total: 0 }),
      ).not.toThrow();
      expect(() =>
        schema.parse({ schedules: [], page: 1, pageSize: 25, total: 0 }),
      ).toThrow();
      expect(() =>
        schema.parse({ timesheets: [], page: 1, pageSize: 25, total: 0 }),
      ).toThrow();
    }
  });

  it('parses leave booleans exactly and keeps numeric(7,2) inputs in range', () => {
    expect(leaveTypeListQuerySchema.parse({ active: 'true' }).active).toBe(
      true,
    );
    expect(() => leaveTypeListQuerySchema.parse({ active: 'yes' })).toThrow();
    const ledger = {
      leaveTypeId: id,
      relationshipId: id,
      effectiveOn: '2026-10-01',
      amount: '99999.99',
      source: 'opening',
      reason: 'opening',
    };
    expect(() => createLeaveLedgerSchema.parse(ledger)).not.toThrow();
    expect(() =>
      createLeaveLedgerSchema.parse({ ...ledger, amount: '100000.00' }),
    ).toThrow();
  });

  it('does not apply create defaults to absence patches', () => {
    expect(updateAbsenceSchema.parse({ payrollCode: 'SICK' })).toEqual({
      payrollCode: 'SICK',
    });
    expect(updateAbsenceSchema.parse({ documentId: null })).toEqual({
      documentId: null,
    });
    expect(() =>
      createAbsenceSchema.parse({
        relationshipId: id,
        kind: 'sickness',
        startsOn: '2026-10-01',
        payrollCode: 'SICK',
        diagnosis: 'private',
      }),
    ).toThrow();
  });
});
