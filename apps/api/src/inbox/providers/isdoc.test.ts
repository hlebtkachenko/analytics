import { describe, expect, it } from 'vitest';

import { storableOutput } from '../../worker/parse-inbox-item.js';
import { providerOutputSchema } from '../contract.js';
import {
  CUSTOMER_ICO,
  DEFAULT_LINES,
  SUPPLIER_ICO,
  isdocInvoice,
  pohodaStyleIsdoc,
} from './__fixtures__/index.js';
import {
  MAX_XML_BYTES,
  normalizeRegistrationNumber,
  parseIsdoc,
  resolveIsdoc,
  type IsdocResolutionContext,
  type ParsedIsdoc,
} from './isdoc.js';

const SUPPLIER_ENTITY = '00000000-0000-4000-8000-000000000001';
const CUSTOMER_ENTITY = '00000000-0000-4000-8000-000000000002';
const OTHER_ENTITY = '00000000-0000-4000-8000-000000000003';
const PARTNER_A = '00000000-0000-4000-8000-00000000000a';
const PARTNER_B = '00000000-0000-4000-8000-00000000000b';

function parsed(bytes: Buffer): ParsedIsdoc {
  const result = parseIsdoc(bytes);

  if (!result.ok) {
    throw new Error(`unexpected refusal: ${result.failure.code}`);
  }

  return result.parsed;
}

function refusal(bytes: Buffer | string): string {
  const result = parseIsdoc(
    typeof bytes === 'string' ? Buffer.from(bytes) : bytes,
  );
  return result.ok ? 'parsed' : result.failure.code;
}

function codes(value: ParsedIsdoc | { issues: { code: string }[] }): string[] {
  return value.issues.map((issue) => issue.code);
}

// We are the customer: the supplier is the counterparty partner.
const receiving: IsdocResolutionContext = {
  channelEntityId: null,
  hintEntityId: null,
  ownEntities: [{ id: CUSTOMER_ENTITY, registrationNumber: CUSTOMER_ICO }],
  partners: [
    {
      defaultLineCategory: 'services',
      id: PARTNER_A,
      registrationNumber: SUPPLIER_ICO,
      vatNumber: null,
    },
  ],
  ruleEntityId: null,
  targetEntityId: null,
};

