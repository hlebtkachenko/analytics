// Turns the analytics read into chart marks and their table rows; Number() is for mark geometry only, tables show the decimal text.
import type { ChartTableRow } from '@bap/design-system/charts';

import { formatMoney, formatMonth } from '../format.ts';
import type { DocumentAnalyticsResponse } from './contract.ts';

type MonthTotal = DocumentAnalyticsResponse['byMonthTotals'][number];
type PartnerTotal = DocumentAnalyticsResponse['byPartner'][number];

export type ChartDatum = Readonly<{
  group: string;
  key: string;
  value: number;
}>;

export type ChartSeries = Readonly<{
  data: readonly ChartDatum[];
  // Every mark is zero or there is nothing to draw, so the page shows a sentence instead of a flat chart.
  empty: boolean;
  rows: readonly ChartTableRow[];
}>;

function isZero(amount: string): boolean {
  return Number(amount) === 0;
}

// Both series are emitted for every month, even at zero, so Carbon never moves Expenses into the Revenue colour slot.
export function monthTotalsSeries(
  months: readonly MonthTotal[],
  groups: Readonly<{ expense: string; revenue: string }>,
  language: string,
): ChartSeries {
  return {
    data: months.flatMap((row) => [
      { group: groups.revenue, key: row.month, value: Number(row.revenue) },
      { group: groups.expense, key: row.month, value: Number(row.expense) },
    ]),
    empty: months.every((row) => isZero(row.revenue) && isZero(row.expense)),
    rows: months.map((row) => ({
      id: row.month,
      values: {
        expense: formatMoney(row.expense),
        month: formatMonth(row.month, language),
        revenue: formatMoney(row.revenue),
      },
    })),
  };
}

export function vatBalanceSeries(
  months: readonly MonthTotal[],
  group: string,
  language: string,
): ChartSeries {
  return {
    data: months.map((row) => ({
      group,
      key: row.month,
      value: Number(row.vatBalance),
    })),
    empty: months.every((row) => isZero(row.vatBalance)),
    rows: months.map((row) => ({
      id: row.month,
      values: {
        month: formatMonth(row.month, language),
        vatBalance: formatMoney(row.vatBalance),
      },
    })),
  };
}

// Two partners may share a name, so each bar gets a unique chart key while the table keeps the plain name.
// A left LABELS axis draws its first key at the bottom, so the bars go in reverse rank to put the largest on top.
export function partnerSeries(
  partners: readonly PartnerTotal[],
  groups: Readonly<{ issued: string; received: string }>,
): ChartSeries {
  const used = new Set<string>();
  const keys = partners.map((row) => {
    let key = row.partnerName;
    for (let counter = 2; used.has(key); counter += 1) {
      key = `${row.partnerName} (${counter})`;
    }
    used.add(key);
    return key;
  });

  return {
    data: partners
      .map((row, index) => [
        { group: groups.issued, key: keys[index]!, value: Number(row.issued) },
        {
          group: groups.received,
          key: keys[index]!,
          value: Number(row.received),
        },
      ])
      .reverse()
      .flat(),
    empty: partners.length === 0,
    rows: partners.map((row) => ({
      id: row.partnerId,
      values: {
        issued: formatMoney(row.issued),
        partner: row.partnerName,
        received: formatMoney(row.received),
      },
    })),
  };
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '"': '&quot;',
  '&': '&amp;',
  "'": '&#39;',
  '<': '&lt;',
  '>': '&gt;',
};

// Carbon writes tooltip values into HTML, so a partner name is escaped to stay text.
export function tooltipValue(value: unknown, language: string): string {
  return typeof value === 'number'
    ? formatMoney(String(value))
    : formatMonth(String(value), language).replace(
        /[&<>"']/g,
        (character) => HTML_ESCAPES[character]!,
      );
}

// Only a single currency can name the unit; none or several leave the axis as a plain amount.
export function amountUnit(
  currencyCodes: readonly string[],
): string | undefined {
  return currencyCodes.length === 1 ? currencyCodes[0] : undefined;
}
