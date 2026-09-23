// Synthetic byte fixtures for the providers: every one is built here, none is a real customer file.

import { crc32, deflateRawSync } from 'node:zlib';

import type { SniffInput } from '../sniff.js';

export const PDF_MAGIC = Buffer.from('%PDF-1.7\n');
export const PNG_MAGIC = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
export const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

export function toSniffInput(bytes: Buffer, window = 65_536): SniffInput {
  return {
    byteSize: bytes.length,
    head: bytes.subarray(0, window),
    tail: bytes.subarray(Math.max(0, bytes.length - window)),
  };
}

// Pads a header to a realistic size so the decorative image threshold does not fire.
export function padded(prefix: Buffer, size: number): Buffer {
  return Buffer.concat([
    prefix,
    Buffer.alloc(Math.max(0, size - prefix.length), 0x41),
  ]);
}

export function pdf(encrypted = false): Buffer {
  const trailer = encrypted
    ? 'trailer\n<< /Root 1 0 R /Encrypt 5 0 R >>\n%%EOF\n'
    : 'trailer\n<< /Root 1 0 R >>\n%%EOF\n';
  return Buffer.concat([
    PDF_MAGIC,
    Buffer.from('1 0 obj\n<< >>\nendobj\n'),
    Buffer.from(trailer),
  ]);
}

export function png(size = 16_384): Buffer {
  return padded(PNG_MAGIC, size);
}

export function jpeg(size = 16_384): Buffer {
  return padded(JPEG_MAGIC, size);
}

export function webp(size = 16_384): Buffer {
  const header = Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP'),
  ]);
  return padded(header, size);
}

// A minimal stored zip: one local file header followed by a central directory naming the entry.
export function zip(entryName: string, passwordProtected = false): Buffer {
  const name = Buffer.from(entryName);
  const flags = passwordProtected ? 0x0001 : 0x0000;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(flags, 6);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(flags, 8);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  return Buffer.concat([local, name, central, name, end]);
}

export function isdoc(): Buffer {
  return Buffer.from(
    '<?xml version="1.0" encoding="utf-8"?>\n<Invoice xmlns="http://isdoc.cz/namespace/2013" version="6.0.1"><DocumentType>1</DocumentType></Invoice>',
  );
}

export function moneyS3(): Buffer {
  return Buffer.from(
    '<?xml version="1.0" encoding="windows-1250"?>\n<!-- export -->\n<MoneyData ICAgendy="00000000"><SeznamFaktPrij/></MoneyData>',
  );
}

export function pohoda(): Buffer {
  return Buffer.from(
    '<?xml version="1.0" encoding="Windows-1250"?><dat:dataPack xmlns:dat="http://www.stormware.cz/schema/version_2/data.xsd" id="x" version="2.0"></dat:dataPack>',
  );
}

export function camt(): Buffer {
  return Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt/></Document>',
  );
}

export function unknownXml(): Buffer {
  return Buffer.from('<?xml version="1.0"?><note><to>placeholder</to></note>');
}

// The 128-character 074 header: type, account, name, old balance date, four signed amounts, number, date, padding.
export function gpc(): Buffer {
  const amount = `${'0'.repeat(14)}+`;
  const header = `074${'0'.repeat(16)}${'PLACEHOLDER ACCOUNT'.padEnd(20)}010126${amount}${amount}${amount}${amount}001010126${' '.repeat(14)}`;
  return Buffer.from(`${header}\r\n075${'0'.repeat(125)}\r\n`);
}

// A CSV whose first cell starts with 074 is a table, not a statement.
export function csvStartingWith074(): Buffer {
  return Buffer.from(
    `074;${'x'.repeat(120)};note\n${'1'.repeat(3)};${'y'.repeat(120)};b\n`,
  );
}

// A GPC header padded past 128 characters is no longer the fixed record.
export function gpcOverlong(): Buffer {
  const header = gpc().toString('latin1').split('\r\n', 1)[0] ?? '';
  return Buffer.from(`${header}00\r\n075${'0'.repeat(125)}\r\n`);
}

// Header plus 37-byte rows: the 64 KiB window edge lands on the second byte of the "ř" in row 1771.
export function czechCsvOver64KiB(): Buffer {
  const row = '01.01.2026;1250,00;přijatá záloha\n';
  return Buffer.from(`datum;částka;poznámka\n${row.repeat(2_000)}`);
}

