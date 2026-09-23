import { describe, expect, it } from 'vitest';

import {
  createDocumentRequestSchema,
  createInvoiceLineSchema,
  createInvoiceSchema,
  derivedVatAmount,
  documentAnalyticsQuerySchema,
  documentAnalyticsResponseSchema,
  documentCountsSchema,
  documentListQuerySchema,
  documentListResponseSchema,
  economicEventLineSchema,
  invoiceSchema,
  partnerSchema,
  updateDocumentRequestSchema,
  updatePartnerRequestSchema,
} from './contract.ts';

const LEGAL_ENTITY_ID = '9b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21';
const OTHER_LEGAL_ENTITY_ID = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const INVOICE_LINE_ID = '00000000-0000-4000-8000-000000000020';
const DOCUMENT_ID = '00000000-0000-4000-8000-000000000010';

const standardLine = {
  baseAmount: '1000',
  category: 'services',
  description: 'Placeholder line',
  vatAmount: '210.00',
  vatMode: 'standard',
  vatRate: '21',
};

const deductionLine = {
  baseAmount: '500',
  description: 'Advance deducted',
  lineKind: 'advance_deduction',
  vatAmount: '105.00',
  vatMode: 'standard',
  vatRate: '21',
};

describe('derivedVatAmount', () => {
  it('rounds half away from zero on the minor unit, where a float rounds down', () => {
    expect(derivedVatAmount('4.10', '15')).toBe('0.62');
    expect(derivedVatAmount('1000', '21')).toBe('210.00');
    expect(derivedVatAmount('0', '21')).toBe('0.00');
  });

  it('refuses a value that carries more precision than the contract', () => {
    expect(derivedVatAmount('1.00001', '21')).toBeUndefined();
    expect(derivedVatAmount('1000', '21.001')).toBeUndefined();
  });
});

describe('createInvoiceLineSchema', () => {
  it('accepts a VAT amount within half a unit of the derived one', () => {
    expect(
      createInvoiceLineSchema.safeParse({ ...standardLine, vatAmount: '210.4' })
        .success,
    ).toBe(true);
  });

  it('refuses a VAT amount further than half a unit from the derived one', () => {
    expect(
      createInvoiceLineSchema.safeParse({ ...standardLine, vatAmount: '211' })
        .success,
    ).toBe(false);
  });

  it('refuses any VAT on a line outside the standard regime', () => {
    expect(
      createInvoiceLineSchema.safeParse({
        ...standardLine,
        vatMode: 'reverse_charge',
      }).success,
    ).toBe(false);
    expect(
      createInvoiceLineSchema.safeParse({
        ...standardLine,
        vatAmount: '0',
        vatMode: 'exempt',
        vatRate: '0',
      }).success,
    ).toBe(true);
  });

  it('refuses a tax point and a period on an advance deduction line', () => {
    expect(createInvoiceLineSchema.safeParse(deductionLine).success).toBe(true);

    for (const field of ['periodEnd', 'periodStart', 'taxPointDate']) {
      expect(
        createInvoiceLineSchema.safeParse({
          ...deductionLine,
          [field]: '2026-09-30',
        }).success,
      ).toBe(false);
    }
  });

  it('refuses a negative amount and a rate outside the percentage range', () => {
    expect(
      createInvoiceLineSchema.safeParse({
        ...standardLine,
        baseAmount: '-1000',
      }).success,
    ).toBe(false);
    expect(
      createInvoiceLineSchema.safeParse({ ...standardLine, quantity: '-1' })
        .success,
    ).toBe(false);
    expect(
      createInvoiceLineSchema.safeParse({
        ...standardLine,
        vatAmount: '0',
        vatRate: '101',
      }).success,
    ).toBe(false);
    expect(
      createInvoiceLineSchema.safeParse({
        ...standardLine,
        vatAmount: '0',
        vatRate: '21.001',
      }).success,
    ).toBe(false);
  });
});

