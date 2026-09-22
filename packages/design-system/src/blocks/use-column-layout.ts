'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { GridColumn } from './types';

type StoredLayout = {
  order: string[];
  widths: Record<string, number>;
  hidden: string[];
};

const MIN_WIDTH = 60;

function storageKey(persistKey: string): string {
  return `bap.grid.${persistKey}`;
}

// Read a persisted layout, tolerating absent storage and malformed values.
function loadLayout(persistKey?: string): StoredLayout | null {
  if (!persistKey || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey(persistKey));
    return raw ? (JSON.parse(raw) as StoredLayout) : null;
  } catch {
    return null;
  }
}

export type ColumnLayout = Readonly<{
  visibleColumns: readonly GridColumn[];
  widths: Readonly<Record<string, number>>;
  hidden: ReadonlySet<string>;
  moveColumn: (fromKey: string, toKey: string) => void;
  setWidth: (key: string, width: number) => void;
  toggleHidden: (key: string) => void;
  reset: () => void;
}>;

// Manage column order, width, and visibility with optional persistence.
export function useColumnLayout(
  columns: readonly GridColumn[],
  persistKey?: string,
): ColumnLayout {
  const defaultOrder = useMemo(
    () => columns.map((column) => column.key),
    [columns],
  );
  // Only declared widths are authoritative; the table layout sizes the rest.
  const defaultWidths = useMemo(
    () =>
      Object.fromEntries(
        columns
          .filter(
            (column): column is GridColumn & { width: number } =>
              column.width !== undefined,
          )
          .map((column) => [column.key, column.width]),
      ),
    [columns],
  );

  // Read any persisted layout a single time per key.
  const storedLayout = useMemo(() => loadLayout(persistKey), [persistKey]);

  // Initialize from the persisted layout once, falling back to column defaults.
  const [order, setOrder] = useState<string[]>(() => {
    const known = new Set(defaultOrder);
    return storedLayout
      ? storedLayout.order.filter((key) => known.has(key))
      : defaultOrder;
  });
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    storedLayout ? { ...defaultWidths, ...storedLayout.widths } : defaultWidths,
  );
  const [hidden, setHidden] = useState<Set<string>>(() => {
    const known = new Set(defaultOrder);
    return storedLayout
      ? new Set(storedLayout.hidden.filter((key) => known.has(key)))
      : new Set();
  });

  // Persist the layout whenever it changes and a key is provided.
  useEffect(() => {
    if (!persistKey || typeof window === 'undefined') return;
    const payload: StoredLayout = { order, widths, hidden: [...hidden] };
    try {
      window.localStorage.setItem(
        storageKey(persistKey),
        JSON.stringify(payload),
      );
    } catch {
      // Ignore quota or privacy-mode failures; layout stays in memory.
    }
  }, [persistKey, order, widths, hidden]);

  const moveColumn = useCallback((fromKey: string, toKey: string) => {
    if (fromKey === toKey) return;
    setOrder((current) => {
      const next = current.filter((key) => key !== fromKey);
      const target = next.indexOf(toKey);
      next.splice(target, 0, fromKey);
      return next;
    });
  }, []);

  const setWidth = useCallback((key: string, width: number) => {
    setWidths((current) => ({
      ...current,
      [key]: Math.max(MIN_WIDTH, Math.round(width)),
    }));
  }, []);

  const toggleHidden = useCallback((key: string) => {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setOrder(defaultOrder);
    setWidths(defaultWidths);
    setHidden(new Set());
  }, [defaultOrder, defaultWidths]);

  const visibleColumns = useMemo(() => {
    const byKey = new Map(columns.map((column) => [column.key, column]));
    const ordered = order
      .map((key) => byKey.get(key))
      .filter((column): column is GridColumn => column !== undefined);
    // Columns added after a layout was persisted are appended, never dropped.
    const inOrder = new Set(order);
    const appended = columns.filter((column) => !inOrder.has(column.key));
    return [...ordered, ...appended].filter(
      (column) => !hidden.has(column.key),
    );
  }, [columns, order, hidden]);

  return {
    visibleColumns,
    widths,
    hidden,
    moveColumn,
    setWidth,
    toggleHidden,
    reset,
  };
}
