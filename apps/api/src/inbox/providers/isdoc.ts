import type { InboxUnprocessableReason } from '@bap/db';
import { SaxesParser } from 'saxes';

import {
  createDocumentRequestSchema,
  MAX_INVOICE_LINES,
} from '../../documents/contract.js';
import type {
  ProviderIssue,
  ProviderOutput,
  ProviderReason,
} from '../contract.js';

export const ISDOC_PROVIDER = 'isdoc';
export const ISDOC_PROVIDER_VERSION = '2026-09-23.1';
export const ISDOC_NAMESPACE = 'http://isdoc.cz/namespace/2013';
export const ISDOC_DETECTED_TYPE = 'isdoc_invoice';

// The hardening caps of the spec: bytes before decoding, then depth, elements, text per element and lines.
export const MAX_XML_BYTES = 5 * 1024 * 1024;
export const MAX_XML_DEPTH = 32;
export const MAX_XML_ELEMENTS = 20_000;
export const MAX_XML_TEXT = 4_000;
// Text inside a skipped subtree (ds:Signature, XAdES, Extensions) is only counted, never stored.
export const MAX_SKIPPED_TEXT = MAX_XML_BYTES;

const VERSION_PATTERN = /^6\.0(\.\d+)?$/;
const AMOUNT_PATTERN = /^[+-]?\d{1,15}(\.\d{1,6})?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const VARIABLE_SYMBOL_PATTERN = /^[0-9]{1,10}$/;
const CURRENCY_CODE_PATTERN = /^[A-Za-z]{3}$/;
const MICRO = 1_000_000n;
const CENT = 10_000n;
const MAX_REFERENCE_LENGTH = 64;
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_UNIT_LENGTH = 16;
const MAX_EVIDENCE_LENGTH = 500;
// Any well-formed uuid: the parse validates the content shape, never which entity it lands in.
const PLACEHOLDER_ENTITY_ID = '00000000-0000-4000-8000-000000000000';

type FailureCode = Extract<
  InboxUnprocessableReason,
  'password_protected' | 'too_large' | 'unreadable' | 'unsupported_type'
>;

export interface IsdocFailure {
  code: FailureCode;
  message: string;
}

export class IsdocReadError extends Error {
  constructor(
    readonly code: FailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'IsdocReadError';
  }
}

// One element of the ISDOC namespace; foreign and skipped subtrees never become nodes.
export interface XmlElement {
  attributes: Record<string, string>;
  children: XmlElement[];
  name: string;
  text: string;
}

interface ReadXmlOptions {
  maxBytes: number;
  maxLines?: number;
  namespace: string;
  root: string;
  // Names inside the namespace whose whole subtree is skipped, yet still counted against the caps.
  skip?: readonly string[];
  version?: RegExp;
}

// Hardened read: size before decoding, strict UTF-8, no error handler so every well-formedness error throws,
// any DOCTYPE throws, the root is checked by its resolved namespace URI, and every cap counts skipped nodes too.
export function readXml(
  bytes: Uint8Array,
  options: ReadXmlOptions,
): XmlElement {
  if (bytes.byteLength > options.maxBytes) {
    throw new IsdocReadError('too_large', 'The XML exceeds the size cap.');
  }

  let xml: string;

  try {
    xml = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
      bytes,
    );
  } catch {
    throw new IsdocReadError('unreadable', 'The XML is not valid UTF-8.');
  }

  const parser = new SaxesParser({ position: false, xmlns: true });
  const stack: (XmlElement | null)[] = [];
  const textLengths: number[] = [];
  let root: XmlElement | null = null;
  let elements = 0;
  let lines = 0;

  parser.on('xmldecl', (declaration) => {
    const encoding = declaration.encoding?.toLowerCase();

    if (encoding !== undefined && encoding !== 'utf-8' && encoding !== 'utf8') {
      throw new IsdocReadError(
        'unreadable',
        'The XML declares an encoding other than UTF-8.',
      );
    }
  });
  parser.on('doctype', () => {
    throw new IsdocReadError('unreadable', 'The XML carries a DOCTYPE.');
  });
  parser.on('opentag', (tag) => {
    elements += 1;

    if (stack.length + 1 > MAX_XML_DEPTH || elements > MAX_XML_ELEMENTS) {
      throw new IsdocReadError('too_large', 'The XML exceeds a structure cap.');
    }

    const inNamespace = tag.uri === options.namespace;

    if (stack.length === 0) {
      if (!inNamespace || tag.local !== options.root) {
        throw new IsdocReadError(
          'unsupported_type',
          'The root element is not the expected one in its namespace.',
        );
      }

      const version = tag.attributes.version?.value ?? '';

      if (options.version !== undefined && !options.version.test(version)) {
        throw new IsdocReadError(
          'unsupported_type',
          'The ISDOC version is not 6.0.',
        );
      }
    }

    if (
      inNamespace &&
      (tag.local === 'InvoiceLine' ||
        tag.local === 'TaxedDeposit' ||
        tag.local === 'NonTaxedDeposit')
    ) {
      lines += 1;

      if (lines > (options.maxLines ?? Number.POSITIVE_INFINITY)) {
        throw new IsdocReadError(
          'too_large',
          `The invoice exceeds ${MAX_INVOICE_LINES} lines and deposits.`,
        );
      }
    }

    const parent = stack.at(-1);
    const skipped =
      parent === null ||
      !inNamespace ||
      (options.skip ?? []).includes(tag.local);

    if (skipped) {
      stack.push(null);
    } else {
      const element: XmlElement = {
        attributes: Object.fromEntries(
          Object.values(tag.attributes)
            .filter((attribute) => attribute.prefix === '')
            .map((attribute) => [attribute.local, attribute.value]),
        ),
        children: [],
        name: tag.local,
        text: '',
      };
      parent?.children.push(element);
      root ??= element;
      stack.push(element);
    }

    textLengths.push(0);
  });
  const onText = (text: string): void => {
    const index = textLengths.length - 1;

    if (index < 0) {
      return;
    }

    textLengths[index] = (textLengths[index] ?? 0) + text.length;
    const current = stack.at(-1);
    // A skipped node's text is never kept, so a signature's long base64 meets the byte cap, not the element cap.
    const cap = current === null ? MAX_SKIPPED_TEXT : MAX_XML_TEXT;

    if ((textLengths[index] ?? 0) > cap) {
      throw new IsdocReadError('too_large', 'An element exceeds the text cap.');
    }

    if (current !== null && current !== undefined) {
      current.text += text;
    }
  };
  parser.on('text', onText);
  parser.on('cdata', onText);
  parser.on('closetag', () => {
    stack.pop();
    textLengths.pop();
  });

  try {
    parser.write(xml).close();
  } catch (error) {
    if (error instanceof IsdocReadError) {
      throw error;
    }

    throw new IsdocReadError('unreadable', 'The XML is not well formed.');
  }

  if (root === null) {
    throw new IsdocReadError('unreadable', 'The XML has no root element.');
  }

  return root;
}

