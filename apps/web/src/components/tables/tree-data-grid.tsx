'use client';

import { useState } from 'react';

import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@bap/design-system/react';

import styles from './tree-data-grid.module.scss';
import type { CellValue, TreeDataGridProps, TreeNode } from './types';

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

export function TreeDataGrid({
  columns,
  nodes,
  title,
  description,
  size = 'sm',
}: TreeDataGridProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
    defaultExpandedIds(nodes),
  );

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

  const visibleRows = flattenVisibleRows(nodes, expandedIds);

  return (
    <TableContainer description={description} title={title}>
      <Table size={size}>
        <TableHead>
          <TableRow>
            {columns.map((column) => (
              <TableHeader
                className={
                  column.align === 'end' ? (styles.alignEnd ?? '') : ''
                }
                key={column.key}
                scope="col"
              >
                {column.header}
              </TableHeader>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {visibleRows.map(({ depth, node }) => {
            const hasChildren = (node.children?.length ?? 0) > 0;
            const isExpanded = expandedIds.has(node.id);
            const name = nodeName(node);

            return (
              <TableRow key={node.id}>
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
