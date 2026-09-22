'use client';

import { useState } from 'react';

import {
  OverflowMenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
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

import styles from './tree-data-grid.module.scss';
import type {
  CellValue,
  SortDirection,
  SortSpec,
  TreeDataGridProps,
  TreeNode,
} from './types';
import { compareCellValues } from './use-grid-sort';

// A flattened row pairs a visible node with its depth in the tree.
type FlatRow = Readonly<{
  depth: number;
  node: TreeNode;
}>;

// Reads the name cell for the toggle button's accessible label, falling back to the node id.
function nodeName(node: TreeNode): string {
  const value = node.cells.name;
  return value === null || value === undefined ? node.id : String(value);
}

// A missing or null cell renders as empty text rather than the word null.
function cellText(value: CellValue): string {
  return value === null || value === undefined ? '' : String(value);
}

// Top-level nodes with children start expanded; every deeper level starts collapsed.
function defaultExpandedIds(nodes: readonly TreeNode[]): Set<string> {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      ids.add(node.id);
    }
  }
  return ids;
}

// Ids of every node with at least one child, used by the expand-all control.
function collectParentIds(nodes: readonly TreeNode[]): Set<string> {
  const ids = new Set<string>();
  for (const node of nodes) {
    const children = node.children ?? [];
    if (children.length > 0) {
      ids.add(node.id);
      for (const id of collectParentIds(children)) ids.add(id);
    }
  }
  return ids;
}

// Walks the tree and keeps only rows whose ancestors are all expanded.
function flattenVisibleRows(
  nodes: readonly TreeNode[],
  expandedIds: ReadonlySet<string>,
  depth = 0,
): FlatRow[] {
  return nodes.flatMap((node) => {
    const row: FlatRow = { depth, node };
    const children = node.children ?? [];

    if (children.length === 0 || !expandedIds.has(node.id)) {
      return [row];
    }

    return [row, ...flattenVisibleRows(children, expandedIds, depth + 1)];
  });
}

// A node matches a search needle if any of its cell values contain it.
function nodeMatches(node: TreeNode, needle: string): boolean {
  return Object.values(node.cells).some((value) =>
    cellText(value).toLowerCase().includes(needle),
  );
}

// Keeps nodes that match the needle or have a surviving descendant, and
// collects the ids of every ancestor of a survivor so it can be forced open.
export function filterTree(
  nodes: readonly TreeNode[],
  needle: string,
): { nodes: TreeNode[]; expand: Set<string> } {
  const term = needle.trim().toLowerCase();
  const expand = new Set<string>();
  if (term === '') return { nodes: [...nodes], expand };

  function walk(list: readonly TreeNode[]): TreeNode[] {
    const kept: TreeNode[] = [];
    for (const node of list) {
      const children = node.children ?? [];
      const survivingChildren = walk(children);
      const ownMatch = nodeMatches(node, term);
      if (!ownMatch && survivingChildren.length === 0) continue;
      if (survivingChildren.length > 0) expand.add(node.id);
      kept.push(
        children.length > 0 ? { ...node, children: survivingChildren } : node,
      );
    }
    return kept;
  }

  return { nodes: walk(nodes), expand };
}

// Sorts each sibling group by the given column, recursing into children;
// missing values sort last in both directions, never negated.
export function sortTree(
  nodes: readonly TreeNode[],
  spec: SortSpec | null,
): TreeNode[] {
  if (!spec) return [...nodes];
  const sorted = [...nodes].sort((a, b) => {
    const left = a.cells[spec.key];
    const right = b.cells[spec.key];
    const leftMissing = left === null || left === undefined;
    const rightMissing = right === null || right === undefined;
    if (leftMissing && rightMissing) return 0;
    if (leftMissing) return 1;
    if (rightMissing) return -1;
    const order = compareCellValues(left, right);
    return spec.direction === 'ASC' ? order : -order;
  });
  return sorted.map((node) => ({
    ...node,
    children: sortTree(node.children ?? [], spec),
  }));
}

// Every id in a node's own subtree, including itself.
export function collectSubtreeIds(node: TreeNode): string[] {
  const ids = [node.id];
  for (const child of node.children ?? []) {
    ids.push(...collectSubtreeIds(child));
  }
  return ids;
}

// A node reads as selected only once its whole subtree is selected.
export function isSubtreeSelected(
  node: TreeNode,
  selected: Set<string>,
): boolean {
  return collectSubtreeIds(node).every((id) => selected.has(id));
}