describe('fxRate', () => {
  it('takes a positive request rate of at most 6 decimals', () => {
    expect(
      createInvoiceSchema.safeParse({
        fxRate: '24.5',
        lines: [standardLine],
      }).success,
    ).toBe(true);
    expect(
      createInvoiceSchema.safeParse({ fxRate: '0', lines: [standardLine] })
        .success,
    ).toBe(false);
    expect(
      createInvoiceSchema.safeParse({
        fxRate: '24.5000001',
        lines: [standardLine],
      }).success,
    ).toBe(false);
  });

  it('reads the stored rate back with the 6 decimals the register keeps', () => {
    const stored = {
      advanceTotal: '0.0000',
      amountDue: '1210.0000',
      baseTotal: '1000.0000',
      dueDate: null,
      grossTotal: '1210.0000',
      lines: [
        {
          activityCode: null,
          baseAmount: '1000.0000',
          category: 'services',
          description: 'Placeholder line',
          id: INVOICE_LINE_ID,
          lineKind: 'item',
          lineNo: 1,
          periodEnd: null,
          periodStart: null,
          quantity: null,
          sourceAccountCode: null,
          taxPointDate: null,
          unit: null,
          unitPrice: null,
          vatAmount: '210.0000',
          vatMode: 'standard',
          vatRate: '21.00',
        },
      ],
      receivedDate: null,
      roundingAmount: '0.0000',
      taxPointDate: null,
      variableSymbol: null,
      vatTotal: '210.0000',
    };

    expect(
      invoiceSchema.safeParse({ ...stored, fxRate: '24.500000' }).success,
    ).toBe(true);
    expect(invoiceSchema.safeParse({ ...stored, fxRate: '24.5' }).success).toBe(
      false,
    );
  });
});

describe('validity windows', () => {
  const base = {
    documentDate: '2026-09-01',
    kind: 'contract',
    legalEntityId: LEGAL_ENTITY_ID,
    title: 'Placeholder register entry',
  };

  it('refuses a create whose window ends before it starts', () => {
    expect(
      createDocumentRequestSchema.safeParse({
        ...base,
        validFrom: '2026-09-02',
        validTo: '2026-09-01',
      }).success,
    ).toBe(false);
    expect(
      createDocumentRequestSchema.safeParse({
        ...base,
        validFrom: '2026-09-01',
        validTo: '2026-09-01',
      }).success,
    ).toBe(true);
  });

  it('refuses the same inversion on a patch', () => {
    expect(
      updateDocumentRequestSchema.safeParse({
        validFrom: '2026-09-02',
        validTo: '2026-09-01',
      }).success,
    ).toBe(false);
    expect(
      updateDocumentRequestSchema.safeParse({
        validFrom: '2026-09-02',
        validTo: null,
      }).success,
    ).toBe(true);
  });

  it('accepts an emptied note, which clears the field', () => {
    expect(updateDocumentRequestSchema.safeParse({ notes: '' }).success).toBe(
      true,
    );
  });
});

describe('documentCountsSchema', () => {
  const counts = {
    all: 4,
    archived: 0,
    needsReview: 1,
    verified: 2,
    withIssues: 1,
  };

  it('accepts the five non-negative integer counts the list carries', () => {
    expect(documentCountsSchema.safeParse(counts).success).toBe(true);
  });

  it('refuses a negative, fractional, or missing count', () => {
    expect(
      documentCountsSchema.safeParse({ ...counts, withIssues: -1 }).success,
    ).toBe(false);
    expect(
      documentCountsSchema.safeParse({ ...counts, verified: 2.5 }).success,
    ).toBe(false);
    const partial: Record<string, number> = { ...counts };
    delete partial.withIssues;
    expect(documentCountsSchema.safeParse(partial).success).toBe(false);
  });

  it('is required on the list response and rejects an unknown key', () => {
    const list = {
      counts,
      documents: [],
      page: 1,
      pageSize: 25,
      total: 4,
      totalsByCurrency: [],
    };

    expect(documentListResponseSchema.safeParse(list).success).toBe(true);
    const withoutCounts: Record<string, unknown> = { ...list };
    delete withoutCounts.counts;
    expect(documentListResponseSchema.safeParse(withoutCounts).success).toBe(
      false,
    );
    expect(
      documentCountsSchema.safeParse({ ...counts, unexpected: 0 }).success,
    ).toBe(false);
  });
});

