'use client';

import {
  Button,
  DataTableSkeleton,
  InlineNotification,
  Loading,
  OverflowMenu,
  OverflowMenuItem,
  Pagination,
  Table,
  TableBatchAction,
  TableBatchActions,
  TableBody,
  TableCell,
  TableContainer,
  TableExpandedRow,
  TableExpandHeader,
  TableExpandRow,
  TableHead,
  TableHeader,
  TableRow,
  TableSelectAll,
  TableSelectRow,
  TableToolbar,
  TableToolbarContent,
  TableToolbarMenu,
  TableToolbarSearch,
} from '../react';
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import styles from './data-grid.module.scss';
import type {
  DataGridProps,
  DensitySize,
  GridColumn,
  GridRow,
  RowAction,
} from './types';
import { useCellSelection } from './use-cell-selection';
import { useColumnLayout } from './use-column-layout';
import { useGridSort } from './use-grid-sort';
import { useVirtualWindow } from './use-virtual-window';

const SELECT_WIDTH = 48;
const NUMBER_WIDTH = 64;
const DEFAULT_WIDTH = 160;

// Carbon data-table row heights per size, used to size virtualized rows.
const ROW_HEIGHTS: Record<DensitySize, number> = {
  xs: 24,
  sm: 32,
  md: 40,
  lg: 48,
  xl: 64,
};

