import { crc32, inflateRawSync } from 'node:zlib';

import {
  IsdocReadError,
  MAX_XML_BYTES,
  children,
  readXml,
  type IsdocFailure,
  type XmlElement,
} from './isdoc.js';

export const ISDOC_MANIFEST_NAMESPACE =
  'http://isdoc.cz/namespace/2013/manifest';
const MANIFEST_NAME = 'manifest.xml';

// The whole archive stays under the email attachment cap (MAX_ATTACHMENT_BYTES of the split).
export const MAX_ISDOCX_BYTES = 25_000_000;
export const MAX_ISDOCX_ENTRIES = 50;
export const MAX_ISDOCX_DECLARED_BYTES = 50 * 1024 * 1024;
export const MAX_ISDOCX_RATIO = 100;
export const MAX_MANIFEST_BYTES = 64 * 1024;

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_LENGTH = 22;
const CENTRAL_LENGTH = 46;
const LOCAL_LENGTH = 30;
// The EOCD record plus the longest comment it may carry.
const EOCD_SEARCH_BYTES = EOCD_LENGTH + 0xffff;
const U16_MARKER = 0xffff;
const U32_MARKER = 0xffffffff;

interface CentralEntry {
  compressedSize: number;
  crc: number;
  directory: boolean;
  flags: number;
  localOffset: number;
  method: number;
  name: Buffer;
  size: number;
}

interface LocatedEntry extends CentralEntry {
  dataEnd: number;
  dataStart: number;
}

export type IsdocxReadResult =
  { failure: IsdocFailure; ok: false } | { ok: true; xml: Buffer };

function refuse(code: IsdocFailure['code'], message: string): never {
  throw new IsdocReadError(code, message);
}

interface EndRecord {
  centralOffset: number;
  centralSize: number;
  entries: number;
}

// Walks the central directory; null when it does not hold exactly the declared entry count.
function walkCentral(
  bytes: Buffer,
  end: EndRecord,
  endOffset: number,
): CentralEntry[] | null {
  if (end.centralOffset + end.centralSize > endOffset) {
    return null;
  }

  const entries: CentralEntry[] = [];
  let offset = end.centralOffset;
  const limit = end.centralOffset + end.centralSize;

  while (offset < limit) {
    if (
      offset + CENTRAL_LENGTH > limit ||
      bytes.readUInt32LE(offset) !== CENTRAL_SIGNATURE
    ) {
      return null;
    }

    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const next =
      offset + CENTRAL_LENGTH + nameLength + extraLength + commentLength;

    if (next > limit) {
      return null;
    }

    const name = bytes.subarray(
      offset + CENTRAL_LENGTH,
      offset + CENTRAL_LENGTH + nameLength,
    );
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const size = bytes.readUInt32LE(offset + 24);
    const localOffset = bytes.readUInt32LE(offset + 42);

    if (
      compressedSize === U32_MARKER ||
      size === U32_MARKER ||
      localOffset === U32_MARKER ||
      bytes.readUInt16LE(offset + 34) === U16_MARKER
    ) {
      refuse('unsupported_type', 'The archive uses ZIP64.');
    }

    entries.push({
      compressedSize,
      crc: bytes.readUInt32LE(offset + 16),
      directory: name.at(-1) === 0x2f,
      flags: bytes.readUInt16LE(offset + 8),
      localOffset,
      method: bytes.readUInt16LE(offset + 10),
      name,
      size,
    });
    offset = next;
  }

  return entries.length === end.entries ? entries : null;
}