export function csv(): Buffer {
  return Buffer.from('date;amount;note\n2026-01-01;100;a\n2026-01-02;200;b\n');
}

export function text(): Buffer {
  return Buffer.from('A short note somebody typed.\nSecond line.\n');
}

export function binaryGarbage(): Buffer {
  return Buffer.from([0x00, 0x01, 0x02, 0xfe, 0xff, 0x10, 0x00, 0x7f]);
}

// Synthetic ISDOC 6.0.1 invoices: placeholder parties with IČO 00000000 (supplier) and 11111111 (customer).
export const SUPPLIER_ICO = '00000000';
export const CUSTOMER_ICO = '11111111';

export interface FixtureParty {
  dic?: string;
  ico?: string;
  name?: string;
}

export interface FixtureLine {
  base: string;
  description?: string;
  inclusive?: string;
  note?: string;
  quantity?: string;
  rate: string;
  reverseCharge?: boolean;
  unit?: string;
  unitPrice?: string;
  vat: string;
  vatApplicable?: boolean;
}

export interface FixtureTaxedDeposit {
  id: string;
  inclusive: string;
  rate: string;
  taxable: string;
  variableSymbol?: string;
}

export interface FixtureUntaxedDeposit {
  amount: string;
  id: string;
  variableSymbol?: string;
}

export interface IsdocFixtureOptions {
  customer?: FixtureParty;
  documentType?: string;
  // Raw XML placed after the header, for elements a single test needs.
  extra?: string;
  // CZK per RefCurrRate foreign units; the Curr figures are the local ones divided by rate / ref.
  foreign?: { code: string; rate: string; ref: string };
  id?: string;
  issueDate?: string;
  lines?: FixtureLine[];
  localCurrency?: string;
  // Replaces a computed LegalMonetaryTotal element, keyed by element name.
  overrides?: Record<string, string>;
  rootAttributes?: string;
  rootName?: string;
  rounding?: string;
  supplier?: FixtureParty;
  taxedDeposits?: FixtureTaxedDeposit[];
  untaxedDeposits?: FixtureUntaxedDeposit[];
  vatApplicable?: boolean;
  variableSymbol?: string;
  version?: string;
}

const cents = (value: string): number => Math.round(Number(value) * 100);
const money = (value: number): string => (value / 100).toFixed(2);

function partyXml(tag: string, party: FixtureParty, fallbackIco: string) {
  const dic =
    party.dic === undefined
      ? ''
      : `<PartyTaxScheme><CompanyID>${party.dic}</CompanyID><TaxScheme>VAT</TaxScheme></PartyTaxScheme>`;
  return `<${tag}><Party><PartyIdentification><ID>${party.ico ?? fallbackIco}</ID></PartyIdentification><PartyName><Name>${party.name ?? 'Placeholder Party'}</Name></PartyName><PostalAddress><StreetName>Placeholder</StreetName><BuildingNumber>1</BuildingNumber><CityName>Placeholder</CityName><PostalZone>00000</PostalZone><Country><IdentificationCode>CZ</IdentificationCode><Name>Czech Republic</Name></Country></PostalAddress>${dic}</Party></${tag}>`;
}

export const DEFAULT_LINES: FixtureLine[] = [
  {
    base: '1000.00',
    description: 'Placeholder service',
    rate: '21',
    vat: '210.00',
  },
  {
    base: '500.00',
    description: 'Placeholder goods',
    rate: '12',
    vat: '60.00',
  },
];