export function child(
  element: XmlElement | undefined,
  path: string,
): XmlElement | undefined {
  let current = element;

  for (const name of path.split('/')) {
    current = current?.children.find((candidate) => candidate.name === name);
  }

  return current;
}

export function children(
  element: XmlElement | undefined,
  name: string,
): XmlElement[] {
  return (element?.children ?? []).filter(
    (candidate) => candidate.name === name,
  );
}

export function text(
  element: XmlElement | undefined,
  path: string,
): string | null {
  const value = child(element, path)?.text.trim();
  return value === undefined || value.length === 0 ? null : value;
}

// Amounts are compared in millionths; null when the text is no decimal the parser may compare.
function micro(value: string | null): bigint | null {
  if (value === null || !AMOUNT_PATTERN.test(value)) {
    return null;
  }

  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = value.replace(/^[+-]/, '').split('.');
  const scaled = BigInt(whole) * MICRO + BigInt(fraction.padEnd(6, '0'));

  return negative ? -scaled : scaled;
}

function formatMicro(value: bigint): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const fraction = (magnitude % MICRO)
    .toString()
    .padStart(6, '0')
    .replace(/0+$/, '');

  return `${negative ? '-' : ''}${magnitude / MICRO}${fraction.length > 0 ? `.${fraction}` : ''}`;
}

// The draft keeps the file's own digits, only a leading plus is dropped.
function amountText(value: string | null): string | undefined {
  return value === null ? undefined : value.replace(/^\+/, '');
}

// A rate as canonical digits: 21.00 becomes 21 and 12.50 becomes 12.5.
function canonicalRate(value: string | null): string {
  const parsed = micro(value);
  return parsed === null ? (value ?? '0') : formatMicro(parsed);
}

// IČO: digits only, left-padded to 8; anything longer or empty identifies nothing.
export function normalizeRegistrationNumber(
  value: string | null,
): string | null {
  const digits = (value ?? '').replaceAll(/[^0-9]/g, '');
  return digits.length === 0 || digits.length > 8
    ? null
    : digits.padStart(8, '0');
}

function normalizeVatNumber(value: string | null): string | null {
  const compact = (value ?? '').replaceAll(/\s/g, '').toUpperCase();
  return compact.length === 0 ? null : compact;
}

