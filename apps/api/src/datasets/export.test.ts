import { Writable } from 'node:stream';

import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { datasetExportFilename } from './contract.js';
import type {
  DatasetColumnRecord,
  DatasetRowRecord,
} from './dataset-repository.js';
import { writeDatasetCsv, writeDatasetXlsx } from './export.js';

const columns: DatasetColumnRecord[] = [
  { inferredType: 'text', name: 'label', position: 0 },
  { inferredType: 'number', name: 'count', position: 1 },
  { inferredType: 'boolean', name: 'flag', position: 2 },
];

function placeholderRow(rowNumber: number): DatasetRowRecord {
  return {
    data: {
      count: rowNumber,
      flag: rowNumber % 2 === 0,
      label: `row-${rowNumber}`,
    },
    rowNumber,
  };
}

// Records the moment the writer reads a cell, so batch handling is observable without any timing.
function observedRow(rowNumber: number, events: string[]): DatasetRowRecord {
  const data: Record<string, boolean | number | string | null> = {
    count: rowNumber,
    flag: rowNumber % 2 === 0,
  };
  Object.defineProperty(data, 'label', {
    enumerable: true,
    get: () => {
      events.push(`encode:${rowNumber}`);
      return `row-${rowNumber}`;
    },
  });

  return { data, rowNumber };
}

function collector(): { chunks: Buffer[]; target: Writable } {
  const chunks: Buffer[] = [];
  const target = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });

  return { chunks, target };
}

describe('writeDatasetCsv', () => {
  it('emits every batch before the next one is read', async () => {
    const events: string[] = [];
    const chunks: Buffer[] = [];
    const target = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        events.push(`write:${chunks.length}`);
        callback();
      },
    });
    async function* batches(): AsyncGenerator<readonly DatasetRowRecord[]> {
      for (let index = 0; index < 3; index += 1) {
        events.push(`read:${index}`);
        yield [placeholderRow(index)];
      }
    }

    await writeDatasetCsv(target, { batches: batches(), columns });

    // Structural, not timed: a batch can only be written after it is read and before the next read starts.
    expect(events).toEqual([
      'write:1',
      'read:0',
      'write:2',
      'read:1',
      'write:3',
      'read:2',
      'write:4',
    ]);
  });

  it('writes a byte order mark, a header and RFC 4180 quoting', async () => {
    const { chunks, target } = collector();
    async function* batches(): AsyncGenerator<readonly DatasetRowRecord[]> {
      yield [
        {
          data: {
            count: 1,
            flag: null,
            label: 'comma,and "quote"\r\nsecond line',
          },
          rowNumber: 0,
        },
      ];
    }

    await writeDatasetCsv(target, { batches: batches(), columns });

    expect(Buffer.concat(chunks).toString('utf8')).toBe(
      '\uFEFFlabel,count,flag\r\n"comma,and ""quote""\r\nsecond line",1,\r\n',
    );
  });

  it('keeps the column order and fills a missing key with an empty field', async () => {
    const { chunks, target } = collector();
    async function* batches(): AsyncGenerator<readonly DatasetRowRecord[]> {
      yield [{ data: { count: 7, label: 'row-0' }, rowNumber: 0 }];
    }

    await writeDatasetCsv(target, { batches: batches(), columns });

    expect(Buffer.concat(chunks).toString('utf8')).toBe(
      '\uFEFFlabel,count,flag\r\nrow-0,7,\r\n',
    );
  });
});

