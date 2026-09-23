import { inboxChannelKinds, inboxItemStatuses } from '@bap/db';
import { legalEntityIdentifierSchema } from '@bap/security';
import { z } from 'zod';

import {
  absDecimal,
  addDecimal,
  DECIMAL_PATTERN,
  DECIMAL_ZERO,
  multiplyByRatePercent,
  NON_NEGATIVE_DECIMAL_PATTERN,
  parseDecimal,
  tryParseDecimal,
} from './decimal.js';

// The closed vocabularies of the migration. Both Zod and the published OpenAPI read these arrays, so they cannot drift.
export const DOCUMENT_KINDS = [
  'issued_invoice',
  'received_invoice',
  'credit_note',
  'advance_request',
  'receipt',
  'bank_statement',
  'contract',
  'agreement',
  'hr_document',
  'payroll',
  'tax_filing',
  'other',
] as const;

export const DOCUMENT_STATUSES = [
  'registered',
  'needs_review',
  'verified',
  'archived',
] as const;

export const DOCUMENT_SOURCES = ['manual', 'upload', 'import', 'api'] as const;

export const INVOICE_LINE_CATEGORIES = [
  'goods',
  'material',
  'services',
  'labour',
  'transport',
  'asset',
  'other',
] as const;

// An advance deduction is a line kind, because the paper itemises the deducted advance by VAT rate.
export const INVOICE_LINE_KINDS = ['item', 'advance_deduction'] as const;

export const VAT_MODES = [
  'standard',
  'reverse_charge',
  'exempt',
  'outside_scope',
] as const;

export const DOCUMENT_LINK_KINDS = [
  'settles',
  'advance_of',
  'fulfills',
  'corrects',
  'supersedes',
  'relates',
] as const;

export const DATA_ISSUE_CODES = [
  'unbalanced_event',
  'unmapped_line',
  'missing_partner',
  'total_mismatch',
] as const;

export const ISSUE_SEVERITIES = ['warning', 'error'] as const;

export const EVENT_SIDES = ['debit', 'credit'] as const;

// The balance sheet or income statement nature of a directive account, the vocabulary the chart itself stores.
export const ACCOUNT_NATURES = [
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'EXPENSE',
  'REVENUE',
  'CLOSING',
  'OFF_BALANCE',
] as const;

export const DOCUMENT_SORT_KEYS = [
  'documentDate',
  'reference',
  'title',
  'totalAmount',
  'createdAt',
] as const;

export const SORT_ORDERS = ['asc', 'desc'] as const;

// The bound on one page and on how deep a caller may page; a larger value is rejected, never clamped.
export const MAX_DOCUMENT_PAGE_SIZE = 100;
export const DEFAULT_DOCUMENT_PAGE_SIZE = 25;
export const MAX_DOCUMENT_WINDOW = 10_000;

// The whole partner list and the whole reference chart are bounded on the server; no client parameter widens them.
export const MAX_PARTNER_LIST_SIZE = 200;
export const MAX_INVOICE_LINES = 200;
export const MAX_DOCUMENT_ATTRIBUTES = 50;

export const documentKindSchema = z.enum(DOCUMENT_KINDS);
export const documentStatusSchema = z.enum(DOCUMENT_STATUSES);
export const documentSourceSchema = z.enum(DOCUMENT_SOURCES);
export const invoiceLineCategorySchema = z.enum(INVOICE_LINE_CATEGORIES);
export const invoiceLineKindSchema = z.enum(INVOICE_LINE_KINDS);
export const vatModeSchema = z.enum(VAT_MODES);
export const documentLinkKindSchema = z.enum(DOCUMENT_LINK_KINDS);
export const dataIssueCodeSchema = z.enum(DATA_ISSUE_CODES);
export const issueSeveritySchema = z.enum(ISSUE_SEVERITIES);
export const eventSideSchema = z.enum(EVENT_SIDES);
export const accountNatureSchema = z.enum(ACCOUNT_NATURES);

// Money crosses the boundary as text only: a JS number cannot hold numeric(19,4) without loss.
export const decimalStringSchema = z.string().trim().regex(DECIMAL_PATTERN);

// An amount a document carries is never negative; a refund is a credit note, which is its own kind.
export const nonNegativeDecimalStringSchema = z
  .string()
  .trim()
  .regex(NON_NEGATIVE_DECIMAL_PATTERN);

// The analytic activity of a line: a free code, normalised here so grouping never depends on how it was typed.
export const ACTIVITY_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const activityCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(ACTIVITY_CODE_PATTERN);

// One unit, the bound the invoice check constraint enforces on the only signed money column in the register.
const ROUNDING_BOUND = parseDecimal('1');

// The supplier rounded up when it is positive and down when it is negative, so this amount alone carries a sign.
export const signedRoundingSchema = decimalStringSchema.refine(
  (value) => {
    const rounding = tryParseDecimal(value);

    // Zod keeps refining after the regex fails, and the regex issue already reports that value.
    return rounding === null || absDecimal(rounding) < ROUNDING_BOUND;
  },
  { message: 'A rounding difference is smaller than one unit.' },
);

// Zero to one hundred with at most two decimal places, the exact range numeric(5,2) and the check constraint accept.
export const VAT_RATE_PATTERN = /^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/;
export const vatRateSchema = z.string().trim().regex(VAT_RATE_PATTERN);

// numeric(18,6) and greater than zero: the lookahead demands a digit that is not a zero somewhere in the value.
export const FX_RATE_PATTERN = /^(?=.*[1-9])\d{1,12}(\.\d{1,6})?$/;
export const fxRateSchema = z.string().trim().regex(FX_RATE_PATTERN);

// Half a unit of tolerance, the same the invoice_line check constraint allows for per-rate source rounding.
const VAT_TOLERANCE = parseDecimal('0.5');

function vatWithinTolerance(line: {
  baseAmount: string;
  vatAmount: string;
  vatMode: (typeof VAT_MODES)[number];
  vatRate: string;
}): boolean {
  if (line.vatMode !== 'standard') {
    return true;
  }

  const vatAmount = tryParseDecimal(line.vatAmount);
  const baseAmount = tryParseDecimal(line.baseAmount);
  const vatRate = tryParseDecimal(line.vatRate);

  // Zod keeps refining after a child regex fails, and that regex issue already reports the field.
  if (vatAmount === null || baseAmount === null || vatRate === null) {
    return true;
  }

  const difference = vatAmount - multiplyByRatePercent(baseAmount, vatRate);

  return absDecimal(difference) <= VAT_TOLERANCE;
}

// Base plus VAT of one line, or null when either amount is still failing its own pattern.
function lineGross(line: {
  baseAmount: string;
  vatAmount: string;
}): bigint | null {
  const base = tryParseDecimal(line.baseAmount);
  const vat = tryParseDecimal(line.vatAmount);

  return base === null || vat === null ? null : addDecimal(base, vat);
}

