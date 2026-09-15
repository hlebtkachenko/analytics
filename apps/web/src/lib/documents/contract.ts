import { z } from 'zod';

// Mirrors apps/api documents contract, which apps/web must not import.

// Money crosses the wire as a decimal string, so no amount is ever rounded by a float.
export const decimalStringSchema = z
  .string()
  .trim()
  .regex(/^-?\d{1,15}(\.\d{1,4})?$/);
// Line quantities, prices and VAT are never negative; a refund is its own credit note.
const nonNegativeDecimalSchema = z
  .string()
  .trim()
  .regex(/^\d{1,15}(\.\d{1,4})?$/);
export const documentDateSchema = z.iso.date();
export const identifierSchema = z.string().trim().toLowerCase().uuid();

// Scales a decimal string to integer units of 10 to the scale, so no float touches money.
function scaledUnits(value: string, scale: number): bigint | undefined {
  const match = /^(-?)(\d{1,15})(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (match === null || (match[3]?.length ?? 0) > scale) {
    return undefined;
  }
  const digits = BigInt(`${match[2]!}${(match[3] ?? '').padEnd(scale, '0')}`);
  return match[1] === '-' ? -digits : digits;
}

// Money crosses the wire at 4 decimals, so a total is summed in 10^-4 units.
export function decimalUnits(value: string): bigint | undefined {
  return scaledUnits(value, 4);
}

// Renders 10^-4 units back as the 4 decimal string the register itself stores.
export function formatDecimalUnits(units: bigint): string {
  const magnitude = units < 0n ? -units : units;
  const whole = magnitude / 10_000n;
  const fraction = magnitude % 10_000n;
  return `${units < 0n ? '-' : ''}${whole.toString()}.${fraction.toString().padStart(4, '0')}`;
}

// The VAT a standard line carries: base times rate, half away from zero at 2 decimals.
export function derivedVatAmount(
  baseAmount: string,
  vatRate: string,
): string | undefined {
  const base = scaledUnits(baseAmount, 4);
  const rate = scaledUnits(vatRate, 2);
  if (base === undefined || rate === undefined) {
    return undefined;
  }
  // Base is in 10^-4 units and rate in 10^-2 units, so their product is 10^6 hundredths.
  const product = base * rate;
  const magnitude = product < 0n ? -product : product;
  const rounded = (magnitude + 500_000n) / 1_000_000n;
  const hundredths = product < 0n ? -rounded : rounded;
  const whole = hundredths < 0n ? -hundredths / 100n : hundredths / 100n;
  const fraction = (hundredths < 0n ? -hundredths : hundredths) % 100n;
  const sign = hundredths < 0n ? '-' : '';
  return `${sign}${whole.toString()}.${fraction.toString().padStart(2, '0')}`;
}

export const documentKindSchema = z.enum([
  'issued_invoice',
  'received_invoice',
  'credit_note',
  'receipt',
  'bank_statement',
  'contract',
  'agreement',
  'hr_document',
  'payroll',
  'tax_filing',
  'other',
]);
export const documentStatusSchema = z.enum([
  'registered',
  'needs_review',
  'verified',
  'archived',
]);
export const documentSourceSchema = z.enum([
  'manual',
  'upload',
  'import',
  'api',
]);
export const invoiceLineCategorySchema = z.enum([
  'goods',
  'material',
  'services',
  'labour',
  'transport',
  'asset',
  'other',
]);
// A deducted advance is a line of its own kind, never a supply with a negative amount.
export const invoiceLineKindSchema = z.enum(['item', 'advance_deduction']);
export const vatModeSchema = z.enum([
  'standard',
  'reverse_charge',
  'exempt',
  'outside_scope',
]);
export const documentLinkKindSchema = z.enum([
  'settles',
  'fulfills',
  'corrects',
  'supersedes',
  'relates',
]);
export const dataIssueCodeSchema = z.enum([
  'unbalanced_event',
  'unmapped_line',
  'missing_partner',
  'total_mismatch',
]);
export const eventSideSchema = z.enum(['debit', 'credit']);

// Codes are upper-cased at the boundary exactly like the API does.
const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/);
const referenceSchema = z.string().trim().min(1).max(64);
const titleSchema = z.string().trim().min(1).max(200);
// An empty note clears the field, so the mirror accepts it exactly like the API.
const notesSchema = z.string().trim().max(2000);
const attributeKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const attributeValueSchema = z.string().max(2000);
const accountCodeSchema = z.string().regex(/^[0-9]{3}$/);
const sourceAccountCodeSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{3}(\.[0-9A-Za-z]+)?$/);
const variableSymbolSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{1,10}$/);
// A VAT rate is a percentage between 0 and 100 carrying at most 2 decimals.
const vatRateSchema = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/)
  .refine((value) => Number(value) <= 100);
