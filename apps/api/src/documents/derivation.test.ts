import { describe, expect, it } from 'vitest';

import {
  createInvoiceLineSchema,
  INVOICE_LINE_CATEGORIES,
} from './contract.js';
import { deriveEconomicEvent, RULE_SET_VERSION } from './derivation.js';
import type { DerivationInput, DerivationLine } from './derivation.js';

const PARTNER_ID = '7d5e0f41-2c8a-4f6d-be54-912ca08d7f62';
const LINE_ID = '8e6f1052-3d9b-4a7e-cf65-a23db19e8073';
const SECOND_LINE_ID = '9f702163-4eac-4b8f-d076-b34ec2af9184';

// A neutral placeholder line: the rules never read the description, only the kind, the category and the VAT mode.
function line(overrides: Partial<DerivationLine> = {}): DerivationLine {
  return {
    activityCode: null,
    baseAmount: '1000.0000',
    category: 'services',
    description: 'placeholder line',
    id: LINE_ID,
    lineKind: 'item',
    taxPointDate: null,
    vatAmount: '210.0000',
    vatMode: 'standard',
    vatRate: '21.00',
    ...overrides,
  };
}

// The invoice around the lines: the rules read its kind, its dates, its partner and its rounding difference.
function invoice(overrides: Partial<DerivationInput> = {}): DerivationInput {
  return {
    documentDate: '2026-09-15',
    kind: 'issued_invoice',
    lines: [line()],
    partnerId: PARTNER_ID,
    roundingAmount: '0',
    taxPointDate: null,
    ...overrides,
  };
}

// An advance deduction carries no category and settles a prepayment instead of describing a supply.
function deduction(overrides: Partial<DerivationLine> = {}): DerivationLine {
  return line({
    category: null,
    description: 'placeholder advance deduction',
    lineKind: 'advance_deduction',
    ...overrides,
  });
}

// The published shape of an event line, without the fields every rule sets the same way.
function shape(
  event: ReturnType<typeof deriveEconomicEvent>,
): { accountCode: string; amount: string; side: string }[] {
  return (event?.lines ?? []).map((entry) => ({
    accountCode: entry.accountCode,
    amount: entry.amount,
    side: entry.side,
  }));
}