// Lower-cased at the boundary like every other identifier, because PostgreSQL emits lower-case uuids.
export const documentIdentifierSchema = z.string().trim().toLowerCase().uuid();
export const partnerIdentifierSchema = z.string().trim().toLowerCase().uuid();
export const documentLinkIdentifierSchema = z
  .string()
  .trim()
  .toLowerCase()
  .uuid();

export const documentReferenceSchema = z.string().trim().min(1).max(64);
export const documentTitleSchema = z.string().trim().min(1).max(200);
export const documentNotesSchema = z.string().trim().max(2000);
export const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/);
export const attributeKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
export const attributeValueSchema = z.string().max(2000);
export const accountCodeSchema = z.string().regex(/^[0-9]{3}$/);
export const sourceAccountCodeSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{3}(\.[0-9A-Za-z]+)?$/);

export const partnerNameSchema = z.string().trim().min(1).max(200);
export const partnerRegistrationNumberSchema = z
  .string()
  .trim()
  .max(32)
  .regex(/^[A-Za-z0-9-]{1,32}$/);
export const partnerVatNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}[A-Za-z0-9]{2,16}$/);
export const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/);

export const documentSummarySchema = z
  .object({
    createdAt: z.iso.datetime(),
    currencyCode: currencyCodeSchema,
    documentDate: z.iso.date(),
    hasEvent: z.boolean(),
    id: documentIdentifierSchema,
    isBalanced: z.boolean().nullable(),
    isCurrent: z.boolean(),
    kind: documentKindSchema,
    legalEntityId: legalEntityIdentifierSchema,
    openIssueCount: z.number().int().min(0),
    partnerId: partnerIdentifierSchema.nullable(),
    partnerName: partnerNameSchema.nullable(),
    reference: documentReferenceSchema.nullable(),
    source: documentSourceSchema,
    status: documentStatusSchema,
    title: documentTitleSchema,
    totalAmount: decimalStringSchema.nullable(),
    updatedAt: z.iso.datetime(),
    validFrom: z.iso.date().nullable(),
    validTo: z.iso.date().nullable(),
    version: z.number().int().min(1),
  })
  .strict();

export type DocumentSummary = z.infer<typeof documentSummarySchema>;

export const invoiceLineSchema = z
  .object({
    activityCode: activityCodeSchema.nullable(),
    baseAmount: nonNegativeDecimalStringSchema,
    // Null on an advance deduction line, which settles a prepayment instead of describing a supply.
    category: invoiceLineCategorySchema.nullable(),
    description: z.string().min(1).max(500),
    id: z.string().toLowerCase().uuid(),
    lineKind: invoiceLineKindSchema,
    lineNo: z.number().int().min(1),
    periodEnd: z.iso.date().nullable(),
    periodStart: z.iso.date().nullable(),
    quantity: nonNegativeDecimalStringSchema.nullable(),
    sourceAccountCode: sourceAccountCodeSchema.nullable(),
    taxPointDate: z.iso.date().nullable(),
    unit: z.string().max(16).nullable(),
    unitPrice: nonNegativeDecimalStringSchema.nullable(),
    vatAmount: nonNegativeDecimalStringSchema,
    vatMode: vatModeSchema,
    vatRate: vatRateSchema,
  })
  .strict();

export const invoiceSchema = z
  .object({
    advanceTotal: nonNegativeDecimalStringSchema,
    // Generated and stored by the database as gross plus rounding minus the advance; the API never writes it.
    amountDue: nonNegativeDecimalStringSchema,
    baseTotal: nonNegativeDecimalStringSchema,
    dueDate: z.iso.date().nullable(),
    // numeric(18,6) reaches the boundary as text, so the response carries all six decimal places.
    fxRate: fxRateSchema.nullable(),
    grossTotal: nonNegativeDecimalStringSchema,
    lines: z.array(invoiceLineSchema),
    receivedDate: z.iso.date().nullable(),
    roundingAmount: signedRoundingSchema,
    taxPointDate: z.iso.date().nullable(),
    variableSymbol: z
      .string()
      .regex(/^[0-9]{1,10}$/)
      .nullable(),
    vatTotal: nonNegativeDecimalStringSchema,
  })
  .strict();

export const economicEventLineSchema = z
  .object({
    accountCode: accountCodeSchema,
    accountName: z.string(),
    activityCode: activityCodeSchema.nullable(),
    amount: decimalStringSchema,
    description: z.string().max(500).nullable(),
    // The tax point of this leg, which is what a report by month groups on; the event date stays the register date.
    effectiveDate: z.iso.date(),
    invoiceLineId: z.string().toLowerCase().uuid().nullable(),
    lineNo: z.number().int().min(1),
    partnerId: partnerIdentifierSchema.nullable(),
    side: eventSideSchema,
  })
  .strict();

export const economicEventSchema = z
  .object({
    creditTotal: decimalStringSchema,
    debitTotal: decimalStringSchema,
    derivedAt: z.iso.datetime(),
    eventDate: z.iso.date(),
    id: z.string().toLowerCase().uuid(),
    isBalanced: z.boolean(),
    lines: z.array(economicEventLineSchema),
    ruleSetVersion: z.string().min(1).max(64),
  })
  .strict();

export const dataIssueSchema = z
  .object({
    code: dataIssueCodeSchema,
    createdAt: z.iso.datetime(),
    detail: z.string().max(500).nullable(),
    id: z.string().toLowerCase().uuid(),
    resolvedAt: z.iso.datetime().nullable(),
    severity: issueSeveritySchema,
  })
  .strict();

export const documentLinkSchema = z
  .object({
    createdAt: z.iso.datetime(),
    fromDocumentId: documentIdentifierSchema,
    id: documentLinkIdentifierSchema,
    kind: documentLinkKindSchema,
    toDocumentId: documentIdentifierSchema,
  })
  .strict();

export type DocumentLink = z.infer<typeof documentLinkSchema>;

// The original bytes behind the document: one row per attached blob, in document order.
export const documentFileSchema = z
  .object({
    blobId: z.string().uuid(),
    byteSize: z.number().int().positive(),
    filename: z.string().min(1).max(255).nullable(),
    mediaType: z.string().min(1).max(255),
    position: z.number().int().min(1),
  })
  .strict();

export type DocumentFile = z.infer<typeof documentFileSchema>;

// Every inbox item pointing at the document: the one that created it and every one attached later.
export const documentInboxItemSchema = z
  .object({
    channelKind: z.enum(inboxChannelKinds),
    id: z.string().uuid(),
    receivedAt: z.iso.datetime(),
    status: z.enum(inboxItemStatuses),
  })
  .strict();