// An exchange rate is strictly positive and carries at most 6 decimals.
const fxRateSchema = z
  .string()
  .trim()
  .regex(/^\d{1,15}(\.\d{1,6})?$/)
  .refine((value) => Number(value) > 0);
// A free analytic code, lower-cased at the boundary exactly like the API does.
const activityCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_-]{0,31}$/);
// Rounding is the one signed money field, and it is always under a whole unit.
const roundingAmountSchema = decimalStringSchema.refine((value) => {
  const units = decimalUnits(value);
  return units !== undefined && (units < 0n ? -units : units) < 10_000n;
});
// numeric(18,6) comes back scaled, so a stored rate always reads with 6 decimals.
const storedFxRateSchema = z
  .string()
  .trim()
  .regex(/^\d{1,15}\.\d{6}$/)
  .refine((value) => Number(value) > 0);

export const MAX_INVOICE_LINES = 200;
export const MAX_DOCUMENT_ATTRIBUTES = 50;
export const MAX_DOCUMENT_PAGE_SIZE = 100;
export const DEFAULT_DOCUMENT_PAGE_SIZE = 25;
// The API refuses a window beyond this, so deep paging can never scan a whole tenant.
export const MAX_DOCUMENT_WINDOW = 10_000;

export const documentSummarySchema = z
  .object({
    createdAt: z.iso.datetime(),
    currencyCode: currencyCodeSchema,
    documentDate: documentDateSchema,
    hasEvent: z.boolean(),
    id: identifierSchema,
    isBalanced: z.boolean().nullable(),
    isCurrent: z.boolean(),
    kind: documentKindSchema,
    legalEntityId: identifierSchema,
    openIssueCount: z.number().int().min(0),
    partnerId: identifierSchema.nullable(),
    partnerName: z.string().nullable(),
    reference: z.string().nullable(),
    source: documentSourceSchema,
    status: documentStatusSchema,
    title: z.string(),
    totalAmount: decimalStringSchema.nullable(),
    updatedAt: z.iso.datetime(),
    validFrom: documentDateSchema.nullable(),
    validTo: documentDateSchema.nullable(),
    version: z.number().int().min(1),
  })
  .strict();

export const invoiceLineSchema = z
  .object({
    activityCode: activityCodeSchema.nullable(),
    baseAmount: nonNegativeDecimalSchema,
    category: invoiceLineCategorySchema.nullable(),
    description: z.string(),
    id: identifierSchema,
    lineKind: invoiceLineKindSchema,
    lineNo: z.number().int().min(1),
    periodEnd: documentDateSchema.nullable(),
    periodStart: documentDateSchema.nullable(),
    quantity: nonNegativeDecimalSchema.nullable(),
    sourceAccountCode: z.string().nullable(),
    taxPointDate: documentDateSchema.nullable(),
    unit: z.string().nullable(),
    unitPrice: nonNegativeDecimalSchema.nullable(),
    vatAmount: nonNegativeDecimalSchema,
    vatMode: vatModeSchema,
    vatRate: vatRateSchema,
  })
  .strict();

export const invoiceSchema = z
  .object({
    advanceTotal: nonNegativeDecimalSchema,
    amountDue: nonNegativeDecimalSchema,
    baseTotal: decimalStringSchema,
    dueDate: documentDateSchema.nullable(),
    fxRate: storedFxRateSchema.nullable(),
    grossTotal: decimalStringSchema,
    lines: z.array(invoiceLineSchema),
    receivedDate: documentDateSchema.nullable(),
    roundingAmount: roundingAmountSchema,
    taxPointDate: documentDateSchema.nullable(),
    variableSymbol: z.string().nullable(),
    vatTotal: decimalStringSchema,
  })
  .strict();

