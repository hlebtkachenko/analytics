// The Czech default rule set: changing a rule means a new version string and a re-derivation, never an edit of stored event lines.

import {
  absDecimal,
  addDecimal,
  compareDecimal,
  DECIMAL_ZERO,
  formatDecimal,
  multiplyByRatePercent,
  parseDecimal,
} from './decimal.js';
import type {
  DataIssueCode,
  DocumentKind,
  EventSide,
  InvoiceLineCategory,
  InvoiceLineKind,
  IssueSeverity,
  VatMode,
} from './contract.js';

export const RULE_SET_VERSION = 'cz-default-2026-09.1';

// The receivable and the payable: the only accounts that carry the partner.
const RECEIVABLE_ACCOUNT = '311';
const PAYABLE_ACCOUNT = '321';
const VAT_ACCOUNT = '343';

// The advance already paid to a supplier and the one a customer already paid us.
const ADVANCE_PAID_ACCOUNT = '314';
const ADVANCE_RECEIVED_ACCOUNT = '324';

// A rounding difference has no supply behind it, so it books as an other expense or an other revenue.
const OTHER_EXPENSE_ACCOUNT = '548';
const OTHER_REVENUE_ACCOUNT = '648';

const REVENUE_ACCOUNTS: Readonly<Record<InvoiceLineCategory, string>> = {
  asset: '641',
  goods: '604',
  labour: '602',
  material: '642',
  other: '648',
  services: '602',
  transport: '602',
};

const EXPENSE_ACCOUNTS: Readonly<Record<InvoiceLineCategory, string>> = {
  asset: '042',
  goods: '504',
  labour: '518',
  material: '501',
  other: '548',
  services: '518',
  transport: '518',
};

export interface DerivationLine {
  activityCode: string | null;
  baseAmount: string;
  category: InvoiceLineCategory | null;
  description: string;
  id: string;
  lineKind: InvoiceLineKind;
  taxPointDate: string | null;
  vatAmount: string;
  vatMode: VatMode;
  vatRate: string;
}

export interface DerivationInput {
  documentDate: string;
  kind: DocumentKind;
  lines: readonly DerivationLine[];
  partnerId: string | null;
  roundingAmount: string;
  taxPointDate: string | null;
}

export interface DerivedEventLine {
  accountCode: string;
  activityCode: string | null;
  amount: string;
  description: string | null;
  effectiveDate: string;
  invoiceLineId: string | null;
  lineNo: number;
  partnerId: string | null;
  side: EventSide;
}

export interface DerivedIssue {
  code: DataIssueCode;
  detail: string | null;
  severity: IssueSeverity;
}

export interface DerivedEvent {
  creditTotal: string;
  debitTotal: string;
  isBalanced: boolean;
  issues: DerivedIssue[];
  lines: DerivedEventLine[];
}

interface PendingLine {
  accountCode: string;
  activityCode: string | null;
  amount: bigint;
  description: string | null;
  effectiveDate: string;
  invoiceLineId: string | null;
  partnerId: string | null;
  side: EventSide;
}

// A refund reverses nothing here: credit_note is its own kind, so no rule ever sees a negative invoice line.
const EVENT_KINDS: readonly DocumentKind[] = [
  'issued_invoice',
  'received_invoice',
];

// A reverse charge line stores no VAT, so the self-assessed amount is computed from the rate.
function selfAssessedVat(line: DerivationLine): bigint {
  return multiplyByRatePercent(
    parseDecimal(line.baseAmount),
    parseDecimal(line.vatRate),
  );
}

// Only a standard line carries a stored VAT amount; every other mode books its VAT elsewhere or not at all.
function storedVat(line: DerivationLine): bigint {
  return line.vatMode === 'standard'
    ? parseDecimal(line.vatAmount)
    : DECIMAL_ZERO;
}

// An item line always carries a category by check constraint, and a deduction line never reaches these maps.
function revenueAccount(line: DerivationLine): string {
  return REVENUE_ACCOUNTS[line.category ?? 'other'];
}

function expenseAccount(line: DerivationLine): string {
  return EXPENSE_ACCOUNTS[line.category ?? 'other'];
}

