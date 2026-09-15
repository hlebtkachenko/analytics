import { describe, expect, it } from 'vitest';

import { createInvoiceLineSchema } from './contract.js';
import { deriveEconomicEvent, RULE_SET_VERSION } from './derivation.js';
import type { DerivationLine } from './derivation.js';

const PARTNER_ID = '7d5e0f41-2c8a-4f6d-be54-912ca08d7f62';
const LINE_ID = '8e6f1052-3d9b-4a7e-cf65-a23db19e8073';
const SECOND_LINE_ID = '9f702163-4eac-4b8f-d076-b34ec2af9184';

// A neutral placeholder line: the rules never read the description, only the category and the VAT mode.
function line(overrides: Partial<DerivationLine> = {}): DerivationLine {
  return {
    baseAmount: '1000.0000',
    category: 'services',
    description: 'placeholder line',
    id: LINE_ID,
    vatAmount: '210.0000',
    vatMode: 'standard',
    vatRate: '21.00',
    ...overrides,
  };
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
    expect(RULE_SET_VERSION).toBe('cz-default-2026-09');
  });

  it('books an issued standard invoice as receivable, revenue and output VAT', () => {
    const event = deriveEconomicEvent({
      kind: 'issued_invoice',
      lines: [line()],
      partnerId: PARTNER_ID,
    });

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
    const accounts = (
      ['goods', 'material', 'services', 'asset', 'other'] as const
    ).map(
      (category) =>
        deriveEconomicEvent({
          kind: 'issued_invoice',
          lines: [
            line({ category, vatAmount: '0', vatMode: 'exempt', vatRate: '0' }),
          ],
          partnerId: PARTNER_ID,
        })?.lines[1]?.accountCode,
    );

    expect(accounts).toEqual(['604', '642', '602', '641', '648']);
  });

  it('books a received standard invoice as expense, input VAT and payable', () => {
    const event = deriveEconomicEvent({
      kind: 'received_invoice',
      lines: [line({ category: 'goods' })],
      partnerId: PARTNER_ID,
    });

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
    const accounts = (
      ['goods', 'material', 'services', 'asset', 'other'] as const
    ).map(
      (category) =>
        deriveEconomicEvent({
          kind: 'received_invoice',
          lines: [
            line({ category, vatAmount: '0', vatMode: 'exempt', vatRate: '0' }),
          ],
          partnerId: PARTNER_ID,
        })?.lines[0]?.accountCode,
    );

    expect(accounts).toEqual(['504', '501', '518', '042', '548']);
  });

  it('self-assesses a received reverse charge on both sides of 343', () => {
    const event = deriveEconomicEvent({
      kind: 'received_invoice',
      lines: [line({ vatAmount: '0', vatMode: 'reverse_charge' })],
      partnerId: PARTNER_ID,
    });

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
      const event = deriveEconomicEvent({
        kind: 'issued_invoice',
        lines: [line({ vatAmount: '0', vatMode })],
        partnerId: PARTNER_ID,
      });

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
          deriveEconomicEvent({
            kind: 'received_invoice',
            lines: [line({ vatAmount: '0', vatMode })],
            partnerId: PARTNER_ID,
          }),
        ),
      ).toEqual([
        { accountCode: '518', amount: '1000.0000', side: 'debit' },
        { accountCode: '321', amount: '1000.0000', side: 'credit' },
      ]);
    }
  });

  it('numbers a multi-line invoice sequentially and stays balanced', () => {
    const event = deriveEconomicEvent({
      kind: 'issued_invoice',
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
      partnerId: PARTNER_ID,
    });

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

  it('cannot produce an unbalanced event, because every leg is emitted in a balanced set', () => {
    for (const kind of ['issued_invoice', 'received_invoice'] as const) {
      for (const vatMode of [
        'standard',
        'reverse_charge',
        'exempt',
        'outside_scope',
      ] as const) {
        const event = deriveEconomicEvent({
          kind,
          lines: [
            line({
              vatAmount: vatMode === 'standard' ? '210.0000' : '0',
              vatMode,
            }),
          ],
          partnerId: PARTNER_ID,
        });

        expect(event?.isBalanced).toBe(true);
        expect(
          event?.issues.some((issue) => issue.code === 'unbalanced_event'),
        ).toBe(false);
      }
    }
  });

  it('drops an empty leg instead of writing a zero amount', () => {
    const event = deriveEconomicEvent({
      kind: 'issued_invoice',
      lines: [line({ baseAmount: '0', vatAmount: '0', vatRate: '0' })],
      partnerId: PARTNER_ID,
    });

    // The stored amount is positive by check constraint, so a zero line has nothing to write.
    expect(event?.lines).toEqual([]);
    expect(event?.isBalanced).toBe(true);
  });

  it('keeps a mixed invoice whole when one of its lines is empty', () => {
    const event = deriveEconomicEvent({
      kind: 'issued_invoice',
      lines: [
        line({ baseAmount: '0', vatAmount: '0', vatRate: '0' }),
        line({
          baseAmount: '100.0000',
          id: SECOND_LINE_ID,
          vatAmount: '21.0000',
        }),
      ],
      partnerId: PARTNER_ID,
    });

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
    const event = deriveEconomicEvent({
      kind: 'issued_invoice',
      lines: [line()],
      partnerId: null,
    });

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
      expect(
        deriveEconomicEvent({ kind, lines: [line()], partnerId: PARTNER_ID }),
      ).toBeNull();
    }
  });
});
