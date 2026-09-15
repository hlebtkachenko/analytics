import { describe, expect, it } from 'vitest';

import {
  createDocumentRequestSchema,
  createInvoiceLineSchema,
  createInvoiceSchema,
  derivedVatAmount,
  documentListQuerySchema,
  invoiceSchema,
  updateDocumentRequestSchema,
} from './contract.ts';

const LEGAL_ENTITY_ID = '9b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21';
const INVOICE_LINE_ID = '00000000-0000-4000-8000-000000000020';

const standardLine = {
  baseAmount: '1000',
  category: 'services',
  description: 'Placeholder line',
  vatAmount: '210.00',
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
      baseTotal: '1000.0000',
      dueDate: null,
      grossTotal: '1210.0000',
      lines: [
        {
          baseAmount: '1000.0000',
          category: 'services',
          description: 'Placeholder line',
          id: INVOICE_LINE_ID,
          lineNo: 1,
          quantity: null,
          sourceAccountCode: null,
          unit: null,
          unitPrice: null,
          vatAmount: '210.0000',
          vatMode: 'standard',
          vatRate: '21.00',
        },
      ],
      receivedDate: null,
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
});
