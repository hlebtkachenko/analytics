'use client';

export * from '@carbon/charts-react';
// Extensionless like ./catalog.generated, so the Next bundler resolves the TSX source.
export { ChartFrame } from './chart-frame';
export type {
  ChartFrameProps,
  ChartTable,
  ChartTableColumn,
  ChartTableRow,
} from './chart-frame';