describe('writeDatasetXlsx', () => {
  it('commits every batch to the workbook before the next one is read', async () => {
    const events: string[] = [];
    const { target } = collector();
    async function* batches(): AsyncGenerator<readonly DatasetRowRecord[]> {
      for (let batch = 0; batch < 3; batch += 1) {
        events.push(`read:${batch}`);
        yield [
          observedRow(batch * 2, events),
          observedRow(batch * 2 + 1, events),
        ];
      }
    }

    await writeDatasetXlsx(target, { batches: batches(), columns });

    // Structural, not timed: every row of a batch reaches the writer before the next batch is requested.
    expect(events).toEqual([
      'read:0',
      'encode:0',
      'encode:1',
      'read:1',
      'encode:2',
      'encode:3',
      'read:2',
      'encode:4',
      'encode:5',
    ]);
  });

  it('produces a readable workbook with a header and one row per record', async () => {
    const { chunks, target } = collector();
    async function* batches(): AsyncGenerator<readonly DatasetRowRecord[]> {
      yield [placeholderRow(0), placeholderRow(1)];
      yield [placeholderRow(2)];
    }

    await writeDatasetXlsx(target, { batches: batches(), columns });
    const workbook = new ExcelJS.Workbook();
    // ExcelJS declares its own Buffer type, so the node Buffer crosses the boundary once, here.
    await workbook.xlsx.load(Buffer.concat(chunks) as unknown as ArrayBuffer);
    const worksheet = workbook.worksheets[0];

    expect(worksheet?.name).toBe('data');
    expect(worksheet?.rowCount).toBe(4);
    expect(worksheet?.getRow(1).values).toEqual([
      undefined,
      'label',
      'count',
      'flag',
    ]);
    expect(worksheet?.getRow(2).values).toEqual([undefined, 'row-0', 0, true]);
  });

  it('never writes a leading equals sign as a formula', async () => {
    const { chunks, target } = collector();
    async function* batches(): AsyncGenerator<readonly DatasetRowRecord[]> {
      yield [{ data: { count: 0, flag: false, label: '=1+1' }, rowNumber: 0 }];
    }

    await writeDatasetXlsx(target, { batches: batches(), columns });
    const workbook = new ExcelJS.Workbook();
    // ExcelJS declares its own Buffer type, so the node Buffer crosses the boundary once, here.
    await workbook.xlsx.load(Buffer.concat(chunks) as unknown as ArrayBuffer);
    const cell = workbook.worksheets[0]?.getRow(2).getCell(1);

    expect(cell?.value).toBe('=1+1');
    expect(cell?.formula).toBeUndefined();
  });
});

describe('datasetExportFilename', () => {
  it('derives the name from the dataset id only', () => {
    expect(
      datasetExportFilename('2f1c4a4e-6f0d-4f0a-9b3e-0d5b5c8a1e77', 'csv'),
    ).toBe('dataset-2f1c4a4e-6f0d-4f0a-9b3e-0d5b5c8a1e77.csv');
    expect(
      datasetExportFilename('2f1c4a4e-6f0d-4f0a-9b3e-0d5b5c8a1e77', 'xlsx'),
    ).toBe('dataset-2f1c4a4e-6f0d-4f0a-9b3e-0d5b5c8a1e77.xlsx');
  });

  it('refuses anything that is not a dataset identifier', () => {
    expect(() => datasetExportFilename('report"; rm', 'csv')).toThrow();
  });
});

describe('csv formula neutralization', () => {
  it('prefixes a cell a spreadsheet would evaluate', async () => {
    const { chunks, target } = collector();
    await writeDatasetCsv(target, {
      batches: (async function* () {
        yield [
          {
            data: {
              formula: '=1+1',
              hyphen: '-2+3',
              plain: 'value',
              plus: '+1',
              summons: '@SUM(A1)',
            },
            rowNumber: 0,
          },
        ];
      })(),
      columns: [
        { inferredType: 'text', name: 'formula', position: 0 },
        { inferredType: 'text', name: 'hyphen', position: 1 },
        { inferredType: 'text', name: 'plain', position: 2 },
        { inferredType: 'text', name: 'plus', position: 3 },
        { inferredType: 'text', name: 'summons', position: 4 },
      ],
    });

    const csv = Buffer.concat(chunks).toString('utf8');
    // Every dangerous lead is inert, the value stays readable, and a plain cell is untouched.
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'-2+3");
    expect(csv).toContain("'+1");
    expect(csv).toContain("'@SUM(A1)");
    expect(csv).toMatch(/(^|,)value(,|\r\n)/m);
  });
});
