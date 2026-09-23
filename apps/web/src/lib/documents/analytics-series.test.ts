import { describe, expect, it } from 'vitest';

import {
  amountUnit,
  monthTotalsSeries,
  partnerSeries,
  tooltipValue,
  vatBalanceSeries,
} from './analytics-series.ts';

const months = [
  {
    expense: '0.0000',
    month: '2026-01-01',
    revenue: '0.0000',
    vatBalance: '0.0000',
  },
  {
    expense: '1500.5000',
    month: '2026-02-01',
    revenue: '0.0000',
    vatBalance: '-315.1050',
  },
];

describe('monthTotalsSeries', () => {
  it('keeps both series in every month, zero included, in revenue then expense order', () => {
    const series = monthTotalsSeries(
      months,
      { expense: 'Expenses', revenue: 'Revenue' },
      'en',
    );

    expect(series.data).toEqual([
      { group: 'Revenue', key: '2026-01-01', value: 0 },
      { group: 'Expenses', key: '2026-01-01', value: 0 },
      { group: 'Revenue', key: '2026-02-01', value: 0 },
      { group: 'Expenses', key: '2026-02-01', value: 1500.5 },
    ]);
    expect(series.empty).toBe(false);
  });

  it('writes table rows with the UI month and Czech money, one per month of the window', () => {
    const series = monthTotalsSeries(
      months,
      { expense: 'Expenses', revenue: 'Revenue' },
      'en',
    );

    expect(series.rows).toHaveLength(2);
    expect(series.rows[1]).toEqual({
      id: '2026-02-01',
      values: {
        expense: expect.stringMatching(/^1[\s ]500,50$/),
        month: 'February 2026',
        revenue: '0,00',
      },
    });
  });

  it('reads an all-zero or missing window as empty', () => {
    const groups = { expense: 'Expenses', revenue: 'Revenue' };

    expect(monthTotalsSeries(months.slice(0, 1), groups, 'en').empty).toBe(
      true,
    );
    expect(monthTotalsSeries([], groups, 'en').empty).toBe(true);
  });
});

describe('vatBalanceSeries', () => {
  it('draws a reclaim month below zero and keeps the signed amount in the table', () => {
    const series = vatBalanceSeries(months, 'VAT balance', 'en');

    expect(series.data).toEqual([
      { group: 'VAT balance', key: '2026-01-01', value: 0 },
      { group: 'VAT balance', key: '2026-02-01', value: -315.105 },
    ]);
    expect(series.rows[1]?.values).toEqual({
      month: 'February 2026',
      vatBalance: expect.stringMatching(/^-315,11$/),
    });
    expect(series.empty).toBe(false);
    expect(vatBalanceSeries(months.slice(0, 1), 'VAT', 'en').empty).toBe(true);
  });
});

describe('partnerSeries', () => {
  const groups = { issued: 'Issued', received: 'Received' };

  it('gives a shared name a unique chart key and keeps the plain name in the table', () => {
    const series = partnerSeries(
      [
        {
          issued: '1209.7000',
          partnerId: '00000000-0000-4000-8000-000000000001',
          partnerName: 'Placeholder Partner',
          received: '0.0000',
        },
        {
          issued: '0.0000',
          partnerId: '00000000-0000-4000-8000-000000000002',
          partnerName: 'Placeholder Partner',
          received: '100.0000',
        },
      ],
      groups,
    );

    expect(series.data).toEqual([
      { group: 'Issued', key: 'Placeholder Partner (2)', value: 0 },
      { group: 'Received', key: 'Placeholder Partner (2)', value: 100 },
      { group: 'Issued', key: 'Placeholder Partner', value: 1209.7 },
      { group: 'Received', key: 'Placeholder Partner', value: 0 },
    ]);
    expect(series.rows.map((row) => row.values.partner)).toEqual([
      'Placeholder Partner',
      'Placeholder Partner',
    ]);
    expect(series.rows[0]?.values.issued).toMatch(/^1[\s ]209,70$/);
  });

  it('draws the largest partner at the top: last key in data order, Issued before Received in every partner', () => {
    const series = partnerSeries(
      ['Largest', 'Middle', 'Smallest'].map((partnerName, index) => ({
        issued: '10.0000',
        partnerId: `00000000-0000-4000-8000-00000000000${index + 1}`,
        partnerName,
        received: '5.0000',
      })),
      groups,
    );

    expect(series.data.map((datum) => datum.key).at(-1)).toBe('Largest');
    expect([...new Set(series.data.map((datum) => datum.key))]).toEqual([
      'Smallest',
      'Middle',
      'Largest',
    ]);
    expect(series.data.map((datum) => datum.group).slice(0, 2)).toEqual([
      'Issued',
      'Received',
    ]);
    expect(series.rows.map((row) => row.values.partner)).toEqual([
      'Largest',
      'Middle',
      'Smallest',
    ]);
  });

  it('is empty only when no partner is in scope', () => {
    expect(partnerSeries([], groups).empty).toBe(true);
  });
});

describe('tooltipValue', () => {
  it('escapes a partner name so Carbon renders it as text', () => {
    const value = tooltipValue('<a href=x>y</a>', 'en');

    expect(value).toContain('&lt;a');
    expect(value).toBe('&lt;a href=x&gt;y&lt;/a&gt;');
    expect(tooltipValue(`Tom & "Jerry's"`, 'en')).toBe(
      'Tom &amp; &quot;Jerry&#39;s&quot;',
    );
  });

  it('writes a number as Czech money and a month key as the UI month', () => {
    expect(tooltipValue(1500.5, 'en')).toMatch(/^1[\s ]500,50$/);
    expect(tooltipValue('2026-02-01', 'en')).toBe('February 2026');
  });
});

describe('amountUnit', () => {
  it('names the unit only for a single currency', () => {
    expect(amountUnit(['CZK'])).toBe('CZK');
    expect(amountUnit(['CZK', 'EUR'])).toBeUndefined();
    expect(amountUnit([])).toBeUndefined();
  });
});
