import { describe, expect, it } from 'vitest';
import {
  createAbsenceSchema,
  shiftInputSchema,
  timeEntryInputSchema,
  updateAbsenceSchema,
  updateLeaveTypeSchema,
} from './contract';

describe('hr-time browser contract', () => {
  const instant = '2026-01-01T08:00:00.000Z';
  const later = '2026-01-01T09:00:00.000Z';
  it('rejects invalid shift and entry durations and category minutes', () => {
    expect(() =>
      shiftInputSchema.parse({ startsAt: later, endsAt: instant }),
    ).toThrow();
    expect(() =>
      shiftInputSchema.parse({
        startsAt: instant,
        endsAt: later,
        breakMinutes: 60,
      }),
    ).toThrow();
    expect(() =>
      timeEntryInputSchema.parse({
        workDate: '2026-01-01',
        startedAt: instant,
        endedAt: later,
        overtimeMinutes: 61,
      }),
    ).toThrow();
  });
  it('keeps create defaults out of absence patches and permits leave-type active', () => {
    expect(updateAbsenceSchema.parse({ payrollCode: 'SICK' })).toEqual({
      payrollCode: 'SICK',
    });
    expect(
      createAbsenceSchema.parse({
        relationshipId: '00000000-0000-4000-8000-000000000001',
        kind: 'sickness',
        startsOn: '2026-01-01',
        payrollCode: 'SICK',
      }),
    ).toMatchObject({ endsOn: null, documentId: null });
    expect(() =>
      createAbsenceSchema.parse({
        relationshipId: '00000000-0000-4000-8000-000000000001',
        kind: 'sickness',
        startsOn: '2026-01-02',
        endsOn: '2026-01-01',
        payrollCode: 'SICK',
      }),
    ).toThrow();
    expect(updateLeaveTypeSchema.parse({ active: false })).toEqual({
      active: false,
    });
  });
  it('rejects unknown browser fields', () => {
    expect(() =>
      updateAbsenceSchema.parse({ payrollCode: 'SICK', unknown: true }),
    ).toThrow();
  });
});