export const documentDetailSchema = z
  .object({
    attributes: z.record(attributeKeySchema, attributeValueSchema),
    document: documentSummarySchema,
    event: economicEventSchema.nullable(),
    files: z.array(documentFileSchema),
    inboxItems: z.array(documentInboxItemSchema),
    invoice: invoiceSchema.nullable(),
    issues: z.array(dataIssueSchema),
    links: z.array(documentLinkSchema),
    supersededByDocumentId: documentIdentifierSchema.nullable(),
    supersedesDocumentId: documentIdentifierSchema.nullable(),
  })
  .strict();

export type DocumentDetail = z.infer<typeof documentDetailSchema>;

// The tab counts of the list, on the caller scope and the entity filter, ignoring every other filter.
export const documentCountsSchema = z
  .object({
    all: z.number().int().min(0),
    archived: z.number().int().min(0),
    needsReview: z.number().int().min(0),
    verified: z.number().int().min(0),
    withIssues: z.number().int().min(0),
  })
  .strict();

export type DocumentCounts = z.infer<typeof documentCountsSchema>;

export const documentListResponseSchema = z
  .object({
    counts: documentCountsSchema,
    documents: z.array(documentSummarySchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(MAX_DOCUMENT_PAGE_SIZE),
    total: z.number().int().min(0),
    totalsByCurrency: z.array(
      z
        .object({
          currencyCode: currencyCodeSchema,
          totalAmount: decimalStringSchema,
        })
        .strict(),
    ),
  })
  .strict();

export type DocumentListResponse = z.infer<typeof documentListResponseSchema>;

// A filter arrives either repeated or comma separated; both collapse to the same list of enum members.
export function repeatedOrCsv<Values extends readonly [string, ...string[]]>(
  values: Values,
): z.ZodType<Values[number][]> {
  return z
    .union([z.string(), z.array(z.string())])
    .transform((value) =>
      (Array.isArray(value) ? value : value.split(','))
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    )
    .pipe(z.array(z.enum(values)).min(1).max(values.length));
}

// The most legal entities one filter may name, the same bound the entity scope carries.
export const MAX_FILTER_LEGAL_ENTITIES = 200;

// An id filter arrives either repeated or comma separated; both collapse to the same validated id list.
export function repeatedOrCsvIds(
  schema: z.ZodType<string, string>,
): z.ZodType<string[]> {
  return z
    .union([z.string(), z.array(z.string())])
    .transform((value) =>
      (Array.isArray(value) ? value : value.split(','))
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    )
    .pipe(z.array(schema).min(1).max(MAX_FILTER_LEGAL_ENTITIES));
}

export const DOCUMENT_CURRENT_FILTERS = ['true', 'false', 'all'] as const;

export const documentListQuerySchema = z
  .object({
    // Superseded versions are hidden unless asked for.
    current: z.enum(DOCUMENT_CURRENT_FILTERS).default('true'),
    dateFrom: z.iso.date().optional(),
    dateTo: z.iso.date().optional(),
    kind: repeatedOrCsv(DOCUMENT_KINDS).optional(),
    // Several entities may be selected at once; none selected leaves the whole caller scope in view.
    legalEntityId: repeatedOrCsvIds(legalEntityIdentifierSchema).optional(),
    order: z.enum(SORT_ORDERS).default('desc'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_DOCUMENT_PAGE_SIZE)
      .default(DEFAULT_DOCUMENT_PAGE_SIZE),
    partnerId: partnerIdentifierSchema.optional(),
    q: z.string().trim().min(1).max(100).optional(),
    sort: z.enum(DOCUMENT_SORT_KEYS).default('documentDate'),
    status: repeatedOrCsv(DOCUMENT_STATUSES).optional(),
  })
  .strict()
  .superRefine((query, context) => {
    // Offset paging is bounded so a deep page cannot turn into an unbounded scan.
    if (query.page * query.pageSize > MAX_DOCUMENT_WINDOW) {
      context.addIssue({
        code: 'custom',
        message: `page multiplied by pageSize must not exceed ${MAX_DOCUMENT_WINDOW}.`,
        path: ['page'],
      });
    }

    if (
      query.dateFrom !== undefined &&
      query.dateTo !== undefined &&
      query.dateFrom > query.dateTo
    ) {
      context.addIssue({
        code: 'custom',
        message: 'dateFrom must not be later than dateTo.',
        path: ['dateFrom'],
      });
    }
  });

export type DocumentListQuery = z.infer<typeof documentListQuerySchema>;

export const createInvoiceLineSchema = z
  .object({
    activityCode: activityCodeSchema.optional(),
    baseAmount: nonNegativeDecimalStringSchema,
    category: invoiceLineCategorySchema.optional(),
    description: z.string().trim().min(1).max(500),
    lineKind: invoiceLineKindSchema.default('item'),
    periodEnd: z.iso.date().optional(),
    periodStart: z.iso.date().optional(),
    quantity: nonNegativeDecimalStringSchema.optional(),
    sourceAccountCode: sourceAccountCodeSchema.optional(),
    taxPointDate: z.iso.date().optional(),
    unit: z.string().trim().min(1).max(16).optional(),
    unitPrice: nonNegativeDecimalStringSchema.optional(),
    vatAmount: nonNegativeDecimalStringSchema.default('0'),
    vatMode: vatModeSchema,
    vatRate: vatRateSchema.default('0'),
  })
  .strict()
  .superRefine((line, context) => {
    // A supply is categorised and a deduction is not, exactly as the invoice_line check constraint demands.
    if (line.lineKind === 'item' && line.category === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'An item line requires a category.',
        path: ['category'],
      });
    }

    if (line.lineKind === 'advance_deduction' && line.category !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'An advance deduction line carries no category.',
        path: ['category'],
      });
    }

    // The settlement legs take the tax point of the final invoice, so a date here would re-date them into the advance's month.
    if (line.lineKind === 'advance_deduction') {
      for (const field of [
        'periodEnd',
        'periodStart',
        'taxPointDate',
      ] as const) {
        if (line[field] !== undefined) {
          context.addIssue({
            code: 'custom',
            message:
              'An advance deduction line carries no tax point and no period.',
            path: [field],
          });
        }
      }
    }

    if (
      line.periodStart !== undefined &&
      line.periodEnd !== undefined &&
      line.periodStart > line.periodEnd
    ) {
      context.addIssue({
        code: 'custom',
        message: 'periodStart must not be later than periodEnd.',
        path: ['periodStart'],
      });
    }
  })
  .refine(
    (line) => {
      const vatAmount = tryParseDecimal(line.vatAmount);

      // An amount that is still failing its own pattern already reports that issue.
      return (
        line.vatMode === 'standard' ||
        vatAmount === null ||
        vatAmount === DECIMAL_ZERO
      );
    },
    {
      message: 'Only a standard line carries a VAT amount.',
      path: ['vatAmount'],
    },
  )
  .refine(vatWithinTolerance, {
    message: 'The VAT amount must match the rate within half a unit.',
    path: ['vatAmount'],
  });

