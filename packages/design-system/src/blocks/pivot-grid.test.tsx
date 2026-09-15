import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { GridRow, PivotConfig } from './types';
import { aggregatePivot, PivotGrid } from './pivot-grid';

afterEach(() => {
  cleanup();
});

// East/retail has two rows so sum, count, and avg diverge in a checkable way.
const rows: readonly GridRow[] = [
  { id: 'r1', region: 'east', channel: 'retail', amount: 10 },
  { id: 'r2', region: 'east', channel: 'retail', amount: 30 },
  { id: 'r3', region: 'east', channel: 'online', amount: 5 },
  { id: 'r4', region: 'west', channel: 'retail', amount: 20 },
];

const baseConfig: PivotConfig = {
  rowDimension: 'region',
  columnDimension: 'channel',
  measure: 'amount',
};

describe('aggregatePivot', () => {
  it('sums the measure per cell, row, column, and grand total', () => {
    const matrix = aggregatePivot(rows, { ...baseConfig, aggregation: 'sum' });

    expect(matrix.cell('east', 'retail')).toBe(40);
    expect(matrix.rowTotal('east')).toBe(45);
    expect(matrix.columnTotal('retail')).toBe(60);
    expect(matrix.grandTotal).toBe(65);
  });

  it('counts matching rows per cell, row, column, and grand total', () => {
    const matrix = aggregatePivot(rows, {
      ...baseConfig,
      aggregation: 'count',
    });

    expect(matrix.cell('east', 'retail')).toBe(2);
    expect(matrix.rowTotal('east')).toBe(3);
    expect(matrix.columnTotal('retail')).toBe(3);
    expect(matrix.grandTotal).toBe(4);
  });

  it('averages the measure per cell, row, column, and grand total', () => {
    const matrix = aggregatePivot(rows, { ...baseConfig, aggregation: 'avg' });

    expect(matrix.cell('east', 'retail')).toBe(20);
    expect(matrix.rowTotal('east')).toBe(15);
    expect(matrix.columnTotal('retail')).toBe(20);
    expect(matrix.grandTotal).toBe(16.25);
  });
});

describe('PivotGrid', () => {
  it('renders the corner header, a column header, and a computed cell', () => {
    render(
      <PivotGrid rows={rows} config={{ ...baseConfig, aggregation: 'sum' }} />,
    );

    expect(screen.getByRole('columnheader', { name: 'region' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'retail' })).toBeVisible();
    expect(screen.getByRole('cell', { name: '40' })).toBeVisible();
  });
});