// The last EOCD signature whose directory fits before it and holds its entry count, so a signature inside a
// comment or a stored entry cannot redirect the reader.
function readCentral(bytes: Buffer): CentralEntry[] {
  const floor = Math.max(0, bytes.length - EOCD_SEARCH_BYTES);

  for (let offset = bytes.length - EOCD_LENGTH; offset >= floor; offset -= 1) {
    if (bytes.readUInt32LE(offset) !== EOCD_SIGNATURE) {
      continue;
    }

    const disk = bytes.readUInt16LE(offset + 4);
    const centralDisk = bytes.readUInt16LE(offset + 6);
    const diskEntries = bytes.readUInt16LE(offset + 8);
    const entries = bytes.readUInt16LE(offset + 10);
    const centralSize = bytes.readUInt32LE(offset + 12);
    const centralOffset = bytes.readUInt32LE(offset + 16);

    if (
      entries === U16_MARKER ||
      diskEntries === U16_MARKER ||
      centralSize === U32_MARKER ||
      centralOffset === U32_MARKER ||
      (offset >= 20 &&
        bytes.readUInt32LE(offset - 20) === ZIP64_LOCATOR_SIGNATURE)
    ) {
      refuse('unsupported_type', 'The archive uses ZIP64.');
    }

    const central = walkCentral(
      bytes,
      { centralOffset, centralSize, entries },
      offset,
    );

    if (central === null) {
      continue;
    }

    if (disk !== 0 || centralDisk !== 0 || diskEntries !== entries) {
      refuse('unsupported_type', 'The archive is split across disks.');
    }

    return central;
  }

  return refuse('unreadable', 'The archive has no usable end record.');
}

function hasUnsafeName(name: Buffer): boolean {
  const value = name.toString('latin1');

  return (
    value.length === 0 ||
    value.startsWith('/') ||
    /[\\:\0]/.test(value) ||
    value.split('/').includes('..')
  );
}

// Every rule refuses the whole archive; the caps run on central-directory values before anything is inflated.
function checkEntries(bytes: Buffer, entries: CentralEntry[]): LocatedEntry[] {
  if (entries.length > MAX_ISDOCX_ENTRIES) {
    refuse(
      'too_large',
      `The archive holds more than ${MAX_ISDOCX_ENTRIES} entries.`,
    );
  }

  let declared = 0;
  const names = new Set<string>();

  for (const entry of entries) {
    if ((entry.flags & 0x0041) !== 0) {
      refuse('password_protected', 'An archive entry is encrypted.');
    }

    if ((entry.flags & 0x0020) !== 0) {
      refuse('unreadable', 'An archive entry is a patch.');
    }

    if (entry.method !== 0 && entry.method !== 8) {
      refuse('unsupported_type', 'An archive entry uses an unknown method.');
    }

    if (hasUnsafeName(entry.name)) {
      refuse('unreadable', 'An archive entry has an unsafe name.');
    }

    // Names compare as bytes: the UTF-8 flag is not trusted.
    const key = entry.name.toString('latin1');

    if (names.has(key)) {
      refuse('unreadable', 'Two archive entries share a name.');
    }

    names.add(key);

    if (!entry.directory && (entry.size === 0 || entry.compressedSize === 0)) {
      refuse('unreadable', 'A file entry declares no size.');
    }

    if (
      entry.compressedSize > 0 &&
      entry.size / entry.compressedSize > MAX_ISDOCX_RATIO
    ) {
      refuse('too_large', 'An archive entry exceeds the compression ratio.');
    }

    declared += entry.size;
  }

  if (declared > MAX_ISDOCX_DECLARED_BYTES) {
    refuse('too_large', 'The archive declares too many bytes.');
  }

  // The local header gives only its name and extra lengths; sizes stay the central ones.
  const located = entries.map((entry): LocatedEntry => {
    const offset = entry.localOffset;

    if (
      offset + LOCAL_LENGTH > bytes.length ||
      bytes.readUInt32LE(offset) !== LOCAL_SIGNATURE
    ) {
      refuse('unreadable', 'An archive entry points outside the file.');
    }

    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const nameStart = offset + LOCAL_LENGTH;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + entry.compressedSize;

    if (dataEnd > bytes.length) {
      refuse('unreadable', 'An archive entry points outside the file.');
    }

    if (!bytes.subarray(nameStart, nameStart + nameLength).equals(entry.name)) {
      refuse('unreadable', 'A local header names another entry.');
    }

    return { ...entry, dataEnd, dataStart };
  });
  const ordered = [...located].sort((a, b) => a.localOffset - b.localOffset);

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];

    if (
      previous !== undefined &&
      current !== undefined &&
      current.localOffset < previous.dataEnd
    ) {
      refuse('unreadable', 'Two archive entries overlap.');
    }
  }

  return located;
}

