import { once } from 'node:events';
import type { Writable } from 'node:stream';

import ExcelJS from 'exceljs';

import type { DatasetExportFormat } from './contract.js';
import type {
  DatasetCellValue,
  DatasetColumnRecord,
  DatasetRowRecord,
} from './dataset-repository.js';

export interface DatasetExportSource {
  batches: AsyncIterable<readonly DatasetRowRecord[]>;
  columns: readonly DatasetColumnRecord[];
}

// A fixed sheet name: app.dataset.name must not steer workbook structure either.
const WORKSHEET_NAME = 'data';

// Excel reads a UTF-8 CSV correctly only when it starts with the byte order mark; the importer strips it again.
const BYTE_ORDER_MARK = '\uFEFF';

const CSV_ROW_SEPARATOR = '\r\n';
const CSV_NEEDS_QUOTING = /["\n\r,]/;
// A spreadsheet evaluates a cell opening with one of these, so an uploaded cell could run on a reader's machine.
const CSV_FORMULA_LEAD = /^[=+\-@\t\r]/;

function toCsvField(value: DatasetCellValue): string {
  if (value === null) {
    return '';
  }

  const text = typeof value === 'string' ? value : String(value);
  // Prefixing keeps the value visible and inert. A dataset shared by grant is read by someone else.
  const inert = CSV_FORMULA_LEAD.test(text) ? `'${text}` : text;
  return CSV_NEEDS_QUOTING.test(inert)
    ? `"${inert.replaceAll('"', '""')}"`
    : inert;
}

function toRowValues(
  columns: readonly DatasetColumnRecord[],
  row: DatasetRowRecord,
): DatasetCellValue[] {
  return columns.map((column) => row.data[column.name] ?? null);
}

// Honours backpressure, so a slow client throttles the database reader instead of filling memory.
async function write(target: Writable, chunk: string): Promise<void> {
  if (!target.write(chunk)) {
    await once(target, 'drain');
  }
}

export async function writeDatasetCsv(
  target: Writable,
  source: DatasetExportSource,
): Promise<void> {
  const header = source.columns.map((column) => toCsvField(column.name));
  await write(
    target,
    `${BYTE_ORDER_MARK}${header.join(',')}${CSV_ROW_SEPARATOR}`,
  );

  for await (const batch of source.batches) {
    let chunk = '';

    for (const row of batch) {
      const fields = toRowValues(source.columns, row).map(toCsvField);
      chunk += `${fields.join(',')}${CSV_ROW_SEPARATOR}`;
    }

    if (chunk.length > 0) {
      await write(target, chunk);
    }
  }

  target.end();
}

// The streaming writer flushes every committed row into the zip, so no worksheet is ever fully resident.
export async function writeDatasetXlsx(
  target: Writable,
  source: DatasetExportSource,
): Promise<void> {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: target,
    // A shared string table would grow with the dataset, which is exactly what streaming must avoid.
    useSharedStrings: false,
    useStyles: false,
  });
  const worksheet = workbook.addWorksheet(WORKSHEET_NAME);
  worksheet.addRow(source.columns.map((column) => column.name)).commit();

  for await (const batch of source.batches) {
    for (const row of batch) {
      worksheet.addRow(toRowValues(source.columns, row)).commit();
    }
  }

  // Commits the open worksheet, finalizes the archive and ends the target stream.
  await workbook.commit();
}

export function writeDatasetExport(
  target: Writable,
  format: DatasetExportFormat,
  source: DatasetExportSource,
): Promise<void> {
  return format === 'csv'
    ? writeDatasetCsv(target, source)
    : writeDatasetXlsx(target, source);
}
