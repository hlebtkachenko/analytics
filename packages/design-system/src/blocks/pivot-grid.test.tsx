import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { GridRow, PivotConfig } from './types';
import { aggregatePivot, PivotGrid } from './pivot-grid';

afterEach(() => {
  cleanup();
});

// East/retail has two rows so sum, count, and avg diverge in a checkable way.
const rows: readonly GridRow[] = [
  { id: 'r1', region: 'east', channel: 'retail', amount: 10, units: 1 },
  { id: 'r2', region: 'east', channel: 'retail', amount: 30, units: 3 },
  { id: 'r3', region: 'east', channel: 'online', amount: 5, units: 2 },
  { id: 'r4', region: 'west', channel: 'retail', amount: 20, units: 4 },
];

const baseConfig: PivotConfig = {
  rowDimension: 'region',
  columnDimension: 'channel',
  measures: [{ key: 'amount', label: 'Amount' }],
};

describe('aggregatePivot', () => {
  it('sums the measure per cell, row, column, and grand total', () => {
    const matrix = aggregatePivot(rows, {
      ...baseConfig,
      measures: [{ key: 'amount', label: 'Amount', aggregation: 'sum' }],
    });

    expect(matrix.cell('east', 'retail', 'amount')).toBe(40);
    expect(matrix.rowTotal('east', 'amount')).toBe(45);
    expect(matrix.columnTotal('retail', 'amount')).toBe(60);
    expect(matrix.grandTotal('amount')).toBe(65);
  });

  it('counts matching rows per cell, row, column, and grand total', () => {
    const matrix = aggregatePivot(rows, {
      ...baseConfig,
      measures: [{ key: 'amount', label: 'Amount', aggregation: 'count' }],
    });

    expect(matrix.cell('east', 'retail', 'amount')).toBe(2);
    expect(matrix.rowTotal('east', 'amount')).toBe(3);
    expect(matrix.columnTotal('retail', 'amount')).toBe(3);
    expect(matrix.grandTotal('amount')).toBe(4);
  });

  it('averages the measure per cell, row, column, and grand total', () => {
    const matrix = aggregatePivot(rows, {
      ...baseConfig,
      measures: [{ key: 'amount', label: 'Amount', aggregation: 'avg' }],
    });

    expect(matrix.cell('east', 'retail', 'amount')).toBe(20);
    expect(matrix.rowTotal('east', 'amount')).toBe(15);
    expect(matrix.columnTotal('retail', 'amount')).toBe(20);
    expect(matrix.grandTotal('amount')).toBe(16.25);
  });
});

describe('PivotGrid', () => {
  it('renders the corner header, a column header, and a computed cell', () => {
    render(
      <PivotGrid
        config={{
          ...baseConfig,
          measures: [{ key: 'amount', label: 'Amount', aggregation: 'sum' }],
        }}
        rows={rows}
      />,
    );

    expect(screen.getByRole('columnheader', { name: 'region' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'retail' })).toBeVisible();
    expect(screen.getByRole('cell', { name: '40' })).toBeVisible();
  });

  it('renders a two-row grouped header when there are multiple measures', () => {
    render(
      <PivotGrid
        config={{
          ...baseConfig,
          measures: [
            { key: 'amount', label: 'Amount', aggregation: 'sum' },
            { key: 'units', label: 'Units', aggregation: 'sum' },
          ],
        }}
        rows={rows}
      />,
    );

    expect(screen.getByRole('columnheader', { name: 'retail' })).toBeVisible();
    expect(
      screen.getAllByRole('columnheader', { name: 'Amount' }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole('columnheader', { name: 'Units' }).length,
    ).toBeGreaterThan(0);
  });
});