function isDate(value: string | null): value is string {
  return (
    value !== null &&
    DATE_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isFalse(value: string | null): boolean {
  return value === 'false' || value === '0';
}

export interface IsdocParty {
  country: string | null;
  name: string | null;
  registrationNumber: string | null;
  vatNumber: string | null;
}

interface DraftLine {
  baseAmount?: string | undefined;
  description: string;
  lineKind: 'advance_deduction' | 'item';
  quantity?: string | undefined;
  unit?: string | undefined;
  unitPrice?: string | undefined;
  vatAmount?: string | undefined;
  vatMode: 'exempt' | 'outside_scope' | 'reverse_charge' | 'standard';
  vatRate: string;
}

export interface IsdocContent {
  attributes: Record<string, string>;
  currencyCode: string;
  documentDate?: string;
  invoice?: {
    dueDate?: string;
    fxRate?: string;
    lines: DraftLine[];
    roundingAmount: string;
    taxPointDate?: string;
    variableSymbol?: string;
  };
  reference?: string;
  totalAmount?: string;
}

export interface ParsedIsdoc {
  content: IsdocContent;
  customer: IsdocParty;
  documentType: string;
  fieldConfidences: Record<string, number>;
  issues: ProviderIssue[];
  reasons: ProviderReason[];
  reference: string | null;
  supplier: IsdocParty;
}

export type IsdocParseResult =
  { failure: IsdocFailure; ok: false } | { ok: true; parsed: ParsedIsdoc };

// Types 1, 3 and 7 carry invoice content; 2 and 6 are credit notes; 4 and 5 are advance requests.
const INVOICE_TYPES = ['1', '3', '7'];
const CREDIT_NOTE_TYPES = ['2', '6'];
const ADVANCE_TYPES = ['4', '5'];
export const ADVANCE_TAX_DOCUMENT_TYPE = '5';

function party(element: XmlElement | undefined): IsdocParty {
  const node = child(element, 'Party');
  const vatScheme = children(node, 'PartyTaxScheme').find(
    (scheme) => text(scheme, 'TaxScheme') === 'VAT',
  );

  return {
    country: text(node, 'PostalAddress/Country/IdentificationCode'),
    name: text(node, 'PartyName/Name'),
    registrationNumber: normalizeRegistrationNumber(
      text(node, 'PartyIdentification/ID'),
    ),
    vatNumber: normalizeVatNumber(text(vatScheme, 'CompanyID')),
  };
}

function evidence(value: string): string {
  return value.slice(0, MAX_EVIDENCE_LENGTH);
}

function vatModeOf(
  headerApplicable: boolean,
  category: XmlElement | undefined,
  rate: string,
): DraftLine['vatMode'] {
  if (!headerApplicable || isFalse(text(category, 'VATApplicable'))) {
    return 'outside_scope';
  }

  if (child(category, 'LocalReverseCharge') !== undefined) {
    return 'reverse_charge';
  }

  return micro(rate) === 0n ? 'exempt' : 'standard';
}

interface Check {
  code: 'amount_mismatch' | 'vat_mismatch';
  expected: bigint | null;
  field: string;
  label: string;
  // The element the file states; null when the file leaves it out, so the check is skipped.
  stated: string | null;
  statedPath: string;
}

// Exact to the cent: a difference of one cent or more is a mismatch, nothing is ever adjusted.
function runCheck(check: Check, issues: ProviderIssue[]): void {
  const stated = micro(check.stated);

  if (stated === null || check.expected === null) {
    return;
  }

  const difference = stated - check.expected;

  if ((difference < 0n ? -difference : difference) >= CENT) {
    issues.push({
      code: check.code,
      field: check.field,
      message: evidence(
        `${check.statedPath} states ${check.stated} but ${check.label} gives ${formatMicro(check.expected)}.`,
      ),
    });
  }
}

function sum(values: readonly (bigint | null)[]): bigint | null {
  let total = 0n;

  for (const value of values) {
    if (value === null) {
      return null;
    }

    total += value;
  }

  return total;
}

interface LineFigures {
  base: bigint | null;
  baseCurr: bigint | null;
  inclusive: bigint | null;
  inclusiveCurr: bigint | null;
  path: string;
  rate: string;
  vat: bigint | null;
}

// The identities of the spec over one currency: suffix '' for the local figures, 'Curr' for the foreign ones.
function crossCheck(
  invoice: XmlElement,
  lines: readonly LineFigures[],
  totalsField: (name: string) => string,
  suffix: '' | 'Curr',
  issues: ProviderIssue[],
): void {
  const totals = child(invoice, 'LegalMonetaryTotal');
  const local = suffix === '';
  const base = (line: LineFigures) => (local ? line.base : line.baseCurr);
  const inclusive = (line: LineFigures) =>
    local ? line.inclusive : line.inclusiveCurr;
  const taxed = children(child(invoice, 'TaxedDeposits'), 'TaxedDeposit');
  const untaxed = children(
    child(invoice, 'NonTaxedDeposits'),
    'NonTaxedDeposit',
  );
  const subTotals = children(child(invoice, 'TaxTotal'), 'TaxSubTotal');
  const checks: Check[] = [
    {
      code: 'amount_mismatch',
      expected: sum(lines.map(base)),
      field: totalsField('lines'),
      label: `the sum of InvoiceLine/LineExtensionAmount${suffix}`,
      stated: text(totals, `TaxExclusiveAmount${suffix}`),
      statedPath: `LegalMonetaryTotal/TaxExclusiveAmount${suffix}`,
    },
    {
      code: 'amount_mismatch',
      expected: sum(lines.map(inclusive)),
      field: totalsField('lines'),
      label: `the sum of InvoiceLine/LineExtensionAmountTaxInclusive${suffix}`,
      stated: text(totals, `TaxInclusiveAmount${suffix}`),
      statedPath: `LegalMonetaryTotal/TaxInclusiveAmount${suffix}`,
    },
    {
      code: 'amount_mismatch',
      expected: sum(
        taxed.map((deposit) =>
          micro(text(deposit, `TaxInclusiveDepositAmount${suffix}`)),
        ),
      ),
      field: totalsField('lines'),
      label: `the sum of TaxedDeposit/TaxInclusiveDepositAmount${suffix}`,
      stated: text(totals, `AlreadyClaimedTaxInclusiveAmount${suffix}`),
      statedPath: `LegalMonetaryTotal/AlreadyClaimedTaxInclusiveAmount${suffix}`,
    },
    {
      code: 'amount_mismatch',
      expected: sum(
        untaxed.map((deposit) =>
          micro(text(deposit, `DepositAmount${suffix}`)),
        ),
      ),
      field: totalsField('lines'),
      label: `the sum of NonTaxedDeposit/DepositAmount${suffix}`,
      stated: text(totals, `PaidDepositsAmount${suffix}`),
      statedPath: `LegalMonetaryTotal/PaidDepositsAmount${suffix}`,
    },
  ];
  const grossTotal = micro(text(totals, `TaxInclusiveAmount${suffix}`));
  const claimed = micro(
    text(totals, `AlreadyClaimedTaxInclusiveAmount${suffix}`) ?? '0',
  );
  const difference = micro(
    text(totals, `DifferenceTaxInclusiveAmount${suffix}`),
  );
  const paid = micro(text(totals, `PaidDepositsAmount${suffix}`) ?? '0');
  const rounding = micro(text(totals, `PayableRoundingAmount${suffix}`) ?? '0');

  checks.push(
    {
      code: 'amount_mismatch',
      expected:
        grossTotal === null || claimed === null ? null : grossTotal - claimed,
      field: totalsField('lines'),
      label: 'TaxInclusiveAmount minus AlreadyClaimedTaxInclusiveAmount',
      stated: text(totals, `DifferenceTaxInclusiveAmount${suffix}`),
      statedPath: `LegalMonetaryTotal/DifferenceTaxInclusiveAmount${suffix}`,
    },
    {
      code: 'amount_mismatch',
      expected:
        difference === null || paid === null || rounding === null
          ? null
          : difference - paid + rounding,
      field: totalsField('roundingAmount'),
      label:
        'DifferenceTaxInclusiveAmount minus PaidDepositsAmount plus PayableRoundingAmount',
      stated: text(totals, `PayableAmount${suffix}`),
      statedPath: `LegalMonetaryTotal/PayableAmount${suffix}`,
    },
  );

  const rates = new Set(lines.map((line) => canonicalRate(line.rate)));
  const subTotalRates = new Set<string>();

  for (const subTotal of subTotals) {
    const rate = canonicalRate(text(subTotal, 'TaxCategory/Percent'));
    const atRate = lines.filter((line) => canonicalRate(line.rate) === rate);
    const taxedAtRate = taxed.filter(
      (deposit) =>
        canonicalRate(text(deposit, 'ClassifiedTaxCategory/Percent')) === rate,
    );
    const bases = sum(atRate.map(base));
    const inclusives = sum(atRate.map(inclusive));
    subTotalRates.add(rate);

    checks.push(
      {
        code: 'amount_mismatch',
        expected: bases,
        field: totalsField('lines'),
        label: `the sum of the line bases at ${rate} %`,
        stated: text(subTotal, `TaxableAmount${suffix}`),
        statedPath: `TaxSubTotal/TaxableAmount${suffix} at ${rate} %`,
      },
      {
        code: 'amount_mismatch',
        expected: inclusives,
        field: totalsField('lines'),
        label: `the sum of the line gross amounts at ${rate} %`,
        stated: text(subTotal, `TaxInclusiveAmount${suffix}`),
        statedPath: `TaxSubTotal/TaxInclusiveAmount${suffix} at ${rate} %`,
      },
      {
        code: 'vat_mismatch',
        expected: local
          ? sum(atRate.map((line) => line.vat))
          : bases === null || inclusives === null
            ? null
            : inclusives - bases,
        field: totalsField('lines'),
        label: `the sum of the line VAT at ${rate} %`,
        stated: text(subTotal, `TaxAmount${suffix}`),
        statedPath: `TaxSubTotal/TaxAmount${suffix} at ${rate} %`,
      },
      {
        code: 'amount_mismatch',
        expected: sum(
          taxedAtRate.map((deposit) =>
            micro(text(deposit, `TaxableDepositAmount${suffix}`)),
          ),
        ),
        field: totalsField('lines'),
        label: `the sum of TaxedDeposit/TaxableDepositAmount${suffix} at ${rate} %`,
        stated: text(subTotal, `AlreadyClaimedTaxableAmount${suffix}`),
        statedPath: `TaxSubTotal/AlreadyClaimedTaxableAmount${suffix} at ${rate} %`,
      },
    );
  }

  checks.push({
    code: 'vat_mismatch',
    expected: sum(
      subTotals.map((subTotal) => micro(text(subTotal, `TaxAmount${suffix}`))),
    ),
    field: totalsField('lines'),
    label: `the sum of TaxSubTotal/TaxAmount${suffix}`,
    stated: text(child(invoice, 'TaxTotal'), `TaxAmount${suffix}`),
    statedPath: `TaxTotal/TaxAmount${suffix}`,
  });

  for (const check of checks) {
    runCheck(check, issues);
  }

  // A rate the lines use with no TaxSubTotal of its own leaves that rate unsummarised.
  if (local && subTotals.length > 0) {
    for (const rate of rates) {
      if (!subTotalRates.has(rate)) {
        issues.push({
          code: 'vat_mismatch',
          field: totalsField('lines'),
          message: evidence(
            `The lines use ${rate} % but no TaxTotal/TaxSubTotal names that rate.`,
          ),
        });
      }
    }
  }
}

function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

// Each createDocumentRequestSchema failure becomes one issue under its draft path.
function schemaIssues(body: unknown): ProviderIssue[] {
  const parsed = createDocumentRequestSchema.safeParse(body);

  if (parsed.success) {
    return [];
  }

  return parsed.error.issues.map((issue) => {
    const field = issue.path
      .map((segment, index) =>
        typeof segment === 'number'
          ? `[${segment}]`
          : `${index === 0 ? '' : '.'}${String(segment)}`,
      )
      .join('');
    const last = String(issue.path.at(-1) ?? '');
    const code: ProviderIssue['code'] =
      last === 'vatAmount'
        ? 'vat_mismatch'
        : ['baseAmount', 'lines', 'roundingAmount', 'totalAmount'].includes(
              last,
            )
          ? 'amount_mismatch'
          : 'missing_required_field';

    return {
      code,
      ...(field.length === 0 ? {} : { field: field.slice(0, 100) }),
      message: evidence(issue.message),
    };
  });
}

// The pure parser: bytes in, content, parties and issues out; no I/O, no database, no entity decision.
export function parseIsdoc(bytes: Uint8Array): IsdocParseResult {
  let invoice: XmlElement;

  try {
    invoice = readXml(bytes, {
      maxBytes: MAX_XML_BYTES,
      maxLines: MAX_INVOICE_LINES,
      namespace: ISDOC_NAMESPACE,
      root: 'Invoice',
      skip: ['Extensions'],
      version: VERSION_PATTERN,
    });
  } catch (error) {
    if (error instanceof IsdocReadError) {
      return {
        failure: { code: error.code, message: error.message },
        ok: false,
      };
    }

    throw error;
  }

  const documentType = text(invoice, 'DocumentType') ?? '';
  const invoiceType = INVOICE_TYPES.includes(documentType);

  if (
    !invoiceType &&
    !CREDIT_NOTE_TYPES.includes(documentType) &&
    !ADVANCE_TYPES.includes(documentType)
  ) {
    return {
      failure: {
        code: 'unsupported_type',
        message: 'The ISDOC DocumentType is not one of 1 to 7.',
      },
      ok: false,
    };
  }

  const issues: ProviderIssue[] = [];
  const reasons: ProviderReason[] = [];
  const fieldConfidences: Record<string, number> = {};
  const attributes: Record<string, string> = {
    isdoc_document_type: documentType,
  };
  const totals = child(invoice, 'LegalMonetaryTotal');
  const version = invoice.attributes.version ?? '6.0';
  const uuid = text(invoice, 'UUID');

  reasons.push({
    evidence: evidence(
      `ISDOC ${version}, document type ${documentType}${uuid === null ? '' : `, UUID ${uuid}`}.`,
    ),
    step: 'parse',
    weight: 1,
  });

  const id = text(invoice, 'ID');
  let reference: string | undefined;

  if (id !== null && id.length <= MAX_REFERENCE_LENGTH) {
    reference = id;
  } else if (id !== null) {
    reasons.push({
      evidence: `The ID is longer than ${MAX_REFERENCE_LENGTH} characters, so the reference is left empty.`,
      step: 'parse',
      weight: 0.5,
    });
  }

  const issueDate = text(invoice, 'IssueDate');
  const documentDate = isDate(issueDate) ? issueDate : undefined;

  if (documentDate === undefined) {
    issues.push({
      code: 'missing_required_field',
      field: 'documentDate',
      message: 'Invoice/IssueDate is missing or not a date.',
    });
  }

  const taxPoint = text(invoice, 'TaxPointDate');
  const taxPointDate = isDate(taxPoint) ? taxPoint : undefined;
  const details = child(invoice, 'PaymentMeans/Payment/Details');
  const due = text(details, 'PaymentDueDate');
  const variable = text(details, 'VariableSymbol');
  let variableSymbol: string | undefined;

  if (variable !== null && VARIABLE_SYMBOL_PATTERN.test(variable)) {
    variableSymbol = variable;
  } else if (variable !== null) {
    reasons.push({
      evidence: 'The variable symbol is not 1 to 10 digits, so it is dropped.',
      step: 'parse',
      weight: 0.5,
    });
  }

  // Content is always the local currency: analytics has no currency dimension, so foreign figures are attributes.
  const currencyCode = (text(invoice, 'LocalCurrencyCode') ?? '').toUpperCase();

  if (currencyCode !== 'CZK') {
    issues.push({
      code: 'unsupported_type',
      field: 'currencyCode',
      message: 'Invoice/LocalCurrencyCode is not CZK.',
    });
  }

  const foreign = text(invoice, 'ForeignCurrencyCode');
  let fxRate: string | undefined;

  // An ISO 4217 code or nothing: any other text is an issue and never reaches an attribute or a reason.
  if (foreign !== null && !CURRENCY_CODE_PATTERN.test(foreign)) {
    issues.push({
      code: 'unsupported_type',
      field: 'attributes.foreign_currency_code',
      message:
        'Invoice/ForeignCurrencyCode is not a three-letter currency code.',
    });
  } else if (foreign !== null) {
    attributes.foreign_currency_code = foreign.toUpperCase();
    const payable = amountText(text(totals, 'PayableAmountCurr'));

    if (payable !== undefined) {
      attributes.foreign_payable_amount = payable;
    }

    const rate = micro(text(invoice, 'CurrRate'));
    const referenceRate = micro(text(invoice, 'RefCurrRate') ?? '1');

    if (rate !== null && referenceRate !== null && referenceRate > 0n) {
      // CZK per one foreign unit: CurrRate CZK buy RefCurrRate foreign units.
      fxRate = formatMicro(divideRounded(rate * MICRO, referenceRate));
      reasons.push({
        evidence: evidence(
          `fxRate ${fxRate} is CZK per one ${attributes.foreign_currency_code} (CurrRate / RefCurrRate).`,
        ),
        step: 'parse',
        weight: 1,
      });
    }
  }

  const headerApplicable = !isFalse(text(invoice, 'VATApplicable'));
  const lineElements = children(child(invoice, 'InvoiceLines'), 'InvoiceLine');
  const taxedDeposits = children(
    child(invoice, 'TaxedDeposits'),
    'TaxedDeposit',
  );
  const untaxedDeposits = children(
    child(invoice, 'NonTaxedDeposits'),
    'NonTaxedDeposit',
  );
  const lines: DraftLine[] = [];
  const figures: LineFigures[] = [];

  for (const [index, line] of lineElements.entries()) {
    const path = `invoice.lines[${index}]`;
    const category = child(line, 'ClassifiedTaxCategory');
    const rate = canonicalRate(text(category, 'Percent'));
    const vatMode = vatModeOf(headerApplicable, category, rate);
    const quantity = child(line, 'InvoicedQuantity');
    const unit = quantity?.attributes.unitCode?.trim() ?? '';
    const lineId = text(line, 'ID') ?? String(index + 1);
    const description = (
      text(line, 'Item/Description') ??
      text(line, 'Note') ??
      `Line ${lineId}`
    ).slice(0, MAX_DESCRIPTION_LENGTH);
    const base = text(line, 'LineExtensionAmount');
    const vat = text(line, 'LineExtensionTaxAmount');
    const inclusive = text(line, 'LineExtensionAmountTaxInclusive');

    if (unit.length > MAX_UNIT_LENGTH) {
      reasons.push({
        evidence: `InvoiceLine[${index + 1}] names a unit longer than ${MAX_UNIT_LENGTH} characters, so it is dropped.`,
        step: 'parse',
        weight: 0.5,
      });
    }

    if (vatMode === 'exempt') {
      fieldConfidences[`${path}.vatMode`] = 0.9;
    }

    // Only invoice content keeps lines; a credit note or an advance request states its own signs.
    if (invoiceType) {
      for (const [field, value] of [
        ['baseAmount', base],
        ['vatAmount', vat],
      ] as const) {
        const parsed = micro(value);

        if (parsed !== null && parsed < 0n) {
          issues.push({
            code: 'amount_mismatch',
            field: `${path}.${field}`,
            message: `InvoiceLine[${index + 1}] carries a negative amount, which an invoice line cannot hold.`,
          });
        }
      }
    }

    runCheck(
      {
        code: 'amount_mismatch',
        expected: (() => {
          const parsedBase = micro(base);
          const parsedVat = micro(vat);
          return parsedBase === null || parsedVat === null
            ? null
            : parsedBase + parsedVat;
        })(),
        field: `${path}.vatAmount`,
        label: 'LineExtensionAmount plus LineExtensionTaxAmount',
        stated: inclusive,
        statedPath: `InvoiceLine[${index + 1}]/LineExtensionAmountTaxInclusive`,
      },
      issues,
    );

    lines.push({
      ...(amountText(base) === undefined
        ? {}
        : { baseAmount: amountText(base) }),
      description,
      lineKind: 'item',
      ...(amountText(quantity?.text.trim() || null) === undefined
        ? {}
        : { quantity: amountText(quantity?.text.trim() || null) }),
      ...(unit.length === 0 || unit.length > MAX_UNIT_LENGTH ? {} : { unit }),
      ...(amountText(text(line, 'UnitPrice')) === undefined
        ? {}
        : { unitPrice: amountText(text(line, 'UnitPrice')) }),
      ...(amountText(vat) === undefined ? {} : { vatAmount: amountText(vat) }),
      vatMode,
      vatRate: rate,
    });
    figures.push({
      base: micro(base),
      baseCurr: micro(text(line, 'LineExtensionAmountCurr')),
      inclusive: micro(inclusive),
      inclusiveCurr: micro(text(line, 'LineExtensionAmountTaxInclusiveCurr')),
      path,
      rate,
      vat: micro(vat),
    });
  }

  // Deductions follow the item lines, taxed deposits first, each in document order.
  for (const deposit of taxedDeposits) {
    const category = child(deposit, 'ClassifiedTaxCategory');
    const rate = canonicalRate(text(category, 'Percent'));
    const taxable = micro(text(deposit, 'TaxableDepositAmount'));
    const gross = micro(text(deposit, 'TaxInclusiveDepositAmount'));
    const symbol = text(deposit, 'VariableSymbol');

    lines.push({
      ...(amountText(text(deposit, 'TaxableDepositAmount')) === undefined
        ? {}
        : { baseAmount: amountText(text(deposit, 'TaxableDepositAmount')) }),
      description:
        `Advance ${text(deposit, 'ID') ?? ''}${symbol === null ? '' : ` VS ${symbol}`}`
          .trim()
          .slice(0, MAX_DESCRIPTION_LENGTH),
      lineKind: 'advance_deduction',
      ...(taxable === null || gross === null
        ? {}
        : { vatAmount: formatMicro(gross - taxable) }),
      vatMode: vatModeOf(headerApplicable, category, rate),
      vatRate: rate,
    });
  }

  // A paid proforma carries no tax, so its deduction is outside the VAT scope at rate 0.
  for (const deposit of untaxedDeposits) {
    const symbol = text(deposit, 'VariableSymbol');

    lines.push({
      ...(amountText(text(deposit, 'DepositAmount')) === undefined
        ? {}
        : { baseAmount: amountText(text(deposit, 'DepositAmount')) }),
      description:
        `Advance ${text(deposit, 'ID') ?? ''}${symbol === null ? '' : ` VS ${symbol}`}`
          .trim()
          .slice(0, MAX_DESCRIPTION_LENGTH),
      lineKind: 'advance_deduction',
      vatAmount: '0',
      vatMode: 'outside_scope',
      vatRate: '0',
    });
  }

  const totalsField = (name: string): string =>
    invoiceType ? `invoice.${name}` : 'totalAmount';

  crossCheck(invoice, figures, totalsField, '', issues);

  if (foreign !== null) {
    crossCheck(invoice, figures, totalsField, 'Curr', issues);
  }

  const roundingText = amountText(text(totals, 'PayableRoundingAmount')) ?? '0';
  const rounding = micro(roundingText);
  const content: IsdocContent = {
    attributes,
    currencyCode,
    ...(documentDate === undefined ? {} : { documentDate }),
    ...(reference === undefined ? {} : { reference }),
  };

  if (invoiceType) {
    // The two database checks a route would otherwise meet as an unexpected 23514.
    if (rounding !== null && (rounding < 0n ? -rounding : rounding) >= MICRO) {
      issues.push({
        code: 'amount_mismatch',
        field: 'invoice.roundingAmount',
        message:
          'LegalMonetaryTotal/PayableRoundingAmount is one unit or more.',
      });
    }

    const lineGross = (index: number): bigint | null => {
      const line = lines[index];
      const base = micro(line?.baseAmount ?? null);
      const vat = micro(line?.vatAmount ?? '0');
      return base === null || vat === null ? null : base + vat;
    };
    const supplied = sum(
      lines.flatMap((line, index) =>
        line.lineKind === 'item' ? [lineGross(index)] : [],
      ),
    );
    const deducted = sum(
      lines.flatMap((line, index) =>
        line.lineKind === 'advance_deduction' ? [lineGross(index)] : [],
      ),
    );

    if (
      supplied !== null &&
      deducted !== null &&
      rounding !== null &&
      deducted > supplied + rounding
    ) {
      issues.push({
        code: 'amount_mismatch',
        field: 'invoice.lines',
        message:
          'The deposits deduct more than the lines supply plus the rounding.',
      });
    }

    content.invoice = {
      ...(isDate(due) ? { dueDate: due } : {}),
      ...(fxRate === undefined ? {} : { fxRate }),
      lines,
      roundingAmount: roundingText,
      ...(taxPointDate === undefined ? {} : { taxPointDate }),
      ...(variableSymbol === undefined ? {} : { variableSymbol }),
    };

    if (documentType === '3') {
      const original = text(invoice, 'OriginalDocumentReference/ID');
      reasons.push({
        evidence: evidence(
          `A debit note on the original document ${original ?? 'the file does not name'}.`,
        ),
        step: 'parse',
        weight: 1,
      });
    }
  } else {
    // Credit notes and advance requests carry no invoice content and a non-negative total.
    const gross = text(totals, 'TaxInclusiveAmount');
    const parsedGross = micro(gross);

    if (gross !== null) {
      attributes.signed_total_amount = amountText(gross) ?? gross;
    }

    if (parsedGross !== null) {
      content.totalAmount = formatMicro(
        parsedGross < 0n ? -parsedGross : parsedGross,
      );
    }

    if (CREDIT_NOTE_TYPES.includes(documentType)) {
      const original = text(invoice, 'OriginalDocumentReference/ID');

      if (original !== null) {
        attributes.original_reference = original.slice(0, 2000);
      }
    }

    if (documentType === ADVANCE_TAX_DOCUMENT_TYPE) {
      if (taxPointDate !== undefined) {
        attributes.tax_point_date = taxPointDate;
      }

      for (const subTotal of children(
        child(invoice, 'TaxTotal'),
        'TaxSubTotal',
      )) {
        const key = canonicalRate(
          text(subTotal, 'TaxCategory/Percent'),
        ).replace('.', '_');
        const taxable = amountText(text(subTotal, 'TaxableAmount'));
        const tax = amountText(text(subTotal, 'TaxAmount'));

        if (/^[0-9_]{1,20}$/.test(key) && taxable !== undefined) {
          attributes[`vat_base_${key}`] = taxable;
        }

        if (/^[0-9_]{1,20}$/.test(key) && tax !== undefined) {
          attributes[`vat_amount_${key}`] = tax;
        }
      }

      reasons.push({
        evidence:
          'An advance tax document: its VAT claim is not derived, so it never routes automatically.',
        step: 'parse',
        weight: 1,
      });
    }
  }

  // Validated with placeholders for what the parse cannot know: the entity and each item line's category.
  const validation = {
    attributes,
    currencyCode,
    documentDate: documentDate ?? '2000-01-01',
    ...(content.invoice === undefined
      ? {}
      : {
          invoice: {
            ...content.invoice,
            lines: content.invoice.lines.map((line) =>
              line.lineKind === 'item' ? { ...line, category: 'other' } : line,
            ),
          },
        }),
    kind: invoiceType
      ? 'received_invoice'
      : CREDIT_NOTE_TYPES.includes(documentType)
        ? 'credit_note'
        : 'advance_request',
    legalEntityId: PLACEHOLDER_ENTITY_ID,
    ...(reference === undefined ? {} : { reference }),
    title: 'ISDOC',
    ...(content.totalAmount === undefined
      ? {}
      : { totalAmount: content.totalAmount }),
  };
  const seen = new Set(issues.map((issue) => `${issue.code}:${issue.field}`));

  for (const issue of schemaIssues(validation)) {
    const key = `${issue.code}:${issue.field}`;

    if (!seen.has(key)) {
      seen.add(key);
      issues.push(issue);
    }
  }

  return {
    ok: true,
    parsed: {
      content,
      customer: party(child(invoice, 'AccountingCustomerParty')),
      documentType,
      fieldConfidences,
      issues,
      reasons,
      reference: id,
      supplier: party(child(invoice, 'AccountingSupplierParty')),
    },
  };
}

export interface ResolutionEntity {
  id: string;
  registrationNumber: string | null;
}

export interface ResolutionPartner {
  defaultLineCategory: string | null;
  id: string;
  registrationNumber: string | null;
  vatNumber: string | null;
}

export interface IsdocResolutionContext {
  // Chain steps 1 and 2: the channel entity copied onto the item, and the hint a person set.
  channelEntityId: string | null;
  hintEntityId: string | null;
  ownEntities: readonly ResolutionEntity[];
  partners: readonly ResolutionPartner[];
  ruleEntityId: string | null;
  targetEntityId: string | null;
}

export interface IsdocResolution {
  // The resolved partner's default line category: it travels in memory only, never into a row.
  lineCategory: string | null;
  output: ProviderOutput;
}

type Side = 'issued' | 'received';

function kindOf(documentType: string, side: Side | null): string | null {
  if (side === null) {
    return null;
  }

  if (INVOICE_TYPES.includes(documentType)) {
    return side === 'issued' ? 'issued_invoice' : 'received_invoice';
  }

  return CREDIT_NOTE_TYPES.includes(documentType)
    ? 'credit_note'
    : 'advance_request';
}

// Entity by IČO, then the partner by IČO or DIČ, in memory; nothing here reads or writes a row.
export function resolveIsdoc(
  parsed: ParsedIsdoc,
  context: IsdocResolutionContext,
): IsdocResolution {
  const issues = [...parsed.issues];
  const reasons = [...parsed.reasons];
  const own = (registrationNumber: string | null): ResolutionEntity[] =>
    registrationNumber === null
      ? []
      : context.ownEntities.filter(
          (entity) =>
            normalizeRegistrationNumber(entity.registrationNumber) ===
            registrationNumber,
        );
  const suppliers = own(parsed.supplier.registrationNumber);
  const customers = own(parsed.customer.registrationNumber);

  if (suppliers.length > 1 || customers.length > 1) {
    issues.push({
      code: 'entity_conflict',
      field: 'legalEntityId',
      message: 'Two own legal entities carry the same IČO.',
    });
  }

  const supplier = suppliers.length === 1 ? (suppliers[0]?.id ?? null) : null;
  const customer = customers.length === 1 ? (customers[0]?.id ?? null) : null;
  let side: Side | null = null;
  let entityId: string | null = null;

  if (supplier !== null && customer !== null) {
    const bound = [context.hintEntityId, context.channelEntityId];

    if (bound.includes(supplier)) {
      side = 'issued';
      entityId = supplier;
    } else if (bound.includes(customer)) {
      side = 'received';
      entityId = customer;
    } else {
      issues.push({
        code: 'entity_conflict',
        field: 'legalEntityId',
        message:
          'Both parties are own legal entities and no channel or hint entity picks the side.',
      });
    }
  } else if (supplier !== null) {
    side = 'issued';
    entityId = supplier;
  } else if (customer !== null) {
    side = 'received';
    entityId = customer;
  } else if (suppliers.length <= 1 && customers.length <= 1) {
    issues.push({
      code: 'entity_unresolved',
      field: 'legalEntityId',
      message: 'Neither party IČO matches an own legal entity.',
    });
  }

  const bound = [
    ['channel', context.channelEntityId],
    ['hint', context.hintEntityId],
    ['rule', context.ruleEntityId],
    ['target default', context.targetEntityId],
  ] as const;
  const namesNoneOfOurs =
    supplier === null &&
    customer === null &&
    suppliers.length === 0 &&
    customers.length === 0;

  for (const [source, boundId] of bound) {
    if (boundId === null) {
      continue;
    }

    const boundHasNumber =
      normalizeRegistrationNumber(
        context.ownEntities.find((entity) => entity.id === boundId)
          ?.registrationNumber ?? null,
      ) !== null;

    if (entityId !== null && boundId !== entityId) {
      issues.push({
        code: 'entity_conflict',
        field: 'legalEntityId',
        message: `The ${source} entity differs from the entity the file names.`,
      });
    } else if (namesNoneOfOurs && boundHasNumber) {
      issues.push({
        code: 'entity_conflict',
        field: 'legalEntityId',
        message: `The ${source} entity has an IČO, but the file names none of the own entities.`,
      });
    }
  }

  const counterparty =
    side === null
      ? null
      : side === 'issued'
        ? parsed.customer
        : parsed.supplier;
  let partnerId: string | null = null;
  let lineCategory: string | null = null;

  if (counterparty !== null) {
    const byNumber =
      counterparty.registrationNumber === null
        ? []
        : context.partners.filter(
            (partner) =>
              normalizeRegistrationNumber(partner.registrationNumber) ===
              counterparty.registrationNumber,
          );
    const byVat =
      byNumber.length > 0 || counterparty.vatNumber === null
        ? []
        : context.partners.filter(
            (partner) =>
              normalizeVatNumber(partner.vatNumber) === counterparty.vatNumber,
          );
    const matches = byNumber.length > 0 ? byNumber : byVat;
    const only = matches.length === 1 ? matches[0] : undefined;

    if (only !== undefined) {
      partnerId = only.id;
      lineCategory = only.defaultLineCategory;
      reasons.push({
        evidence: `The counterparty matches a partner by ${byNumber.length > 0 ? 'IČO' : 'DIČ'}.`,
        step: 'parse',
        weight: 1,
      });
    } else if (matches.length > 1) {
      issues.push({
        code: 'unknown_partner',
        field: 'partnerId',
        message: evidence(
          `Several partners match the counterparty: ${matches.map((partner) => partner.id).join(', ')}.`,
        ),
      });
    } else {
      issues.push({
        code: 'unknown_partner',
        field: 'partnerId',
        message: 'No partner matches the counterparty.',
      });
      reasons.push({
        evidence: evidence(
          `Proposed partner: name ${counterparty.name ?? 'unknown'}, IČO ${counterparty.registrationNumber ?? 'none'}, DIČ ${counterparty.vatNumber ?? 'none'}, country ${counterparty.country ?? 'unknown'}.`,
        ),
        step: 'parse',
        weight: 0.5,
      });
    }
  }

  const kind = kindOf(parsed.documentType, side);
  const name = (counterparty ?? parsed.supplier).name;
  const title =
    [name, parsed.reference]
      .filter((part) => part !== null)
      .join(' ')
      .trim()
      .slice(0, MAX_TITLE_LENGTH) || 'ISDOC';
  const boundStep =
    (context.channelEntityId !== null || context.hintEntityId !== null) &&
    (entityId === null ||
      entityId === context.channelEntityId ||
      entityId === context.hintEntityId);
  const entityConfidence = boundStep ? 1 : entityId !== null ? 0.95 : 0.5;
  const parseConfidence = issues.length === 0 ? 1 : 0.5;

  return {
    lineCategory,
    output: {
      confidence: Math.min(entityConfidence, parseConfidence),
      detectedType: ISDOC_DETECTED_TYPE,
      draft: {
        ...parsed.content,
        kind,
        legalEntityId: entityId,
        partnerId,
        title,
      },
      fieldConfidences: {
        ...parsed.fieldConfidences,
        kind: kind === null ? 0.5 : 1,
        legalEntityId: entityConfidence,
        partnerId: partnerId === null ? 0.5 : 1,
      },
      issues,
      ...(entityId === null ? {} : { legalEntityId: entityId }),
      ...(partnerId === null ? {} : { partnerId }),
      reasons,
    },
  };
}

// A refused file: no draft, one issue naming why, so the item stays in review.
export function failureOutput(failure: IsdocFailure): ProviderOutput {
  return {
    confidence: 0,
    detectedType: ISDOC_DETECTED_TYPE,
    draft: {},
    fieldConfidences: {},
    issues: [{ code: failure.code, message: failure.message }],
    reasons: [],
  };
}
