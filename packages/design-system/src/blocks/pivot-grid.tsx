'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '../react';
import { useMemo } from 'react';
import type { ComponentProps, ComponentType } from 'react';

import type {
  CellValue,
  GridRow,
  PivotAggregation,
  PivotConfig,
  PivotMeasure,
  PivotGridProps,
} from './types';
import styles from './pivot-grid.module.scss';

// Pin the locale so server and client render identical numbers (no hydration mismatch).
const numberFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
});

// Join truthy class names for CSS module composition.
function cx(...classes: (string | false | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

// A control-character separator that cannot appear in dimension values, so
// composite map keys never collide when a value contains a space.
const KEY_SEPARATOR = String.fromCharCode(31);

// Carbon's TableHeader props omit rowSpan even though the underlying <th>
// forwards it; this typed alias lets the grouped corner header span 2 rows.
type SpannableHeaderProps = ComponentProps<typeof TableHeader> & {
  rowSpan?: number;
};
const SpannableTableHeader = TableHeader as ComponentType<SpannableHeaderProps>;

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

// Resolve an accumulated sum and count into the configured aggregation.
function resolveAggregation(
  aggregation: PivotAggregation,
  sum: number,
  count: number,
): number {
  if (aggregation === 'count') return count;
  if (aggregation === 'avg') return count === 0 ? 0 : sum / count;
  return sum;
}

// Per-measure sum and count accumulators for cells, rows, columns, and the grand total.
type MeasureAccumulator = {
  cellSum: Map<string, number>;
  cellCount: Map<string, number>;
  rowSum: Map<string, number>;
  rowCount: Map<string, number>;
  columnSum: Map<string, number>;
  columnCount: Map<string, number>;
  grandSum: number;
  grandCount: number;
};

export type PivotMatrix = Readonly<{
  rowValues: readonly string[];
  columnValues: readonly string[];
  measures: readonly PivotMeasure[];
  cell: (rowValue: string, columnValue: string, measureKey: string) => number;
  rowTotal: (rowValue: string, measureKey: string) => number;
  columnTotal: (columnValue: string, measureKey: string) => number;
  grandTotal: (measureKey: string) => number;
}>;

// Pure aggregation: group flat rows into a rowDimension x columnDimension
// matrix, computing every measure's aggregate in one pass over the rows.
export function aggregatePivot(
  rows: readonly GridRow[],
  config: PivotConfig,
): PivotMatrix {
  const rowValues = distinctSorted(rows, config.rowDimension);
  const columnValues = distinctSorted(rows, config.columnDimension);

  const aggregationByMeasure = new Map<string, PivotAggregation>(
    config.measures.map((measure) => [
      measure.key,
      measure.aggregation ?? 'sum',
    ]),
  );

  const accumulators = new Map<string, MeasureAccumulator>();
  for (const measure of config.measures) {
    accumulators.set(measure.key, {
      cellSum: new Map(),
      cellCount: new Map(),
      rowSum: new Map(),
      rowCount: new Map(),
      columnSum: new Map(),
      columnCount: new Map(),
      grandSum: 0,
      grandCount: 0,
    });
  }

  const bump = (map: Map<string, number>, key: string, value: number): void => {
    map.set(key, (map.get(key) ?? 0) + value);
  };

  for (const row of rows) {
    const rowKey = dimensionKey(row[config.rowDimension]);
    const columnKey = dimensionKey(row[config.columnDimension]);
    const cellKey = `${rowKey}${KEY_SEPARATOR}${columnKey}`;
    for (const measure of config.measures) {
      const acc = accumulators.get(measure.key);
      if (!acc) continue;
      const value = toNumber(row[measure.key]);
      bump(acc.cellSum, cellKey, value);
      bump(acc.cellCount, cellKey, 1);
      bump(acc.rowSum, rowKey, value);
      bump(acc.rowCount, rowKey, 1);
      bump(acc.columnSum, columnKey, value);
      bump(acc.columnCount, columnKey, 1);
      acc.grandSum += value;
      acc.grandCount += 1;
    }
  }

  const resolveFor = (
    measureKey: string,
    pick: (acc: MeasureAccumulator) => { sum: number; count: number },
  ): number => {
    const acc = accumulators.get(measureKey);
    if (!acc) return 0;
    const aggregation = aggregationByMeasure.get(measureKey) ?? 'sum';
    const { sum, count } = pick(acc);
    return resolveAggregation(aggregation, sum, count);
  };

  return {
    cell: (rowValue, columnValue, measureKey) => {
      const key = `${rowValue}${KEY_SEPARATOR}${columnValue}`;
      return resolveFor(measureKey, (acc) => ({
        sum: acc.cellSum.get(key) ?? 0,
        count: acc.cellCount.get(key) ?? 0,
      }));
    },
    columnTotal: (columnValue, measureKey) =>
      resolveFor(measureKey, (acc) => ({
        sum: acc.columnSum.get(columnValue) ?? 0,
        count: acc.columnCount.get(columnValue) ?? 0,
      })),
    columnValues,
    grandTotal: (measureKey) =>
      resolveFor(measureKey, (acc) => ({
        sum: acc.grandSum,
        count: acc.grandCount,
      })),
    measures: config.measures,
    rowTotal: (rowValue, measureKey) =>
      resolveFor(measureKey, (acc) => ({
        sum: acc.rowSum.get(rowValue) ?? 0,
        count: acc.rowCount.get(rowValue) ?? 0,
      })),
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
  const measureCount = matrix.measures.length;
  // Single-measure header omits per-cell measure keys, so resolve the one
  // configured measure once; every matrix lookup already guards with `?? 0`.
  const measureKey = matrix.measures[0]?.key ?? '';

  return (
    <TableContainer
      className={styles.root}
      description={description}
      title={title}
    >
      <Table size={size}>
        {measureCount > 1 ? (
          <>
            <TableHead>
              <TableRow>
                <SpannableTableHeader
                  className={cx(styles.rowHeader, styles.corner)}
                  rowSpan={2}
                >
                  {config.rowDimension}
                </SpannableTableHeader>
                {matrix.columnValues.map((columnValue) => (
                  <TableHeader
                    className={cx(styles.groupHeader, styles.groupStart)}
                    colSpan={measureCount}
                    key={columnValue}
                    scope="colgroup"
                  >
                    {columnValue}
                  </TableHeader>
                ))}
                <TableHeader
                  className={cx(
                    styles.groupHeader,
                    styles.groupStart,
                    styles.totalCell,
                  )}
                  colSpan={measureCount}
                  scope="colgroup"
                >
                  Total
                </TableHeader>
              </TableRow>
              <TableRow>
                {matrix.columnValues.flatMap((columnValue) =>
                  matrix.measures.map((measure, measureIndex) => (
                    <TableHeader
                      className={cx(
                        styles.num,
                        measureIndex === 0 && styles.groupStart,
                      )}
                      key={`${columnValue}-${measure.key}`}
                      scope="col"
                    >
                      {measure.label}
                    </TableHeader>
                  )),
                )}
                {matrix.measures.map((measure, measureIndex) => (
                  <TableHeader
                    className={cx(
                      styles.num,
                      styles.totalCell,
                      measureIndex === 0 && styles.groupStart,
                    )}
                    key={`total-${measure.key}`}
                    scope="col"
                  >
                    {measure.label}
                  </TableHeader>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {matrix.rowValues.map((rowValue) => (
                <TableRow key={rowValue}>
                  <TableHeader className={cx(styles.rowHeader)} scope="row">
                    {rowValue}
                  </TableHeader>
                  {matrix.columnValues.flatMap((columnValue) =>
                    matrix.measures.map((measure, measureIndex) => (
                      <TableCell
                        className={cx(
                          styles.num,
                          measureIndex === 0 && styles.groupStart,
                        )}
                        key={`${columnValue}-${measure.key}`}
                      >
                        {numberFormatter.format(
                          matrix.cell(rowValue, columnValue, measure.key),
                        )}
                      </TableCell>
                    )),
                  )}
                  {matrix.measures.map((measure, measureIndex) => (
                    <TableCell
                      className={cx(
                        styles.num,
                        styles.totalCell,
                        measureIndex === 0 && styles.groupStart,
                      )}
                      key={`total-${measure.key}`}
                    >
                      {numberFormatter.format(
                        matrix.rowTotal(rowValue, measure.key),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              <TableRow className={cx(styles.totalRow)}>
                <TableHeader
                  className={cx(styles.rowHeader, styles.totalCell)}
                  scope="row"
                >
                  Total
                </TableHeader>
                {matrix.columnValues.flatMap((columnValue) =>
                  matrix.measures.map((measure, measureIndex) => (
                    <TableCell
                      className={cx(
                        styles.num,
                        styles.totalCell,
                        measureIndex === 0 && styles.groupStart,
                      )}
                      key={`${columnValue}-${measure.key}`}
                    >
                      {numberFormatter.format(
                        matrix.columnTotal(columnValue, measure.key),
                      )}
                    </TableCell>
                  )),
                )}
                {matrix.measures.map((measure, measureIndex) => (
                  <TableCell
                    className={cx(
                      styles.num,
                      styles.totalCell,
                      measureIndex === 0 && styles.groupStart,
                    )}
                    key={`grand-${measure.key}`}
                  >
                    {numberFormatter.format(matrix.grandTotal(measure.key))}
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </>
        ) : (
          <>
            <TableHead>
              <TableRow>
                <TableHeader className={cx(styles.rowHeader, styles.corner)}>
                  {config.rowDimension}
                </TableHeader>
                {matrix.columnValues.map((columnValue) => (
                  <TableHeader
                    className={cx(styles.num)}
                    key={columnValue}
                    scope="col"
                  >
                    {columnValue}
                  </TableHeader>
                ))}
                <TableHeader
                  className={cx(
                    styles.num,
                    styles.totalCell,
                    styles.groupStart,
                  )}
                  scope="col"
                >
                  Total
                </TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {matrix.rowValues.map((rowValue) => (
                <TableRow key={rowValue}>
                  <TableHeader className={cx(styles.rowHeader)} scope="row">
                    {rowValue}
                  </TableHeader>
                  {matrix.columnValues.map((columnValue) => (
                    <TableCell className={cx(styles.num)} key={columnValue}>
                      {numberFormatter.format(
                        matrix.cell(rowValue, columnValue, measureKey),
                      )}
                    </TableCell>
                  ))}
                  <TableCell
                    className={cx(
                      styles.num,
                      styles.totalCell,
                      styles.groupStart,
                    )}
                  >
                    {numberFormatter.format(
                      matrix.rowTotal(rowValue, measureKey),
                    )}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className={cx(styles.totalRow)}>
                <TableHeader
                  className={cx(styles.rowHeader, styles.totalCell)}
                  scope="row"
                >
                  Total
                </TableHeader>
                {matrix.columnValues.map((columnValue) => (
                  <TableCell
                    className={cx(styles.num, styles.totalCell)}
                    key={columnValue}
                  >
                    {numberFormatter.format(
                      matrix.columnTotal(columnValue, measureKey),
                    )}
                  </TableCell>
                ))}
                <TableCell
                  className={cx(
                    styles.num,
                    styles.totalCell,
                    styles.groupStart,
                  )}
                >
                  {numberFormatter.format(matrix.grandTotal(measureKey))}
                </TableCell>
              </TableRow>
            </TableBody>
          </>
        )}
      </Table>
    </TableContainer>
  );
}