export const economicEventLineSchema = z
  .object({
    accountCode: accountCodeSchema,
    accountName: z.string(),
    activityCode: activityCodeSchema.nullable(),
    amount: decimalStringSchema,
    description: z.string().nullable(),
    effectiveDate: documentDateSchema,
    invoiceLineId: identifierSchema.nullable(),
    lineNo: z.number().int().min(1),
    partnerId: identifierSchema.nullable(),
    side: eventSideSchema,
  })
  .strict();

export const economicEventSchema = z
  .object({
    creditTotal: decimalStringSchema,
    debitTotal: decimalStringSchema,
    derivedAt: z.iso.datetime(),
    eventDate: documentDateSchema,
    id: identifierSchema,
    isBalanced: z.boolean(),
    lines: z.array(economicEventLineSchema),
    ruleSetVersion: z.string(),
  })
  .strict();

export const dataIssueSchema = z
  .object({
    code: dataIssueCodeSchema,
    createdAt: z.iso.datetime(),
    detail: z.string().nullable(),
    id: identifierSchema,
    resolvedAt: z.iso.datetime().nullable(),
    severity: z.enum(['warning', 'error']),
  })
  .strict();

export const documentLinkSchema = z
  .object({
    createdAt: z.iso.datetime(),
    fromDocumentId: identifierSchema,
    id: identifierSchema,
    kind: documentLinkKindSchema,
    toDocumentId: identifierSchema,
  })
  .strict();

export const documentDetailSchema = z
  .object({
    attributes: z.record(attributeKeySchema, attributeValueSchema),
    document: documentSummarySchema,
    event: economicEventSchema.nullable(),
    invoice: invoiceSchema.nullable(),
    issues: z.array(dataIssueSchema),
    links: z.array(documentLinkSchema),
  })
  .strict();

