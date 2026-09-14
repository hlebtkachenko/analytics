'use client';

import { useState, type UIEvent } from 'react';

const OVERSCAN = 6;

export type VirtualWindow = Readonly<{
  start: number;
  end: number;
  padTop: number;
  padBottom: number;
  onScroll: (event: UIEvent<HTMLElement>) => void;
}>;

// Compute the visible row slice for a fixed row height scroll container.
export function useVirtualWindow(
  rowCount: number,
  rowHeight: number,
  viewportHeight: number,
): VirtualWindow {
  const [scrollTop, setScrollTop] = useState(0);

  const visibleCount = Math.ceil(viewportHeight / rowHeight) + OVERSCAN * 2;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const end = Math.min(rowCount, start + visibleCount);

  return {
    start,
    end,
    padTop: start * rowHeight,
    padBottom: Math.max(0, (rowCount - end) * rowHeight),
    onScroll: (event) => setScrollTop(event.currentTarget.scrollTop),
  };
}
