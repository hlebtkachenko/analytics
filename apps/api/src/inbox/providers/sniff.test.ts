import { describe, expect, it } from 'vitest';

import { providerOutputSchema } from '../contract.js';
import * as fixtures from './__fixtures__/index.js';
import { sniffBytes, toProviderOutput } from './sniff.js';

function sniff(bytes: Buffer) {
  return sniffBytes(fixtures.toSniffInput(bytes));
}

describe('sniffBytes', () => {
  it.each([
    ['a PDF', fixtures.pdf(), 'pdf', 'application/pdf'],
    ['a PNG', fixtures.png(), 'image', 'image/png'],
    ['a JPEG', fixtures.jpeg(), 'image', 'image/jpeg'],
    ['a WebP', fixtures.webp(), 'image', 'image/webp'],
    ['an ISDOC invoice', fixtures.isdoc(), 'isdoc_invoice', 'application/xml'],
    [
      'an ISDOCX package',
      fixtures.zip('invoice.isdoc'),
      'isdoc_invoice',
      'application/vnd.isdoc+zip',
    ],
    [
      'a Money S3 export',
      fixtures.moneyS3(),
      'money_s3_export',
      'application/xml',
    ],
    ['a Pohoda export', fixtures.pohoda(), 'pohoda_export', 'application/xml'],
    ['a CAMT statement', fixtures.camt(), 'camt_statement', 'application/xml'],
    ['a GPC statement', fixtures.gpc(), 'gpc_statement', 'text/plain'],
    ['a CSV table', fixtures.csv(), 'tabular', 'text/csv'],
    [
      'an XLSX workbook',
      fixtures.zip('xl/workbook.xml'),
      'tabular',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    ['plain text', fixtures.text(), 'text', 'text/plain'],
  ])('detects %s', (_name, bytes, detectedType, mediaType) => {
    const sniffed = sniff(bytes);

    expect(sniffed.detectedType).toBe(detectedType);
    expect(sniffed.mediaType).toBe(mediaType);
    expect(sniffed.issues).toEqual([]);
    expect(sniffed.confidence).toBeGreaterThan(0.5);
    expect(sniffed.reasons).toHaveLength(1);
    expect(sniffed.reasons[0]?.step).toBe('sniff');
  });

  it.each([
    ['an empty file', Buffer.alloc(0), 'empty'],
    ['a whitespace file', Buffer.from('  \n\n '), 'empty'],
    ['an encrypted PDF', fixtures.pdf(true), 'encrypted'],
    [
      'a password protected zip',
      fixtures.zip('invoice.isdoc', true),
      'password_protected',
    ],
    ['a tiny image', fixtures.png(512), 'decorative_image'],
    ['unknown XML', fixtures.unknownXml(), 'unsupported_type'],
    [
      'a zip of unknown content',
      fixtures.zip('readme.txt'),
      'unsupported_type',
    ],
    ['binary garbage', fixtures.binaryGarbage(), 'unreadable'],
  ])('raises %s as %s', (_name, bytes, code) => {
    const sniffed = sniff(bytes);

    expect(sniffed.issues.map((issue) => issue.code)).toEqual([code]);
  });

  it('never raises too_large: the size limit belongs to the upload boundary', () => {
    const large = fixtures.padded(fixtures.PDF_MAGIC, 2 * 65_536);

    expect(sniff(large).issues).toEqual([]);
  });

  it('reads the XML root without the byte order mark and the prolog', () => {
    const withBom = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      fixtures.isdoc(),
    ]);

    expect(sniff(withBom).detectedType).toBe('isdoc_invoice');
  });

  it('produces a valid provider output with an empty draft', () => {
    const output = toProviderOutput(sniff(fixtures.pdf()));

    expect(providerOutputSchema.parse(output)).toEqual(output);
    expect(output.draft).toEqual({});
    expect(output.legalEntityId).toBeUndefined();
  });
});
