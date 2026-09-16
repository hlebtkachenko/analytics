import type {
  ProviderIssue,
  ProviderOutput,
  ProviderReason,
} from '../contract.js';

export const SNIFF_PROVIDER = 'sniff';
export const SNIFF_PROVIDER_VERSION = '2026-09-16.1';

// The two windows the sniff reads: the head carries every magic number, the tail the zip directory and the PDF trailer.
export const SNIFF_WINDOW_BYTES = 65_536;

// An image below this size is a signature, a logo or a tracking pixel, never a scanned paper.
export const DECORATIVE_IMAGE_BYTES = 8_192;

export interface SniffInput {
  byteSize: number;
  head: Uint8Array;
  tail: Uint8Array;
}

export interface SniffResult {
  confidence: number;
  detectedType: string;
  issues: ProviderIssue[];
  mediaType: string;
  reasons: ProviderReason[];
}

const XML_NAMESPACES: readonly {
  detectedType: string;
  mediaType: string;
  namespace?: string;
  root: string;
}[] = [
  {
    detectedType: 'isdoc_invoice',
    mediaType: 'application/xml',
    namespace: 'http://isdoc.cz/namespace/2013',
    root: 'Invoice',
  },
  {
    detectedType: 'money_s3_export',
    mediaType: 'application/xml',
    root: 'MoneyData',
  },
  {
    detectedType: 'pohoda_export',
    mediaType: 'application/xml',
    root: 'dataPack',
  },
  {
    detectedType: 'camt_statement',
    mediaType: 'application/xml',
    namespace: 'urn:iso:std:iso:20022:tech:xsd:camt.053',
    root: 'Document',
  },
];

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((value, index) => bytes[index] === value);
}

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

function utf8(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('utf8');
}

function result(
  detectedType: string,
  mediaType: string,
  confidence: number,
  evidence: string,
  issues: ProviderIssue[] = [],
): SniffResult {
  return {
    confidence,
    detectedType,
    issues,
    mediaType,
    reasons: [{ evidence, step: 'sniff', weight: confidence }],
  };
}

function unprocessable(
  code: ProviderIssue['code'],
  message: string,
): ProviderIssue {
  return { code, message };
}

function sniffPdf(input: SniffInput): SniffResult {
  // The encryption dictionary lives in the trailer, but a linearised file may carry it near the head as well.
  const encrypted =
    latin1(input.tail).includes('/Encrypt') ||
    latin1(input.head).includes('/Encrypt');

  return result(
    'pdf',
    'application/pdf',
    1,
    'The file starts with the PDF signature.',
    encrypted
      ? [unprocessable('encrypted', 'The PDF is encrypted and cannot be read.')]
      : [],
  );
}

function sniffImage(
  input: SniffInput,
  mediaType: string,
  evidence: string,
): SniffResult {
  return result(
    'image',
    mediaType,
    1,
    evidence,
    input.byteSize < DECORATIVE_IMAGE_BYTES
      ? [
          unprocessable(
            'decorative_image',
            'The image is too small to be a scanned document.',
          ),
        ]
      : [],
  );
}

function sniffZip(input: SniffInput): SniffResult {
  // General purpose bit 0 of the first local file header marks a password-protected entry.
  const flags = (input.head[6] ?? 0) | ((input.head[7] ?? 0) << 8);

  if ((flags & 0x0001) !== 0) {
    return result(
      'unknown',
      'application/zip',
      1,
      'The first zip entry is password protected.',
      [
        unprocessable(
          'password_protected',
          'The archive is password protected and cannot be read.',
        ),
      ],
    );
  }

  // The central directory names every entry; an ISDOC package carries the invoice as a .isdoc entry.
  const directory = latin1(input.tail);

  if (directory.includes('.isdoc')) {
    return result(
      'isdoc_invoice',
      'application/vnd.isdoc+zip',
      0.9,
      'The zip central directory names an .isdoc entry.',
    );
  }

  if (directory.includes('xl/workbook.xml')) {
    return result(
      'tabular',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      0.95,
      'The zip central directory names an Excel workbook.',
    );
  }

  return result(
    'unknown',
    'application/zip',
    0.5,
    'The file is a zip archive of unknown content.',
    [
      unprocessable(
        'unsupported_type',
        'The archive content is not supported.',
      ),
    ],
  );
}

