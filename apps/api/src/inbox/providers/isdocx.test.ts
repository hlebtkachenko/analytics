import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { MAX_ATTACHMENT_BYTES } from '../../worker/split-email-item.js';
import { parseIsdocBytes } from '../../worker/parse-inbox-item.js';
import {
  isdocInvoice,
  isdocManifest,
  zipArchive,
  type ZipEntryFixture,
  type ZipFixtureOptions,
} from './__fixtures__/index.js';
import { MAX_XML_BYTES } from './isdoc.js';
import { MAX_ISDOCX_BYTES, MAX_MANIFEST_BYTES, readIsdocx } from './isdocx.js';

const MAIN = 'invoice.isdoc';

function main(overrides: Partial<ZipEntryFixture> = {}): ZipEntryFixture {
  return { data: isdocInvoice(), name: MAIN, ...overrides };
}

function manifest(filename = MAIN, extra = ''): ZipEntryFixture {
  return { data: isdocManifest(filename, extra), name: 'manifest.xml' };
}

function read(
  entries: readonly ZipEntryFixture[],
  options: ZipFixtureOptions = {},
): string {
  const result = readIsdocx(zipArchive(entries, options));
  return result.ok ? 'ok' : result.failure.code;
}

describe('readIsdocx', () => {
  it('reads the main document the manifest names and parses it', () => {
    const bytes = zipArchive([
      manifest(),
      main(),
      { data: Buffer.from('%PDF-1.7 placeholder'), name: 'preview.pdf' },
    ]);
    const result = readIsdocx(bytes);

    expect(result.ok && result.xml.equals(isdocInvoice())).toBe(true);
    const parsed = parseIsdocBytes(bytes);
    expect(parsed.ok && parsed.parsed.issues).toEqual([]);
  });

  it('takes the one root .isdoc entry when there is no manifest, stored or deflated', () => {
    expect(read([main()])).toBe('ok');
    expect(read([main({ method: 0 })])).toBe('ok');
    expect(read([{ data: Buffer.alloc(0), name: 'folder/' }, main()])).toBe(
      'ok',
    );
  });

  it('refuses no main document, two root .isdoc entries, or one only in a folder', () => {
    expect(read([{ data: Buffer.from('x'), name: 'note.txt' }])).toBe(
      'unreadable',
    );
    expect(read([main(), main({ name: 'second.isdoc' })])).toBe('unreadable');
    expect(read([main({ name: 'folder/invoice.isdoc' })])).toBe('unreadable');
  });

  it('refuses a manifest naming no single, usable main document', () => {
    expect(read([manifest('missing.isdoc'), main()])).toBe('unreadable');
    expect(read([manifest('invoice%2Eisdoc'), main()])).toBe('unreadable');
    expect(read([manifest('manifest.xml'), main()])).toBe('unreadable');
    expect(
      read([
        manifest('folder/'),
        { data: Buffer.alloc(0), name: 'folder/' },
        main(),
      ]),
    ).toBe('unreadable');
    expect(
      read([
        manifest(MAIN, '<maindocument filename="second.isdoc"/>'),
        main(),
        main({ name: 'second.isdoc' }),
      ]),
    ).toBe('unreadable');
    expect(
      read([
        {
          data: Buffer.from(
            '<manifest xmlns="urn:other"><maindocument filename="invoice.isdoc"/></manifest>',
          ),
          name: 'manifest.xml',
        },
        main(),
      ]),
    ).toBe('unreadable');
    expect(
      read([
        { ...manifest(), name: 'Manifest.xml' },
        main(),
        main({ name: 'b.isdoc' }),
      ]),
    ).toBe('unreadable');
  });

  it('caps the manifest at 64 KB before inflating it', () => {
    expect(
      read([
        manifest(MAIN, `<!-- ${'x'.repeat(MAX_MANIFEST_BYTES)} -->`),
        main(),
      ]),
    ).toBe('too_large');
  });

  it('takes the last end record whose directory fits, ignoring a signature in the comment or in a stored entry', () => {
    const fake = Buffer.alloc(22);
    fake.writeUInt32LE(0x06054b50, 0);
    fake.writeUInt16LE(1, 10);
    fake.writeUInt32LE(9999, 12);

    expect(
      read([main()], { comment: Buffer.concat([fake, Buffer.from('tail')]) }),
    ).toBe('ok');
    expect(
      read([
        {
          data: Buffer.concat([Buffer.from('x'), fake]),
          method: 0,
          name: 'blob.bin',
        },
        main(),
      ]),
    ).toBe('ok');
  });

  it('refuses a file with no end record', () => {
    expect(readIsdocx(Buffer.from('PK\x03\x04 not an archive')).ok).toBe(false);
    const result = readIsdocx(Buffer.from('PK\x03\x04 not an archive'));
    expect(!result.ok && result.failure.code).toBe('unreadable');
  });

  it('refuses ZIP64 markers, a ZIP64 locator and a split archive as unsupported_type', () => {
    expect(read([main()], { entries: 0xffff, diskEntries: 0xffff })).toBe(
      'unsupported_type',
    );
    expect(read([main()], { zip64Locator: true })).toBe('unsupported_type');
    expect(read([main({ centralSize: 0xffffffff })])).toBe('unsupported_type');
    expect(read([main({ localOffset: 0xffffffff })])).toBe('unsupported_type');
    expect(read([main({ diskStart: 0xffff })])).toBe('unsupported_type');
    expect(read([main()], { disk: 1 })).toBe('unsupported_type');
    expect(read([main()], { centralDisk: 1 })).toBe('unsupported_type');
  });

  it('refuses an entry count that does not match the directory', () => {
    expect(read([main()], { entries: 2, diskEntries: 2 })).toBe('unreadable');
    expect(read([main()], { centralOffset: 3 })).toBe('unreadable');
  });

  it('reads sizes from the central directory and only names from the local header', () => {
    expect(read([main({ localName: 'other.isdoc' })])).toBe('unreadable');
    // Bit 3 means the local header left the sizes to a descriptor; the central values are used instead.
    expect(read([main({ flags: 0x0008 })])).toBe('ok');
  });

  it('refuses offsets past the file, overlapping entries and a file entry with no size', () => {
    expect(read([main({ localOffset: 10_000_000 })])).toBe('unreadable');
    expect(read([main(), main({ localOffset: 0, name: 'copy.bin' })])).toBe(
      'unreadable',
    );
    expect(
      read([main(), { data: Buffer.alloc(0), method: 0, name: 'empty.txt' }]),
    ).toBe('unreadable');
    expect(read([main({ centralCompressedSize: 5_000_000 })])).toBe(
      'unreadable',
    );
  });

  it('refuses encrypted, patched and unknown-method entries', () => {
    expect(read([main({ flags: 0x0001 })])).toBe('password_protected');
    expect(read([main({ flags: 0x0040 })])).toBe('password_protected');
    expect(read([main({ flags: 0x0020 })])).toBe('unreadable');
    const bzip = zipArchive([main({ method: 0 })]);
    const central = bzip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bzip.writeUInt16LE(12, central + 10);
    const result = readIsdocx(bzip);
    expect(!result.ok && result.failure.code).toBe('unsupported_type');
  });

  it.each([
    ['a parent segment', 'a/../invoice.isdoc'],
    ['a leading slash', '/invoice.isdoc'],
    ['a backslash', 'a\\invoice.isdoc'],
    ['a colon', 'c:invoice.isdoc'],
    ['a NUL', 'invoice\0.isdoc'],
  ])('refuses a name with %s', (_name, name) => {
    expect(read([main(), { data: Buffer.from('x'), name }])).toBe('unreadable');
  });

  it('refuses two entries with the same name bytes', () => {
    expect(read([manifest(), main(), main()])).toBe('unreadable');
  });

  it('caps entries, declared bytes, ratio and the archive from central values before any inflate', () => {
    const many = Array.from({ length: 50 }, (_, index) => ({
      data: Buffer.from('x'),
      method: 0 as const,
      name: `f${index}.txt`,
    }));
    const stored = randomBytes(300_000);

    expect(read([main(), ...many])).toBe('too_large');
    expect(read([main(), ...many.slice(1)])).toBe('ok');
    expect(
      read([
        main(),
        { centralSize: 27_000_000, data: stored, method: 0, name: 'a.bin' },
        { centralSize: 27_000_000, data: stored, method: 0, name: 'b.bin' },
      ]),
    ).toBe('too_large');
    expect(
      read([main(), { data: Buffer.alloc(1_000_000), name: 'bomb.bin' }]),
    ).toBe('too_large');
    expect(MAX_ISDOCX_BYTES).toBe(MAX_ATTACHMENT_BYTES);
    const oversized = readIsdocx(Buffer.alloc(MAX_ISDOCX_BYTES + 1));
    expect(!oversized.ok && oversized.failure.code).toBe('too_large');
  });

  it('caps the main document at the XML cap before inflating it', () => {
    expect(
      read([
        main({
          centralSize: MAX_XML_BYTES + 1,
          data: randomBytes(60_000),
          method: 0,
        }),
      ]),
    ).toBe('too_large');
  });

  it('refuses a stored length, an inflated length or a CRC other than the declared one', () => {
    const data = isdocInvoice();

    expect(read([main({ centralSize: data.length + 1, method: 0 })])).toBe(
      'unreadable',
    );
    expect(read([main({ centralSize: data.length - 1 })])).toBe('unreadable');
    expect(read([main({ centralSize: data.length + 1 })])).toBe('unreadable');
    expect(read([main({ crc: 1 })])).toBe('unreadable');
  });

  it('parses a plain XML and an archive through the same entry point', () => {
    const plain = parseIsdocBytes(isdocInvoice());
    const refused = parseIsdocBytes(zipArchive([main({ flags: 0x0001 })]));

    expect(plain.ok).toBe(true);
    expect(!refused.ok && refused.failure.code).toBe('password_protected');
  });
});