// The tax point of the supply, with the invoice and then the document date behind it.
function effectiveDate(line: DerivationLine, input: DerivationInput): string {
  return line.taxPointDate ?? input.taxPointDate ?? input.documentDate;
}

function issuedItemLines(
  line: DerivationLine,
  input: DerivationInput,
  common: Omit<PendingLine, 'accountCode' | 'amount' | 'partnerId' | 'side'>,
): PendingLine[] {
  const base = parseDecimal(line.baseAmount);
  const vat = storedVat(line);

  return [
    {
      ...common,
      accountCode: RECEIVABLE_ACCOUNT,
      amount: addDecimal(base, vat),
      partnerId: input.partnerId,
      side: 'debit',
    },
    {
      ...common,
      accountCode: revenueAccount(line),
      amount: base,
      partnerId: null,
      side: 'credit',
    },
    {
      ...common,
      accountCode: VAT_ACCOUNT,
      amount: vat,
      partnerId: null,
      side: 'credit',
    },
  ];
}

// Settling an advance we already invoiced: the receivable falls and the prepayment we hold is consumed.
function issuedAdvanceLines(
  line: DerivationLine,
  input: DerivationInput,
  common: Omit<PendingLine, 'accountCode' | 'amount' | 'partnerId' | 'side'>,
): PendingLine[] {
  const base = parseDecimal(line.baseAmount);
  const vat = storedVat(line);

  return [
    {
      ...common,
      accountCode: ADVANCE_RECEIVED_ACCOUNT,
      amount: base,
      partnerId: null,
      side: 'debit',
    },
    {
      ...common,
      accountCode: VAT_ACCOUNT,
      amount: vat,
      partnerId: null,
      side: 'debit',
    },
    {
      ...common,
      accountCode: RECEIVABLE_ACCOUNT,
      amount: addDecimal(base, vat),
      partnerId: input.partnerId,
      side: 'credit',
    },
  ];
}

function receivedItemLines(
  line: DerivationLine,
  input: DerivationInput,
  common: Omit<PendingLine, 'accountCode' | 'amount' | 'partnerId' | 'side'>,
): PendingLine[] {
  const base = parseDecimal(line.baseAmount);
  const vat = storedVat(line);
  const reverseCharge =
    line.vatMode === 'reverse_charge' ? selfAssessedVat(line) : DECIMAL_ZERO;

  return [
    {
      ...common,
      accountCode: expenseAccount(line),
      amount: base,
      partnerId: null,
      side: 'debit',
    },
    {
      ...common,
      accountCode: VAT_ACCOUNT,
      amount: vat,
      partnerId: null,
      side: 'debit',
    },
    {
      ...common,
      accountCode: PAYABLE_ACCOUNT,
      amount: addDecimal(base, vat),
      partnerId: input.partnerId,
      side: 'credit',
    },
    // Self-assessment puts the same amount on both sides, so a reverse charge line never moves the balance.
    {
      ...common,
      accountCode: VAT_ACCOUNT,
      amount: reverseCharge,
      partnerId: null,
      side: 'debit',
    },
    {
      ...common,
      accountCode: VAT_ACCOUNT,
      amount: reverseCharge,
      partnerId: null,
      side: 'credit',
    },
  ];
}

// The payable falls by the deducted advance; a non-standard advance carries no VAT, so its VAT leg is empty and dropped.
function receivedAdvanceLines(
  line: DerivationLine,
  input: DerivationInput,
  common: Omit<PendingLine, 'accountCode' | 'amount' | 'partnerId' | 'side'>,
): PendingLine[] {
  const base = parseDecimal(line.baseAmount);
  const vat = storedVat(line);

  return [
    {
      ...common,
      accountCode: PAYABLE_ACCOUNT,
      amount: addDecimal(base, vat),
      partnerId: input.partnerId,
      side: 'debit',
    },
    {
      ...common,
      accountCode: ADVANCE_PAID_ACCOUNT,
      amount: base,
      partnerId: null,
      side: 'credit',
    },
    {
      ...common,
      accountCode: VAT_ACCOUNT,
      amount: vat,
      partnerId: null,
      side: 'credit',
    },
  ];
}