describe('parseIsdoc', () => {
  it('maps a clean invoice to invoice content with no issue', () => {
    const result = parsed(isdocInvoice({ rounding: '0.20' }));

    expect(result.issues).toEqual([]);
    expect(result.documentType).toBe('1');
    expect(result.supplier.registrationNumber).toBe(SUPPLIER_ICO);
    expect(result.customer.registrationNumber).toBe(CUSTOMER_ICO);
    expect(result.content).toMatchObject({
      attributes: { isdoc_document_type: '1' },
      currencyCode: 'CZK',
      documentDate: '2026-09-01',
      invoice: {
        dueDate: '2026-09-15',
        roundingAmount: '0.20',
        taxPointDate: '2026-09-01',
        variableSymbol: '20260001',
      },
      reference: 'FV-2026-0001',
    });
    expect(result.content.invoice?.lines).toEqual([
      {
        baseAmount: '1000.00',
        description: 'Placeholder service',
        lineKind: 'item',
        quantity: '1',
        unit: 'h',
        unitPrice: '1000.00',
        vatAmount: '210.00',
        vatMode: 'standard',
        vatRate: '21',
      },
      expect.objectContaining({ baseAmount: '500.00', vatRate: '12' }),
    ]);
  });

  it('keeps a negative rounding signed', () => {
    const result = parsed(isdocInvoice({ rounding: '-0.40' }));

    expect(result.issues).toEqual([]);
    expect(result.content.invoice?.roundingAmount).toBe('-0.40');
  });

  it('reads the totals block of a desktop emitter with a paid proforma, a taxed advance and a rounding', () => {
    const result = parsed(pohodaStyleIsdoc());

    expect(result.issues).toEqual([]);
    expect(result.content.invoice?.roundingAmount).toBe('-0.44');
    expect(result.content.invoice?.lines.map((line) => line.lineKind)).toEqual([
      'item',
      'item',
      'advance_deduction',
      'advance_deduction',
    ]);
    expect(result.content.invoice?.lines[2]).toEqual({
      baseAmount: '1000',
      description: 'Advance ZL-1 VS 2602',
      lineKind: 'advance_deduction',
      vatAmount: '210',
      vatMode: 'standard',
      vatRate: '21',
    });
    expect(result.content.invoice?.lines[3]).toEqual({
      baseAmount: '500',
      description: 'Advance ZF-1 VS 2601',
      lineKind: 'advance_deduction',
      vatAmount: '0',
      vatMode: 'outside_scope',
      vatRate: '0',
    });
  });

  it.each([
    ['2', 'credit note'],
    ['6', 'advance credit note'],
    ['4', 'proforma'],
  ])(
    'keeps type %s (%s) as a total and attributes, never invoice content',
    (documentType) => {
      const result = parsed(
        isdocInvoice({
          documentType,
          extra:
            '<OriginalDocumentReference><ID>FV-2026-0000</ID><IssueDate>2026-08-01</IssueDate></OriginalDocumentReference>',
          overrides: { TaxInclusiveAmount: '-1770.00' },
        }),
      );

      expect(result.content.invoice).toBeUndefined();
      expect(result.content.totalAmount).toBe('1770');
      expect(result.content.attributes).toMatchObject({
        isdoc_document_type: documentType,
        signed_total_amount: '-1770.00',
      });
      expect(result.content.attributes.original_reference).toBe(
        documentType === '4' ? undefined : 'FV-2026-0000',
      );
    },
  );

  it('keeps an advance tax document (type 5) with its VAT per rate and the not-derived reason', () => {
    const result = parsed(
      isdocInvoice({
        documentType: '5',
        lines: [
          { base: '1000.00', rate: '21', vat: '210.00' },
          { base: '100.00', rate: '12.50', vat: '12.50' },
        ],
      }),
    );

    expect(result.content.invoice).toBeUndefined();
    expect(result.content.attributes).toMatchObject({
      isdoc_document_type: '5',
      tax_point_date: '2026-09-01',
      vat_amount_12_5: '12.50',
      vat_amount_21: '210.00',
      vat_base_12_5: '100.00',
      vat_base_21: '1000.00',
    });
    expect(result.reasons.map((reason) => reason.evidence).join(' ')).toContain(
      'VAT claim is not derived',
    );
  });

  it.each(['3', '7'])('keeps type %s as invoice content', (documentType) => {
    const result = parsed(
      isdocInvoice({
        documentType,
        extra:
          '<OriginalDocumentReference><ID>FV-2026-0000</ID></OriginalDocumentReference>',
      }),
    );

    expect(result.content.invoice).toBeDefined();
    expect(result.issues).toEqual([]);

    if (documentType === '3') {
      expect(result.reasons.at(-1)?.evidence).toContain('FV-2026-0000');
    }
  });

  it('keeps CZK content and puts a foreign currency in attributes with CZK per foreign unit', () => {
    const result = parsed(
      isdocInvoice({
        foreign: { code: 'EUR', rate: '25', ref: '1' },
        lines: [{ base: '2500.00', rate: '21', vat: '525.00' }],
      }),
    );

    expect(result.issues).toEqual([]);
    expect(result.content.currencyCode).toBe('CZK');
    expect(result.content.invoice?.fxRate).toBe('25');
    expect(result.content.attributes).toMatchObject({
      foreign_currency_code: 'EUR',
      foreign_payable_amount: '121.00',
    });
  });

  it('runs the totals identities over the foreign figures too', () => {
    const bytes = isdocInvoice({
      foreign: { code: 'EUR', rate: '25', ref: '1' },
      lines: [{ base: '2500.00', rate: '21', vat: '525.00' }],
    })
      .toString()
      .replace(
        '<TaxExclusiveAmountCurr>100.00</TaxExclusiveAmountCurr>',
        '<TaxExclusiveAmountCurr>101.00</TaxExclusiveAmountCurr>',
      );
    const result = parsed(Buffer.from(bytes));

    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'amount_mismatch',
        message: expect.stringContaining('TaxExclusiveAmountCurr'),
      }),
    ]);
  });

  it('raises an issue for a foreign currency code that is not three letters and never embeds it', () => {
    for (const code of ['Q'.repeat(1000), 'EU1']) {
      const result = parsed(
        isdocInvoice({
          foreign: { code, rate: '25', ref: '1' },
          lines: [{ base: '2500.00', rate: '21', vat: '525.00' }],
        }),
      );
      const output = resolveIsdoc(result, receiving).output;

      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: 'unsupported_type',
          field: 'attributes.foreign_currency_code',
        }),
      );
      expect(result.content.attributes).not.toHaveProperty(
        'foreign_currency_code',
      );
      expect(JSON.stringify(output)).not.toContain(code);
      expect(providerOutputSchema.safeParse(output).success).toBe(true);
    }
  });

  it('keeps an oversized tax rate out of the issue messages', () => {
    const bytes = isdocInvoice()
      .toString()
      .replace(
        '<Percent>21</Percent><VATCalculationMethod>',
        `<Percent>${'X'.repeat(1000)}</Percent><VATCalculationMethod>`,
      );
    const result = parsed(Buffer.from(bytes));
    const output = resolveIsdoc(result, receiving).output;

    expect(codes(result)).toContain('vat_mismatch');
    expect(providerOutputSchema.safeParse(output).success).toBe(true);
  });

  it('divides CurrRate by RefCurrRate to six places', () => {
    const result = parsed(
      isdocInvoice({
        foreign: { code: 'HUF', rate: '6.3', ref: '100' },
        lines: [{ base: '6.30', rate: '21', vat: '1.32' }],
      }),
    );

    expect(result.content.invoice?.fxRate).toBe('0.063');
  });

  it('raises unsupported_type on a local currency other than CZK and keeps the draft', () => {
    const result = parsed(isdocInvoice({ localCurrency: 'EUR' }));

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'unsupported_type',
        field: 'currencyCode',
      }),
    );
    expect(result.content.invoice?.lines).toHaveLength(2);
  });

  it('turns deposits into advance deduction lines after the item lines', () => {
    const result = parsed(
      isdocInvoice({
        taxedDeposits: [
          {
            id: 'ZL-7',
            inclusive: '242.00',
            rate: '21',
            taxable: '200.00',
            variableSymbol: '77',
          },
        ],
        untaxedDeposits: [{ amount: '100.00', id: 'ZF-8' }],
      }),
    );

    expect(result.issues).toEqual([]);
    expect(result.content.invoice?.lines.slice(2)).toEqual([
      {
        baseAmount: '200.00',
        description: 'Advance ZL-7 VS 77',
        lineKind: 'advance_deduction',
        vatAmount: '42',
        vatMode: 'standard',
        vatRate: '21',
      },
      {
        baseAmount: '100.00',
        description: 'Advance ZF-8',
        lineKind: 'advance_deduction',
        vatAmount: '0',
        vatMode: 'outside_scope',
        vatRate: '0',
      },
    ]);
  });

  it.each([
    ['TaxExclusiveAmount', '1500.01'],
    ['TaxInclusiveAmount', '1770.01'],
    ['AlreadyClaimedTaxInclusiveAmount', '1.00'],
    ['PaidDepositsAmount', '1.00'],
    ['DifferenceTaxInclusiveAmount', '1769.00'],
    ['PayableAmount', '1771.00'],
  ])(
    'raises amount_mismatch when %s disagrees and adjusts nothing',
    (element, value) => {
      const result = parsed(isdocInvoice({ overrides: { [element]: value } }));

      expect(codes(result)).toContain('amount_mismatch');
      expect(
        result.issues.some((issue) => issue.message.includes(element)),
      ).toBe(true);
      expect(result.content.invoice?.lines[0]?.baseAmount).toBe('1000.00');
    },
  );

  it('checks each line gross against its base plus VAT', () => {
    const result = parsed(
      isdocInvoice({
        lines: [
          { base: '1000.00', inclusive: '1210.05', rate: '21', vat: '210.00' },
        ],
        overrides: {
          TaxInclusiveAmount: '1210.05',
          DifferenceTaxInclusiveAmount: '1210.05',
          PayableAmount: '1210.05',
        },
      }),
    );

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'amount_mismatch',
        field: 'invoice.lines[0].vatAmount',
      }),
    );
  });

  it('checks every TaxSubTotal and the TaxTotal against the lines and the taxed deposits', () => {
    const base = isdocInvoice({
      taxedDeposits: [
        { id: 'ZL-1', inclusive: '121.00', rate: '21', taxable: '100.00' },
      ],
    }).toString();
    const cases: [string, string, string][] = [
      [
        '<TaxableAmount>1000.00</TaxableAmount>',
        '<TaxableAmount>1000.10</TaxableAmount>',
        'amount_mismatch',
      ],
      [
        '<TaxInclusiveAmount>1210.00</TaxInclusiveAmount>',
        '<TaxInclusiveAmount>1210.10</TaxInclusiveAmount>',
        'amount_mismatch',
      ],
      [
        '<TaxAmount>210.00</TaxAmount>',
        '<TaxAmount>210.10</TaxAmount>',
        'vat_mismatch',
      ],
      [
        '<AlreadyClaimedTaxableAmount>100.00</AlreadyClaimedTaxableAmount>',
        '<AlreadyClaimedTaxableAmount>90.00</AlreadyClaimedTaxableAmount>',
        'amount_mismatch',
      ],
      [
        '<TaxAmount>270.00</TaxAmount></TaxTotal>',
        '<TaxAmount>271.00</TaxAmount></TaxTotal>',
        'vat_mismatch',
      ],
    ];

    expect(parsed(Buffer.from(base)).issues).toEqual([]);

    for (const [from, to, code] of cases) {
      expect(base).toContain(from);
      expect(codes(parsed(Buffer.from(base.replace(from, to))))).toContain(
        code,
      );
    }
  });

  it('pre-checks the rounding bound and the deduction bound as amount_mismatch', () => {
    expect(parsed(isdocInvoice({ rounding: '1.00' })).issues).toContainEqual(
      expect.objectContaining({
        code: 'amount_mismatch',
        field: 'invoice.roundingAmount',
      }),
    );
    expect(
      parsed(
        isdocInvoice({
          lines: [{ base: '100.00', rate: '21', vat: '21.00' }],
          untaxedDeposits: [{ amount: '500.00', id: 'ZF-1' }],
        }),
      ).issues,
    ).toContainEqual(
      expect.objectContaining({
        code: 'amount_mismatch',
        field: 'invoice.lines',
      }),
    );
  });

  it('never flips a negative line and raises amount_mismatch on it', () => {
    const result = parsed(
      isdocInvoice({
        lines: [
          { base: '1000.00', rate: '21', vat: '210.00' },
          { base: '-100.00', rate: '21', vat: '-21.00' },
        ],
      }),
    );

    expect(result.content.invoice?.lines[1]?.baseAmount).toBe('-100.00');
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'amount_mismatch',
        field: 'invoice.lines[1].baseAmount',
      }),
    );
  });

  it('raises no negative-line issue on a credit note, which carries no invoice lines', () => {
    const result = parsed(
      isdocInvoice({
        documentType: '2',
        lines: [{ base: '-100.00', rate: '21', vat: '-21.00' }],
      }),
    );

    expect(result.content.invoice).toBeUndefined();
    expect(result.issues).toEqual([]);
  });

  it('derives the VAT mode from the header and the line tax category', () => {
    const lines = parsed(
      isdocInvoice({
        lines: [
          { base: '100.00', rate: '21', vat: '0.00', vatApplicable: false },
          { base: '100.00', rate: '21', reverseCharge: true, vat: '0.00' },
          { base: '100.00', rate: '0', vat: '0.00' },
          { base: '100.00', rate: '21', vat: '21.00' },
        ],
      }),
    );

    expect(lines.content.invoice?.lines.map((line) => line.vatMode)).toEqual([
      'outside_scope',
      'reverse_charge',
      'exempt',
      'standard',
    ]);
    expect(lines.fieldConfidences['invoice.lines[2].vatMode']).toBe(0.9);

    const outside = parsed(
      isdocInvoice({
        lines: [{ base: '100.00', rate: '21', vat: '0.00' }],
        vatApplicable: false,
      }),
    );
    expect(outside.content.invoice?.lines[0]?.vatMode).toBe('outside_scope');
  });

  it('cuts or drops what the register cannot hold, with a reason', () => {
    const result = parsed(
      isdocInvoice({
        id: 'X'.repeat(65),
        lines: [
          {
            base: '1000.00',
            description: 'D'.repeat(600),
            rate: '21',
            unit: 'U'.repeat(17),
            vat: '210.00',
          },
          {
            base: '500.00',
            note: 'Placeholder note',
            rate: '12',
            vat: '60.00',
          },
          { base: '10.00', rate: '12', vat: '1.20' },
        ],
        variableSymbol: 'ABC',
      }),
    );
    const evidence = result.reasons.map((reason) => reason.evidence).join(' ');

    expect(result.content.reference).toBeUndefined();
    expect(result.content.invoice?.variableSymbol).toBeUndefined();
    expect(result.content.invoice?.lines[0]?.description).toHaveLength(500);
    expect(result.content.invoice?.lines[0]?.unit).toBeUndefined();
    expect(result.content.invoice?.lines[1]?.description).toBe(
      'Placeholder note',
    );
    expect(result.content.invoice?.lines[2]?.description).toBe('Line 3');
    expect(evidence).toContain('longer than 64');
    expect(evidence).toContain('unit longer than 16');
    expect(evidence).toContain('variable symbol');
  });

  it('counts item lines and deposits against one 200 cap', () => {
    const line = { base: '1.00', rate: '21', vat: '0.21' };
    const deposit = { amount: '0.01', id: 'ZF' };

    expect(
      refusal(
        isdocInvoice({
          lines: Array.from({ length: 150 }, () => line),
          untaxedDeposits: Array.from({ length: 50 }, () => deposit),
        }),
      ),
    ).toBe('parsed');
    expect(
      refusal(
        isdocInvoice({
          lines: Array.from({ length: 150 }, () => line),
          untaxedDeposits: Array.from({ length: 51 }, () => deposit),
        }),
      ),
    ).toBe('too_large');
  });

  it.each([
    [
      '5.x namespace',
      isdocInvoice({
        rootAttributes:
          'xmlns="http://isdoc.cz/namespace/invoice" version="5.2"',
      }),
    ],
    ['version 6.1', isdocInvoice({ version: '6.1' })],
    [
      'no version',
      isdocInvoice({
        rootAttributes: 'xmlns="http://isdoc.cz/namespace/2013"',
      }),
    ],
    [
      'right prefix on a wrong URI',
      isdocInvoice({
        rootName: 'isdoc:Invoice',
        rootAttributes:
          'xmlns:isdoc="http://example.org/isdoc" xmlns="http://isdoc.cz/namespace/2013" version="6.0.1"',
      }),
    ],
    ['no namespace', isdocInvoice({ rootAttributes: 'version="6.0.1"' })],
  ])('refuses the %s as unsupported_type', (_name, bytes) => {
    expect(refusal(bytes)).toBe('unsupported_type');
  });

  it('accepts 6.0 and 6.0.2 by the resolved namespace, whatever the prefix', () => {
    expect(refusal(isdocInvoice({ version: '6.0' }))).toBe('parsed');
    expect(refusal(isdocInvoice({ version: '6.0.2' }))).toBe('parsed');
    const prefixed = isdocInvoice()
      .toString()
      .replaceAll(/<(\/?)([A-Z])/g, '<$1i:$2')
      .replace('xmlns="http://isdoc.cz', 'xmlns:i="http://isdoc.cz');
    expect(parsed(Buffer.from(prefixed)).issues).toEqual([]);
  });

  it('refuses a DOCTYPE, an external entity and an undefined entity', () => {
    const body = isdocInvoice()
      .toString()
      .replace(/^<\?xml[^>]*>\n/, '');

    expect(refusal(`<!DOCTYPE Invoice>${body}`)).toBe('unreadable');
    expect(
      refusal(
        `<!DOCTYPE Invoice [<!ENTITY secret SYSTEM "file:///etc/passwd">]>${body.replace('FV-2026-0001', '&secret;')}`,
      ),
    ).toBe('unreadable');
    expect(
      refusal(
        `<!DOCTYPE Invoice [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;">]>${body}`,
      ),
    ).toBe('unreadable');
    expect(refusal(body.replace('FV-2026-0001', '&undefined;'))).toBe(
      'unreadable',
    );
    expect(refusal(body.replace('FV-2026-0001', 'A&amp;B'))).toBe('parsed');
  });

  it('refuses malformed XML and bad or undeclared encodings', () => {
    expect(
      refusal(
        '<Invoice xmlns="http://isdoc.cz/namespace/2013" version="6.0.1">',
      ),
    ).toBe('unreadable');
    expect(refusal(Buffer.from([0x3c, 0xc3, 0x28, 0x3e]))).toBe('unreadable');
    expect(
      refusal(
        isdocInvoice()
          .toString()
          .replace('encoding="UTF-8"', 'encoding="windows-1250"'),
      ),
    ).toBe('unreadable');
  });

  it('checks the byte size before decoding and enforces every structure cap', () => {
    const body = isdocInvoice().toString();
    const nested = `${'<Note>'.repeat(33)}${'</Note>'.repeat(33)}`;
    const many = '<Note/>'.repeat(20_001);

    expect(refusal(Buffer.alloc(MAX_XML_BYTES + 1, 0x20))).toBe('too_large');
    expect(
      refusal(body.replace('<IssuingSystem>', `${nested}<IssuingSystem>`)),
    ).toBe('too_large');
    expect(
      refusal(body.replace('<IssuingSystem>', `${many}<IssuingSystem>`)),
    ).toBe('too_large');
    expect(
      refusal(
        body.replace(
          '<IssuingSystem>Placeholder',
          `<IssuingSystem>${'x'.repeat(4001)}`,
        ),
      ),
    ).toBe('too_large');
  });

  it('skips Extensions and foreign elements but still counts them', () => {
    const body = isdocInvoice().toString();
    const extension = `<Extensions><Secret>${'y'.repeat(100)}</Secret></Extensions><ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:SignedInfo/></ds:Signature>`;

    expect(
      parsed(
        Buffer.from(
          body.replace('<IssuingSystem>', `${extension}<IssuingSystem>`),
        ),
      ).issues,
    ).toEqual([]);
    expect(
      refusal(
        body.replace(
          '<IssuingSystem>',
          `<Extensions>${'<x:a xmlns:x="urn:x"/>'.repeat(20_001)}</Extensions><IssuingSystem>`,
        ),
      ),
    ).toBe('too_large');
  });

  it('reads a signed ISDOC whose signature carries long base64 values, and still caps an ISDOC element', () => {
    const base64 = 'QUJD'.repeat(5_000);
    const signature = `<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:SignedInfo/><ds:SignatureValue>${base64}</ds:SignatureValue><ds:Object><xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#"><xades:EncapsulatedTimeStamp>${base64}</xades:EncapsulatedTimeStamp></xades:QualifyingProperties></ds:Object></ds:Signature>`;
    const body = isdocInvoice().toString();

    expect(
      parsed(Buffer.from(body.replace('</Invoice>', `${signature}</Invoice>`)))
        .issues,
    ).toEqual([]);
    expect(
      refusal(
        body.replace('<IssuingSystem>Placeholder', `<IssuingSystem>${base64}`),
      ),
    ).toBe('too_large');
  });

  it('refuses a DocumentType outside 1 to 7', () => {
    expect(refusal(isdocInvoice({ documentType: '9' }))).toBe(
      'unsupported_type',
    );
  });

  it('turns each failure of the documents contract into an issue under its draft path', () => {
    const result = parsed(
      isdocInvoice({
        lines: [{ base: '1000.00', rate: '21', vat: '250.00' }],
      }),
    );

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'vat_mismatch',
        field: 'invoice.lines[0].vatAmount',
      }),
    );
  });
});

