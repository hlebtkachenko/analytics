'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@bap/design-system/react';

import type { CellValue, GridRow, PivotConfig, PivotGridProps } from './types';
import styles from './pivot-grid.module.scss';

const numberFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
});

// Fallback collapses the module's index-signature type to a definite string.
const totalRowClassName: string = styles.totalRow ?? '';
const totalCellClassName: string = styles.totalCell ?? '';

// Coerce a raw measure value to a number; non-numeric values aggregate as zero.
function toNumber(value: CellValue): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

// Group key for a dimension cell; missing values group under an empty string.
function dimensionKey(value: CellValue): string {
  return value === null || value === undefined ? '' : String(value);
}

function distinctSorted(rows: readonly GridRow[], dimension: string): string[] {
  return Array.from(
    new Set(rows.map((row) => dimensionKey(row[dimension]))),
  ).sort();
}

export type PivotMatrix = Readonly<{
  rowValues: readonly string[];
  columnValues: readonly string[];
  cell: (rowValue: string, columnValue: string) => number;
  rowTotal: (rowValue: string) => number;
  columnTotal: (columnValue: string) => number;
  grandTotal: number;
}>;

// Pure aggregation: group flat rows into a rowDimension x columnDimension matrix.
export function aggregatePivot(
  rows: readonly GridRow[],
  config: PivotConfig,
): PivotMatrix {
  const aggregation = config.aggregation ?? 'sum';
  const rowValues = distinctSorted(rows, config.rowDimension);
  const columnValues = distinctSorted(rows, config.columnDimension);

  function aggregate(matchingRows: readonly GridRow[]): number {
    if (aggregation === 'count') {
      return matchingRows.length;
    }
    const sum = matchingRows.reduce(
      (total, row) => total + toNumber(row[config.measure]),
      0,
    );
    if (aggregation === 'avg') {
      return matchingRows.length === 0 ? 0 : sum / matchingRows.length;
    }
    return sum;
  }

  function cell(rowValue: string, columnValue: string): number {
    return aggregate(
      rows.filter(
        (row) =>
          dimensionKey(row[config.rowDimension]) === rowValue &&
          dimensionKey(row[config.columnDimension]) === columnValue,
      ),
    );
  }

  function rowTotal(rowValue: string): number {
    return aggregate(
      rows.filter((row) => dimensionKey(row[config.rowDimension]) === rowValue),
    );
  }

  function columnTotal(columnValue: string): number {
    return aggregate(
      rows.filter(
        (row) => dimensionKey(row[config.columnDimension]) === columnValue,
      ),
    );
  }

  return {
    cell,
    columnTotal,
    columnValues,
    grandTotal: aggregate(rows),
    rowTotal,
    rowValues,
  };
}

export function PivotGrid({
  rows,
  config,
  title,
  description,
  size = 'sm',
}: PivotGridProps) {
  const matrix = aggregatePivot(rows, config);

  return (
    <TableContainer title={title} description={description}>
      <Table size={size}>
        <TableHead>
          <TableRow>
            <TableHeader>{config.rowDimension}</TableHeader>
            {matrix.columnValues.map((columnValue) => (
              <TableHeader key={columnValue} scope="col">
                {columnValue}
              </TableHeader>
            ))}
            <TableHeader scope="col" className={totalCellClassName}>
              Total
            </TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {matrix.rowValues.map((rowValue) => (
            <TableRow key={rowValue}>
              <TableHeader scope="row">{rowValue}</TableHeader>
              {matrix.columnValues.map((columnValue) => (
                <TableCell key={columnValue}>
                  {numberFormatter.format(matrix.cell(rowValue, columnValue))}
                </TableCell>
              ))}
              <TableCell className={totalCellClassName}>
                {numberFormatter.format(matrix.rowTotal(rowValue))}
              </TableCell>
            </TableRow>
          ))}
          <TableRow className={totalRowClassName}>
            <TableHeader scope="row" className={totalCellClassName}>
              Total
            </TableHeader>
            {matrix.columnValues.map((columnValue) => (
              <TableCell key={columnValue} className={totalCellClassName}>
                {numberFormatter.format(matrix.columnTotal(columnValue))}
              </TableCell>
            ))}
            <TableCell className={totalCellClassName}>
              {numberFormatter.format(matrix.grandTotal)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </TableContainer>
  );
}
