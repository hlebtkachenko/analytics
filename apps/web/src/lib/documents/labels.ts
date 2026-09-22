import type { StatusSeverity } from '../../components/status-indicator.tsx';

import type {
  DataIssue,
  DocumentKind,
  DocumentLinkKind,
  DocumentStatus,
  InvoiceLineCategory,
  InvoiceLineKind,
  VatMode,
} from './contract.ts';

// One translation key per contract value, so no page invents its own wording.
export const documentKindLabelKeys: Readonly<Record<DocumentKind, string>> = {
  agreement: 'documents.kindAgreement',
  bank_statement: 'documents.kindBankStatement',
  contract: 'documents.kindContract',
  credit_note: 'documents.kindCreditNote',
  hr_document: 'documents.kindHrDocument',
  issued_invoice: 'documents.kindIssuedInvoice',
  other: 'documents.kindOther',
  payroll: 'documents.kindPayroll',
  receipt: 'documents.kindReceipt',
  received_invoice: 'documents.kindReceivedInvoice',
  tax_filing: 'documents.kindTaxFiling',
};

export const documentStatusLabelKeys: Readonly<Record<DocumentStatus, string>> =
  {
    archived: 'documents.statusArchived',
    needs_review: 'documents.statusNeedsReview',
    registered: 'documents.statusRegistered',
    verified: 'documents.statusVerified',
  };

export const documentStatusSeverity: Readonly<
  Record<DocumentStatus, StatusSeverity>
> = {
  archived: 'neutral',
  needs_review: 'warning',
  registered: 'neutral',
  verified: 'success',
};

export const invoiceLineCategoryLabelKeys: Readonly<
  Record<InvoiceLineCategory, string>
> = {
  asset: 'documents.categoryAsset',
  goods: 'documents.categoryGoods',
  labour: 'documents.categoryLabour',
  material: 'documents.categoryMaterial',
  other: 'documents.categoryOther',
  services: 'documents.categoryServices',
  transport: 'documents.categoryTransport',
};

export const invoiceLineKindLabelKeys: Readonly<
  Record<InvoiceLineKind, string>
> = {
  advance_deduction: 'documents.lineKindAdvanceDeduction',
  item: 'documents.lineKindItem',
};

export const vatModeLabelKeys: Readonly<Record<VatMode, string>> = {
  exempt: 'documents.vatModeExempt',
  outside_scope: 'documents.vatModeOutsideScope',
  reverse_charge: 'documents.vatModeReverseCharge',
  standard: 'documents.vatModeStandard',
};

export const documentLinkKindLabelKeys: Readonly<
  Record<DocumentLinkKind, string>
> = {
  corrects: 'documents.linkCorrects',
  fulfills: 'documents.linkFulfills',
  relates: 'documents.linkRelates',
  settles: 'documents.linkSettles',
  supersedes: 'documents.linkSupersedes',
};

export const dataIssueLabelKeys: Readonly<Record<DataIssue['code'], string>> = {
  missing_partner: 'documents.issueMissingPartner',
  total_mismatch: 'documents.issueTotalMismatch',
  unbalanced_event: 'documents.issueUnbalancedEvent',
  unmapped_line: 'documents.issueUnmappedLine',
};
