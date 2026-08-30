import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';

import ExcelJS from 'exceljs';
import type { Cell } from 'exceljs';

export type DatasetFormat = 'csv' | 'xlsx';
export type DatasetValue = boolean | number | string | null;
export type InferredColumnType = 'boolean' | 'number' | 'text' | 'timestamp';

export const MAX_COLUMNS = 512;
const MAX_COLUMN_NAME_LENGTH = 128;
const MAX_VALUE_LENGTH = 32_768;
const BYTE_ORDER_MARK = '\uFEFF';
// Every XLSX file is a zip archive, so its first four bytes are the local file header signature.
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

// Messages are recorded in app.upload.error, so they carry positions only and never cell content.
export class DatasetParseError extends Error {}

export interface ParsedDataset {
  columns: readonly string[];
  rows: AsyncIterable<readonly DatasetValue[]>;
}

export function resolveDatasetFormat(filename: string): DatasetFormat | null {
  const extension = filename.slice(filename.lastIndexOf('.')).toLowerCase();

  if (extension === '.csv') {
    return 'csv';
  }

  return extension === '.xlsx' ? 'xlsx' : null;
}

async function assertContentMatchesFormat(
  filePath: string,
  format: DatasetFormat,
): Promise<void> {
  const handle = await open(filePath, 'r');

  try {
    const head = Buffer.alloc(ZIP_MAGIC.length);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    const archive = bytesRead === ZIP_MAGIC.length && head.equals(ZIP_MAGIC);

    if (format === 'xlsx' && !archive) {
      throw new DatasetParseError(
        'The file is declared as XLSX but is not a workbook.',
      );
    }

    if (format === 'csv' && archive) {
      throw new DatasetParseError(
        'The file is declared as CSV but contains a workbook.',
      );
    }
  } finally {
    await handle.close();
  }
}

// A hand written state machine rather than the ExcelJS CSV reader, which materializes a worksheet.
async function* readCsvRecords(
  filePath: string,
): AsyncGenerator<readonly string[]> {
  const source = createReadStream(filePath, { encoding: 'utf8' });
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let quotePending = false;
  let started = false;

  const closeField = (): void => {
    if (field.length > MAX_VALUE_LENGTH) {
      throw new DatasetParseError('A value exceeds the supported length.');
    }

    record.push(field);
    field = '';

    if (record.length > MAX_COLUMNS) {
      throw new DatasetParseError('The file has more columns than supported.');
    }
  };

  try {
    for await (const chunk of source) {
      let text = chunk as string;

      if (!started) {
        started = true;
        text = text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text;
      }

      for (const character of text) {
        if (quoted && !quotePending) {
          if (character === '"') {
            quotePending = true;
          } else {
            field += character;
          }
          continue;
        }

        if (quotePending) {
          quotePending = false;

          if (character === '"') {
            field += '"';
            continue;
          }

          quoted = false;
        }

        if (character === '"' && field.length === 0) {
          quoted = true;
        } else if (character === ',') {
          closeField();
        } else if (character === '\n') {
          closeField();

          if (record.some((value) => value.length > 0)) {
            yield record;
          }

          record = [];
        } else if (character !== '\r') {
          field += character;
        }
      }
    }
  } finally {
    source.destroy();
  }

  if (quoted && !quotePending) {
    throw new DatasetParseError('The file ends inside a quoted value.');
  }

  if (field.length > 0 || record.length > 0) {
    closeField();

    if (record.some((value) => value.length > 0)) {
      yield record;
    }
  }
}

function toDatasetValue(cell: Cell): DatasetValue {
  const { value } = cell;

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const text = cell.text;

  if (text.length > MAX_VALUE_LENGTH) {
    throw new DatasetParseError('A value exceeds the supported length.');
  }

  return text;
}

