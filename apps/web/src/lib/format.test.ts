import { describe, expect, it } from 'vitest';

import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatMonth,
  isoDay,
} from './format.ts';

describe('formatMonth', () => {
  it('reads a month key as the month name and full year in the UI language', () => {
    expect(formatMonth('2026-06-01', 'en')).toBe('June 2026');
    expect(formatMonth('2026-01-01', 'en')).toBe('January 2026');
  });

  it('reads the stored first day in local time, never a day earlier', () => {
    expect(formatMonth('2026-12-01', 'en')).toBe('December 2026');
  });

  it('returns a value it cannot parse unchanged, so nothing invents a month', () => {
    expect(formatMonth('not-a-date', 'en')).toBe('not-a-date');
  });

  it('shortens the month name for chart ticks, in the same UI language', () => {
    expect(formatMonth('2026-06-01', 'en', 'short')).toBe('Jun 2026');
    expect(formatMonth('not-a-date', 'en', 'short')).toBe('not-a-date');
  });
});

describe('formatDate', () => {
  it('reads a stored calendar day in local time and shows it in Czech', () => {
    expect(formatDate('2026-09-01')).toBe('1. 9. 2026');
    expect(formatDate('2026-01-01')).toBe('1. 1. 2026');
  });

  it('shows the local day of a timestamp and leaves an unparsable value as is', () => {
    expect(formatDate(new Date(2026, 8, 21, 12).toISOString())).toBe(
      '21. 9. 2026',
    );
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
});

describe('formatDateTime', () => {
  it('shows the local day and time of a timestamp', () => {
    expect(formatDateTime(new Date(2026, 8, 21, 14, 5).toISOString())).toBe(
      '21. 9. 2026 14:05',
    );
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
  });
});

describe('formatMoney', () => {
  it('formats in Czech with the currency after the amount', () => {
    expect(formatMoney('1210.5', 'CZK').replace(/\s/g, ' ')).toBe(
      '1 210,50 CZK',
    );
    expect(formatMoney('x')).toBe('x');
  });
});

describe('isoDay', () => {
  it('reads a picked date from its local parts', () => {
    expect(isoDay(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
    expect(isoDay(undefined)).toBe('');
  });
});
