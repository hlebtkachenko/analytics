// The Czech default rule set: changing a rule means a new version string and a re-derivation, never an edit of stored event lines.

import {
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
  IssueSeverity,
  VatMode,
} from './contract.js';

export const RULE_SET_VERSION = 'cz-default-2026-09';

// The receivable and the payable: the only accounts that carry the partner.
const RECEIVABLE_ACCOUNT = '311';
const PAYABLE_ACCOUNT = '321';
const VAT_ACCOUNT = '343';

const REVENUE_ACCOUNTS: Readonly<Record<InvoiceLineCategory, string>> = {
  asset: '641',
  goods: '604',
  material: '642',
  other: '648',
  services: '602',
};

const EXPENSE_ACCOUNTS: Readonly<Record<InvoiceLineCategory, string>> = {
  asset: '042',
  goods: '504',
  material: '501',
  other: '548',
  services: '518',
};

export interface DerivationLine {
  baseAmount: string;
  category: InvoiceLineCategory;
  description: string;
  id: string;
  vatAmount: string;
  vatMode: VatMode;
  vatRate: string;
}

export interface DerivationInput {
  kind: DocumentKind;
  lines: readonly DerivationLine[];
  partnerId: string | null;
}

export interface DerivedEventLine {
  accountCode: string;
  amount: string;
  description: string | null;
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
  amount: bigint;
  description: string;
  invoiceLineId: string;
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

function issuedLines(
  line: DerivationLine,
  partnerId: string | null,
): PendingLine[] {
  const base = parseDecimal(line.baseAmount);
  const vat =
    line.vatMode === 'standard' ? parseDecimal(line.vatAmount) : DECIMAL_ZERO;

  return [
    {
      accountCode: RECEIVABLE_ACCOUNT,
      amount: addDecimal(base, vat),
      description: line.description,
      invoiceLineId: line.id,
      partnerId,
      side: 'debit',
    },
    {
      accountCode: REVENUE_ACCOUNTS[line.category],
      amount: base,
      description: line.description,
      invoiceLineId: line.id,
      partnerId: null,
      side: 'credit',
    },
    {
      accountCode: VAT_ACCOUNT,
      amount: vat,
      description: line.description,
      invoiceLineId: line.id,
      partnerId: null,
      side: 'credit',
    },
  ];
}

function receivedLines(
  line: DerivationLine,
  partnerId: string | null,
): PendingLine[] {
  const base = parseDecimal(line.baseAmount);
  const vat =
    line.vatMode === 'standard' ? parseDecimal(line.vatAmount) : DECIMAL_ZERO;
  const reverseCharge =
    line.vatMode === 'reverse_charge' ? selfAssessedVat(line) : DECIMAL_ZERO;
  const common = {
    description: line.description,
    invoiceLineId: line.id,
  };

  return [
    {
      ...common,
      accountCode: EXPENSE_ACCOUNTS[line.category],
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
      partnerId,
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

// Returns null for every kind the rule set does not book; the caller then stores no event at all.
export function deriveEconomicEvent(
  input: DerivationInput,
): DerivedEvent | null {
  if (!EVENT_KINDS.includes(input.kind)) {
    return null;
  }

  const pending = input.lines.flatMap((line) =>
    input.kind === 'issued_invoice'
      ? issuedLines(line, input.partnerId)
      : receivedLines(line, input.partnerId),
  );
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
      amount: formatDecimal(candidate.amount),
      description: candidate.description,
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