export function TreeDataGrid({
  columns,
  nodes,
  title,
  description,
  size = 'sm',
  sortable = false,
  initialSort,
  search = false,
  searchValue,
  onSearch,
  selection = 'none',
  onSelectionChange,
  expandAllControl = false,
}: TreeDataGridProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
    defaultExpandedIds(nodes),
  );
  const [sort, setSort] = useState<SortSpec | null>(initialSort ?? null);
  const [localQuery, setLocalQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Client search filters in place; a server handler switches it to controlled.
  const serverSearch = typeof onSearch === 'function';
  const query = serverSearch ? (searchValue ?? '') : localQuery;
  const needle = search ? query : '';
  const handleSearch = (value: string): void => {
    if (serverSearch) onSearch?.(value);
    else setLocalQuery(value);
  };

  const filtered = filterTree(nodes, needle);
  const effective = sortTree(filtered.nodes, sort);
  const searchActive = needle.trim() !== '';
  const activeExpanded = searchActive
    ? new Set([...expandedIds, ...filtered.expand])
    : expandedIds;
  const visibleRows = flattenVisibleRows(effective, activeExpanded);

  function toggle(id: string): void {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function expandAll(): void {
    setExpandedIds(collectParentIds(nodes));
  }

  function collapseAll(): void {
    setExpandedIds(new Set());
  }

  function sortDirectionFor(key: string): SortDirection {
    return sort && sort.key === key ? sort.direction : 'NONE';
  }

  function toggleSort(key: string): void {
    setSort((current) => {
      if (!current || current.key !== key) return { key, direction: 'ASC' };
      if (current.direction === 'ASC') return { key, direction: 'DESC' };
      return null;
    });
  }

  const allSelected =
    effective.length > 0 &&
    effective.every((node) => isSubtreeSelected(node, selected));

  function toggleAll(): void {
    const next = new Set(selected);
    for (const node of effective) {
      for (const id of collectSubtreeIds(node)) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
    }
    setSelected(next);
    onSelectionChange?.([...next]);
  }

  function toggleSelection(node: TreeNode): void {
    if (selection === 'single') {
      const next = new Set([node.id]);
      setSelected(next);
      onSelectionChange?.([...next]);
      return;
    }
    const ids = collectSubtreeIds(node);
    const allIn = ids.every((id) => selected.has(id));
    const next = new Set(selected);
    for (const id of ids) {
      if (allIn) next.delete(id);
      else next.add(id);
    }
    setSelected(next);
    onSelectionChange?.([...next]);
  }

  const showToolbar = search || expandAllControl;

  return (
    <TableContainer
      className={styles.root}
      description={description}
      title={title}
    >
      {showToolbar && (
        <TableToolbar>
          <TableToolbarContent>
            {search && (
              // Name the search landmark from the title so multi-grid pages stay unique
              <TableToolbarSearch
                labelText={
                  title === undefined ? 'Search rows' : `Search ${title}`
                }
                onChange={(event) =>
                  handleSearch(
                    typeof event === 'string' ? '' : event.target.value,
                  )
                }
                placeholder="Search rows"
                value={query}
              />
            )}
            {expandAllControl && (
              <TableToolbarMenu iconDescription="Tree options">
                <OverflowMenuItem itemText="Expand all" onClick={expandAll} />
                <OverflowMenuItem
                  itemText="Collapse all"
                  onClick={collapseAll}
                />
              </TableToolbarMenu>
            )}
          </TableToolbarContent>
        </TableToolbar>
      )}
      <Table size={size}>
        <TableHead>
          <TableRow>
            {selection === 'multi' && (
              <TableSelectAll
                ariaLabel="Select all rows"
                checked={allSelected}
                id="tree-data-grid-select-all"
                name="tree-data-grid-select-all"
                onSelect={toggleAll}
              />
            )}
            {selection === 'single' && <th aria-hidden />}
            {columns.map((column) => {
              const canSort = Boolean(sortable && column.sortable);
              const sortHandler = canSort
                ? { onClick: () => toggleSort(column.key) }
                : {};
              return (
                <TableHeader
                  className={
                    column.align === 'end' ? (styles.alignEnd ?? '') : ''
                  }
                  isSortHeader={
                    canSort && sortDirectionFor(column.key) !== 'NONE'
                  }
                  isSortable={canSort}
                  key={column.key}
                  scope="col"
                  sortDirection={sortDirectionFor(column.key)}
                  {...sortHandler}
                >
                  {column.header}
                </TableHeader>
              );
            })}
          </TableRow>
        </TableHead>
        <TableBody>
          {visibleRows.map(({ depth, node }) => {
            const hasChildren = (node.children?.length ?? 0) > 0;
            const isExpanded = activeExpanded.has(node.id);
            const name = nodeName(node);

            return (
              <TableRow key={node.id}>
                {selection !== 'none' && (
                  <TableSelectRow
                    ariaLabel={`Select ${name}`}
                    checked={isSubtreeSelected(node, selected)}
                    id={`tree-data-grid-select-${node.id}`}
                    name={`tree-data-grid-select-${node.id}`}
                    onSelect={() => toggleSelection(node)}
                    radio={selection === 'single'}
                  />
                )}
                {columns.map((column, columnIndex) => {
                  const value = cellText(node.cells[column.key]);

                  if (columnIndex !== 0) {
                    return (
                      <TableCell
                        className={
                          column.align === 'end' ? (styles.alignEnd ?? '') : ''
                        }
                        key={column.key}
                      >
                        {value}
                      </TableCell>
                    );
                  }

                  return (
                    <TableCell key={column.key}>
                      <span
                        className={styles.cellContent}
                        style={{ paddingInlineStart: `${depth}rem` }}
                      >
                        {hasChildren ? (
                          <button
                            aria-expanded={isExpanded}
                            aria-label={
                              isExpanded ? `Collapse ${name}` : `Expand ${name}`
                            }
                            className={styles.toggle}
                            onClick={() => {
                              toggle(node.id);
                            }}
                            type="button"
                          >
                            <span
                              className={
                                isExpanded
                                  ? `${styles.caret} ${styles.rotated}`
                                  : styles.caret
                              }
                            />
                          </button>
                        ) : (
                          <span className={styles.togglePlaceholder} />
                        )}
                        {value}
                      </span>
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