describe('documentListQuerySchema', () => {
  it('refuses a date range that ends before it starts', () => {
    expect(
      documentListQuerySchema.safeParse({
        dateFrom: '2026-09-02',
        dateTo: '2026-09-01',
      }).success,
    ).toBe(false);
  });

  it('caps a comma separated filter at the size of its vocabulary', () => {
    expect(
      documentListQuerySchema.safeParse({
        status: new Array(5).fill('registered').join(','),
      }).success,
    ).toBe(false);
  });

  it('reads one legal entity, several repeated, or several comma separated', () => {
    const single = documentListQuerySchema.safeParse({
      legalEntityId: LEGAL_ENTITY_ID,
    });
    expect(single.success && single.data.legalEntityId).toEqual([
      LEGAL_ENTITY_ID,
    ]);

    const repeated = documentListQuerySchema.safeParse({
      legalEntityId: [LEGAL_ENTITY_ID, OTHER_LEGAL_ENTITY_ID],
    });
    expect(repeated.success && repeated.data.legalEntityId).toEqual([
      LEGAL_ENTITY_ID,
      OTHER_LEGAL_ENTITY_ID,
    ]);

    const csv = documentListQuerySchema.safeParse({
      legalEntityId: `${LEGAL_ENTITY_ID},${OTHER_LEGAL_ENTITY_ID}`,
    });
    expect(csv.success && csv.data.legalEntityId).toEqual([
      LEGAL_ENTITY_ID,
      OTHER_LEGAL_ENTITY_ID,
    ]);
  });

  it('refuses an entity filter that carries an unusable id', () => {
    expect(
      documentListQuerySchema.safeParse({ legalEntityId: 'not-a-uuid' })
        .success,
    ).toBe(false);
    expect(
      documentListQuerySchema.safeParse({
        legalEntityId: [LEGAL_ENTITY_ID, 'not-a-uuid'],
      }).success,
    ).toBe(false);
  });
});

describe('invoice line kinds', () => {
  it('requires a category on a supply line and refuses one on a deduction', () => {
    expect(
      createInvoiceLineSchema.safeParse({ ...deductionLine, lineKind: 'item' })
        .success,
    ).toBe(false);
    expect(createInvoiceLineSchema.safeParse(deductionLine).success).toBe(true);
    expect(
      createInvoiceLineSchema.safeParse({
        ...deductionLine,
        category: 'services',
      }).success,
    ).toBe(false);
  });

  it('defaults a line to a supply and keeps the new category values', () => {
    const parsed = createInvoiceLineSchema.safeParse({
      ...standardLine,
      category: 'labour',
    });
    expect(parsed.success && parsed.data.lineKind).toBe('item');
    expect(
      createInvoiceLineSchema.safeParse({
        ...standardLine,
        category: 'transport',
      }).success,
    ).toBe(true);
  });

  it('refuses a period that ends before it starts', () => {
    expect(
      createInvoiceLineSchema.safeParse({
        ...standardLine,
        periodEnd: '2026-01-31',
        periodStart: '2026-01-01',
      }).success,
    ).toBe(true);
    expect(
      createInvoiceLineSchema.safeParse({
        ...standardLine,
        periodEnd: '2026-01-01',
        periodStart: '2026-01-31',
      }).success,
    ).toBe(false);
  });

  it('lower-cases and trims an activity code, and refuses an unusable one', () => {
    const parsed = createInvoiceLineSchema.safeParse({
      ...standardLine,
      activityCode: '  Month-01  ',
    });
    expect(parsed.success && parsed.data.activityCode).toBe('month-01');
    expect(
      createInvoiceLineSchema.safeParse({
        ...standardLine,
        activityCode: '-leading',
      }).success,
    ).toBe(false);
    expect(
      createInvoiceLineSchema.safeParse({
        ...standardLine,
        activityCode: 'a'.repeat(33),
      }).success,
    ).toBe(false);
  });
});