export const documentListResponseSchema = z
  .object({
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

export const documentSortSchema = z.enum([
  'documentDate',
  'reference',
  'title',
  'totalAmount',
  'createdAt',
]);
export const documentOrderSchema = z.enum(['asc', 'desc']);

// Comma separated enum filters, capped at the vocabulary so a repeat cannot pad the query.
const csvKindSchema = z
  .string()
  .transform((value) => value.split(','))
  .pipe(
    z.array(documentKindSchema).min(1).max(documentKindSchema.options.length),
  );

const csvStatusSchema = z
  .string()
  .transform((value) => value.split(','))
  .pipe(
    z
      .array(documentStatusSchema)
      .min(1)
      .max(documentStatusSchema.options.length),
  );

export const documentListQuerySchema = z
  .object({
    dateFrom: documentDateSchema.optional(),
    dateTo: documentDateSchema.optional(),
    kind: csvKindSchema.optional(),
    legalEntityId: identifierSchema.optional(),
    order: documentOrderSchema.default('desc'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_DOCUMENT_PAGE_SIZE)
      .default(DEFAULT_DOCUMENT_PAGE_SIZE),
    partnerId: identifierSchema.optional(),
    q: z.string().trim().min(1).max(100).optional(),
    sort: documentSortSchema.default('documentDate'),
    status: csvStatusSchema.optional(),
  })
  .strict()
  .refine((query) => query.page * query.pageSize <= MAX_DOCUMENT_WINDOW)
  .refine(
    (query) =>
      query.dateFrom === undefined ||
      query.dateTo === undefined ||
      query.dateFrom <= query.dateTo,
  );

// Half a unit of tolerance, because a source system may round per rate rather than per line.
const VAT_TOLERANCE_UNITS = 5000n;

export const createInvoiceLineSchema = z
  .object({
    activityCode: activityCodeSchema.optional(),
    baseAmount: nonNegativeDecimalSchema,
    category: invoiceLineCategorySchema.optional(),
    description: z.string().trim().min(1).max(500),
    lineKind: invoiceLineKindSchema.default('item'),
    periodEnd: documentDateSchema.optional(),
    periodStart: documentDateSchema.optional(),
    quantity: nonNegativeDecimalSchema.optional(),
    sourceAccountCode: sourceAccountCodeSchema.optional(),
    taxPointDate: documentDateSchema.optional(),
    unit: z.string().trim().min(1).max(16).optional(),
    unitPrice: nonNegativeDecimalSchema.optional(),
    vatAmount: nonNegativeDecimalSchema.default('0'),
    vatMode: vatModeSchema,
    vatRate: vatRateSchema.default('0'),
  })
  .strict()
  .superRefine((line, context) => {
    // A supply is classified by category; a deducted advance carries no category at all.
    if (line.lineKind === 'item' && line.category === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'A supply line carries a category.',
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
    // The settlement legs take the tax point of the invoice, so a date here would re-date them into the advance's month.
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
    const actual = scaledUnits(line.vatAmount, 4);
    if (actual === undefined) {
      return;
    }
    // Reverse charge, exempt and outside scope carry no VAT on the invoice itself.
    if (line.vatMode !== 'standard') {
      if (actual !== 0n) {
        context.addIssue({
          code: 'custom',
          message: 'A non-standard VAT line carries no VAT amount.',
          path: ['vatAmount'],
        });
      }
      return;
    }
    const derived = derivedVatAmount(line.baseAmount, line.vatRate);
    const expected =
      derived === undefined ? undefined : scaledUnits(derived, 4);
    if (expected === undefined) {
      return;
    }
    const difference = actual - expected;
    if ((difference < 0n ? -difference : difference) <= VAT_TOLERANCE_UNITS) {
      return;
    }
    context.addIssue({
      code: 'custom',
      message: 'The VAT amount disagrees with the base amount and rate.',
      path: ['vatAmount'],
    });
  });

// Base plus VAT over the lines of one kind, in 10^-4 units, ignoring what does not parse.
export function grossUnits(
  lines: readonly { baseAmount: string; lineKind: string; vatAmount: string }[],
  lineKind: string,
): bigint {
  return lines
    .filter((line) => line.lineKind === lineKind)
    .reduce(
      (total, line) =>
        total +
        (decimalUnits(line.baseAmount) ?? 0n) +
        (decimalUnits(line.vatAmount) ?? 0n),
      0n,
    );
}

export const createInvoiceSchema = z
  .object({
    dueDate: documentDateSchema.optional(),
    fxRate: fxRateSchema.optional(),
    lines: z.array(createInvoiceLineSchema).min(1).max(MAX_INVOICE_LINES),
    receivedDate: documentDateSchema.optional(),
    roundingAmount: roundingAmountSchema.default('0'),
    taxPointDate: documentDateSchema.optional(),
    variableSymbol: variableSymbolSchema.optional(),
  })
  .strict()
  .superRefine((invoice, context) => {
    // An invoice is a supply first; a deduction alone is not an invoice.
    if (!invoice.lines.some((line) => line.lineKind === 'item')) {
      context.addIssue({
        code: 'custom',
        message: 'An invoice carries at least one supply line.',
        path: ['lines'],
      });
    }
    // An overpaid advance is settled by a credit note, never by a negative amount due.
    const payable =
      grossUnits(invoice.lines, 'item') +
      (decimalUnits(invoice.roundingAmount) ?? 0n);
    if (grossUnits(invoice.lines, 'advance_deduction') > payable) {
      context.addIssue({
        code: 'custom',
        message: 'The deducted advance exceeds the invoiced amount.',
        path: ['lines'],
      });
    }
  });

// The two kinds that carry invoice content; every other kind is register plus attributes.
export const invoiceDocumentKinds = [
  'issued_invoice',
  'received_invoice',
] as const;

export function isInvoiceKind(kind: string): boolean {
  return (invoiceDocumentKinds as readonly string[]).includes(kind);
}

export const createDocumentRequestSchema = z
  .object({
    attributes: z
      .record(attributeKeySchema, attributeValueSchema)
      .refine((value) => Object.keys(value).length <= MAX_DOCUMENT_ATTRIBUTES)
      .optional(),
    currencyCode: currencyCodeSchema.default('CZK'),
    documentDate: documentDateSchema,
    invoice: createInvoiceSchema.optional(),
    kind: documentKindSchema,
    legalEntityId: identifierSchema,
    notes: notesSchema.optional(),
    partnerId: identifierSchema.optional(),
    reference: referenceSchema.optional(),
    title: titleSchema,
    totalAmount: decimalStringSchema.optional(),
    validFrom: documentDateSchema.optional(),
    validTo: documentDateSchema.optional(),
  })
  .strict()
  .superRefine((body, context) => {
    // Invoice content belongs to the two invoice kinds and to no other kind.
    if (isInvoiceKind(body.kind) !== (body.invoice !== undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'Invoice content is required for invoice kinds only.',
        path: ['invoice'],
      });
    }
    // A validity window that ends before it starts is refused rather than stored.
    if (
      body.validFrom !== undefined &&
      body.validTo !== undefined &&
      body.validFrom > body.validTo
    ) {
      context.addIssue({
        code: 'custom',
        message: 'validFrom must not be later than validTo.',
        path: ['validTo'],
      });
    }
  });

export const updateDocumentRequestSchema = z
  .object({
    attributes: z
      .record(attributeKeySchema, attributeValueSchema)
      .refine((value) => Object.keys(value).length <= MAX_DOCUMENT_ATTRIBUTES)
      .optional(),
    documentDate: documentDateSchema.optional(),
    notes: notesSchema.nullable().optional(),
    partnerId: identifierSchema.nullable().optional(),
    reference: referenceSchema.nullable().optional(),
    status: documentStatusSchema.optional(),
    title: titleSchema.optional(),
    validFrom: documentDateSchema.nullable().optional(),
    validTo: documentDateSchema.nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0)
  .refine(
    (body) =>
      body.validFrom === undefined ||
      body.validFrom === null ||
      body.validTo === undefined ||
      body.validTo === null ||
      body.validFrom <= body.validTo,
  );

export const createDocumentLinkRequestSchema = z
  .object({ kind: documentLinkKindSchema, toDocumentId: identifierSchema })
  .strict();

export const partnerSchema = z
  .object({
    countryCode: z.string().nullable(),
    createdAt: z.iso.datetime(),
    id: identifierSchema,
    legalEntityId: identifierSchema.nullable(),
    name: z.string(),
    registrationNumber: z.string().nullable(),
    updatedAt: z.iso.datetime(),
    vatNumber: z.string().nullable(),
  })
  .strict();

export const partnerListSchema = z
  .object({ partners: z.array(partnerSchema) })
  .strict();

const partnerNameSchema = z.string().trim().min(1).max(200);
const partnerRegistrationNumberSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9-]{1,32}$/);
const partnerVatNumberSchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{2}[A-Za-z0-9]{2,16}$/);
const countryCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{2}$/);

