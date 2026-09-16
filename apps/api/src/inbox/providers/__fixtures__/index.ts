// Synthetic byte fixtures for the sniff provider: every one is built here, none is a real customer file.

import type { SniffInput } from '../sniff.js';

export const PDF_MAGIC = Buffer.from('%PDF-1.7\n');
export const PNG_MAGIC = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
export const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

export function toSniffInput(bytes: Buffer, window = 65_536): SniffInput {
  return {
    byteSize: bytes.length,
    head: bytes.subarray(0, window),
    tail: bytes.subarray(Math.max(0, bytes.length - window)),
  };
}

// Pads a header to a realistic size so the decorative image threshold does not fire.
export function padded(prefix: Buffer, size: number): Buffer {
  return Buffer.concat([
    prefix,
    Buffer.alloc(Math.max(0, size - prefix.length), 0x41),
  ]);
}

export function pdf(encrypted = false): Buffer {
  const trailer = encrypted
    ? 'trailer\n<< /Root 1 0 R /Encrypt 5 0 R >>\n%%EOF\n'
    : 'trailer\n<< /Root 1 0 R >>\n%%EOF\n';
  return Buffer.concat([
    PDF_MAGIC,
    Buffer.from('1 0 obj\n<< >>\nendobj\n'),
    Buffer.from(trailer),
  ]);
}

export function png(size = 16_384): Buffer {
  return padded(PNG_MAGIC, size);
}

export function jpeg(size = 16_384): Buffer {
  return padded(JPEG_MAGIC, size);
}

export function webp(size = 16_384): Buffer {
  const header = Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP'),
  ]);
  return padded(header, size);
}

// A minimal stored zip: one local file header followed by a central directory naming the entry.
export function zip(entryName: string, passwordProtected = false): Buffer {
  const name = Buffer.from(entryName);
  const flags = passwordProtected ? 0x0001 : 0x0000;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(flags, 6);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(flags, 8);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  return Buffer.concat([local, name, central, name, end]);
}

export function isdoc(): Buffer {
  return Buffer.from(
    '<?xml version="1.0" encoding="utf-8"?>\n<Invoice xmlns="http://isdoc.cz/namespace/2013" version="6.0.1"><DocumentType>1</DocumentType></Invoice>',
  );
}

export function moneyS3(): Buffer {
  return Buffer.from(
    '<?xml version="1.0" encoding="windows-1250"?>\n<!-- export -->\n<MoneyData ICAgendy="00000000"><SeznamFaktPrij/></MoneyData>',
  );
}

export function pohoda(): Buffer {
  return Buffer.from(
    '<?xml version="1.0" encoding="Windows-1250"?><dat:dataPack xmlns:dat="http://www.stormware.cz/schema/version_2/data.xsd" id="x" version="2.0"></dat:dataPack>',
  );
}

export function camt(): Buffer {
  return Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt/></Document>',
  );
}

export function unknownXml(): Buffer {
  return Buffer.from('<?xml version="1.0"?><note><to>placeholder</to></note>');
}

export function gpc(): Buffer {
  const header = `074${'0'.repeat(16)}${'PLACEHOLDER ACCOUNT'.padEnd(20)}${'0'.repeat(14)}${'0'.repeat(20)}${'0'.repeat(20)}${'0'.repeat(20)}${'0'.repeat(20)}`;
  return Buffer.from(`${header.padEnd(128, '0')}\r\n075${'0'.repeat(125)}\r\n`);
}

export function csv(): Buffer {
  return Buffer.from('date;amount;note\n2026-01-01;100;a\n2026-01-02;200;b\n');
}

export function text(): Buffer {
  return Buffer.from('A short note somebody typed.\nSecond line.\n');
}

export function binaryGarbage(): Buffer {
  return Buffer.from([0x00, 0x01, 0x02, 0xfe, 0xff, 0x10, 0x00, 0x7f]);
}