// ExcelJS streams the sheet XML row by row; only the shared string table is held in memory.
async function* readXlsxRecords(
  filePath: string,
): AsyncGenerator<readonly DatasetValue[]> {
  const source = createReadStream(filePath);

  try {
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(source, {
      entries: 'ignore',
      hyperlinks: 'ignore',
      sharedStrings: 'cache',
      styles: 'cache',
      worksheets: 'emit',
    });

    for await (const worksheet of reader) {
      for await (const row of worksheet) {
        if (row.cellCount > MAX_COLUMNS) {
          throw new DatasetParseError(
            'The file has more columns than supported.',
          );
        }

        const values: DatasetValue[] = [];

        for (let index = 1; index <= row.cellCount; index += 1) {
          values.push(toDatasetValue(row.getCell(index)));
        }

        if (values.some((value) => value !== null && value !== '')) {
          yield values;
        }
      }

      // One dataset is one table, so only the first worksheet is ingested.
      break;
    }
  } finally {
    source.destroy();
  }
}

function normalizeColumnNames(header: readonly DatasetValue[]): string[] {
  if (header.length === 0) {
    throw new DatasetParseError('The header row is empty.');
  }

  if (header.length > MAX_COLUMNS) {
    throw new DatasetParseError('The file has more columns than supported.');
  }

  const used = new Set<string>();

  return header.map((value, index) => {
    const label = value === null ? '' : String(value).trim();
    const base = (label === '' ? `column_${index + 1}` : label).slice(
      0,
      MAX_COLUMN_NAME_LENGTH,
    );
    let candidate = base;
    let attempt = 2;

    // app.dataset_column requires one name per dataset, so a repeated header gets a counter.
    while (used.has(candidate)) {
      candidate = `${base.slice(0, MAX_COLUMN_NAME_LENGTH - 8)}_${attempt}`;
      attempt += 1;
    }

    used.add(candidate);
    return candidate;
  });
}

async function* alignRows(
  records: AsyncGenerator<readonly DatasetValue[]>,
  width: number,
): AsyncGenerator<readonly DatasetValue[]> {
  let position = 0;

  for await (const record of records) {
    position += 1;

    if (record.length > width) {
      throw new DatasetParseError(
        `Row ${position} has ${record.length} values but the header declares ${width}.`,
      );
    }

    const row: DatasetValue[] = [];

    for (let index = 0; index < width; index += 1) {
      row.push(record[index] ?? null);
    }

    yield row;
  }
}

export async function openDataset(
  filePath: string,
  format: DatasetFormat,
): Promise<ParsedDataset> {
  await assertContentMatchesFormat(filePath, format);
  const records: AsyncGenerator<readonly DatasetValue[]> =
    format === 'csv' ? readCsvRecords(filePath) : readXlsxRecords(filePath);
  const header = await records.next();

  if (header.done === true) {
    throw new DatasetParseError('The file has no header row.');
  }

  const columns = normalizeColumnNames(header.value);
  return { columns, rows: alignRows(records, columns.length) };
}

function classify(value: DatasetValue): InferredColumnType | null {
  if (value === null || value === '') {
    return null;
  }

  if (typeof value === 'boolean') {
    return 'boolean';
  }

  if (typeof value === 'number') {
    return 'number';
  }

  const text = value.trim();

  if (/^(true|false)$/i.test(text)) {
    return 'boolean';
  }

  if (/^-?\d+(\.\d+)?$/.test(text)) {
    return 'number';
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(text) && !Number.isNaN(Date.parse(text))) {
    return 'timestamp';
  }

  return 'text';
}

// A parse and display hint drawn from a bounded sample, never a guarantee about any value.
// One disagreeing value collapses the column to text so the hint cannot over-promise.
export function inferColumnTypes(
  sample: readonly (readonly DatasetValue[])[],
  width: number,
): InferredColumnType[] {
  const inferred: (InferredColumnType | null)[] = Array.from(
    { length: width },
    () => null,
  );

  for (const row of sample) {
    for (let index = 0; index < width; index += 1) {
      const observed = classify(row[index] ?? null);
      const current = inferred[index];

      if (observed === null || current === observed) {
        continue;
      }

      inferred[index] = current === null ? observed : 'text';
    }
  }

  return inferred.map((type) => type ?? 'text');
}