// A whole ISDOC invoice whose totals are computed from its lines and deposits unless an override says otherwise.
export function isdocInvoice(options: IsdocFixtureOptions = {}): Buffer {
  const lines = options.lines ?? DEFAULT_LINES;
  const taxed = options.taxedDeposits ?? [];
  const untaxed = options.untaxedDeposits ?? [];
  const factor =
    options.foreign === undefined
      ? 1
      : Number(options.foreign.rate) / Number(options.foreign.ref);
  const curr = (value: number): number => Math.round(value / factor);
  const inclusive = (line: FixtureLine): number =>
    line.inclusive === undefined
      ? cents(line.base) + cents(line.vat)
      : cents(line.inclusive);
  const exclusiveTotal = lines.reduce((sum, line) => sum + cents(line.base), 0);
  const inclusiveTotal = lines.reduce((sum, line) => sum + inclusive(line), 0);
  const claimed = taxed.reduce(
    (sum, deposit) => sum + cents(deposit.inclusive),
    0,
  );
  const claimedBase = taxed.reduce(
    (sum, deposit) => sum + cents(deposit.taxable),
    0,
  );
  const paid = untaxed.reduce((sum, deposit) => sum + cents(deposit.amount), 0);
  const rounding = cents(options.rounding ?? '0');
  const difference = inclusiveTotal - claimed;
  const totals: Record<string, string> = {
    TaxExclusiveAmount: money(exclusiveTotal),
    TaxInclusiveAmount: money(inclusiveTotal),
    AlreadyClaimedTaxExclusiveAmount: money(claimedBase),
    AlreadyClaimedTaxInclusiveAmount: money(claimed),
    DifferenceTaxExclusiveAmount: money(exclusiveTotal - claimedBase),
    DifferenceTaxInclusiveAmount: money(difference),
    PayableRoundingAmount: money(rounding),
    PaidDepositsAmount: money(paid),
    PayableAmount: money(difference - paid + rounding),
  };
  const withCurr = (name: string, value: number): string =>
    options.foreign === undefined
      ? ''
      : `<${name}Curr>${money(curr(value))}</${name}Curr>`;
  const monetary = Object.entries(totals)
    .map(([name, value]) => {
      const stated = options.overrides?.[name] ?? value;
      return `${withCurr(name, cents(value))}<${name}>${stated}</${name}>`;
    })
    .join('');
  const rates = [...new Set(lines.map((line) => line.rate))];
  const subTotals = rates
    .map((rate) => {
      const atRate = lines.filter((line) => line.rate === rate);
      const base = atRate.reduce((sum, line) => sum + cents(line.base), 0);
      const vat = atRate.reduce((sum, line) => sum + cents(line.vat), 0);
      const gross = atRate.reduce((sum, line) => sum + inclusive(line), 0);
      const taxable = taxed
        .filter((deposit) => deposit.rate === rate)
        .reduce((sum, deposit) => sum + cents(deposit.taxable), 0);
      return `<TaxSubTotal>${withCurr('TaxableAmount', base)}<TaxableAmount>${money(base)}</TaxableAmount>${withCurr('TaxInclusiveAmount', gross)}<TaxInclusiveAmount>${money(gross)}</TaxInclusiveAmount>${withCurr('TaxAmount', vat)}<TaxAmount>${money(vat)}</TaxAmount><AlreadyClaimedTaxableAmount>${money(taxable)}</AlreadyClaimedTaxableAmount><TaxCategory><Percent>${rate}</Percent></TaxCategory></TaxSubTotal>`;
    })
    .join('');
  const vatTotal = lines.reduce((sum, line) => sum + cents(line.vat), 0);
  const lineXml = lines
    .map((line, index) => {
      const applicable =
        line.vatApplicable === false
          ? '<VATApplicable>false</VATApplicable>'
          : '';
      const reverse =
        line.reverseCharge === true
          ? '<LocalReverseCharge><LocalReverseChargeCode>1</LocalReverseChargeCode></LocalReverseCharge>'
          : '';
      const description =
        line.description === undefined
          ? ''
          : `<Item><Description>${line.description}</Description></Item>`;
      const note = line.note === undefined ? '' : `<Note>${line.note}</Note>`;
      return `<InvoiceLine><ID>${index + 1}</ID><InvoicedQuantity unitCode="${line.unit ?? 'h'}">${line.quantity ?? '1'}</InvoicedQuantity>${withCurr('LineExtensionAmount', cents(line.base))}<LineExtensionAmount>${line.base}</LineExtensionAmount>${withCurr('LineExtensionAmountTaxInclusive', inclusive(line))}<LineExtensionAmountTaxInclusive>${money(inclusive(line))}</LineExtensionAmountTaxInclusive><LineExtensionTaxAmount>${line.vat}</LineExtensionTaxAmount><UnitPrice>${line.unitPrice ?? line.base}</UnitPrice>${note}<ClassifiedTaxCategory><Percent>${line.rate}</Percent><VATCalculationMethod>0</VATCalculationMethod>${applicable}${reverse}</ClassifiedTaxCategory>${description}</InvoiceLine>`;
    })
    .join('');
  const taxedXml =
    taxed.length === 0
      ? ''
      : `<TaxedDeposits>${taxed
          .map(
            (deposit) =>
              `<TaxedDeposit><ID>${deposit.id}</ID>${deposit.variableSymbol === undefined ? '' : `<VariableSymbol>${deposit.variableSymbol}</VariableSymbol>`}${withCurr('TaxableDepositAmount', cents(deposit.taxable))}<TaxableDepositAmount>${deposit.taxable}</TaxableDepositAmount>${withCurr('TaxInclusiveDepositAmount', cents(deposit.inclusive))}<TaxInclusiveDepositAmount>${deposit.inclusive}</TaxInclusiveDepositAmount><ClassifiedTaxCategory><Percent>${deposit.rate}</Percent><VATCalculationMethod>0</VATCalculationMethod></ClassifiedTaxCategory></TaxedDeposit>`,
          )
          .join('')}</TaxedDeposits>`;
  const untaxedXml =
    untaxed.length === 0
      ? ''
      : `<NonTaxedDeposits>${untaxed
          .map(
            (deposit) =>
              `<NonTaxedDeposit><ID>${deposit.id}</ID>${deposit.variableSymbol === undefined ? '' : `<VariableSymbol>${deposit.variableSymbol}</VariableSymbol>`}${withCurr('DepositAmount', cents(deposit.amount))}<DepositAmount>${deposit.amount}</DepositAmount></NonTaxedDeposit>`,
          )
          .join('')}</NonTaxedDeposits>`;
  const foreign =
    options.foreign === undefined
      ? ''
      : `<ForeignCurrencyCode>${options.foreign.code}</ForeignCurrencyCode><CurrRate>${options.foreign.rate}</CurrRate><RefCurrRate>${options.foreign.ref}</RefCurrRate>`;
  const rootName = options.rootName ?? 'Invoice';
  const rootAttributes =
    options.rootAttributes ??
    `xmlns="http://isdoc.cz/namespace/2013" version="${options.version ?? '6.0.1'}"`;

  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>\n<${rootName} ${rootAttributes}><DocumentType>${options.documentType ?? '1'}</DocumentType><ID>${options.id ?? 'FV-2026-0001'}</ID><UUID>00000000-0000-4000-8000-0000000000aa</UUID><IssuingSystem>Placeholder</IssuingSystem><IssueDate>${options.issueDate ?? '2026-09-01'}</IssueDate><TaxPointDate>2026-09-01</TaxPointDate><VATApplicable>${options.vatApplicable === false ? 'false' : 'true'}</VATApplicable><ElectronicPossibilityAgreementReference></ElectronicPossibilityAgreementReference><LocalCurrencyCode>${options.localCurrency ?? 'CZK'}</LocalCurrencyCode>${foreign}${options.extra ?? ''}${partyXml('AccountingSupplierParty', options.supplier ?? {}, SUPPLIER_ICO)}${partyXml('AccountingCustomerParty', options.customer ?? {}, CUSTOMER_ICO)}<InvoiceLines>${lineXml}</InvoiceLines>${untaxedXml}${taxedXml}<TaxTotal>${subTotals}${withCurr('TaxAmount', vatTotal)}<TaxAmount>${money(vatTotal)}</TaxAmount></TaxTotal><LegalMonetaryTotal>${monetary}</LegalMonetaryTotal><PaymentMeans><Payment><PaidAmount>${totals.PayableAmount}</PaidAmount><PaymentMeansCode>42</PaymentMeansCode><Details><PaymentDueDate>2026-09-15</PaymentDueDate><ID>000000-0000000000</ID><BankCode>0000</BankCode><Name>Placeholder Bank</Name><IBAN>CZ0000000000000000000000</IBAN><BIC>PLACCZPP</BIC><VariableSymbol>${options.variableSymbol ?? '20260001'}</VariableSymbol></Details></Payment></PaymentMeans></${rootName}>`,
  );
}

// The totals block shape of a desktop emitter such as Pohoda: a paid proforma, a taxed advance, a rounding to
// whole crowns and every Curr twin written as zero. Synthetic values only.
export function pohodaStyleIsdoc(): Buffer {
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="http://isdoc.cz/namespace/2013" version="6.0.2">
  <DocumentType>1</DocumentType>
  <ID>260100001</ID>
  <UUID>00000000-0000-4000-8000-0000000000bb</UUID>
  <IssuingSystem>Placeholder desktop</IssuingSystem>
  <IssueDate>2026-09-10</IssueDate>
  <TaxPointDate>2026-09-10</TaxPointDate>
  <VATApplicable>true</VATApplicable>
  <ElectronicPossibilityAgreementReference/>
  <Note>Placeholder</Note>
  <LocalCurrencyCode>CZK</LocalCurrencyCode>
  <CurrRate>1</CurrRate>
  <RefCurrRate>1</RefCurrRate>
  <AccountingSupplierParty><Party><PartyIdentification><ID>00000000</ID></PartyIdentification><PartyName><Name>Placeholder Supplier</Name></PartyName><PostalAddress><StreetName>Placeholder</StreetName><BuildingNumber>1</BuildingNumber><CityName>Placeholder</CityName><PostalZone>00000</PostalZone><Country><IdentificationCode>CZ</IdentificationCode><Name/></Country></PostalAddress><PartyTaxScheme><CompanyID>CZ00000000</CompanyID><TaxScheme>VAT</TaxScheme></PartyTaxScheme></Party></AccountingSupplierParty>
  <AccountingCustomerParty><Party><PartyIdentification><ID>11111111</ID></PartyIdentification><PartyName><Name>Placeholder Customer</Name></PartyName><PostalAddress><StreetName>Placeholder</StreetName><BuildingNumber>2</BuildingNumber><CityName>Placeholder</CityName><PostalZone>00000</PostalZone><Country><IdentificationCode>CZ</IdentificationCode><Name/></Country></PostalAddress></Party></AccountingCustomerParty>
  <InvoiceLines>
    <InvoiceLine>
      <ID>1</ID>
      <InvoicedQuantity unitCode="ks">3</InvoicedQuantity>
      <LineExtensionAmountCurr>0</LineExtensionAmountCurr>
      <LineExtensionAmount>3000</LineExtensionAmount>
      <LineExtensionAmountTaxInclusiveCurr>0</LineExtensionAmountTaxInclusiveCurr>
      <LineExtensionAmountTaxInclusive>3630</LineExtensionAmountTaxInclusive>
      <LineExtensionTaxAmount>630</LineExtensionTaxAmount>
      <UnitPrice>1000</UnitPrice>
      <UnitPriceTaxInclusive>1210</UnitPriceTaxInclusive>
      <ClassifiedTaxCategory><Percent>21</Percent><VATCalculationMethod>0</VATCalculationMethod></ClassifiedTaxCategory>
      <Item><Description>Placeholder item</Description></Item>
    </InvoiceLine>
    <InvoiceLine>
      <ID>2</ID>
      <InvoicedQuantity unitCode="ks">1</InvoicedQuantity>
      <LineExtensionAmountCurr>0</LineExtensionAmountCurr>
      <LineExtensionAmount>99.50</LineExtensionAmount>
      <LineExtensionAmountTaxInclusiveCurr>0</LineExtensionAmountTaxInclusiveCurr>
      <LineExtensionAmountTaxInclusive>111.44</LineExtensionAmountTaxInclusive>
      <LineExtensionTaxAmount>11.94</LineExtensionTaxAmount>
      <UnitPrice>99.50</UnitPrice>
      <UnitPriceTaxInclusive>111.44</UnitPriceTaxInclusive>
      <ClassifiedTaxCategory><Percent>12</Percent><VATCalculationMethod>0</VATCalculationMethod></ClassifiedTaxCategory>
      <Item><Description>Placeholder material</Description></Item>
    </InvoiceLine>
  </InvoiceLines>
  <NonTaxedDeposits>
    <NonTaxedDeposit><ID>ZF-1</ID><VariableSymbol>2601</VariableSymbol><DepositAmountCurr>0</DepositAmountCurr><DepositAmount>500</DepositAmount></NonTaxedDeposit>
  </NonTaxedDeposits>
  <TaxedDeposits>
    <TaxedDeposit><ID>ZL-1</ID><VariableSymbol>2602</VariableSymbol><TaxableDepositAmountCurr>0</TaxableDepositAmountCurr><TaxableDepositAmount>1000</TaxableDepositAmount><TaxInclusiveDepositAmountCurr>0</TaxInclusiveDepositAmountCurr><TaxInclusiveDepositAmount>1210</TaxInclusiveDepositAmount><ClassifiedTaxCategory><Percent>21</Percent><VATCalculationMethod>0</VATCalculationMethod></ClassifiedTaxCategory></TaxedDeposit>
  </TaxedDeposits>
  <TaxTotal>
    <TaxSubTotal><TaxableAmountCurr>0</TaxableAmountCurr><TaxableAmount>3000</TaxableAmount><TaxAmountCurr>0</TaxAmountCurr><TaxAmount>630</TaxAmount><TaxInclusiveAmountCurr>0</TaxInclusiveAmountCurr><TaxInclusiveAmount>3630</TaxInclusiveAmount><AlreadyClaimedTaxableAmountCurr>0</AlreadyClaimedTaxableAmountCurr><AlreadyClaimedTaxableAmount>1000</AlreadyClaimedTaxableAmount><AlreadyClaimedTaxAmountCurr>0</AlreadyClaimedTaxAmountCurr><AlreadyClaimedTaxAmount>210</AlreadyClaimedTaxAmount><AlreadyClaimedTaxInclusiveAmountCurr>0</AlreadyClaimedTaxInclusiveAmountCurr><AlreadyClaimedTaxInclusiveAmount>1210</AlreadyClaimedTaxInclusiveAmount><DifferenceTaxableAmountCurr>0</DifferenceTaxableAmountCurr><DifferenceTaxableAmount>2000</DifferenceTaxableAmount><DifferenceTaxAmountCurr>0</DifferenceTaxAmountCurr><DifferenceTaxAmount>420</DifferenceTaxAmount><DifferenceTaxInclusiveAmountCurr>0</DifferenceTaxInclusiveAmountCurr><DifferenceTaxInclusiveAmount>2420</DifferenceTaxInclusiveAmount><TaxCategory><Percent>21</Percent></TaxCategory></TaxSubTotal>
    <TaxSubTotal><TaxableAmountCurr>0</TaxableAmountCurr><TaxableAmount>99.50</TaxableAmount><TaxAmountCurr>0</TaxAmountCurr><TaxAmount>11.94</TaxAmount><TaxInclusiveAmountCurr>0</TaxInclusiveAmountCurr><TaxInclusiveAmount>111.44</TaxInclusiveAmount><AlreadyClaimedTaxableAmountCurr>0</AlreadyClaimedTaxableAmountCurr><AlreadyClaimedTaxableAmount>0</AlreadyClaimedTaxableAmount><AlreadyClaimedTaxAmountCurr>0</AlreadyClaimedTaxAmountCurr><AlreadyClaimedTaxAmount>0</AlreadyClaimedTaxAmount><AlreadyClaimedTaxInclusiveAmountCurr>0</AlreadyClaimedTaxInclusiveAmountCurr><AlreadyClaimedTaxInclusiveAmount>0</AlreadyClaimedTaxInclusiveAmount><DifferenceTaxableAmountCurr>0</DifferenceTaxableAmountCurr><DifferenceTaxableAmount>99.50</DifferenceTaxableAmount><DifferenceTaxAmountCurr>0</DifferenceTaxAmountCurr><DifferenceTaxAmount>11.94</DifferenceTaxAmount><DifferenceTaxInclusiveAmountCurr>0</DifferenceTaxInclusiveAmountCurr><DifferenceTaxInclusiveAmount>111.44</DifferenceTaxInclusiveAmount><TaxCategory><Percent>12</Percent></TaxCategory></TaxSubTotal>
    <TaxAmountCurr>0</TaxAmountCurr>
    <TaxAmount>641.94</TaxAmount>
  </TaxTotal>
  <LegalMonetaryTotal>
    <TaxExclusiveAmount>3099.50</TaxExclusiveAmount>
    <TaxExclusiveAmountCurr>0</TaxExclusiveAmountCurr>
    <TaxInclusiveAmount>3741.44</TaxInclusiveAmount>
    <TaxInclusiveAmountCurr>0</TaxInclusiveAmountCurr>
    <AlreadyClaimedTaxExclusiveAmount>1000</AlreadyClaimedTaxExclusiveAmount>
    <AlreadyClaimedTaxExclusiveAmountCurr>0</AlreadyClaimedTaxExclusiveAmountCurr>
    <AlreadyClaimedTaxInclusiveAmount>1210</AlreadyClaimedTaxInclusiveAmount>
    <AlreadyClaimedTaxInclusiveAmountCurr>0</AlreadyClaimedTaxInclusiveAmountCurr>
    <DifferenceTaxExclusiveAmount>2099.50</DifferenceTaxExclusiveAmount>
    <DifferenceTaxExclusiveAmountCurr>0</DifferenceTaxExclusiveAmountCurr>
    <DifferenceTaxInclusiveAmount>2531.44</DifferenceTaxInclusiveAmount>
    <DifferenceTaxInclusiveAmountCurr>0</DifferenceTaxInclusiveAmountCurr>
    <PayableRoundingAmount>-0.44</PayableRoundingAmount>
    <PayableRoundingAmountCurr>0</PayableRoundingAmountCurr>
    <PaidDepositsAmount>500</PaidDepositsAmount>
    <PaidDepositsAmountCurr>0</PaidDepositsAmountCurr>
    <PayableAmount>2031</PayableAmount>
    <PayableAmountCurr>0</PayableAmountCurr>
  </LegalMonetaryTotal>
  <PaymentMeans><Payment><PaidAmount>2031</PaidAmount><PaymentMeansCode>42</PaymentMeansCode><Details><PaymentDueDate>2026-09-24</PaymentDueDate><ID>000000-0000000000</ID><BankCode>0000</BankCode><Name/><VariableSymbol>260100001</VariableSymbol></Details></Payment></PaymentMeans>
</Invoice>`);
}

