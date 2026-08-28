'use client';

import {
  Heading,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import type { ReactNode } from 'react';

export type ChartTableColumn = Readonly<{
  key: string;
  label: string;
}>;

export type ChartTableRow = Readonly<{
  id: string;
  values: Readonly<Record<string, number | string>>;
}>;

export type ChartTable = Readonly<{
  columns: readonly ChartTableColumn[];
  description?: string;
  label: string;
  rows: readonly ChartTableRow[];
}>;

export type ChartFrameProps = Readonly<{
  children: ReactNode;
  description?: string;
  missingValueLabel?: string;
  table: ChartTable;
  title: string;
}>;

export function ChartFrame({
  children,
  description,
  missingValueLabel = 'Not available',
  table,
  title,
}: ChartFrameProps) {
  return (
    <Stack gap={7}>
      <figure>
        <figcaption>
          <Heading>{title}</Heading>
          {description ? <p>{description}</p> : null}
        </figcaption>
        {children}
      </figure>
      <TableContainer description={table.description} title={table.label}>
        <Table aria-label={table.label}>
          <TableHead>
            <TableRow>
              {table.columns.map((column) => (
                <TableHeader key={column.key} scope="col">
                  {column.label}
                </TableHeader>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {table.rows.map((row) => (
              <TableRow key={row.id}>
                {table.columns.map((column) => (
                  <TableCell key={column.key}>
                    {row.values[column.key] ?? missingValueLabel}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  );
}