describe('czech default derivation rules', () => {
  it('names the rule set it implements', () => {
    expect(RULE_SET_VERSION).toBe('cz-default-2026-09.1');
  });

  it('books an issued standard invoice as receivable, revenue and output VAT', () => {
    const event = deriveEconomicEvent(invoice());

    expect(shape(event)).toEqual([
      { accountCode: '311', amount: '1210.0000', side: 'debit' },
      { accountCode: '602', amount: '1000.0000', side: 'credit' },
      { accountCode: '343', amount: '210.0000', side: 'credit' },
    ]);
    expect(event).toMatchObject({
      creditTotal: '1210.0000',
      debitTotal: '1210.0000',
      isBalanced: true,
      issues: [],
    });
    // The partner rides on the receivable only, and every line points back at its invoice line.
    expect(event?.lines.map((entry) => entry.partnerId)).toEqual([
      PARTNER_ID,
      null,
      null,
    ]);
    expect(event?.lines.map((entry) => entry.invoiceLineId)).toEqual([
      LINE_ID,
      LINE_ID,
      LINE_ID,
    ]);
    expect(event?.lines.map((entry) => entry.lineNo)).toEqual([1, 2, 3]);
    expect(event?.lines[1]?.description).toBe('placeholder line');
  });

  it('maps every issued category to its own revenue account', () => {
    const accounts = INVOICE_LINE_CATEGORIES.map(
      (category) =>
        deriveEconomicEvent(
          invoice({
            lines: [
              line({
                category,
                vatAmount: '0',
                vatMode: 'exempt',
                vatRate: '0',
              }),
            ],
          }),
        )?.lines[1]?.accountCode,
    );

    // Labour and transport are their own categories for analytics, but they book to the services account.
    expect(accounts).toEqual(['604', '642', '602', '602', '602', '641', '648']);
  });

  it('books a received standard invoice as expense, input VAT and payable', () => {
    const event = deriveEconomicEvent(
      invoice({
        kind: 'received_invoice',
        lines: [line({ category: 'goods' })],
      }),
    );

    expect(shape(event)).toEqual([
      { accountCode: '504', amount: '1000.0000', side: 'debit' },
      { accountCode: '343', amount: '210.0000', side: 'debit' },
      { accountCode: '321', amount: '1210.0000', side: 'credit' },
    ]);
    expect(event?.isBalanced).toBe(true);
    expect(event?.lines.map((entry) => entry.partnerId)).toEqual([
      null,
      null,
      PARTNER_ID,
    ]);
  });

  it('maps every received category to its own expense account', () => {
    const accounts = INVOICE_LINE_CATEGORIES.map(
      (category) =>
        deriveEconomicEvent(
          invoice({
            kind: 'received_invoice',
            lines: [
              line({
                category,
                vatAmount: '0',
                vatMode: 'exempt',
                vatRate: '0',
              }),
            ],
          }),
        )?.lines[0]?.accountCode,
    );

    expect(accounts).toEqual(['504', '501', '518', '518', '518', '042', '548']);
  });

  it('self-assesses a received reverse charge on both sides of 343', () => {
    const event = deriveEconomicEvent(
      invoice({
        kind: 'received_invoice',
        lines: [line({ vatAmount: '0', vatMode: 'reverse_charge' })],
      }),
    );

    expect(shape(event)).toEqual([
      { accountCode: '518', amount: '1000.0000', side: 'debit' },
      { accountCode: '321', amount: '1000.0000', side: 'credit' },
      { accountCode: '343', amount: '210.0000', side: 'debit' },
      { accountCode: '343', amount: '210.0000', side: 'credit' },
    ]);
    // The payable carries the net amount only, and the self-assessed VAT nets to nothing.
    expect(event).toMatchObject({
      creditTotal: '1210.0000',
      debitTotal: '1210.0000',
      isBalanced: true,
    });
  });

  it('writes no VAT line for an issued reverse charge, an exempt or an outside scope line', () => {
    for (const vatMode of [
      'reverse_charge',
      'exempt',
      'outside_scope',
    ] as const) {
      const event = deriveEconomicEvent(
        invoice({ lines: [line({ vatAmount: '0', vatMode })] }),
      );

      expect(shape(event)).toEqual([
        { accountCode: '311', amount: '1000.0000', side: 'debit' },
        { accountCode: '602', amount: '1000.0000', side: 'credit' },
      ]);
      expect(event?.isBalanced).toBe(true);
    }
  });

  it('writes no VAT line for a received exempt or outside scope line', () => {
    for (const vatMode of ['exempt', 'outside_scope'] as const) {
      expect(
        shape(
          deriveEconomicEvent(
            invoice({
              kind: 'received_invoice',
              lines: [line({ vatAmount: '0', vatMode })],
            }),
          ),
        ),
      ).toEqual([
        { accountCode: '518', amount: '1000.0000', side: 'debit' },
        { accountCode: '321', amount: '1000.0000', side: 'credit' },
      ]);
    }
  });

  it('settles a standard advance deduction on a received invoice against the payable', () => {
    const event = deriveEconomicEvent(
      invoice({ kind: 'received_invoice', lines: [deduction()] }),
    );

    expect(shape(event)).toEqual([
      { accountCode: '321', amount: '1210.0000', side: 'debit' },
      { accountCode: '314', amount: '1000.0000', side: 'credit' },
      { accountCode: '343', amount: '210.0000', side: 'credit' },
    ]);
    // The payable carries the partner, and the deduction never touches an expense account.
    expect(event?.lines.map((entry) => entry.partnerId)).toEqual([
      PARTNER_ID,
      null,
      null,
    ]);
    expect(event?.isBalanced).toBe(true);
  });

  it('books a received reverse charge advance deduction without any VAT leg', () => {
    const event = deriveEconomicEvent(
      invoice({
        kind: 'received_invoice',
        lines: [deduction({ vatAmount: '0', vatMode: 'reverse_charge' })],
      }),
    );

    // The buyer self-assesses once at the tax point of the supply, so the advance itself carries no VAT.
    expect(shape(event)).toEqual([
      { accountCode: '321', amount: '1000.0000', side: 'debit' },
      { accountCode: '314', amount: '1000.0000', side: 'credit' },
    ]);
    expect(event?.isBalanced).toBe(true);
  });

  it('settles a standard advance deduction on an issued invoice against the receivable', () => {
    const event = deriveEconomicEvent(invoice({ lines: [deduction()] }));

    expect(shape(event)).toEqual([
      { accountCode: '324', amount: '1000.0000', side: 'debit' },
      { accountCode: '343', amount: '210.0000', side: 'debit' },
      { accountCode: '311', amount: '1210.0000', side: 'credit' },
    ]);
    expect(event?.lines.map((entry) => entry.partnerId)).toEqual([
      null,
      null,
      PARTNER_ID,
    ]);
    expect(event?.isBalanced).toBe(true);
  });

  it('books an issued reverse charge advance deduction without any VAT leg', () => {
    const event = deriveEconomicEvent(
      invoice({
        lines: [deduction({ vatAmount: '0', vatMode: 'reverse_charge' })],
      }),
    );

    expect(shape(event)).toEqual([
      { accountCode: '324', amount: '1000.0000', side: 'debit' },
      { accountCode: '311', amount: '1000.0000', side: 'credit' },
    ]);
    expect(event?.isBalanced).toBe(true);
  });

  it('books a rounding difference on both sides of a received invoice', () => {
    const roundedUp = deriveEconomicEvent(
      invoice({
        kind: 'received_invoice',
        lines: [line({ vatAmount: '0', vatMode: 'exempt', vatRate: '0' })],
        roundingAmount: '0.20',
      }),
    );
    const roundedDown = deriveEconomicEvent(
      invoice({
        kind: 'received_invoice',
        lines: [line({ vatAmount: '0', vatMode: 'exempt', vatRate: '0' })],
        roundingAmount: '-0.30',
      }),
    );

    expect(shape(roundedUp)).toEqual([
      { accountCode: '518', amount: '1000.0000', side: 'debit' },
      { accountCode: '321', amount: '1000.0000', side: 'credit' },
      { accountCode: '548', amount: '0.2000', side: 'debit' },
      { accountCode: '321', amount: '0.2000', side: 'credit' },
    ]);
    expect(shape(roundedDown)).toEqual([
      { accountCode: '518', amount: '1000.0000', side: 'debit' },
      { accountCode: '321', amount: '1000.0000', side: 'credit' },
      { accountCode: '321', amount: '0.3000', side: 'debit' },
      { accountCode: '648', amount: '0.3000', side: 'credit' },
    ]);
    // The rounding belongs to no line and to no activity, and only its payable leg carries the partner.
    expect(
      roundedUp?.lines.slice(2).map((entry) => entry.invoiceLineId),
    ).toEqual([null, null]);
    expect(
      roundedUp?.lines.slice(2).map((entry) => entry.activityCode),
    ).toEqual([null, null]);
    expect(roundedUp?.lines.slice(2).map((entry) => entry.partnerId)).toEqual([
      null,
      PARTNER_ID,
    ]);
    expect(roundedDown?.lines.slice(2).map((entry) => entry.partnerId)).toEqual(
      [PARTNER_ID, null],
    );
    expect(roundedUp?.isBalanced).toBe(true);
    expect(roundedDown?.isBalanced).toBe(true);
  });

  it('books a rounding difference on both sides of an issued invoice', () => {
    const roundedUp = deriveEconomicEvent(
      invoice({
        lines: [line({ vatAmount: '0', vatMode: 'exempt', vatRate: '0' })],
        roundingAmount: '0.20',
      }),
    );
    const roundedDown = deriveEconomicEvent(
      invoice({
        lines: [line({ vatAmount: '0', vatMode: 'exempt', vatRate: '0' })],
        roundingAmount: '-0.30',
      }),
    );

    expect(shape(roundedUp)).toEqual([
      { accountCode: '311', amount: '1000.0000', side: 'debit' },
      { accountCode: '602', amount: '1000.0000', side: 'credit' },
      { accountCode: '311', amount: '0.2000', side: 'debit' },
      { accountCode: '648', amount: '0.2000', side: 'credit' },
    ]);
    expect(shape(roundedDown)).toEqual([
      { accountCode: '311', amount: '1000.0000', side: 'debit' },
      { accountCode: '602', amount: '1000.0000', side: 'credit' },
      { accountCode: '548', amount: '0.3000', side: 'debit' },
      { accountCode: '311', amount: '0.3000', side: 'credit' },
    ]);
    expect(roundedUp?.lines.slice(2).map((entry) => entry.partnerId)).toEqual([
      PARTNER_ID,
      null,
    ]);
    expect(roundedDown?.lines.slice(2).map((entry) => entry.partnerId)).toEqual(
      [null, PARTNER_ID],
    );
    expect(roundedUp?.isBalanced).toBe(true);
    expect(roundedDown?.isBalanced).toBe(true);
  });

  it('writes no rounding leg when there is no rounding difference', () => {
    expect(
      shape(deriveEconomicEvent(invoice({ roundingAmount: '0.0000' }))),
    ).toEqual([
      { accountCode: '311', amount: '1210.0000', side: 'debit' },
      { accountCode: '602', amount: '1000.0000', side: 'credit' },
      { accountCode: '343', amount: '210.0000', side: 'credit' },
    ]);
  });

  it('dates every leg by the line tax point, then the invoice one, then the document date', () => {
    const dated = deriveEconomicEvent(
      invoice({
        kind: 'received_invoice',
        lines: [
          line({
            taxPointDate: '2026-07-31',
            vatAmount: '0',
            vatMode: 'exempt',
            vatRate: '0',
          }),
          line({
            id: SECOND_LINE_ID,
            vatAmount: '0',
            vatMode: 'exempt',
            vatRate: '0',
          }),
        ],
        roundingAmount: '0.20',
        taxPointDate: '2026-08-31',
      }),
    );
    const undated = deriveEconomicEvent(
      invoice({
        kind: 'received_invoice',
        lines: [line({ vatAmount: '0', vatMode: 'exempt', vatRate: '0' })],
        roundingAmount: '0.20',
      }),
    );

    // The dated line keeps its own tax point; the other line and the rounding fall back to the invoice one.
    expect(dated?.lines.map((entry) => entry.effectiveDate)).toEqual([
      '2026-07-31',
      '2026-07-31',
      '2026-08-31',
      '2026-08-31',
      '2026-08-31',
      '2026-08-31',
    ]);
    // With no tax point anywhere, the document date is the last fallback.
    expect(undated?.lines.map((entry) => entry.effectiveDate)).toEqual([
      '2026-09-15',
      '2026-09-15',
      '2026-09-15',
      '2026-09-15',
    ]);
  });

  it('copies the activity of a line onto every leg it produces', () => {
    const event = deriveEconomicEvent(
      invoice({
        kind: 'received_invoice',
        lines: [
          line({ activityCode: 'site-a', vatMode: 'standard' }),
          deduction({ id: SECOND_LINE_ID, vatAmount: '0', vatMode: 'exempt' }),
        ],
        roundingAmount: '0.20',
      }),
    );

    expect(event?.lines.map((entry) => entry.activityCode)).toEqual([
      'site-a',
      'site-a',
      'site-a',
      null,
      null,
      null,
      null,
    ]);
  });

  it('numbers a multi-line invoice sequentially and stays balanced', () => {
    const event = deriveEconomicEvent(
      invoice({
        lines: [
          line({
            baseAmount: '100.0000',
            category: 'goods',
            vatAmount: '21.0000',
          }),
          line({
            baseAmount: '50.5000',
            category: 'material',
            id: SECOND_LINE_ID,
            vatAmount: '0',
            vatMode: 'exempt',
            vatRate: '0',
          }),
        ],
      }),
    );

    expect(shape(event)).toEqual([
      { accountCode: '311', amount: '121.0000', side: 'debit' },
      { accountCode: '604', amount: '100.0000', side: 'credit' },
      { accountCode: '343', amount: '21.0000', side: 'credit' },
      { accountCode: '311', amount: '50.5000', side: 'debit' },
      { accountCode: '642', amount: '50.5000', side: 'credit' },
    ]);
    expect(event?.lines.map((entry) => entry.lineNo)).toEqual([1, 2, 3, 4, 5]);
    expect(event).toMatchObject({
      creditTotal: '171.5000',
      debitTotal: '171.5000',
      isBalanced: true,
    });
  });

  it('balances an invoice that carries every kind of leg at once', () => {
    const event = deriveEconomicEvent(
      invoice({
        kind: 'received_invoice',
        lines: [
          line({
            baseAmount: '1000.0000',
            category: 'material',
            vatAmount: '210.0000',
          }),
          line({
            baseAmount: '500.0000',
            category: 'labour',
            id: SECOND_LINE_ID,
            vatAmount: '0',
            vatMode: 'reverse_charge',
          }),
          deduction({ baseAmount: '400.0000', vatAmount: '84.0000' }),
          deduction({
            baseAmount: '300.0000',
            vatAmount: '0',
            vatMode: 'reverse_charge',
          }),
        ],
        roundingAmount: '0.20',
      }),
    );

    expect(shape(event)).toEqual([
      { accountCode: '501', amount: '1000.0000', side: 'debit' },
      { accountCode: '343', amount: '210.0000', side: 'debit' },
      { accountCode: '321', amount: '1210.0000', side: 'credit' },
      { accountCode: '518', amount: '500.0000', side: 'debit' },
      { accountCode: '321', amount: '500.0000', side: 'credit' },
      { accountCode: '343', amount: '105.0000', side: 'debit' },
      { accountCode: '343', amount: '105.0000', side: 'credit' },
      { accountCode: '321', amount: '484.0000', side: 'debit' },
      { accountCode: '314', amount: '400.0000', side: 'credit' },
      { accountCode: '343', amount: '84.0000', side: 'credit' },
      { accountCode: '321', amount: '300.0000', side: 'debit' },
      { accountCode: '314', amount: '300.0000', side: 'credit' },
      { accountCode: '548', amount: '0.2000', side: 'debit' },
      { accountCode: '321', amount: '0.2000', side: 'credit' },
    ]);
    expect(event).toMatchObject({
      creditTotal: '2599.2000',
      debitTotal: '2599.2000',
      isBalanced: true,
      issues: [],
    });
  });

  it('cannot produce an unbalanced event, because every leg is emitted in a balanced set', () => {
    for (const kind of ['issued_invoice', 'received_invoice'] as const) {
      for (const vatMode of [
        'standard',
        'reverse_charge',
        'exempt',
        'outside_scope',
      ] as const) {
        for (const roundingAmount of ['0', '0.20', '-0.30']) {
          const event = deriveEconomicEvent(
            invoice({
              kind,
              lines: [
                line({
                  vatAmount: vatMode === 'standard' ? '210.0000' : '0',
                  vatMode,
                }),
                deduction({
                  baseAmount: '100.0000',
                  id: SECOND_LINE_ID,
                  vatAmount: vatMode === 'standard' ? '21.0000' : '0',
                  vatMode,
                }),
              ],
              roundingAmount,
            }),
          );

          expect(event?.isBalanced).toBe(true);
          expect(
            event?.issues.some((issue) => issue.code === 'unbalanced_event'),
          ).toBe(false);
        }
      }
    }
  });

  it('drops an empty leg instead of writing a zero amount', () => {
    const event = deriveEconomicEvent(
      invoice({
        lines: [line({ baseAmount: '0', vatAmount: '0', vatRate: '0' })],
      }),
    );

    // The stored amount is positive by check constraint, so a zero line has nothing to write.
    expect(event?.lines).toEqual([]);
    expect(event?.isBalanced).toBe(true);
  });

  it('keeps a mixed invoice whole when one of its lines is empty', () => {
    const event = deriveEconomicEvent(
      invoice({
        lines: [
          line({ baseAmount: '0', vatAmount: '0', vatRate: '0' }),
          line({
            baseAmount: '100.0000',
            id: SECOND_LINE_ID,
            vatAmount: '21.0000',
          }),
        ],
      }),
    );

    // Only the exactly empty legs vanish; the paying line keeps every one of its own.
    expect(shape(event)).toEqual([
      { accountCode: '311', amount: '121.0000', side: 'debit' },
      { accountCode: '602', amount: '100.0000', side: 'credit' },
      { accountCode: '343', amount: '21.0000', side: 'credit' },
    ]);
    expect(event).toMatchObject({
      creditTotal: '121.0000',
      debitTotal: '121.0000',
      isBalanced: true,
    });
  });

  it('rejects a negative amount at the boundary instead of deriving from it', () => {
    for (const field of ['baseAmount', 'unitPrice', 'quantity'] as const) {
      expect(
        createInvoiceLineSchema.safeParse({
          baseAmount: '1000.0000',
          category: 'services',
          description: 'placeholder line',
          [field]: '-1.0000',
          vatAmount: '210.0000',
          vatMode: 'standard',
          vatRate: '21.00',
        }).success,
      ).toBe(false);
    }

    expect(
      createInvoiceLineSchema.safeParse({
        baseAmount: '1000.0000',
        category: 'services',
        description: 'placeholder line',
        vatAmount: '-210.0000',
        vatMode: 'standard',
        vatRate: '21.00',
      }).success,
    ).toBe(false);
  });

  it('warns about a missing partner and nothing else when the invoice is whole', () => {
    const event = deriveEconomicEvent(invoice({ partnerId: null }));

    expect(event?.issues).toEqual([
      {
        code: 'missing_partner',
        detail:
          'The invoice carries no partner, so the receivable or payable is unattributed',
        severity: 'warning',
      },
    ]);
    expect(event?.lines[0]?.partnerId).toBeNull();
  });

  it('books no event for a kind the rule set does not cover', () => {
    for (const kind of [
      'credit_note',
      'receipt',
      'bank_statement',
      'contract',
      'agreement',
      'hr_document',
      'payroll',
      'tax_filing',
      'other',
    ] as const) {
      expect(deriveEconomicEvent(invoice({ kind }))).toBeNull();
    }
  });
});