function sniffXml(text: string): SniffResult | null {
  // The first element after the prolog and any comment; namespaces are read from its own attributes.
  const rootMatch = /<(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)([^>]*)>/.exec(
    text.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>/g, ''),
  );

  if (rootMatch === null) {
    return null;
  }

  const root = rootMatch[1] ?? '';
  const attributes = rootMatch[2] ?? '';

  for (const candidate of XML_NAMESPACES) {
    if (candidate.root !== root) {
      continue;
    }

    if (
      candidate.namespace !== undefined &&
      !attributes.includes(candidate.namespace)
    ) {
      continue;
    }

    return result(
      candidate.detectedType,
      candidate.mediaType,
      1,
      `The XML root element is ${root}${candidate.namespace === undefined ? '' : ` in ${candidate.namespace}`}.`,
    );
  }

  return result(
    'unknown',
    'application/xml',
    0.6,
    `The XML root element ${root} is not a known export.`,
    [unprocessable('unsupported_type', 'The XML document is not supported.')],
  );
}

// GPC (ABO) statements start with a fixed-width record whose type code is 074.
function isGpc(text: string): boolean {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  return firstLine.startsWith('074') && firstLine.length >= 100;
}

function isTabular(text: string): boolean {
  const lines = text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, 20);

  if (lines.length < 2) {
    return false;
  }

  for (const separator of [',', ';', '\t']) {
    const counts = lines.map((line) => line.split(separator).length);
    const first = counts[0] ?? 0;

    if (first >= 2 && counts.every((count) => count === first)) {
      return true;
    }
  }

  return false;
}

// Control characters outside whitespace mean the bytes are not text a person could read.
function isReadableText(bytes: Uint8Array): boolean {
  const text = utf8(bytes);

  if (text.includes('�')) {
    return false;
  }

  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;

    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      return false;
    }
  }

  return true;
}

export function sniffBytes(input: SniffInput): SniffResult {
  if (input.byteSize === 0 || input.head.length === 0) {
    return result(
      'unknown',
      'application/octet-stream',
      1,
      'The file has no bytes.',
      [unprocessable('empty', 'The file is empty.')],
    );
  }

  const head = input.head;

  if (startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return sniffPdf(input);
  }

  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return sniffImage(
      input,
      'image/png',
      'The file starts with the PNG signature.',
    );
  }

  if (startsWith(head, [0xff, 0xd8, 0xff])) {
    return sniffImage(
      input,
      'image/jpeg',
      'The file starts with the JPEG signature.',
    );
  }

  if (
    startsWith(head, [0x52, 0x49, 0x46, 0x46]) &&
    latin1(head.subarray(8, 12)) === 'WEBP'
  ) {
    return sniffImage(
      input,
      'image/webp',
      'The file starts with the WebP signature.',
    );
  }

  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) {
    return sniffZip(input);
  }

  // A byte order mark is text, so it is dropped before any textual check.
  const textBytes = startsWith(head, [0xef, 0xbb, 0xbf])
    ? head.subarray(3)
    : head;

  if (!isReadableText(textBytes)) {
    return result(
      'unknown',
      'application/octet-stream',
      0.5,
      'The bytes match no known signature and are not text.',
      [unprocessable('unreadable', 'The file content cannot be read.')],
    );
  }

  const text = utf8(textBytes);
  const trimmed = text.trimStart();

  if (trimmed.startsWith('<')) {
    const xml = sniffXml(trimmed);

    if (xml !== null) {
      return xml;
    }
  }

  if (isGpc(text)) {
    return result(
      'gpc_statement',
      'text/plain',
      0.95,
      'The first line is a GPC 074 header record.',
    );
  }

  if (isTabular(text)) {
    return result(
      'tabular',
      'text/csv',
      0.8,
      'Every sampled line splits into the same number of fields.',
    );
  }

  if (trimmed.length === 0) {
    return result('unknown', 'text/plain', 1, 'The file is whitespace only.', [
      unprocessable('empty', 'The file carries no content.'),
    ]);
  }

  return result('text', 'text/plain', 0.6, 'The file is plain text.');
}

export function toProviderOutput(sniffed: SniffResult): ProviderOutput {
  return {
    confidence: sniffed.confidence,
    detectedType: sniffed.detectedType,
    draft: {},
    fieldConfidences: {},
    issues: sniffed.issues,
    reasons: sniffed.reasons,
  };
}