export const createInvoiceSchema = z
  .object({
    dueDate: z.iso.date().optional(),
    fxRate: fxRateSchema.optional(),
    lines: z.array(createInvoiceLineSchema).min(1).max(MAX_INVOICE_LINES),
    receivedDate: z.iso.date().optional(),
    roundingAmount: signedRoundingSchema.default('0'),
    taxPointDate: z.iso.date().optional(),
    variableSymbol: z
      .string()
      .trim()
      .regex(/^[0-9]{1,10}$/)
      .optional(),
  })
  .strict()
  .superRefine((invoice, context) => {
    // An invoice that deducts an advance still invoices a supply; a settlement on its own is another document.
    if (!invoice.lines.some((line) => line.lineKind === 'item')) {
      context.addIssue({
        code: 'custom',
        message: 'An invoice requires at least one item line.',
        path: ['lines'],
      });
    }

    const rounding = tryParseDecimal(invoice.roundingAmount);

    // Zod keeps refining after a child regex fails, and an unparsable amount already reports its own issue.
    if (rounding === null) {
      return;
    }

    let supplied = rounding;
    let deducted = DECIMAL_ZERO;

    for (const line of invoice.lines) {
      const gross = lineGross(line);

      if (gross === null) {
        return;
      }

      if (line.lineKind === 'item') {
        supplied = addDecimal(supplied, gross);
      } else {
        deducted = addDecimal(deducted, gross);
      }
    }

    // An overpaid advance is settled by a credit note, so the amount due can never fall below zero.
    if (deducted > supplied) {
      context.addIssue({
        code: 'custom',
        message:
          'The deducted advance must not exceed the supplied amount plus the rounding.',
        path: ['lines'],
      });
    }
  });

const documentAttributesSchema = z
  .record(attributeKeySchema, attributeValueSchema)
  .refine(
    (attributes) => Object.keys(attributes).length <= MAX_DOCUMENT_ATTRIBUTES,
    { message: `At most ${MAX_DOCUMENT_ATTRIBUTES} attributes are accepted.` },
  );

// Kinds that carry structured invoice content; every other kind stores attributes instead.
export const INVOICE_KINDS: readonly (typeof DOCUMENT_KINDS)[number][] = [
  'issued_invoice',
  'received_invoice',
];

export const createDocumentRequestSchema = z
  .object({
    attributes: documentAttributesSchema.optional(),
    currencyCode: currencyCodeSchema.default('CZK'),
    documentDate: z.iso.date(),
    invoice: createInvoiceSchema.optional(),
    kind: documentKindSchema,
    legalEntityId: legalEntityIdentifierSchema,
    notes: documentNotesSchema.optional(),
    partnerId: partnerIdentifierSchema.optional(),
    reference: documentReferenceSchema.optional(),
    title: documentTitleSchema,
    totalAmount: nonNegativeDecimalStringSchema.optional(),
    validFrom: z.iso.date().optional(),
    validTo: z.iso.date().optional(),
  })
  .strict()
  .superRefine((body, context) => {
    const needsInvoice = INVOICE_KINDS.includes(body.kind);

    if (needsInvoice && body.invoice === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'An invoice kind requires invoice content.',
        path: ['invoice'],
      });
    }

    if (!needsInvoice && body.invoice !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Only an invoice kind accepts invoice content.',
        path: ['invoice'],
      });
    }

    if (
      body.validFrom !== undefined &&
      body.validTo !== undefined &&
      body.validFrom > body.validTo
    ) {
      context.addIssue({
        code: 'custom',
        message: 'validFrom must not be later than validTo.',
        path: ['validFrom'],
      });
    }
  });

export type CreateDocumentRequest = z.infer<typeof createDocumentRequestSchema>;

