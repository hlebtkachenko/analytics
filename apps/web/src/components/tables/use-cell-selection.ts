'use client';

import { useCallback, useState } from 'react';

type Cell = { row: number; col: number };

export type CellSelection = Readonly<{
  isSelected: (row: number, col: number) => boolean;
  count: number;
  begin: (row: number, col: number, extend: boolean) => void;
  extendTo: (row: number, col: number) => void;
  end: () => void;
}>;

// Track a rectangular cell range for spreadsheet-style selection.
export function useCellSelection(enabled: boolean): CellSelection {
  const [anchor, setAnchor] = useState<Cell | null>(null);
  const [focus, setFocus] = useState<Cell | null>(null);
  const [dragging, setDragging] = useState(false);

  const bounds =
    anchor && focus
      ? {
          minRow: Math.min(anchor.row, focus.row),
          maxRow: Math.max(anchor.row, focus.row),
          minCol: Math.min(anchor.col, focus.col),
          maxCol: Math.max(anchor.col, focus.col),
        }
      : null;

  const isSelected = (row: number, col: number): boolean =>
    bounds !== null &&
    row >= bounds.minRow &&
    row <= bounds.maxRow &&
    col >= bounds.minCol &&
    col <= bounds.maxCol;

  const count = bounds
    ? (bounds.maxRow - bounds.minRow + 1) * (bounds.maxCol - bounds.minCol + 1)
    : 0;

  const begin = useCallback(
    (row: number, col: number, extend: boolean): void => {
      if (!enabled) return;
      // Shift-click keeps the anchor and moves only the focus.
      if (extend && anchor) setFocus({ row, col });
      else {
        setAnchor({ row, col });
        setFocus({ row, col });
      }
      setDragging(true);
    },
    [enabled, anchor],
  );

  const extendTo = useCallback(
    (row: number, col: number): void => {
      if (enabled && dragging) setFocus({ row, col });
    },
    [enabled, dragging],
  );

  const end = useCallback((): void => setDragging(false), []);

  return { isSelected, count, begin, extendTo, end };
}
