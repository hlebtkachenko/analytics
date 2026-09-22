'use client';

import { useMemo, useState } from 'react';

import type { CellValue, GridRow, SortDirection, SortSpec } from './types';

// Compare two present values; nulls are handled by the caller so they stay last.
export function compareCellValues(a: CellValue, b: CellValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

export type GridSort = Readonly<{
  specs: readonly SortSpec[];
  sortedRows: readonly GridRow[];
  directionFor: (key: string) => SortDirection;
  toggle: (key: string, additive: boolean) => void;
}>;

// Cycle one column through ascending, descending, then cleared.
export function nextSortSpecs(
  current: readonly SortSpec[],
  key: string,
  additive: boolean,
  multi: boolean,
): readonly SortSpec[] {
  const existing = current.find((spec) => spec.key === key);
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
}

// Read the active direction for a column out of the current sort specs.
export function directionForKey(
  specs: readonly SortSpec[],
  key: string,
): SortDirection {
  return specs.find((spec) => spec.key === key)?.direction ?? 'NONE';
}

// Manage single or multi column sort and return the sorted rows.
export function useGridSort(
  rows: readonly GridRow[],
  initial: readonly SortSpec[] = [],
  multi = false,
): GridSort {
  const [specs, setSpecs] = useState<readonly SortSpec[]>(initial);

  const toggle = (key: string, additive: boolean): void => {
    setSpecs((current) => nextSortSpecs(current, key, additive, multi));
  };

  const sortedRows = useMemo(() => {
    if (specs.length === 0) return rows;
    return [...rows].sort((left, right) => {
      for (const spec of specs) {
        const a = left[spec.key];
        const b = right[spec.key];
        const aMissing = a === null || a === undefined;
        const bMissing = b === null || b === undefined;
        // Missing values sort last in both directions, never negated.
        if (aMissing && bMissing) continue;
        if (aMissing) return 1;
        if (bMissing) return -1;
        const order = compareCellValues(a, b);
        if (order !== 0) return spec.direction === 'ASC' ? order : -order;
      }
      return 0;
    });
  }, [rows, specs]);

  const directionFor = (key: string): SortDirection =>
    directionForKey(specs, key);

  return { specs, sortedRows, directionFor, toggle };
}