// Inflates one entry under a hard output cap; a length or CRC other than the declared one is refused.
function extract(bytes: Buffer, entry: LocatedEntry, cap: number): Buffer {
  if (entry.size > cap) {
    refuse('too_large', 'An archive entry exceeds its size cap.');
  }

  const data = bytes.subarray(entry.dataStart, entry.dataEnd);
  let output: Buffer;

  if (entry.method === 0) {
    if (entry.compressedSize !== entry.size) {
      refuse('unreadable', 'A stored entry declares two lengths.');
    }

    output = data;
  } else {
    try {
      output = inflateRawSync(data, {
        maxOutputLength: Math.min(entry.size + 1, cap + 1),
      });
    } catch {
      refuse('unreadable', 'An archive entry does not inflate.');
    }
  }

  if (output.length !== entry.size) {
    refuse('unreadable', 'An archive entry is not its declared length.');
  }

  if (crc32(output) !== entry.crc) {
    refuse('unreadable', 'An archive entry fails its CRC.');
  }

  return output;
}

function mainDocument(bytes: Buffer, entries: LocatedEntry[]): LocatedEntry {
  const manifest = entries.find((entry) =>
    entry.name.equals(Buffer.from(MANIFEST_NAME)),
  );

  if (manifest === undefined) {
    const candidates = entries.filter((entry) => {
      const name = entry.name.toString('latin1');
      return (
        !entry.directory &&
        !name.includes('/') &&
        name.toLowerCase().endsWith('.isdoc')
      );
    });

    if (candidates.length !== 1 || candidates[0] === undefined) {
      refuse('unreadable', 'The archive names no single main document.');
    }

    return candidates[0];
  }

  let root: XmlElement;

  try {
    root = readXml(extract(bytes, manifest, MAX_MANIFEST_BYTES), {
      maxBytes: MAX_MANIFEST_BYTES,
      namespace: ISDOC_MANIFEST_NAMESPACE,
      root: 'manifest',
    });
  } catch (error) {
    // A manifest that is no ISDOC manifest leaves the archive without a main document.
    if (error instanceof IsdocReadError && error.code === 'unsupported_type') {
      refuse('unreadable', 'The manifest is not an ISDOC manifest.');
    }

    throw error;
  }

  const named = children(root, 'maindocument');
  const filename = named[0]?.attributes.filename;

  if (named.length !== 1 || filename === undefined || filename.includes('%')) {
    refuse('unreadable', 'The manifest names no single main document.');
  }

  const target = Buffer.from(filename, 'utf8');
  const main = entries.find((entry) => entry.name.equals(target));

  if (main === undefined || main.directory || main === manifest) {
    refuse('unreadable', 'The manifest names no usable main document.');
  }

  return main;
}

// Stdlib only: the archive stays in memory, only the manifest and the main document are ever inflated.
export function readIsdocx(bytes: Buffer): IsdocxReadResult {
  try {
    if (bytes.length > MAX_ISDOCX_BYTES) {
      refuse('too_large', 'The archive exceeds the size cap.');
    }

    const entries = checkEntries(bytes, readCentral(bytes));
    const main = mainDocument(bytes, entries);

    return { ok: true, xml: extract(bytes, main, MAX_XML_BYTES) };
  } catch (error) {
    if (error instanceof IsdocReadError) {
      return {
        failure: { code: error.code, message: error.message },
        ok: false,
      };
    }

    throw error;
  }
}

// A zip local header opens an ISDOCX; anything else is read as the plain XML.
export function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}
