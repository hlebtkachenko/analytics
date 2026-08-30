import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DatasetParseError,
  inferColumnTypes,
  openDataset,
  resolveDatasetFormat,
} from './parser.js';
import type { DatasetValue } from './parser.js';

let directory: string;

async function writeCsv(name: string, content: string): Promise<string> {
  const path = join(directory, name);
  await writeFile(path, content, 'utf8');
  return path;
}

async function writeWorkbook(
  name: string,
  rows: readonly (readonly (boolean | number | string)[])[],
): Promise<string> {
  const path = join(directory, name);
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: path });
  const sheet = workbook.addWorksheet('Sheet1');

  for (const row of rows) {
    sheet.addRow([...row]).commit();
  }

  sheet.commit();
  await workbook.commit();
  return path;
}

async function collect(path: string, format: 'csv' | 'xlsx') {
  const dataset = await openDataset(path, format);
  const rows: (readonly DatasetValue[])[] = [];

  for await (const row of dataset.rows) {
    rows.push(row);
  }

  return { columns: dataset.columns, rows };
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'bap-parser-'));
});

afterAll(async () => {
  await rm(directory, { force: true, recursive: true });
});

describe('resolveDatasetFormat', () => {
  it('accepts only the two supported extensions', () => {
    expect(resolveDatasetFormat('input.csv')).toBe('csv');
    expect(resolveDatasetFormat('INPUT.CSV')).toBe('csv');
    expect(resolveDatasetFormat('input.xlsx')).toBe('xlsx');
    expect(resolveDatasetFormat('input.xlsx.exe')).toBeNull();
    expect(resolveDatasetFormat('input')).toBeNull();
  });
});

describe('CSV parsing', () => {
  it('reads quoted values, mixed line endings and a byte order mark', async () => {
    const path = await writeCsv(
      'basic.csv',
      '\uFEFFlabel,amount,flag\r\n"first, item",10,true\r\n"quote ""inside""",20,false\n\nlast,30,true\n',
    );

    await expect(collect(path, 'csv')).resolves.toEqual({
      columns: ['label', 'amount', 'flag'],
      rows: [
        ['first, item', '10', 'true'],
        ['quote "inside"', '20', 'false'],
        ['last', '30', 'true'],
      ],
    });
  });

  it('pads a short row and names unlabelled and repeated headers', async () => {
    const path = await writeCsv('shape.csv', 'label,,label\nonly\n');

    await expect(collect(path, 'csv')).resolves.toEqual({
      columns: ['label', 'column_2', 'label_2'],
      rows: [['only', null, null]],
    });
  });

  it('rejects a row wider than its header and names the position only', async () => {
    const path = await writeCsv('wide.csv', 'a,b\n1,2\n1,2,3\n');

    await expect(collect(path, 'csv')).rejects.toThrow(
      new DatasetParseError(
        'Row 2 has 3 values but the header declares 2.',
      ) as Error,
    );
  });

  it('rejects a file that ends inside a quoted value', async () => {
    const path = await writeCsv('unterminated.csv', 'a,b\n"open,2\n');

    await expect(collect(path, 'csv')).rejects.toThrow(DatasetParseError);
  });

  it('rejects an empty file', async () => {
    const path = await writeCsv('empty.csv', '');

    await expect(collect(path, 'csv')).rejects.toThrow(
      new DatasetParseError('The file has no header row.') as Error,
    );
  });
});

describe('XLSX parsing', () => {
  it('reads the first worksheet and skips a blank row', async () => {
    const path = await writeWorkbook('basic.xlsx', [
      ['label', 'amount', 'flag'],
      ['first', 10, true],
      [],
      ['second', 20.5, false],
    ]);

    await expect(collect(path, 'xlsx')).resolves.toEqual({
      columns: ['label', 'amount', 'flag'],
      rows: [
        ['first', 10, true],
        ['second', 20.5, false],
      ],
    });
  });
});

describe('declared format against content', () => {
  it('rejects a workbook declared as CSV', async () => {
    const path = await writeWorkbook('mislabelled.xlsx', [['label'], ['one']]);

    await expect(collect(path, 'csv')).rejects.toThrow(
      new DatasetParseError(
        'The file is declared as CSV but contains a workbook.',
      ) as Error,
    );
  });

  it('rejects plain text declared as XLSX', async () => {
    const path = await writeCsv('mislabelled.csv', 'label\none\n');

    await expect(collect(path, 'xlsx')).rejects.toThrow(
      new DatasetParseError(
        'The file is declared as XLSX but is not a workbook.',
      ) as Error,
    );
  });
});

describe('inferColumnTypes', () => {
  it('reports one type per column and collapses a disagreeing column to text', () => {
    const inferred = inferColumnTypes(
      [
        ['1', 'true', '2026-01-02', 'alpha', null],
        ['2', 'false', '2026-01-03', '7', ''],
      ],
      5,
    );

    expect(inferred).toEqual([
      'number',
      'boolean',
      'timestamp',
      'text',
      'text',
    ]);
  });
});
