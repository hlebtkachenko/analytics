// The list, detail and analytics pages all render a document kind through this one map.
import {
  Document,
  DocumentSigned,
  Finance,
  Money,
  Purchase,
  Receipt,
  Report,
  ShoppingCart,
  Undo,
  UserMultiple,
  Wallet,
} from '@bap/design-system/icons';
import type { DocumentKind } from './contract.ts';

type DocumentKindIcon = typeof Document;

export const DOCUMENT_KIND_ICONS: Record<DocumentKind, DocumentKindIcon> = {
  advance_request: Money,
  agreement: DocumentSigned,
  bank_statement: Finance,
  contract: DocumentSigned,
  credit_note: Undo,
  hr_document: UserMultiple,
  issued_invoice: Receipt,
  other: Document,
  payroll: Wallet,
  receipt: ShoppingCart,
  received_invoice: Purchase,
  tax_filing: Report,
};

export function documentKindIcon(kind: DocumentKind): DocumentKindIcon {
  return DOCUMENT_KIND_ICONS[kind] ?? Document;
}