export const createPartnerRequestSchema = z
  .object({
    countryCode: countryCodeSchema.optional(),
    legalEntityId: identifierSchema.optional(),
    name: partnerNameSchema,
    registrationNumber: partnerRegistrationNumberSchema.optional(),
    vatNumber: partnerVatNumberSchema.optional(),
  })
  .strict();

export const updatePartnerRequestSchema = z
  .object({
    countryCode: countryCodeSchema.nullable().optional(),
    legalEntityId: identifierSchema.nullable().optional(),
    name: partnerNameSchema.optional(),
    registrationNumber: partnerRegistrationNumberSchema.nullable().optional(),
    vatNumber: partnerVatNumberSchema.nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0);

export const partnerListQuerySchema = z
  .object({ q: z.string().trim().min(1).max(100).optional() })
  .strict();

// The one account nature vocabulary, shared by the directive and by the analytics mirror.
const accountNatureSchema = z.enum([
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'EXPENSE',
  'REVENUE',
  'CLOSING',
  'OFF_BALANCE',
]);

export const directiveAccountSchema = z
  .object({
    class: z.number().int().min(0).max(9),
    code: accountCodeSchema,
    groupCode: z.string().regex(/^[0-9]{2}$/),
    nameCs: z.string(),
    nameEn: z.string(),
    nature: accountNatureSchema,
  })
  .strict();

export const directiveAccountListSchema = z
  .object({ directiveAccounts: z.array(directiveAccountSchema) })
  .strict();

// The analytics read answers from stored columns only, so the mirror bounds its document list too.
export const MAX_ANALYTICS_DOCUMENTS = 50;

// The analytics read: the invoices in scope plus four aggregates read straight from stored columns.
const analyticsDocumentSchema = z
  .object({
    advanceTotal: decimalStringSchema,
    amountDue: decimalStringSchema,
    currencyCode: currencyCodeSchema,
    documentDate: documentDateSchema,
    grossTotal: decimalStringSchema,
    id: identifierSchema,
    kind: documentKindSchema,
    partnerName: z.string().nullable(),
    reference: z.string().nullable(),
    roundingAmount: decimalStringSchema,
    status: documentStatusSchema,
    title: z.string(),
  })
  .strict();

const analyticsByMonthSchema = z
  .object({
    accountCode: accountCodeSchema,
    accountName: z.string(),
    credit: decimalStringSchema,
    debit: decimalStringSchema,
    month: documentDateSchema,
  })
  .strict();

const analyticsByActivitySchema = z
  .object({
    activityCode: activityCodeSchema,
    credit: decimalStringSchema,
    debit: decimalStringSchema,
    lineCount: z.number().int().min(0),
  })
  .strict();

const analyticsByVatRegimeSchema = z
  .object({
    baseAmount: decimalStringSchema,
    lineCount: z.number().int().min(0),
    lineKind: invoiceLineKindSchema,
    vatAmount: decimalStringSchema,
    vatMode: vatModeSchema,
    vatRate: vatRateSchema,
  })
  .strict();

const analyticsByAccountSchema = z
  .object({
    accountCode: accountCodeSchema,
    accountName: z.string(),
    credit: decimalStringSchema,
    debit: decimalStringSchema,
    nature: accountNatureSchema,
  })
  .strict();

// The page states its own cost from these counters, so no reader has to trust the docs.
const analyticsStatsSchema = z
  .object({
    elapsedMs: z.number().int().min(0),
    eventLineCount: z.number().int().min(0),
    invoiceLineCount: z.number().int().min(0),
    queryCount: z.number().int().min(1),
  })
  .strict();

export const documentAnalyticsResponseSchema = z
  .object({
    byAccount: z.array(analyticsByAccountSchema),
    byActivity: z.array(analyticsByActivitySchema),
    byMonth: z.array(analyticsByMonthSchema),
    byVatRegime: z.array(analyticsByVatRegimeSchema),
    documents: z.array(analyticsDocumentSchema).max(MAX_ANALYTICS_DOCUMENTS),
    stats: analyticsStatsSchema,
  })
  .strict();

export const documentAnalyticsQuerySchema = z
  .object({ legalEntityId: identifierSchema.optional() })
  .strict();

export type DataIssue = z.infer<typeof dataIssueSchema>;
export type DocumentAnalyticsResponse = z.infer<
  typeof documentAnalyticsResponseSchema
>;
export type DocumentDetail = z.infer<typeof documentDetailSchema>;
export type DocumentKind = z.infer<typeof documentKindSchema>;
export type DocumentLinkKind = z.infer<typeof documentLinkKindSchema>;
export type DocumentListResponse = z.infer<typeof documentListResponseSchema>;
export type DocumentOrder = z.infer<typeof documentOrderSchema>;
export type DocumentSort = z.infer<typeof documentSortSchema>;
export type DocumentStatus = z.infer<typeof documentStatusSchema>;
export type DocumentSummary = z.infer<typeof documentSummarySchema>;
export type InvoiceLineCategory = z.infer<typeof invoiceLineCategorySchema>;
export type InvoiceLineKind = z.infer<typeof invoiceLineKindSchema>;
export type NewDocument = z.input<typeof createDocumentRequestSchema>;
export type Partner = z.infer<typeof partnerSchema>;
export type VatMode = z.infer<typeof vatModeSchema>;
