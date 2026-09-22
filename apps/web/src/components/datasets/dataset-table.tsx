'use client';

import { DataGrid } from '@bap/design-system/blocks';
import type { GridColumn, GridRow } from '@bap/design-system/blocks';
import { useTranslation } from 'react-i18next';

import type {
  DatasetCell,
  DatasetColumn,
  DatasetRow,
} from '../../lib/datasets/client';

type DatasetTableProps = Readonly<{
  columns: readonly DatasetColumn[];
  rows: readonly DatasetRow[];
}>;

// Position keys keep a stored column name from colliding with the row number column.
function columnKey(column: DatasetColumn): string {
  return `column-${column.position}`;
}

// An absent cell reads as empty rather than as the word null.
function cellText(value: DatasetCell | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

export function DatasetTable({ columns, rows }: DatasetTableProps) {
  const { t } = useTranslation();
  const gridColumns: readonly GridColumn[] = [
    { header: t('datasets.rowNumber'), key: 'rowNumber' },
    ...columns.map((column) => ({
      header: column.name,
      key: columnKey(column),
    })),
  ];
  const gridRows: readonly GridRow[] = rows.map((row) => ({
    ...Object.fromEntries(
      columns.map((column) => [
        columnKey(column),
        cellText(row.data[column.name]),
      ]),
    ),
    id: String(row.rowNumber),
    rowNumber: String(row.rowNumber),
  }));

  return (
    <DataGrid
      columns={gridColumns}
      description={t('datasets.rowsDescription')}
      rows={gridRows}
      size="sm"
      title={t('datasets.rowsTitle')}
    />
  );
}