export interface ZipEntryFixture {
  // Overrides of the central-directory values, for the reader's refusal paths.
  centralCompressedSize?: number;
  centralSize?: number;
  crc?: number;
  data: Buffer;
  diskStart?: number;
  flags?: number;
  localName?: Buffer | string;
  localOffset?: number;
  method?: 0 | 8;
  name: Buffer | string;
}

export interface ZipFixtureOptions {
  centralDisk?: number;
  centralOffset?: number;
  comment?: Buffer;
  disk?: number;
  diskEntries?: number;
  entries?: number;
  zip64Locator?: boolean;
}

// A byte-exact zip writer: sizes and CRC are computed unless an entry overrides the central value.
export function zipArchive(
  entries: readonly ZipEntryFixture[],
  options: ZipFixtureOptions = {},
): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const localName = Buffer.from(entry.localName ?? entry.name);
    const method = entry.method ?? 8;
    const payload = method === 8 ? deflateRawSync(entry.data) : entry.data;
    const crc = entry.crc ?? crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.flags ?? 0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(localName.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.flags ?? 0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.centralCompressedSize ?? payload.length, 20);
    central.writeUInt32LE(entry.centralSize ?? entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(entry.diskStart ?? 0, 34);
    central.writeUInt32LE(entry.localOffset ?? offset, 42);
    locals.push(local, localName, payload);
    centrals.push(central, name);
    offset += local.length + localName.length + payload.length;
  }

  const directory = Buffer.concat(centrals);
  const comment = options.comment ?? Buffer.alloc(0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(options.disk ?? 0, 4);
  end.writeUInt16LE(options.centralDisk ?? 0, 6);
  end.writeUInt16LE(
    options.diskEntries ?? options.entries ?? entries.length,
    8,
  );
  end.writeUInt16LE(options.entries ?? entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(options.centralOffset ?? offset, 16);
  end.writeUInt16LE(comment.length, 20);
  const locator = Buffer.alloc(options.zip64Locator === true ? 20 : 0);

  if (options.zip64Locator === true) {
    locator.writeUInt32LE(0x07064b50, 0);
  }

  return Buffer.concat([...locals, directory, locator, end, comment]);
}

export function isdocManifest(filename: string, extra = ''): Buffer {
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?><manifest xmlns="http://isdoc.cz/namespace/2013/manifest"><maindocument filename="${filename}"/>${extra}</manifest>`,
  );
}
