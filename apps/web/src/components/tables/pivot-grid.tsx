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
import { useMemo } from 'react';

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

  // Accumulate sum and count for each cell, row, and column in one pass.
  const cellSum = new Map<string, number>();
  const cellCount = new Map<string, number>();
  const rowSum = new Map<string, number>();
  const rowCount = new Map<string, number>();
  const columnSum = new Map<string, number>();
  const columnCount = new Map<string, number>();
  let grandSum = 0;
  let grandCount = 0;
  const bump = (map: Map<string, number>, key: string, value: number): void => {
    map.set(key, (map.get(key) ?? 0) + value);
  };
  for (const row of rows) {
    const rowKey = dimensionKey(row[config.rowDimension]);
    const columnKey = dimensionKey(row[config.columnDimension]);
    const value = toNumber(row[config.measure]);
    const cellKey = `${rowKey}\u0000${columnKey}`;
    bump(cellSum, cellKey, value);
    bump(cellCount, cellKey, 1);
    bump(rowSum, rowKey, value);
    bump(rowCount, rowKey, 1);
    bump(columnSum, columnKey, value);
    bump(columnCount, columnKey, 1);
    grandSum += value;
    grandCount += 1;
  }

  // Resolve an accumulated sum and count into the configured aggregation.
  const resolve = (sum: number, count: number): number => {
    if (aggregation === 'count') return count;
    if (aggregation === 'avg') return count === 0 ? 0 : sum / count;
    return sum;
  };

  return {
    cell: (rowValue, columnValue) => {
      const key = `${rowValue}\u0000${columnValue}`;
      return resolve(cellSum.get(key) ?? 0, cellCount.get(key) ?? 0);
    },
    columnTotal: (columnValue) =>
      resolve(
        columnSum.get(columnValue) ?? 0,
        columnCount.get(columnValue) ?? 0,
      ),
    columnValues,
    grandTotal: resolve(grandSum, grandCount),
    rowTotal: (rowValue) =>
      resolve(rowSum.get(rowValue) ?? 0, rowCount.get(rowValue) ?? 0),
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
  const matrix = useMemo(() => aggregatePivot(rows, config), [rows, config]);

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
