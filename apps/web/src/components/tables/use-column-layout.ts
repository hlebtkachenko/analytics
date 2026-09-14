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
  const defaultWidths = useMemo(
    () =>
      Object.fromEntries(
        columns.map((column) => [column.key, column.width ?? 160]),
      ),
    [columns],
  );

  // Initialize from a persisted layout once, falling back to column defaults.
  const [order, setOrder] = useState<string[]>(() => {
    const stored = loadLayout(persistKey);
    const known = new Set(defaultOrder);
    return stored ? stored.order.filter((key) => known.has(key)) : defaultOrder;
  });
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    const stored = loadLayout(persistKey);
    return stored ? { ...defaultWidths, ...stored.widths } : defaultWidths;
  });
  const [hidden, setHidden] = useState<Set<string>>(() => {
    const stored = loadLayout(persistKey);
    const known = new Set(defaultOrder);
    return stored
      ? new Set(stored.hidden.filter((key) => known.has(key)))
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
    return order
      .map((key) => byKey.get(key))
      .filter(
        (column): column is GridColumn =>
          column !== undefined && !hidden.has(column.key),
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
