import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { DatasetColumn, DatasetRow } from '../../lib/datasets/client';
import { I18nProvider } from '../../i18n/client-provider';
import { DatasetChart } from './dataset-chart';

afterEach(() => {
  cleanup();
});

const columns = [
  { inferredType: 'text', name: 'label', position: 0 },
  { inferredType: 'number', name: 'value', position: 1 },
];

const textOnlyColumns = [{ inferredType: 'text', name: 'label', position: 0 }];

const rows = [
  { data: { label: 'first', value: 1 }, rowNumber: 1 },
  { data: { label: 'second', value: 3 }, rowNumber: 2 },
];

// Typed from the client contract, not from one fixture, so a string cell is representable here.
function renderChart(
  chartColumns: readonly DatasetColumn[],
  chartRows: readonly DatasetRow[],
) {
  return render(
    <I18nProvider>
      <DatasetChart columns={chartColumns} rows={chartRows} />
    </I18nProvider>,
  );
}

describe('DatasetChart', () => {
  it('draws the first numeric column with a table alternative', () => {
    renderChart(columns, rows);

    expect(
      screen.getByRole('img', {
        name: 'Bar chart of the first numeric column.',
      }),
    ).toBeVisible();
    const table = screen.getByRole('table', { name: 'Charted values' });
    expect(table).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'label' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'value' })).toBeVisible();
    expect(screen.getByRole('cell', { name: 'first' })).toBeVisible();
    expect(screen.getByRole('cell', { name: 'second' })).toBeVisible();
  });

  it('charts a CSV column whose cells arrive as text', () => {
    // The CSV parser stores every cell as a string, so this is the shape an upload really produces.
    renderChart(columns, [
      { data: { label: 'first', value: '10' }, rowNumber: 1 },
      { data: { label: 'second', value: ' 30 ' }, rowNumber: 2 },
      { data: { label: 'third', value: 'not a number' }, rowNumber: 3 },
      { data: { label: 'fourth', value: '' }, rowNumber: 4 },
    ]);

    expect(
      screen.getByRole('img', {
        name: 'Bar chart of the first numeric column.',
      }),
    ).toBeVisible();
    const table = screen.getByRole('table', { name: 'Charted values' });
    // Two parseable cells are charted; the unparseable and the empty one are dropped.
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(screen.getByRole('cell', { name: '10' })).toBeVisible();
    expect(screen.getByRole('cell', { name: '30' })).toBeVisible();
  });

  it('explains itself when no column can be charted', () => {
    renderChart(textOnlyColumns, rows);

    expect(
      screen.getByText('This page of rows has no numeric column to chart.'),
    ).toBeVisible();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