describe('resolveIsdoc', () => {
  it('normalises an IČO to eight digits', () => {
    expect(normalizeRegistrationNumber(' 123 ')).toBe('00000123');
    expect(normalizeRegistrationNumber('CZ-000 000 00')).toBe('00000000');
    expect(normalizeRegistrationNumber('123456789')).toBeNull();
    expect(normalizeRegistrationNumber('')).toBeNull();
  });

  it('resolves a received invoice when the customer IČO is ours and matches the supplier partner', () => {
    const result = resolveIsdoc(parsed(isdocInvoice()), receiving);

    expect(result.lineCategory).toBe('services');
    expect(result.output).toMatchObject({
      confidence: 0.95,
      detectedType: 'isdoc_invoice',
      draft: {
        kind: 'received_invoice',
        legalEntityId: CUSTOMER_ENTITY,
        partnerId: PARTNER_A,
        title: 'Placeholder Party FV-2026-0001',
      },
      issues: [],
      legalEntityId: CUSTOMER_ENTITY,
      partnerId: PARTNER_A,
    });
  });

  it('resolves an issued invoice when the supplier IČO is ours', () => {
    const result = resolveIsdoc(parsed(isdocInvoice()), {
      ...receiving,
      ownEntities: [{ id: SUPPLIER_ENTITY, registrationNumber: '0' }],
      partners: [
        {
          defaultLineCategory: null,
          id: PARTNER_B,
          registrationNumber: '11111111',
          vatNumber: null,
        },
      ],
    });

    expect(result.output.draft).toMatchObject({
      kind: 'issued_invoice',
      legalEntityId: SUPPLIER_ENTITY,
      partnerId: PARTNER_B,
    });
    expect(result.lineCategory).toBeNull();
  });

  it('lets the channel or hint entity pick the side when both parties are ours, else raises entity_conflict', () => {
    const both = {
      ...receiving,
      ownEntities: [
        { id: SUPPLIER_ENTITY, registrationNumber: SUPPLIER_ICO },
        { id: CUSTOMER_ENTITY, registrationNumber: CUSTOMER_ICO },
      ],
      partners: [],
    };
    const picked = resolveIsdoc(parsed(isdocInvoice()), {
      ...both,
      hintEntityId: SUPPLIER_ENTITY,
    });
    const channel = resolveIsdoc(parsed(isdocInvoice()), {
      ...both,
      channelEntityId: CUSTOMER_ENTITY,
    });
    const open = resolveIsdoc(parsed(isdocInvoice()), both);

    expect(picked.output.draft.kind).toBe('issued_invoice');
    expect(picked.output.fieldConfidences.legalEntityId).toBe(1);
    expect(channel.output.draft.kind).toBe('received_invoice');
    expect(open.output.draft.kind).toBeNull();
    expect(codes(open.output)).toContain('entity_conflict');
  });

  it('raises entity_unresolved and a null kind when neither party is ours', () => {
    const result = resolveIsdoc(parsed(isdocInvoice()), {
      ...receiving,
      ownEntities: [{ id: OTHER_ENTITY, registrationNumber: null }],
    });

    expect(result.output.draft).toMatchObject({
      kind: null,
      legalEntityId: null,
    });
    expect(result.output.legalEntityId).toBeUndefined();
    expect(codes(result.output)).toEqual(['entity_unresolved']);
    expect(result.output.confidence).toBe(0.5);
  });

  it('raises entity_conflict for a bound entity that differs, a bound IČO the file skips, or a shared IČO', () => {
    const channel = resolveIsdoc(parsed(isdocInvoice()), {
      ...receiving,
      channelEntityId: OTHER_ENTITY,
    });
    const target = resolveIsdoc(parsed(isdocInvoice()), {
      ...receiving,
      targetEntityId: OTHER_ENTITY,
    });
    const rule = resolveIsdoc(parsed(isdocInvoice()), {
      ...receiving,
      ruleEntityId: OTHER_ENTITY,
    });
    const skipped = resolveIsdoc(parsed(isdocInvoice()), {
      ...receiving,
      channelEntityId: OTHER_ENTITY,
      ownEntities: [{ id: OTHER_ENTITY, registrationNumber: '22222222' }],
    });
    const shared = resolveIsdoc(parsed(isdocInvoice()), {
      ...receiving,
      ownEntities: [
        { id: CUSTOMER_ENTITY, registrationNumber: CUSTOMER_ICO },
        { id: OTHER_ENTITY, registrationNumber: '11111111' },
      ],
    });

    for (const result of [channel, target, rule, skipped, shared]) {
      expect(codes(result.output)).toContain('entity_conflict');
    }

    expect(shared.output.draft.legalEntityId).toBeNull();
  });

  it('matches the partner by DIČ when no IČO matches, and names several or none as unknown_partner', () => {
    const invoice = parsed(isdocInvoice({ supplier: { dic: 'CZ00000000' } }));
    const byVat = resolveIsdoc(invoice, {
      ...receiving,
      partners: [
        {
          defaultLineCategory: 'goods',
          id: PARTNER_B,
          registrationNumber: null,
          vatNumber: 'cz00000000',
        },
      ],
    });
    const several = resolveIsdoc(invoice, {
      ...receiving,
      partners: [
        {
          defaultLineCategory: null,
          id: PARTNER_A,
          registrationNumber: '0',
          vatNumber: null,
        },
        {
          defaultLineCategory: null,
          id: PARTNER_B,
          registrationNumber: '00000000',
          vatNumber: null,
        },
      ],
    });
    const none = resolveIsdoc(invoice, { ...receiving, partners: [] });

    expect(byVat.output.draft.partnerId).toBe(PARTNER_B);
    expect(byVat.lineCategory).toBe('goods');
    expect(several.output.draft.partnerId).toBeNull();
    expect(several.output.issues).toContainEqual(
      expect.objectContaining({
        code: 'unknown_partner',
        message: expect.stringContaining(PARTNER_B),
      }),
    );
    expect(codes(none.output)).toEqual(['unknown_partner']);
    expect(none.output.reasons.at(-1)?.evidence).toContain(
      'Proposed partner: name Placeholder Party, IČO 00000000, DIČ CZ00000000, country CZ.',
    );
  });

  it('keeps parse issues and lowers the confidence to the parse', () => {
    const result = resolveIsdoc(
      parsed(isdocInvoice({ overrides: { PayableAmount: '1.00' } })),
      receiving,
    );

    expect(codes(result.output)).toEqual(['amount_mismatch']);
    expect(result.output.confidence).toBe(0.5);
  });

  it('carries every document type to its kind', () => {
    const kinds = ['1', '2', '3', '4', '5', '6', '7'].map(
      (documentType) =>
        resolveIsdoc(parsed(isdocInvoice({ documentType })), receiving).output
          .draft.kind,
    );

    expect(kinds).toEqual([
      'received_invoice',
      'credit_note',
      'received_invoice',
      'advance_request',
      'advance_request',
      'credit_note',
      'received_invoice',
    ]);
    expect(DEFAULT_LINES).toHaveLength(2);
  });
});

describe('storableOutput', () => {
  it('stores a valid output and turns one that breaks the contract into an unreadable failure', () => {
    const output = resolveIsdoc(parsed(isdocInvoice()), receiving).output;
    const broken = {
      ...output,
      reasons: [
        { evidence: 'x'.repeat(501), step: 'parse' as const, weight: 1 },
      ],
    };

    expect(storableOutput(output)).toBe(output);
    expect(storableOutput(broken)).toMatchObject({
      draft: {},
      issues: [{ code: 'unreadable' }],
    });
  });
});
