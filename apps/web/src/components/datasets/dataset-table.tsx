'use client';

import {
  DataTable,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@bap/design-system/react';
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
  const headers = [
    { header: t('datasets.rowNumber'), key: 'rowNumber' },
    ...columns.map((column) => ({
      header: column.name,
      key: columnKey(column),
    })),
  ];
  const tableRows = rows.map((row) => ({
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
    <DataTable headers={headers} rows={tableRows} size="sm">
      {({ getTableProps, headers: renderedHeaders, rows: renderedRows }) => (
        <TableContainer
          description={t('datasets.rowsDescription')}
          title={t('datasets.rowsTitle')}
        >
          <Table {...getTableProps()} aria-label={t('datasets.rowsTitle')}>
            <TableHead>
              <TableRow>
                {renderedHeaders.map((header) => (
                  <TableHeader key={header.key} scope="col">
                    {header.header}
                  </TableHeader>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {renderedRows.map((row) => (
                <TableRow key={row.id}>
                  {row.cells.map((cell) => (
                    <TableCell key={cell.id}>{String(cell.value)}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </DataTable>
  );
}