export const updateDocumentRequestSchema = z
  .object({
    attributes: documentAttributesSchema.optional(),
    documentDate: z.iso.date().optional(),
    notes: documentNotesSchema.nullish(),
    partnerId: partnerIdentifierSchema.nullish(),
    reference: documentReferenceSchema.nullish(),
    status: documentStatusSchema.optional(),
    title: documentTitleSchema.optional(),
    validFrom: z.iso.date().nullish(),
    validTo: z.iso.date().nullish(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided.',
  })
  // Only the pair inside one body is checkable here; the repository re-checks it against the stored dates.
  .refine(
    (body) =>
      body.validFrom === undefined ||
      body.validFrom === null ||
      body.validTo === undefined ||
      body.validTo === null ||
      body.validFrom <= body.validTo,
    {
      message: 'validFrom must not be later than validTo.',
      path: ['validFrom'],
    },
  );

export type UpdateDocumentRequest = z.infer<typeof updateDocumentRequestSchema>;

export const createDocumentLinkRequestSchema = z
  .object({
    kind: documentLinkKindSchema,
    toDocumentId: documentIdentifierSchema,
  })
  .strict();

export type CreateDocumentLinkRequest = z.infer<
  typeof createDocumentLinkRequestSchema
>;

export const partnerSchema = z
  .object({
    countryCode: countryCodeSchema.nullable(),
    createdAt: z.iso.datetime(),
    id: partnerIdentifierSchema,
    legalEntityId: legalEntityIdentifierSchema.nullable(),
    name: partnerNameSchema,
    registrationNumber: partnerRegistrationNumberSchema.nullable(),
    updatedAt: z.iso.datetime(),
    vatNumber: partnerVatNumberSchema.nullable(),
  })
  .strict();

export type Partner = z.infer<typeof partnerSchema>;

export const partnerListResponseSchema = z
  .object({ partners: z.array(partnerSchema) })
  .strict();

export type PartnerListResponse = z.infer<typeof partnerListResponseSchema>;

export const partnerListQuerySchema = z
  .object({ q: z.string().trim().min(1).max(100).optional() })
  .strict();

export type PartnerListQuery = z.infer<typeof partnerListQuerySchema>;

export const createPartnerRequestSchema = z
  .object({
    countryCode: countryCodeSchema.optional(),
    legalEntityId: legalEntityIdentifierSchema.optional(),
    name: partnerNameSchema,
    registrationNumber: partnerRegistrationNumberSchema.optional(),
    vatNumber: partnerVatNumberSchema.optional(),
  })
  .strict();

export type CreatePartnerRequest = z.infer<typeof createPartnerRequestSchema>;

export const updatePartnerRequestSchema = z
  .object({
    countryCode: countryCodeSchema.nullish(),
    legalEntityId: legalEntityIdentifierSchema.nullish(),
    name: partnerNameSchema.optional(),
    registrationNumber: partnerRegistrationNumberSchema.nullish(),
    vatNumber: partnerVatNumberSchema.nullish(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided.',
  });

export type UpdatePartnerRequest = z.infer<typeof updatePartnerRequestSchema>;

export const directiveAccountSchema = z
  .object({
    class: z.number().int().min(0).max(9),
    code: accountCodeSchema,
    groupCode: z.string().regex(/^[0-9]{2}$/),
    nameCs: z.string().min(1),
    nameEn: z.string().min(1),
    nature: accountNatureSchema,
  })
  .strict();

export type DirectiveAccount = z.infer<typeof directiveAccountSchema>;

export const directiveAccountListResponseSchema = z
  .object({ directiveAccounts: z.array(directiveAccountSchema) })
  .strict();

export type DirectiveAccountListResponse = z.infer<
  typeof directiveAccountListResponseSchema
>;

// The analytics read answers from stored columns only, so it publishes a bounded document list beside its aggregates.
export const MAX_ANALYTICS_DOCUMENTS = 50;

export const documentAnalyticsQuerySchema = z
  .object({
    // Several entities may be selected at once; none selected leaves the whole caller scope in view.
    legalEntityId: repeatedOrCsvIds(legalEntityIdentifierSchema).optional(),
  })
  .strict();

export type DocumentAnalyticsQuery = z.infer<
  typeof documentAnalyticsQuerySchema
>;

// One invoice in the caller scope: what it cost, what was prepaid and what is still due.
export const analyticsDocumentSchema = z
  .object({
    advanceTotal: nonNegativeDecimalStringSchema,
    amountDue: nonNegativeDecimalStringSchema,
    currencyCode: currencyCodeSchema,
    documentDate: z.iso.date(),
    grossTotal: nonNegativeDecimalStringSchema,
    id: documentIdentifierSchema,
    kind: documentKindSchema,
    partnerName: partnerNameSchema.nullable(),
    reference: documentReferenceSchema.nullable(),
    roundingAmount: signedRoundingSchema,
    status: documentStatusSchema,
    title: documentTitleSchema,
  })
  .strict();

// Both sides of a grouping come from one pass, so a reader never has to pair two rows to get a net figure.
export const analyticsMonthRowSchema = z
  .object({
    accountCode: accountCodeSchema,
    accountName: z.string(),
    credit: decimalStringSchema,
    debit: decimalStringSchema,
    // The first day of the month of the leg tax point, never of the register date.
    month: z.iso.date(),
  })
  .strict();

export const analyticsActivityRowSchema = z
  .object({
    activityCode: activityCodeSchema,
    credit: decimalStringSchema,
    debit: decimalStringSchema,
    lineCount: z.number().int().min(0),
  })
  .strict();

export const analyticsVatRegimeRowSchema = z
  .object({
    baseAmount: decimalStringSchema,
    lineCount: z.number().int().min(0),
    lineKind: invoiceLineKindSchema,
    vatAmount: decimalStringSchema,
    vatMode: vatModeSchema,
    vatRate: vatRateSchema,
  })
  .strict();

export const analyticsAccountRowSchema = z
  .object({
    accountCode: accountCodeSchema,
    accountName: z.string(),
    credit: decimalStringSchema,
    debit: decimalStringSchema,
    nature: accountNatureSchema,
  })
  .strict();

// What the route read and what it cost, so the page can state its own cost instead of implying a free answer.
export const analyticsStatsSchema = z
  .object({
    documentCount: z.number().int().min(0),
    elapsedMs: z.number().int().min(0),
    eventLineCount: z.number().int().min(0),
    invoiceLineCount: z.number().int().min(0),
    queryCount: z.number().int().min(1),
  })
  .strict();

export const documentAnalyticsResponseSchema = z
  .object({
    byAccount: z.array(analyticsAccountRowSchema),
    byActivity: z.array(analyticsActivityRowSchema),
    byMonth: z.array(analyticsMonthRowSchema),
    byVatRegime: z.array(analyticsVatRegimeRowSchema),
    documents: z.array(analyticsDocumentSchema).max(MAX_ANALYTICS_DOCUMENTS),
    stats: analyticsStatsSchema,
  })
  .strict();

export type DocumentAnalyticsResponse = z.infer<
  typeof documentAnalyticsResponseSchema
>;

export type AccountNature = z.infer<typeof accountNatureSchema>;
export type DataIssueCode = z.infer<typeof dataIssueCodeSchema>;
export type DocumentKind = z.infer<typeof documentKindSchema>;
export type DocumentLinkKind = z.infer<typeof documentLinkKindSchema>;
export type DocumentSource = z.infer<typeof documentSourceSchema>;
export type DocumentStatus = z.infer<typeof documentStatusSchema>;
export type EventSide = z.infer<typeof eventSideSchema>;
export type InvoiceLineCategory = z.infer<typeof invoiceLineCategorySchema>;
export type InvoiceLineKind = z.infer<typeof invoiceLineKindSchema>;
export type IssueSeverity = z.infer<typeof issueSeveritySchema>;
export type VatMode = z.infer<typeof vatModeSchema>;

const dateProperty = { format: 'date', type: 'string' };
const dateTimeProperty = { format: 'date-time', type: 'string' };
const uuidProperty = { format: 'uuid', type: 'string' };
const moneyProperty = { pattern: DECIMAL_PATTERN.source, type: 'string' };
const amountProperty = {
  pattern: NON_NEGATIVE_DECIMAL_PATTERN.source,
  type: 'string',
};
const vatRateProperty = { pattern: VAT_RATE_PATTERN.source, type: 'string' };
const activityCodeProperty = {
  pattern: ACTIVITY_CODE_PATTERN.source,
  type: 'string',
};
const fxRateProperty = { pattern: FX_RATE_PATTERN.source, type: 'string' };
// The only signed money field, bounded below one unit in both directions by the invoice check constraint.
const roundingProperty = {
  description:
    'Rounding of the printed total to whole crowns, strictly below 1 in absolute value, positive when the issuer rounded up.',
  pattern: '^-?0(\\.\\d{1,4})?$',
  type: 'string',
};
const sourceAccountCodeProperty = {
  pattern: '^[0-9]{3}(\\.[0-9A-Za-z]+)?$',
  type: 'string',
};

export const documentSummaryOpenApiSchema = {
  additionalProperties: false,
  properties: {
    createdAt: dateTimeProperty,
    currencyCode: { pattern: '^[A-Z]{3}$', type: 'string' },
    documentDate: dateProperty,
    hasEvent: { type: 'boolean' },
    id: uuidProperty,
    isBalanced: { nullable: true, type: 'boolean' },
    isCurrent: { type: 'boolean' },
    kind: { enum: [...DOCUMENT_KINDS], type: 'string' },
    legalEntityId: uuidProperty,
    openIssueCount: { minimum: 0, type: 'integer' },
    partnerId: { ...uuidProperty, nullable: true },
    partnerName: { maxLength: 200, nullable: true, type: 'string' },
    reference: { maxLength: 64, nullable: true, type: 'string' },
    source: { enum: [...DOCUMENT_SOURCES], type: 'string' },
    status: { enum: [...DOCUMENT_STATUSES], type: 'string' },
    title: { maxLength: 200, minLength: 1, type: 'string' },
    totalAmount: {
      ...moneyProperty,
      description:
        'For an invoice kind this is the printed total, gross plus rounding, before any advance deduction.',
      nullable: true,
    },
    updatedAt: dateTimeProperty,
    validFrom: { ...dateProperty, nullable: true },
    validTo: { ...dateProperty, nullable: true },
    version: { minimum: 1, type: 'integer' },
  },
  required: [
    'createdAt',
    'currencyCode',
    'documentDate',
    'hasEvent',
    'id',
    'isBalanced',
    'isCurrent',
    'kind',
    'legalEntityId',
    'openIssueCount',
    'partnerId',
    'partnerName',
    'reference',
    'source',
    'status',
    'title',
    'totalAmount',
    'updatedAt',
    'validFrom',
    'validTo',
    'version',
  ],
  type: 'object',
};

const invoiceLineOpenApiSchema = {
  additionalProperties: false,
  properties: {
    activityCode: { ...activityCodeProperty, nullable: true },
    baseAmount: amountProperty,
    category: {
      enum: [...INVOICE_LINE_CATEGORIES],
      nullable: true,
      type: 'string',
    },
    description: { maxLength: 500, minLength: 1, type: 'string' },
    id: uuidProperty,
    lineKind: { enum: [...INVOICE_LINE_KINDS], type: 'string' },
    lineNo: { minimum: 1, type: 'integer' },
    periodEnd: { ...dateProperty, nullable: true },
    periodStart: { ...dateProperty, nullable: true },
    quantity: { ...amountProperty, nullable: true },
    sourceAccountCode: { ...sourceAccountCodeProperty, nullable: true },
    taxPointDate: { ...dateProperty, nullable: true },
    unit: { maxLength: 16, nullable: true, type: 'string' },
    unitPrice: { ...amountProperty, nullable: true },
    vatAmount: amountProperty,
    vatMode: { enum: [...VAT_MODES], type: 'string' },
    vatRate: vatRateProperty,
  },
  required: [
    'activityCode',
    'baseAmount',
    'category',
    'description',
    'id',
    'lineKind',
    'lineNo',
    'periodEnd',
    'periodStart',
    'quantity',
    'sourceAccountCode',
    'taxPointDate',
    'unit',
    'unitPrice',
    'vatAmount',
    'vatMode',
    'vatRate',
  ],
  type: 'object',
};

const invoiceOpenApiSchema = {
  additionalProperties: false,
  properties: {
    advanceTotal: amountProperty,
    amountDue: amountProperty,
    baseTotal: amountProperty,
    dueDate: { ...dateProperty, nullable: true },
    fxRate: { ...fxRateProperty, nullable: true },
    grossTotal: {
      ...amountProperty,
      description:
        'Base plus VAT over the supply lines; the printed total is this plus the rounding, before any advance deduction.',
    },
    lines: { items: invoiceLineOpenApiSchema, type: 'array' },
    receivedDate: { ...dateProperty, nullable: true },
    roundingAmount: roundingProperty,
    taxPointDate: { ...dateProperty, nullable: true },
    variableSymbol: {
      nullable: true,
      pattern: '^[0-9]{1,10}$',
      type: 'string',
    },
    vatTotal: amountProperty,
  },
  required: [
    'advanceTotal',
    'amountDue',
    'baseTotal',
    'dueDate',
    'fxRate',
    'grossTotal',
    'lines',
    'receivedDate',
    'roundingAmount',
    'taxPointDate',
    'variableSymbol',
    'vatTotal',
  ],
  type: 'object',
};

const economicEventOpenApiSchema = {
  additionalProperties: false,
  properties: {
    creditTotal: moneyProperty,
    debitTotal: moneyProperty,
    derivedAt: dateTimeProperty,
    eventDate: dateProperty,
    id: uuidProperty,
    isBalanced: { type: 'boolean' },
    lines: {
      items: {
        additionalProperties: false,
        properties: {
          accountCode: { pattern: '^[0-9]{3}$', type: 'string' },
          accountName: { type: 'string' },
          activityCode: { ...activityCodeProperty, nullable: true },
          amount: moneyProperty,
          description: { maxLength: 500, nullable: true, type: 'string' },
          effectiveDate: dateProperty,
          invoiceLineId: { ...uuidProperty, nullable: true },
          lineNo: { minimum: 1, type: 'integer' },
          partnerId: { ...uuidProperty, nullable: true },
          side: { enum: [...EVENT_SIDES], type: 'string' },
        },
        required: [
          'accountCode',
          'accountName',
          'activityCode',
          'amount',
          'description',
          'effectiveDate',
          'invoiceLineId',
          'lineNo',
          'partnerId',
          'side',
        ],
        type: 'object',
      },
      type: 'array',
    },
    ruleSetVersion: { maxLength: 64, minLength: 1, type: 'string' },
  },
  required: [
    'creditTotal',
    'debitTotal',
    'derivedAt',
    'eventDate',
    'id',
    'isBalanced',
    'lines',
    'ruleSetVersion',
  ],
  type: 'object',
};

export const documentLinkOpenApiSchema = {
  additionalProperties: false,
  properties: {
    createdAt: dateTimeProperty,
    fromDocumentId: uuidProperty,
    id: uuidProperty,
    kind: { enum: [...DOCUMENT_LINK_KINDS], type: 'string' },
    toDocumentId: uuidProperty,
  },
  required: ['createdAt', 'fromDocumentId', 'id', 'kind', 'toDocumentId'],
  type: 'object',
};

export const documentDetailOpenApiSchema = {
  additionalProperties: false,
  properties: {
    // Attribute keys come from the document, so this map stays open; every value is bounded text.
    attributes: { additionalProperties: { type: 'string' }, type: 'object' },
    document: documentSummaryOpenApiSchema,
    event: { ...economicEventOpenApiSchema, nullable: true },
    files: {
      items: {
        additionalProperties: false,
        properties: {
          blobId: uuidProperty,
          byteSize: { minimum: 1, type: 'integer' },
          filename: { maxLength: 255, nullable: true, type: 'string' },
          mediaType: { maxLength: 255, type: 'string' },
          position: { minimum: 1, type: 'integer' },
        },
        required: ['blobId', 'byteSize', 'filename', 'mediaType', 'position'],
        type: 'object',
      },
      type: 'array',
    },
    inboxItems: {
      items: {
        additionalProperties: false,
        properties: {
          channelKind: { enum: [...inboxChannelKinds], type: 'string' },
          id: uuidProperty,
          receivedAt: dateTimeProperty,
          status: { enum: [...inboxItemStatuses], type: 'string' },
        },
        required: ['channelKind', 'id', 'receivedAt', 'status'],
        type: 'object',
      },
      type: 'array',
    },
    invoice: { ...invoiceOpenApiSchema, nullable: true },
    issues: {
      items: {
        additionalProperties: false,
        properties: {
          code: { enum: [...DATA_ISSUE_CODES], type: 'string' },
          createdAt: dateTimeProperty,
          detail: { maxLength: 500, nullable: true, type: 'string' },
          id: uuidProperty,
          resolvedAt: { ...dateTimeProperty, nullable: true },
          severity: { enum: [...ISSUE_SEVERITIES], type: 'string' },
        },
        required: [
          'code',
          'createdAt',
          'detail',
          'id',
          'resolvedAt',
          'severity',
        ],
        type: 'object',
      },
      type: 'array',
    },
    links: { items: documentLinkOpenApiSchema, type: 'array' },
    supersededByDocumentId: { ...uuidProperty, nullable: true },
    supersedesDocumentId: { ...uuidProperty, nullable: true },
  },
  required: [
    'attributes',
    'document',
    'event',
    'files',
    'inboxItems',
    'invoice',
    'issues',
    'links',
    'supersededByDocumentId',
    'supersedesDocumentId',
  ],
  type: 'object',
};

export const documentCountsOpenApiSchema = {
  additionalProperties: false,
  properties: {
    all: { minimum: 0, type: 'integer' },
    archived: { minimum: 0, type: 'integer' },
    needsReview: { minimum: 0, type: 'integer' },
    verified: { minimum: 0, type: 'integer' },
    withIssues: { minimum: 0, type: 'integer' },
  },
  required: ['all', 'archived', 'needsReview', 'verified', 'withIssues'],
  type: 'object',
};

export const documentListOpenApiSchema = {
  additionalProperties: false,
  properties: {
    counts: documentCountsOpenApiSchema,
    documents: { items: documentSummaryOpenApiSchema, type: 'array' },
    page: { minimum: 1, type: 'integer' },
    pageSize: { maximum: MAX_DOCUMENT_PAGE_SIZE, minimum: 1, type: 'integer' },
    total: { minimum: 0, type: 'integer' },
    totalsByCurrency: {
      items: {
        additionalProperties: false,
        properties: {
          currencyCode: { pattern: '^[A-Z]{3}$', type: 'string' },
          totalAmount: moneyProperty,
        },
        required: ['currencyCode', 'totalAmount'],
        type: 'object',
      },
      type: 'array',
    },
  },
  required: [
    'counts',
    'documents',
    'page',
    'pageSize',
    'total',
    'totalsByCurrency',
  ],
  type: 'object',
};

// An advance deduction line settles a prepayment, so it takes its dates from the invoice it settles.
const deductionForbiddenDescription =
  'Refused on an advance deduction line, whose legs carry the tax point of the invoice itself.';

const createInvoiceLineOpenApiSchema = {
  additionalProperties: false,
  properties: {
    activityCode: {
      ...activityCodeProperty,
      description: 'Trimmed and lower cased before validation.',
    },
    baseAmount: amountProperty,
    // Required on an item line and refused on an advance deduction line, which the body schema decides.
    category: { enum: [...INVOICE_LINE_CATEGORIES], type: 'string' },
    description: { maxLength: 500, minLength: 1, type: 'string' },
    lineKind: { enum: [...INVOICE_LINE_KINDS], type: 'string' },
    periodEnd: { ...dateProperty, description: deductionForbiddenDescription },
    periodStart: {
      ...dateProperty,
      description: deductionForbiddenDescription,
    },
    quantity: amountProperty,
    sourceAccountCode: sourceAccountCodeProperty,
    taxPointDate: {
      ...dateProperty,
      description: deductionForbiddenDescription,
    },
    unit: { maxLength: 16, minLength: 1, type: 'string' },
    unitPrice: amountProperty,
    vatAmount: amountProperty,
    vatMode: { enum: [...VAT_MODES], type: 'string' },
    vatRate: vatRateProperty,
  },
  required: ['baseAmount', 'description', 'vatMode'],
  type: 'object',
};

export const createDocumentBodyOpenApiSchema = {
  additionalProperties: false,
  properties: {
    attributes: { additionalProperties: { type: 'string' }, type: 'object' },
    currencyCode: { pattern: '^[A-Z]{3}$', type: 'string' },
    documentDate: dateProperty,
    invoice: {
      additionalProperties: false,
      properties: {
        dueDate: dateProperty,
        fxRate: fxRateProperty,
        lines: {
          items: createInvoiceLineOpenApiSchema,
          maxItems: MAX_INVOICE_LINES,
          minItems: 1,
          type: 'array',
        },
        receivedDate: dateProperty,
        roundingAmount: roundingProperty,
        taxPointDate: dateProperty,
        variableSymbol: { pattern: '^[0-9]{1,10}$', type: 'string' },
      },
      required: ['lines'],
      type: 'object',
    },
    kind: { enum: [...DOCUMENT_KINDS], type: 'string' },
    legalEntityId: uuidProperty,
    notes: { maxLength: 2000, type: 'string' },
    partnerId: uuidProperty,
    reference: { maxLength: 64, minLength: 1, type: 'string' },
    title: { maxLength: 200, minLength: 1, type: 'string' },
    // Ignored whenever invoice content is present, because the server computes the totals from the lines.
    totalAmount: amountProperty,
    validFrom: dateProperty,
    validTo: dateProperty,
  },
  required: ['documentDate', 'kind', 'legalEntityId', 'title'],
  type: 'object',
};

export const updateDocumentBodyOpenApiSchema = {
  additionalProperties: false,
  properties: {
    attributes: { additionalProperties: { type: 'string' }, type: 'object' },
    documentDate: dateProperty,
    notes: { maxLength: 2000, nullable: true, type: 'string' },
    partnerId: { ...uuidProperty, nullable: true },
    reference: { maxLength: 64, minLength: 1, nullable: true, type: 'string' },
    status: { enum: [...DOCUMENT_STATUSES], type: 'string' },
    title: { maxLength: 200, minLength: 1, type: 'string' },
    validFrom: { ...dateProperty, nullable: true },
    validTo: { ...dateProperty, nullable: true },
  },
  required: [],
  type: 'object',
};

export const createDocumentLinkBodyOpenApiSchema = {
  additionalProperties: false,
  properties: {
    kind: { enum: [...DOCUMENT_LINK_KINDS], type: 'string' },
    toDocumentId: uuidProperty,
  },
  required: ['kind', 'toDocumentId'],
  type: 'object',
};

export const partnerOpenApiSchema = {
  additionalProperties: false,
  properties: {
    countryCode: { nullable: true, pattern: '^[A-Z]{2}$', type: 'string' },
    createdAt: dateTimeProperty,
    id: uuidProperty,
    legalEntityId: { ...uuidProperty, nullable: true },
    name: { maxLength: 200, minLength: 1, type: 'string' },
    registrationNumber: {
      maxLength: 32,
      nullable: true,
      pattern: '^[A-Za-z0-9-]{1,32}$',
      type: 'string',
    },
    updatedAt: dateTimeProperty,
    vatNumber: {
      maxLength: 18,
      nullable: true,
      pattern: '^[A-Z]{2}[A-Za-z0-9]{2,16}$',
      type: 'string',
    },
  },
  required: [
    'countryCode',
    'createdAt',
    'id',
    'legalEntityId',
    'name',
    'registrationNumber',
    'updatedAt',
    'vatNumber',
  ],
  type: 'object',
};

export const partnerBodyOpenApiSchema = {
  additionalProperties: false,
  properties: {
    countryCode: { pattern: '^[A-Z]{2}$', type: 'string' },
    legalEntityId: uuidProperty,
    name: { maxLength: 200, minLength: 1, type: 'string' },
    registrationNumber: {
      maxLength: 32,
      minLength: 1,
      pattern: '^[A-Za-z0-9-]{1,32}$',
      type: 'string',
    },
    vatNumber: {
      maxLength: 18,
      minLength: 4,
      pattern: '^[A-Z]{2}[A-Za-z0-9]{2,16}$',
      type: 'string',
    },
  },
  required: ['name'],
  type: 'object',
};

export const partnerListOpenApiSchema = {
  additionalProperties: false,
  properties: { partners: { items: partnerOpenApiSchema, type: 'array' } },
  required: ['partners'],
  type: 'object',
};

export const directiveAccountListOpenApiSchema = {
  additionalProperties: false,
  properties: {
    directiveAccounts: {
      items: {
        additionalProperties: false,
        properties: {
          class: { maximum: 9, minimum: 0, type: 'integer' },
          code: { pattern: '^[0-9]{3}$', type: 'string' },
          groupCode: { pattern: '^[0-9]{2}$', type: 'string' },
          nameCs: { type: 'string' },
          nameEn: { type: 'string' },
          nature: { enum: [...ACCOUNT_NATURES], type: 'string' },
        },
        required: ['class', 'code', 'groupCode', 'nameCs', 'nameEn', 'nature'],
        type: 'object',
      },
      type: 'array',
    },
  },
  required: ['directiveAccounts'],
  type: 'object',
};

const lineCountProperty = { minimum: 0, type: 'integer' };

const analyticsDocumentOpenApiSchema = {
  additionalProperties: false,
  properties: {
    advanceTotal: amountProperty,
    amountDue: {
      ...amountProperty,
      description:
        'The stored generated column: gross plus rounding, less the deducted advance.',
    },
    currencyCode: { pattern: '^[A-Z]{3}$', type: 'string' },
    documentDate: dateProperty,
    grossTotal: amountProperty,
    id: uuidProperty,
    kind: { enum: [...DOCUMENT_KINDS], type: 'string' },
    partnerName: { maxLength: 200, nullable: true, type: 'string' },
    reference: { maxLength: 64, nullable: true, type: 'string' },
    roundingAmount: roundingProperty,
    status: { enum: [...DOCUMENT_STATUSES], type: 'string' },
    title: { maxLength: 200, minLength: 1, type: 'string' },
  },
  required: [
    'advanceTotal',
    'amountDue',
    'currencyCode',
    'documentDate',
    'grossTotal',
    'id',
    'kind',
    'partnerName',
    'reference',
    'roundingAmount',
    'status',
    'title',
  ],
  type: 'object',
};

export const documentAnalyticsOpenApiSchema = {
  additionalProperties: false,
  properties: {
    byAccount: {
      items: {
        additionalProperties: false,
        properties: {
          accountCode: { pattern: '^[0-9]{3}$', type: 'string' },
          accountName: { type: 'string' },
          credit: moneyProperty,
          debit: moneyProperty,
          nature: { enum: [...ACCOUNT_NATURES], type: 'string' },
        },
        required: ['accountCode', 'accountName', 'credit', 'debit', 'nature'],
        type: 'object',
      },
      type: 'array',
    },
    byActivity: {
      items: {
        additionalProperties: false,
        properties: {
          activityCode: activityCodeProperty,
          credit: moneyProperty,
          debit: moneyProperty,
          lineCount: lineCountProperty,
        },
        required: ['activityCode', 'credit', 'debit', 'lineCount'],
        type: 'object',
      },
      type: 'array',
    },
    byMonth: {
      items: {
        additionalProperties: false,
        properties: {
          accountCode: { pattern: '^[0-9]{3}$', type: 'string' },
          accountName: { type: 'string' },
          credit: moneyProperty,
          debit: moneyProperty,
          month: {
            ...dateProperty,
            description:
              'The first day of the month of the leg tax point, not of the register date.',
          },
        },
        required: ['accountCode', 'accountName', 'credit', 'debit', 'month'],
        type: 'object',
      },
      type: 'array',
    },
    byVatRegime: {
      items: {
        additionalProperties: false,
        properties: {
          baseAmount: moneyProperty,
          lineCount: lineCountProperty,
          lineKind: { enum: [...INVOICE_LINE_KINDS], type: 'string' },
          vatAmount: moneyProperty,
          vatMode: { enum: [...VAT_MODES], type: 'string' },
          vatRate: vatRateProperty,
        },
        required: [
          'baseAmount',
          'lineCount',
          'lineKind',
          'vatAmount',
          'vatMode',
          'vatRate',
        ],
        type: 'object',
      },
      type: 'array',
    },
    documents: {
      items: analyticsDocumentOpenApiSchema,
      maxItems: MAX_ANALYTICS_DOCUMENTS,
      type: 'array',
    },
    stats: {
      additionalProperties: false,
      description:
        'What the route read and what it cost: the six queries it ran, the rows behind them and their wall clock time.',
      properties: {
        documentCount: lineCountProperty,
        elapsedMs: lineCountProperty,
        eventLineCount: lineCountProperty,
        invoiceLineCount: lineCountProperty,
        queryCount: { minimum: 1, type: 'integer' },
      },
      required: [
        'documentCount',
        'elapsedMs',
        'eventLineCount',
        'invoiceLineCount',
        'queryCount',
      ],
      type: 'object',
    },
  },
  required: [
    'byAccount',
    'byActivity',
    'byMonth',
    'byVatRegime',
    'documents',
    'stats',
  ],
  type: 'object',
};