// Join truthy class names for CSS module composition.
function cx(...classes: (string | false | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

// Trailing per-row overflow menu; delete actions sort last as the danger item.
function RowActionsMenu({
  actions,
  row,
}: Readonly<{ actions: readonly RowAction[]; row: GridRow }>): ReactNode {
  if (actions.length === 0) return null;
  const ordered = [...actions].sort(
    (first, second) =>
      Number(Boolean(first.isDelete)) - Number(Boolean(second.isDelete)),
  );
  return (
    <OverflowMenu aria-label="Row actions" flipped size="sm">
      {ordered.map((action) => (
        <OverflowMenuItem
          disabled={Boolean(action.disabled)}
          hasDivider={Boolean(action.isDelete)}
          isDelete={Boolean(action.isDelete)}
          itemText={action.label}
          key={action.id}
          onClick={() => action.onClick(row)}
        />
      ))}
    </OverflowMenu>
  );
}

// Read a cell as display text unless the column renders custom content.
function cellContent(row: GridRow, column: GridColumn) {
  if (column.renderCell) return column.renderCell(row);
  const value = row[column.key];
  return value === null || value === undefined ? '' : String(value);
}

export function DataGrid(props: DataGridProps) {
  const {
    columns,
    rows,
    title,
    description,
    size = 'sm',
    zebra = false,
    wrapCells = false,
    sortable = false,
    multiSort = false,
    initialSort = [],
    lockSort = false,
    selection = 'none',
    batchActions = [],
    selectAllScope = 'page',
    onSelectionChange,
    search = false,
    searchPlacement = 'toolbar',
    searchValue,
    onSearch,
    pagination = false,
    paginationMode = 'client',
    pageSize = 10,
    pageSizes = [10, 25, 50],
    page,
    totalItems,
    onPageChange,
    toolbarActions = [],
    rowNumbers = false,
    onRowClick,
    rowActions,
    renderRowDetail,
    reorderableRows = false,
    onRowReorder,
    onRowDrop,
    columnMenu = false,
    reorderableColumns = false,
    resizableColumns = false,
    persistKey,
    stickyHeader = false,
    maxHeight,
    virtualized = false,
    rowHeight,
    infiniteScroll = false,
    hasMore = false,
    onLoadMore,
    cellSelection = false,
    totalsRow,
    footer,
    state = 'ready',
    loadingMode = 'skeleton',
    emptyLabel = 'No rows to display.',
    errorLabel = 'Rows could not be loaded.',
  } = props;

  const layout = useColumnLayout(columns, persistKey);
  const visibleColumns = layout.visibleColumns;

  // Client search filters across every source column value.
  const serverSearch = typeof onSearch === 'function';
  const [clientQuery, setClientQuery] = useState('');
  const query = serverSearch ? (searchValue ?? '') : clientQuery;
  const filtered = useMemo(() => {
    if (serverSearch || !search || query.trim() === '') return rows;
    const needle = query.toLowerCase();
    return rows.filter((row) =>
      columns.some((column) =>
        String(row[column.key] ?? '')
          .toLowerCase()
          .includes(needle),
      ),
    );
  }, [rows, columns, query, search, serverSearch]);

  const sort = useGridSort(filtered, initialSort, multiSort);
  const orderedRows = lockSort ? filtered : sort.sortedRows;

  // Pagination state is controlled for server mode and local otherwise.
  const serverPaging = paginationMode === 'server';
  const [clientPage, setClientPage] = useState(1);
  const [clientPageSize, setClientPageSize] = useState(pageSize);
  const activePage = serverPaging ? (page ?? 1) : clientPage;
  const activePageSize = serverPaging ? pageSize : clientPageSize;
  const clientPaged =
    pagination && !serverPaging && !virtualized && !infiniteScroll;
  const totalPages = Math.max(
    1,
    Math.ceil(orderedRows.length / activePageSize),
  );
  const safePage = Math.min(Math.max(1, activePage), totalPages);

  const bodyRows = clientPaged
    ? orderedRows.slice(
        (safePage - 1) * activePageSize,
        safePage * activePageSize,
      )
    : orderedRows;

  // Selection is tracked by row id across pages.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectedCount = selected.size;
  const commitSelection = (next: Set<string>): void => {
    setSelected(next);
    onSelectionChange?.([...next]);
  };
  const toggleRow = (id: string): void => {
    const next = new Set(selection === 'single' ? [] : selected);
    if (selected.has(id) && selection !== 'single') next.delete(id);
    else next.add(id);
    commitSelection(next);
  };
  const selectAllTargets = (
    selectAllScope === 'all' ? orderedRows : bodyRows
  ).map((row) => row.id);
  const allSelected =
    selectAllTargets.length > 0 &&
    selectAllTargets.every((id) => selected.has(id));
  const toggleAll = (): void => {
    const next = new Set(selected);
    if (allSelected) selectAllTargets.forEach((id) => next.delete(id));
    else selectAllTargets.forEach((id) => next.add(id));
    commitSelection(next);
  };
  const clearSelection = (): void => commitSelection(new Set());

  // Expandable detail rows track their open ids independently of selection.
  const expandable = typeof renderRowDetail === 'function';
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string): void =>
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Cell range selection spans the visible column grid.
  const {
    begin: beginCell,
    extendTo: extendCell,
    end: endCell,
    isSelected: isCellSelected,
  } = useCellSelection(cellSelection);
  useEffect(() => {
    if (!cellSelection) return;
    const stop = (): void => endCell();
    window.addEventListener('mouseup', stop);
    return () => window.removeEventListener('mouseup', stop);
  }, [cellSelection, endCell]);

  // Fixed row height windowing renders only the visible slice; default the
  // row height to the Carbon height for the current size.
  const rowPx = rowHeight ?? ROW_HEIGHTS[size] ?? ROW_HEIGHTS.sm;
  const scrollMaxHeight = virtualized ? (maxHeight ?? 400) : maxHeight;
  const viewport = useVirtualWindow(
    bodyRows.length,
    rowPx,
    scrollMaxHeight ?? 400,
  );
  const renderRows = virtualized
    ? bodyRows.slice(viewport.start, viewport.end)
    : bodyRows;
  const rowBase = virtualized ? viewport.start : 0;
  const numberBase = serverPaging
    ? (activePage - 1) * activePageSize
    : clientPaged
      ? (safePage - 1) * activePageSize
      : rowBase;

  // Append the next page when the sentinel scrolls into view.
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!infiniteScroll || !hasMore) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMore?.();
      },
      { root: scrollRef.current },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [infiniteScroll, hasMore, onLoadMore]);

  // Drag references for column and row reordering.
  const dragColumn = useRef<string | null>(null);
  const dragRow = useRef<string | null>(null);

  const beginResize = (
    event: ReactPointerEvent<HTMLSpanElement>,
    key: string,
  ): void => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = layout.widths[key] ?? DEFAULT_WIDTH;
    const move = (moveEvent: PointerEvent): void =>
      layout.setWidth(key, startWidth + (moveEvent.clientX - startX));
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const hasRowActions = typeof rowActions === 'function';
  const leadingCount =
    (expandable ? 1 : 0) +
    (selection !== 'none' ? 1 : 0) +
    (rowNumbers ? 1 : 0);
  const trailingCount = hasRowActions ? 1 : 0;
  const columnCount = leadingCount + visibleColumns.length + trailingCount;

  // Compute sticky-left offsets so pinned columns stay in view.
  const hasPinned = visibleColumns.some((column) => column.pinned);
  const leftFor: Record<string, number> = {};
  if (hasPinned) {
    let acc = 0;
    if (selection !== 'none') {
      leftFor.__select = acc;
      acc += SELECT_WIDTH;
    }
    if (rowNumbers) {
      leftFor.__number = acc;
      acc += NUMBER_WIDTH;
    }
    for (const column of visibleColumns.filter(
      (candidate) => candidate.pinned,
    )) {
      leftFor[column.key] = acc;
      acc += layout.widths[column.key] ?? DEFAULT_WIDTH;
    }
  }
  // Only the left offset stays inline; z-index and background come from the
  // .pinned classes so pinned cells can track zebra, hover, and selection.
  const stickyStyle = (key: string): CSSProperties =>
    key in leftFor ? { position: 'sticky', left: leftFor[key] ?? 0 } : {};
  const columnStyle = (column: GridColumn): CSSProperties => ({
    width: layout.widths[column.key] ?? DEFAULT_WIDTH,
    minWidth: layout.widths[column.key] ?? DEFAULT_WIDTH,
    ...stickyStyle(column.key),
  });

  // The last frozen data column carries the seam divider.
  const pinnedColumnKeys = visibleColumns
    .filter((column) => column.pinned)
    .map((column) => column.key);
  const lastPinnedKey = pinnedColumnKeys[pinnedColumnKeys.length - 1];
  // Class for any sticky cell; the edge divider lands on the last frozen column.
  const pinnedClass = (key: string): string =>
    key in leftFor
      ? cx(styles.pinned, key === lastPinnedKey && styles.pinnedEdge)
      : '';
  // The selection column cannot take inline styles, so it pins via classes.
  const selectClass =
    '__select' in leftFor ? cx(styles.pinned, styles.pinnedLead) : '';
  // Give the number column an authoritative width for the fixed layout.
  const numberStyle: CSSProperties = {
    width: NUMBER_WIDTH,
    minWidth: NUMBER_WIDTH,
    ...stickyStyle('__number'),
  };

  const handleSearch = (value: string): void => {
    if (serverSearch) onSearch?.(value);
    else {
      // Reset to the first page so a narrowed result set starts at the top.
      setClientQuery(value);
      setClientPage(1);
    }
  };

  const showToolbar =
    search ||
    columnMenu ||
    batchActions.length > 0 ||
    toolbarActions.length > 0 ||
    reorderableColumns ||
    resizableColumns
      ? true
      : Boolean(persistKey);
  const layoutMenu =
    columnMenu || reorderableColumns || resizableColumns || Boolean(persistKey);
  const isEmpty = state === 'empty' || orderedRows.length === 0;
  const showOverlay = state === 'loading' && loadingMode === 'overlay';

  // The skeleton stands in for the whole grid while first data loads.
  // The wrapper clips it to the column so wide skeletons do not bleed out.
  if (state === 'loading' && loadingMode === 'skeleton') {
    return (
      <div className={styles.skeletonWrap}>
        <DataTableSkeleton
          columnCount={columnCount}
          rowCount={Math.min(activePageSize, 8)}
          showHeader={Boolean(title)}
          showToolbar={showToolbar}
        />
      </div>
    );
  }

  if (state === 'error') {
    return (
      <TableContainer description={description} title={title}>
        <InlineNotification
          hideCloseButton
          kind="error"
          subtitle={errorLabel}
          title="Error"
        />
      </TableContainer>
    );
  }

  return (
    <TableContainer description={description} title={title}>
      {showToolbar && (
        <TableToolbar>
          {batchActions.length > 0 && (
            <TableBatchActions
              onCancel={clearSelection}
              shouldShowBatchActions={selectedCount > 0}
              totalSelected={selectedCount}
            >
              {batchActions.map((action) => (
                <TableBatchAction
                  key={action.id}
                  onClick={() => action.onClick([...selected])}
                >
                  {action.label}
                </TableBatchAction>
              ))}
            </TableBatchActions>
          )}
          <TableToolbarContent>
            {search && (
              <TableToolbarSearch
                onChange={(event) =>
                  handleSearch(
                    typeof event === 'string' ? '' : event.target.value,
                  )
                }
                persistent={searchPlacement === 'persistent'}
                placeholder="Search rows"
                value={query}
              />
            )}
            {layoutMenu && (
              <TableToolbarMenu iconDescription="Table options">
                {columnMenu &&
                  columns
                    .filter((column) => column.hideable)
                    .map((column) => (
                      <OverflowMenuItem
                        key={column.key}
                        itemText={`${layout.hidden.has(column.key) ? 'Show' : 'Hide'} ${column.header}`}
                        onClick={() => layout.toggleHidden(column.key)}
                      />
                    ))}
                <OverflowMenuItem
                  itemText="Reset layout"
                  onClick={layout.reset}
                />
              </TableToolbarMenu>
            )}
            {toolbarActions.map((action) => (
              <Button
                disabled={Boolean(action.disabled)}
                key={action.id}
                kind={action.kind ?? 'primary'}
                onClick={action.onClick}
                size="lg"
              >
                {action.label}
              </Button>
            ))}
          </TableToolbarContent>
        </TableToolbar>
      )}

      <div className={styles.viewport}>
        <div
          aria-busy={showOverlay}
          className={styles.scroll}
          onScroll={virtualized ? viewport.onScroll : undefined}
          ref={scrollRef}
          style={scrollMaxHeight ? { maxHeight: scrollMaxHeight } : undefined}
        >
          <Table
            aria-label={title ?? 'Data grid'}
            className={cx(
              (stickyHeader || Boolean(scrollMaxHeight)) && styles.stickyHead,
              (hasPinned || resizableColumns) && styles.fixedLayout,
            )}
            size={size}
            useZebraStyles={zebra}
          >
            <TableHead>
              <TableRow>
                {expandable && (
                  <TableExpandHeader
                    aria-label="Row detail"
                    id="data-grid-expand"
                  />
                )}
                {selection === 'multi' && (
                  <TableSelectAll
                    ariaLabel="Select all rows"
                    checked={allSelected}
                    className={selectClass}
                    id="data-grid-select-all"
                    name="data-grid-select-all"
                    onSelect={toggleAll}
                  />
                )}
                {selection === 'single' && (
                  <th aria-hidden className={selectClass} />
                )}
                {rowNumbers && (
                  <TableHeader
                    className={pinnedClass('__number')}
                    style={numberStyle}
                  >
                    #
                  </TableHeader>
                )}
                {visibleColumns.map((column) => {
                  const canSort = Boolean(
                    sortable && column.sortable && !lockSort,
                  );
                  // Spread optional handlers so no undefined prop reaches Carbon.
                  const sortHandler = canSort
                    ? {
                        onClick: (event: ReactMouseEvent) =>
                          sort.toggle(column.key, event.shiftKey),
                      }
                    : {};
                  const dragHandlers = reorderableColumns
                    ? {
                        draggable: true,
                        onDragStart: () => {
                          dragColumn.current = column.key;
                        },
                        onDragOver: (event: ReactMouseEvent) =>
                          event.preventDefault(),
                        onDrop: () => {
                          if (dragColumn.current)
                            layout.moveColumn(dragColumn.current, column.key);
                          dragColumn.current = null;
                        },
                      }
                    : {};
                  return (
                    <TableHeader
                      className={cx(
                        styles.headerCell,
                        reorderableColumns && styles.reorderable,
                        column.align === 'end' && styles.alignEnd,
                        pinnedClass(column.key),
                      )}
                      isSortHeader={
                        canSort && sort.directionFor(column.key) !== 'NONE'
                      }
                      isSortable={canSort}
                      key={column.key}
                      scope="col"
                      sortDirection={sort.directionFor(column.key)}
                      style={columnStyle(column)}
                      {...sortHandler}
                      {...dragHandlers}
                    >
                      {column.header}
                      {resizableColumns && (
                        <span
                          aria-hidden
                          className={cx(styles.resizeHandle)}
                          onPointerDown={(event) =>
                            beginResize(event, column.key)
                          }
                        />
                      )}
                    </TableHeader>
                  );
                })}
                {hasRowActions && (
                  <TableHeader aria-label="Row actions" scope="col" />
                )}
              </TableRow>
            </TableHead>
            <TableBody>
              {virtualized && viewport.padTop > 0 && (
                <tr className={styles.spacerRow}>
                  <td
                    colSpan={columnCount}
                    style={{ height: viewport.padTop }}
                  />
                </tr>
              )}

              {isEmpty ? (
                <TableRow>
                  <TableCell
                    className={cx(styles.emptyCell)}
                    colSpan={columnCount}
                  >
                    {emptyLabel}
                  </TableCell>
                </TableRow>
              ) : (
                renderRows.map((row, index) => {
                  // Page-aware absolute index so cell selection never leaks across pages.
                  const rowIndex = numberBase + index;
                  const rowCells = (
                    <>
                      {selection !== 'none' && (
                        <TableSelectRow
                          ariaLabel={`Select row ${row.id}`}
                          checked={selected.has(row.id)}
                          className={selectClass}
                          id={`data-grid-select-${row.id}`}
                          name={`data-grid-select-${row.id}`}
                          onSelect={() => toggleRow(row.id)}
                          radio={selection === 'single'}
                        />
                      )}
                      {rowNumbers && (
                        <TableCell
                          className={pinnedClass('__number')}
                          style={numberStyle}
                        >
                          {numberBase + index + 1}
                        </TableCell>
                      )}
                      {visibleColumns.map((column, columnIndex) => (
                        <TableCell
                          className={cx(
                            column.align === 'end' && styles.alignEnd,
                            cellSelection &&
                              isCellSelected(rowIndex, columnIndex) &&
                              styles.cellSelected,
                            pinnedClass(column.key),
                          )}
                          key={column.key}
                          onMouseDown={
                            cellSelection
                              ? (event: ReactMouseEvent) =>
                                  beginCell(
                                    rowIndex,
                                    columnIndex,
                                    event.shiftKey,
                                  )
                              : undefined
                          }
                          onMouseEnter={
                            cellSelection
                              ? () => extendCell(rowIndex, columnIndex)
                              : undefined
                          }
                          style={{
                            ...columnStyle(column),
                            ...(column.colorToken
                              ? { color: `var(${column.colorToken})` }
                              : {}),
                            whiteSpace: wrapCells ? 'normal' : 'nowrap',
                          }}
                        >
                          {cellContent(row, column)}
                        </TableCell>
                      ))}
                      {hasRowActions && (
                        <TableCell className={cx(styles.rowActionsCell)}>
                          <RowActionsMenu
                            actions={rowActions?.(row) ?? []}
                            row={row}
                          />
                        </TableCell>
                      )}
                    </>
                  );

                  // Detail rows swap the row for a Carbon expand/expanded pair.
                  if (expandable) {
                    return (
                      <Fragment key={row.id}>
                        <TableExpandRow
                          aria-label={`Toggle detail for row ${row.id}`}
                          expandHeader="data-grid-expand"
                          isExpanded={expandedRows.has(row.id)}
                          isSelected={
                            selection !== 'none' && selected.has(row.id)
                          }
                          onExpand={() => toggleExpanded(row.id)}
                        >
                          {rowCells}
                        </TableExpandRow>
                        {expandedRows.has(row.id) && (
                          <TableExpandedRow colSpan={columnCount}>
                            {renderRowDetail?.(row)}
                          </TableExpandedRow>
                        )}
                      </Fragment>
                    );
                  }

                  return (
                    <TableRow
                      className={cx(onRowClick && styles.clickableRow)}
                      draggable={reorderableRows}
                      isSelected={selection !== 'none' && selected.has(row.id)}
                      key={row.id}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      onDragOver={
                        reorderableRows
                          ? (event) => event.preventDefault()
                          : undefined
                      }
                      onDragStart={
                        reorderableRows
                          ? () => {
                              dragRow.current = row.id;
                            }
                          : undefined
                      }
                      onDrop={
                        reorderableRows
                          ? () => {
                              if (dragRow.current) {
                                onRowReorder?.(dragRow.current, row.id);
                                onRowDrop?.(dragRow.current, row.id);
                              }
                              dragRow.current = null;
                            }
                          : undefined
                      }
                      style={virtualized ? { height: rowPx } : undefined}
                    >
                      {rowCells}
                    </TableRow>
                  );
                })
              )}

              {virtualized && viewport.padBottom > 0 && (
                <tr className={styles.spacerRow}>
                  <td
                    colSpan={columnCount}
                    style={{ height: viewport.padBottom }}
                  />
                </tr>
              )}

              {totalsRow && !isEmpty && (
                <TableRow>
                  {expandable && <TableCell />}
                  {selection !== 'none' && (
                    <TableCell className={selectClass} />
                  )}
                  {rowNumbers && (
                    <TableCell
                      className={pinnedClass('__number')}
                      style={numberStyle}
                    />
                  )}
                  {visibleColumns.map((column) => (
                    <TableCell
                      className={cx(
                        column.align === 'end' && styles.alignEnd,
                        pinnedClass(column.key),
                      )}
                      key={column.key}
                      style={columnStyle(column)}
                    >
                      {totalsRow[column.key] ?? ''}
                    </TableCell>
                  ))}
                  {hasRowActions && <TableCell />}
                </TableRow>
              )}
            </TableBody>
          </Table>
          {infiniteScroll && hasMore && (
            <div aria-hidden className={styles.loadMore} ref={sentinelRef} />
          )}
        </div>
        {showOverlay && (
          <div aria-live="polite" className={styles.overlay} role="status">
            <Loading description="Loading rows" small withOverlay={false} />
          </div>
        )}
      </div>

      {footer}

      {pagination && !virtualized && !infiniteScroll && (
        <Pagination
          onChange={({ page: nextPage, pageSize: nextSize }) => {
            if (serverPaging) onPageChange?.(nextPage, nextSize);
            else {
              setClientPage(nextPage);
              setClientPageSize(nextSize);
            }
          }}
          page={serverPaging ? activePage : safePage}
          pageSize={activePageSize}
          pageSizes={[...pageSizes]}
          size={size === 'xs' || size === 'sm' ? 'sm' : 'lg'}
          totalItems={
            serverPaging
              ? (totalItems ?? orderedRows.length)
              : orderedRows.length
          }
        />
      )}
    </TableContainer>
  );
}
