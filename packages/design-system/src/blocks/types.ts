import type { ReactNode } from 'react';

// Primitive cell value used for sorting, searching, and plain text rendering.
export type CellValue = string | number | boolean | null | undefined;

// Every grid row carries a stable id plus its primitive column values.
export type GridRow = { id: string } & Record<string, CellValue>;

export type SortDirection = 'ASC' | 'DESC' | 'NONE';
export type DensitySize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type SelectionMode = 'none' | 'single' | 'multi';
export type GridState = 'ready' | 'loading' | 'empty' | 'error';
export type SearchPlacement = 'toolbar' | 'persistent';
export type PaginationMode = 'client' | 'server';
export type LoadingMode = 'skeleton' | 'overlay';

// One active sort key; the list models single or multi column sort.
export type SortSpec = Readonly<{
  key: string;
  direction: Exclude<SortDirection, 'NONE'>;
}>;

// A column definition shared by the core grid and its variants.
export type GridColumn = Readonly<{
  key: string;
  header: string;
  // Per-column opt-in when the grid enables sorting.
  sortable?: boolean;
  // Column can be hidden through the column menu.
  hideable?: boolean;
  // Column stays pinned to the left while the body scrolls horizontally.
  pinned?: boolean;
  // Preferred width in pixels, updated in place when columns are resizable.
  width?: number;
  // Right-align numeric columns.
  align?: 'start' | 'end';
  // Carbon theme custom property applied to the cell text, e.g. --cds-support-error.
  colorToken?: string;
  // Custom cell content for tags, status, and other per-row visuals.
  renderCell?: (row: GridRow) => ReactNode;
}>;

// A text-only toolbar batch action shown while rows are selected.
// Icons are intentionally omitted to honor the curated icon facade contract.
export type BatchAction = Readonly<{
  id: string;
  label: string;
  onClick: (selectedIds: readonly string[]) => void;
}>;

// The full toggle surface. Every cube DataTable and ItemTable variant maps to
// one of these props, a variant component, or a data-wiring choice.
export type DataGridProps = Readonly<{
  columns: readonly GridColumn[];
  rows: readonly GridRow[];
  title?: string;
  description?: string;

  // Density and look.
  size?: DensitySize;
  zebra?: boolean;
  wrapCells?: boolean;

  // Sorting.
  sortable?: boolean;
  multiSort?: boolean;
  initialSort?: readonly SortSpec[];
  // Fixed sort renders the order without interactive headers.
  lockSort?: boolean;

  // Selection and bulk actions.
  selection?: SelectionMode;
  batchActions?: readonly BatchAction[];
  // Whether select all covers the current page or every selectable row.
  selectAllScope?: 'page' | 'all';
  totalSelectableCount?: number;
  onSelectionChange?: (ids: readonly string[]) => void;

  // Search.
  search?: boolean;
  searchPlacement?: SearchPlacement;
  // Controlled value plus handler switches client filtering to server search.
  searchValue?: string;
  onSearch?: (query: string) => void;

  // Pagination.
  pagination?: boolean;
  paginationMode?: PaginationMode;
  pageSize?: number;
  pageSizes?: readonly number[];
  // Controlled one-based page for server pagination.
  page?: number;
  totalItems?: number;
  onPageChange?: (page: number, pageSize: number) => void;

  // Row extras.
  rowNumbers?: boolean;
  onRowClick?: (row: GridRow) => void;
  reorderableRows?: boolean;
  onRowReorder?: (fromId: string, toId: string) => void;
  onRowDrop?: (draggedId: string, targetId: string) => void;

  // Column extras.
  columnMenu?: boolean;
  reorderableColumns?: boolean;
  resizableColumns?: boolean;
  // Key that persists column order, width, and visibility in localStorage.
  persistKey?: string;

  // Scrolling and virtualization.
  stickyHeader?: boolean;
  maxHeight?: number;
  virtualized?: boolean;
  rowHeight?: number;
  infiniteScroll?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;

  // Spreadsheet-style cell range selection.
  cellSelection?: boolean;

  // Totals and footer.
  totalsRow?: Readonly<Record<string, ReactNode>>;
  footer?: ReactNode;

  // Async state.
  state?: GridState;
  loadingMode?: LoadingMode;
  emptyLabel?: string;
  errorLabel?: string;
}>;

// A node in the tree grid; children render as nested expandable rows.
export type TreeNode = Readonly<{
  id: string;
  cells: Readonly<Record<string, CellValue>>;
  children?: readonly TreeNode[];
}>;

export type TreeDataGridProps = Readonly<{
  columns: readonly GridColumn[];
  nodes: readonly TreeNode[];
  title?: string;
  description?: string;
  size?: DensitySize;
}>;

// Pivot configuration: group rows and columns, aggregate a numeric measure.
export type PivotAggregation = 'sum' | 'count' | 'avg';

export type PivotConfig = Readonly<{
  rowDimension: string;
  columnDimension: string;
  measure: string;
  aggregation?: PivotAggregation;
}>;

export type PivotGridProps = Readonly<{
  rows: readonly GridRow[];
  config: PivotConfig;
  title?: string;
  description?: string;
  size?: DensitySize;
}>;
