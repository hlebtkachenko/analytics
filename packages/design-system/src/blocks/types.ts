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
export type SortMode = 'client' | 'server';
export type LoadingMode = 'skeleton' | 'overlay';

// One active sort key; the list models single or multi column sort.
export type SortSpec = Readonly<{
  key: string;
  direction: Exclude<SortDirection, 'NONE'>;
}>;

// Opt-in inline editor for a column; needs DataGridProps.onCellEdit to commit.
export type ColumnEditor =
  | Readonly<{ type: 'text' }>
  | Readonly<{ type: 'checkbox' }>
  | Readonly<{ type: 'select'; options: readonly string[] }>;

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
  // Inline editor for this column; commits through DataGridProps.onCellEdit.
  editor?: ColumnEditor;
}>;

// A text-only toolbar batch action shown while rows are selected.
// Icons are intentionally omitted to honor the curated icon facade contract.
export type BatchAction = Readonly<{
  id: string;
  label: string;
  onClick: (selectedIds: readonly string[]) => void;
}>;

// A persistent toolbar button, e.g. a primary create action.
export type ToolbarAction = Readonly<{
  id: string;
  label: string;
  kind?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  onClick: () => void;
}>;

// One selectable choice inside a faceted filter group.
export type GridFilterOption = Readonly<{ id: string; label: string }>;

// A faceted filter group: a heading over a column of checkbox options.
export type GridFilterGroup = Readonly<{
  key: string;
  heading: string;
  options: readonly GridFilterOption[];
}>;

// A per-row action shown in the trailing overflow menu.
export type RowAction = Readonly<{
  id: string;
  label: string;
  // Renders as the danger variant and sorts to the bottom of the menu.
  isDelete?: boolean;
  disabled?: boolean;
  onClick: (row: GridRow) => void;
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
  // Server mode leaves row order to the caller and only reports header clicks.
  sortMode?: SortMode;
  // Controlled sort specs for server mode; the grid never owns them there.
  sort?: readonly SortSpec[];
  onSortChange?: (sort: readonly SortSpec[]) => void;

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
  // Placeholder for the search field; defaults to a generic one.
  searchPlaceholder?: string;
  // Controlled value plus handler switches client filtering to server search.
  searchValue?: string;
  onSearch?: (query: string) => void;

  // Faceted filter facet: renders a funnel + popover of checkbox groups in the toolbar.
  filters?: readonly GridFilterGroup[];
  // Optional controlled selection per group key; omit to let the grid own it.
  filterValues?: Readonly<Record<string, readonly string[]>>;
  onFilterChange?: (
    values: Readonly<Record<string, readonly string[]>>,
  ) => void;

  // Pagination.
  pagination?: boolean;
  paginationMode?: PaginationMode;
  pageSize?: number;
  pageSizes?: readonly number[];
  // Controlled one-based page for server pagination.
  page?: number;
  totalItems?: number;
  onPageChange?: (page: number, pageSize: number) => void;

  // Persistent toolbar buttons, e.g. a primary create action.
  toolbarActions?: readonly ToolbarAction[];

  // Row extras.
  rowNumbers?: boolean;
  onRowClick?: (row: GridRow) => void;
  // Per-row overflow menu; return the actions available for each row.
  rowActions?: (row: GridRow) => readonly RowAction[];
  // Expandable detail; return the content shown when a row is expanded.
  renderRowDetail?: (row: GridRow) => ReactNode;
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

  // Inline editing; columns opt in with `editor` and commits arrive here.
  onCellEdit?: (rowId: string, key: string, value: CellValue) => void;

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
  sortable?: boolean;
  initialSort?: SortSpec;
  search?: boolean;
  searchValue?: string;
  onSearch?: (query: string) => void;
  selection?: SelectionMode;
  onSelectionChange?: (ids: readonly string[]) => void;
  expandAllControl?: boolean;
}>;

// Pivot configuration: group rows and columns, aggregate numeric measures.
export type PivotAggregation = 'sum' | 'count' | 'avg';

export type PivotMeasure = Readonly<{
  key: string;
  label: string;
  aggregation?: PivotAggregation;
}>;

export type PivotConfig = Readonly<{
  rowDimension: string;
  columnDimension: string;
  measures: readonly PivotMeasure[];
}>;

export type PivotGridProps = Readonly<{
  rows: readonly GridRow[];
  config: PivotConfig;
  title?: string;
  description?: string;
  size?: DensitySize;
}>;