describe('invoice totals', () => {
  it('keeps rounding signed and strictly below a whole unit', () => {
    const parsed = createInvoiceSchema.safeParse({ lines: [standardLine] });
    expect(parsed.success && parsed.data.roundingAmount).toBe('0');
    expect(
      createInvoiceSchema.safeParse({
        lines: [standardLine],
        roundingAmount: '-0.30',
      }).success,
    ).toBe(true);
    expect(
      createInvoiceSchema.safeParse({
        lines: [standardLine],
        roundingAmount: '1.00',
      }).success,
    ).toBe(false);
    expect(
      createInvoiceSchema.safeParse({
        lines: [standardLine],
        roundingAmount: '-1.00',
      }).success,
    ).toBe(false);
  });

  it('refuses an invoice that carries no supply line at all', () => {
    expect(
      createInvoiceSchema.safeParse({ lines: [deductionLine] }).success,
    ).toBe(false);
  });

  it('refuses a deducted advance above the gross total plus rounding', () => {
    // Gross is 1210.00 and the deduction is 1210.00, so only the rounding decides.
    const wholeAdvance = {
      ...deductionLine,
      baseAmount: '1000',
      vatAmount: '210.00',
    };
    expect(
      createInvoiceSchema.safeParse({ lines: [standardLine, wholeAdvance] })
        .success,
    ).toBe(true);
    expect(
      createInvoiceSchema.safeParse({
        lines: [standardLine, wholeAdvance],
        roundingAmount: '-0.10',
      }).success,
    ).toBe(false);
    expect(
      createInvoiceSchema.safeParse({
        lines: [
          standardLine,
          { ...wholeAdvance, baseAmount: '1000.30', vatAmount: '210.06' },
        ],
        roundingAmount: '0.20',
      }).success,
    ).toBe(false);
  });
});

describe('economicEventLineSchema', () => {
  it('reads the leg date and the activity the register now stores', () => {
    const stored = {
      accountCode: '518',
      accountName: 'Other services',
      activityCode: 'month-01',
      amount: '1000.0000',
      description: 'Placeholder line',
      effectiveDate: '2026-01-31',
      invoiceLineId: INVOICE_LINE_ID,
      lineNo: 1,
      partnerId: null,
      side: 'debit',
    };

    expect(economicEventLineSchema.safeParse(stored).success).toBe(true);
    expect(
      economicEventLineSchema.safeParse({ ...stored, activityCode: null })
        .success,
    ).toBe(true);
    expect(
      economicEventLineSchema.safeParse({ ...stored, effectiveDate: null })
        .success,
    ).toBe(false);
  });
});

describe('documentAnalyticsResponseSchema', () => {
  const analytics = {
    byAccount: [
      {
        accountCode: '518',
        accountName: 'Other services',
        credit: '0.0000',
        debit: '5000.0000',
        nature: 'EXPENSE',
      },
    ],
    byActivity: [
      {
        activityCode: 'month-01',
        credit: '0.0000',
        debit: '1000.0000',
        lineCount: 1,
      },
    ],
    byMonth: [
      {
        accountCode: '518',
        accountName: 'Other services',
        credit: '0.0000',
        debit: '1000.0000',
        month: '2026-01-01',
      },
    ],
    byVatRegime: [
      {
        baseAmount: '5000.0000',
        lineCount: 5,
        lineKind: 'item',
        vatAmount: '1050.0000',
        vatMode: 'standard',
        vatRate: '21',
      },
    ],
    documents: [
      {
        advanceTotal: '0.0000',
        amountDue: '6050.0000',
        currencyCode: 'CZK',
        documentDate: '2026-01-15',
        grossTotal: '6050.0000',
        id: DOCUMENT_ID,
        kind: 'received_invoice',
        partnerName: null,
        reference: null,
        roundingAmount: '0.0000',
        status: 'registered',
        title: 'Placeholder document',
      },
    ],
    stats: {
      documentCount: 1,
      elapsedMs: 12,
      eventLineCount: 10,
      invoiceLineCount: 5,
      queryCount: 6,
    },
  };

  it('reads the aggregates the register stores, including the null partner and reference', () => {
    expect(documentAnalyticsResponseSchema.safeParse(analytics).success).toBe(
      true,
    );
  });

  it('refuses stats looser than the route reports', () => {
    expect(
      documentAnalyticsResponseSchema.safeParse({
        ...analytics,
        stats: { ...analytics.stats, elapsedMs: 12.5 },
      }).success,
    ).toBe(false);
    expect(
      documentAnalyticsResponseSchema.safeParse({
        ...analytics,
        stats: { ...analytics.stats, queryCount: 0 },
      }).success,
    ).toBe(false);
  });

  it('refuses an unknown account nature and more documents than the route publishes', () => {
    expect(
      documentAnalyticsResponseSchema.safeParse({
        ...analytics,
        byAccount: [{ ...analytics.byAccount[0], nature: 'PROFIT' }],
      }).success,
    ).toBe(false);
    expect(
      documentAnalyticsResponseSchema.safeParse({
        ...analytics,
        documents: Array.from({ length: 51 }, () => analytics.documents[0]),
      }).success,
    ).toBe(false);
  });

  it('refuses an unexpected key, a float amount, and a malformed month', () => {
    expect(
      documentAnalyticsResponseSchema.safeParse({
        ...analytics,
        total: '6050.0000',
      }).success,
    ).toBe(false);
    expect(
      documentAnalyticsResponseSchema.safeParse({
        ...analytics,
        byAccount: [{ ...analytics.byAccount[0], debit: 5000 }],
      }).success,
    ).toBe(false);
    expect(
      documentAnalyticsResponseSchema.safeParse({
        ...analytics,
        byMonth: [{ ...analytics.byMonth[0], month: '2026-01' }],
      }).success,
    ).toBe(false);
  });
});