function bookLine(line: DerivationLine, input: DerivationInput): PendingLine[] {
  const common = {
    activityCode: line.activityCode,
    description: line.description,
    effectiveDate: effectiveDate(line, input),
    invoiceLineId: line.id,
  };

  if (input.kind === 'issued_invoice') {
    return line.lineKind === 'advance_deduction'
      ? issuedAdvanceLines(line, input, common)
      : issuedItemLines(line, input, common);
  }

  return line.lineKind === 'advance_deduction'
    ? receivedAdvanceLines(line, input, common)
    : receivedItemLines(line, input, common);
}

// The rounding belongs to the invoice as a whole: no line, no activity, and the invoice tax point as its date.
function roundingLines(input: DerivationInput): PendingLine[] {
  const rounding = parseDecimal(input.roundingAmount);

  if (rounding === DECIMAL_ZERO) {
    return [];
  }

  const common = {
    activityCode: null,
    amount: absDecimal(rounding),
    description: null,
    effectiveDate: input.taxPointDate ?? input.documentDate,
    invoiceLineId: null,
  };
  const issued = input.kind === 'issued_invoice';
  const counterparty = issued ? RECEIVABLE_ACCOUNT : PAYABLE_ACCOUNT;
  // Rounded up means a larger receivable on an issued invoice and a larger payable on a received one.
  const counterpartyOnDebit = rounding > DECIMAL_ZERO === issued;

  return [
    {
      ...common,
      accountCode: counterpartyOnDebit ? counterparty : OTHER_EXPENSE_ACCOUNT,
      partnerId: counterpartyOnDebit ? input.partnerId : null,
      side: 'debit',
    },
    {
      ...common,
      accountCode: counterpartyOnDebit ? OTHER_REVENUE_ACCOUNT : counterparty,
      partnerId: counterpartyOnDebit ? null : input.partnerId,
      side: 'credit',
    },
  ];
}

// Returns null for every kind the rule set does not book; the caller then stores no event at all.
export function deriveEconomicEvent(
  input: DerivationInput,
): DerivedEvent | null {
  if (!EVENT_KINDS.includes(input.kind)) {
    return null;
  }

  const pending = [
    ...input.lines.flatMap((line) => bookLine(line, input)),
    ...roundingLines(input),
  ];
  const lines: DerivedEventLine[] = [];
  let debitTotal = DECIMAL_ZERO;
  let creditTotal = DECIMAL_ZERO;

  for (const candidate of pending) {
    // Every input amount is non-negative by contract, so only an exactly empty leg is dropped and nothing else is lost.
    if (candidate.amount === DECIMAL_ZERO) {
      continue;
    }

    if (candidate.side === 'debit') {
      debitTotal = addDecimal(debitTotal, candidate.amount);
    } else {
      creditTotal = addDecimal(creditTotal, candidate.amount);
    }

    lines.push({
      accountCode: candidate.accountCode,
      activityCode: candidate.activityCode,
      amount: formatDecimal(candidate.amount),
      description: candidate.description,
      effectiveDate: candidate.effectiveDate,
      invoiceLineId: candidate.invoiceLineId,
      lineNo: lines.length + 1,
      partnerId: candidate.partnerId,
      side: candidate.side,
    });
  }

  const isBalanced = compareDecimal(debitTotal, creditTotal) === 0;
  const issues: DerivedIssue[] = [];

  if (!isBalanced) {
    issues.push({
      code: 'unbalanced_event',
      detail: `Debit ${formatDecimal(debitTotal)} does not equal credit ${formatDecimal(creditTotal)}`,
      severity: 'error',
    });
  }

  if (input.partnerId === null) {
    issues.push({
      code: 'missing_partner',
      detail:
        'The invoice carries no partner, so the receivable or payable is unattributed',
      severity: 'warning',
    });
  }

  return {
    creditTotal: formatDecimal(creditTotal),
    debitTotal: formatDecimal(debitTotal),
    isBalanced,
    issues,
    lines,
  };
}
