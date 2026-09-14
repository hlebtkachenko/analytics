'use client';

import { useMemo, useState } from 'react';

import type { CellValue, GridRow, SortDirection, SortSpec } from './types';

// Compare two primitive cell values with numbers numeric and nulls last.
function compareValues(a: CellValue, b: CellValue): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

export type GridSort = Readonly<{
  specs: readonly SortSpec[];
  sortedRows: readonly GridRow[];
  directionFor: (key: string) => SortDirection;
  toggle: (key: string, additive: boolean) => void;
}>;

// Manage single or multi column sort and return the sorted rows.
export function useGridSort(
  rows: readonly GridRow[],
  initial: readonly SortSpec[] = [],
  multi = false,
): GridSort {
  const [specs, setSpecs] = useState<readonly SortSpec[]>(initial);

  const toggle = (key: string, additive: boolean): void => {
    setSpecs((current) => {
      const existing = current.find((spec) => spec.key === key);
      // Cycle a single column through ascending, descending, then cleared.
      const next: SortSpec | null =
        existing?.direction === 'ASC'
          ? { key, direction: 'DESC' }
          : existing?.direction === 'DESC'
            ? null
            : { key, direction: 'ASC' };
      if (multi && additive) {
        const without = current.filter((spec) => spec.key !== key);
        return next ? [...without, next] : without;
      }
      return next ? [next] : [];
    });
  };

  const sortedRows = useMemo(() => {
    if (specs.length === 0) return rows;
    return [...rows].sort((left, right) => {
      for (const spec of specs) {
        const order = compareValues(left[spec.key], right[spec.key]);
        if (order !== 0) return spec.direction === 'ASC' ? order : -order;
      }
      return 0;
    });
  }, [rows, specs]);

  const directionFor = (key: string): SortDirection =>
    specs.find((spec) => spec.key === key)?.direction ?? 'NONE';

  return { specs, sortedRows, directionFor, toggle };
}