describe('documentAnalyticsQuerySchema', () => {
  it('accepts the entity filter alone and refuses anything else', () => {
    expect(documentAnalyticsQuerySchema.safeParse({}).success).toBe(true);
    expect(
      documentAnalyticsQuerySchema.safeParse({ legalEntityId: LEGAL_ENTITY_ID })
        .success,
    ).toBe(true);
    expect(
      documentAnalyticsQuerySchema.safeParse({ legalEntityId: 'not-a-uuid' })
        .success,
    ).toBe(false);
    expect(documentAnalyticsQuerySchema.safeParse({ page: '2' }).success).toBe(
      false,
    );
  });

  it('reads several entities repeated or comma separated', () => {
    const repeated = documentAnalyticsQuerySchema.safeParse({
      legalEntityId: [LEGAL_ENTITY_ID, OTHER_LEGAL_ENTITY_ID],
    });
    expect(repeated.success && repeated.data.legalEntityId).toEqual([
      LEGAL_ENTITY_ID,
      OTHER_LEGAL_ENTITY_ID,
    ]);

    const csv = documentAnalyticsQuerySchema.safeParse({
      legalEntityId: `${LEGAL_ENTITY_ID},${OTHER_LEGAL_ENTITY_ID}`,
    });
    expect(csv.success && csv.data.legalEntityId).toEqual([
      LEGAL_ENTITY_ID,
      OTHER_LEGAL_ENTITY_ID,
    ]);
  });
});

describe('partner default line category', () => {
  const partner = {
    countryCode: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    defaultLineCategory: 'services',
    id: '00000000-0000-4000-8000-000000000030',
    legalEntityId: null,
    name: 'Placeholder Partner',
    registrationNumber: '00000000',
    updatedAt: '2026-01-01T00:00:00.000Z',
    vatNumber: null,
  };

  it('mirrors the API partner with a nullable line category from the invoice list', () => {
    expect(partnerSchema.safeParse(partner).success).toBe(true);
    expect(
      partnerSchema.safeParse({ ...partner, defaultLineCategory: null })
        .success,
    ).toBe(true);
    expect(
      partnerSchema.safeParse({ ...partner, defaultLineCategory: 'freight' })
        .success,
    ).toBe(false);
  });

  it('sets or clears the category through the partner patch', () => {
    expect(
      updatePartnerRequestSchema.safeParse({ defaultLineCategory: 'goods' })
        .success,
    ).toBe(true);
    expect(
      updatePartnerRequestSchema.safeParse({ defaultLineCategory: null })
        .success,
    ).toBe(true);
  });
});
