import type { InboxCorrectionField, InboxCorrectionSource } from '@bap/db';

import { DOCUMENT_KINDS, INVOICE_KINDS } from '../documents/contract.js';
import type { InboxItem, InboxRoutingTarget } from './contract.js';
import type { InboxRuleDefinition } from './rules.js';

export const DEFAULT_DRAFT_CURRENCY = 'CZK';
const MAX_TITLE_LENGTH = 200;

type DocumentKind = (typeof DOCUMENT_KINDS)[number];

// The item fields the composer reads, plus the first file's name the list already carries.
export type DraftSourceItem = Pick<
  InboxItem,
  | 'detectedType'
  | 'hintKind'
  | 'hintLegalEntityId'
  | 'hintPartnerId'
  | 'legalEntityId'
  | 'receivedAt'
> & { primaryFilename: string | null };

export interface ComposedDocumentDraft {
  currencyCode: string;
  documentDate: string;
  kind: DocumentKind | null;
  legalEntityId: string | null;
  partnerId: string | null;
  reference: string | null;
  title: string;
}

// The newest isdoc row as the composer reads it; its draft is the stored JSON, narrowed field by field.
export interface ParsedLayer {
  draft: Record<string, unknown>;
  legalEntityId: string | null;
}

// The content a parsed file carries beyond the correctable header fields; copied, never edited in the Inbox.
export interface DraftContent {
  attributes: Record<string, string> | null;
  invoice: Record<string, unknown> | null;
  totalAmount: string | null;
}

const NO_CONTENT: DraftContent = {
  attributes: null,
  invoice: null,
  totalAmount: null,
};

export interface ComposedDocument {
  content: DraftContent;
  draft: ComposedDocumentDraft;
  // Where parsed item lines got their category; null when no line took one.
  lineCategorySource: 'partner_default' | null;
  // The required fields the draft leaves empty: the destination's own plus the target's requiredFields.
  missing: string[];
  // Where each suggested value came from, so a correction can name it; null when nothing was suggested.
  sources: Record<InboxCorrectionField, InboxCorrectionSource | null>;
}

function documentKindOf(token: string | null): DocumentKind | null {
  return DOCUMENT_KINDS.find((kind) => kind === token) ?? null;
}

// The draft field a correction row names, keyed by the draft property.
export const CORRECTION_FIELD_BY_DRAFT_KEY: Record<
  keyof ComposedDocumentDraft,
  InboxCorrectionField
> = {
  currencyCode: 'currency_code',
  documentDate: 'document_date',
  kind: 'kind',
  legalEntityId: 'legal_entity_id',
  partnerId: 'partner_id',
  reference: 'reference',
  title: 'title',
};

function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function isInvoiceKind(kind: string | null): boolean {
  return INVOICE_KINDS.some((invoiceKind) => invoiceKind === kind);
}

// Precedence for kind and entity is hint, rule, parse, target default: the parsed kind is a fact from the file,
// so it outranks the target default. Partner is hint, rule, parse. The rules come in priority order.
export function composeDocumentDraft(
  item: DraftSourceItem,
  matchedRules: readonly InboxRuleDefinition[],
  effectiveTarget: InboxRoutingTarget,
  parsed: ParsedLayer | null = null,
): ComposedDocument {
  const parsedDraft = parsed?.draft ?? {};
  const parsedKind = documentKindOf(stringOf(parsedDraft.kind));
  const parsedPartner = stringOf(parsedDraft.partnerId);
  const rules = [...matchedRules].sort((a, b) => a.priority - b.priority);
  const ruleKind = rules.find((rule) => rule.setDocumentKind !== null);
  const ruleEntity = rules.find((rule) => rule.setLegalEntityId !== null);
  const rulePartner = rules.find((rule) => rule.setPartnerId !== null);
  const sources: ComposedDocument['sources'] = {
    currency_code: 'provider',
    document_date: 'provider',
    kind: null,
    legal_entity_id: null,
    partner_id: null,
    reference: null,
    title: 'provider',
  };

  let kind = documentKindOf(item.hintKind);
  if (kind !== null) {
    sources.kind = 'hint';
  } else if (ruleKind !== undefined) {
    kind = documentKindOf(ruleKind.setDocumentKind);
    sources.kind = 'rule';
  } else if (parsedKind !== null) {
    kind = parsedKind;
    sources.kind = 'provider';
  } else if (effectiveTarget.documentKind !== null) {
    kind = effectiveTarget.documentKind;
    sources.kind = 'target_default';
  }

  // The item's own entity is the standing channel hint copied at intake, so it counts as a hint.
  let legalEntityId = item.hintLegalEntityId ?? item.legalEntityId;
  if (legalEntityId !== null) {
    sources.legal_entity_id = 'hint';
  } else if (ruleEntity !== undefined) {
    legalEntityId = ruleEntity.setLegalEntityId;
    sources.legal_entity_id = 'rule';
  } else if (parsed !== null && parsed.legalEntityId !== null) {
    legalEntityId = parsed.legalEntityId;
    sources.legal_entity_id = 'provider';
  } else if (effectiveTarget.defaultLegalEntityId !== null) {
    legalEntityId = effectiveTarget.defaultLegalEntityId;
    sources.legal_entity_id = 'target_default';
  }

  let partnerId = item.hintPartnerId;
  if (partnerId !== null) {
    sources.partner_id = 'hint';
  } else if (rulePartner !== undefined) {
    partnerId = rulePartner.setPartnerId;
    sources.partner_id = 'rule';
  } else if (parsedPartner !== null) {
    partnerId = parsedPartner;
    sources.partner_id = 'provider';
  }

  const reference = stringOf(parsedDraft.reference);

  if (reference !== null) {
    sources.reference = 'provider';
  }

  const title = (
    stringOf(parsedDraft.title) ??
    item.primaryFilename ??
    item.detectedType ??
    'unknown'
  )
    .trim()
    .slice(0, MAX_TITLE_LENGTH);
  const draft: ComposedDocumentDraft = {
    currencyCode: stringOf(parsedDraft.currencyCode) ?? DEFAULT_DRAFT_CURRENCY,
    documentDate:
      stringOf(parsedDraft.documentDate) ?? item.receivedAt.slice(0, 10),
    kind,
    legalEntityId,
    partnerId,
    reference,
    title: title.length > 0 ? title : 'unknown',
  };
  // A hint or rule kind that is not an invoice kind drops the invoice block; the rest of the content stays.
  const invoice = recordOf(parsedDraft.invoice);
  const attributes = recordOf(parsedDraft.attributes);
  const content: DraftContent =
    parsed === null
      ? NO_CONTENT
      : {
          attributes:
            attributes === null
              ? null
              : (Object.fromEntries(
                  Object.entries(attributes).filter(
                    ([, value]) => typeof value === 'string',
                  ),
                ) as Record<string, string>),
          invoice: isInvoiceKind(kind) ? invoice : null,
          totalAmount: stringOf(parsedDraft.totalAmount),
        };
  const missing: string[] = [];

  if (draft.kind === null) {
    missing.push('kind');
  }

  if (draft.legalEntityId === null) {
    missing.push('legalEntityId');
  }

  const values: Record<string, unknown> = { ...draft };

  for (const field of effectiveTarget.requiredFields) {
    const value = values[field];

    if ((value === undefined || value === null) && !missing.includes(field)) {
      missing.push(field);
    }
  }

  return { content, draft, lineCategorySource: null, missing, sources };
}

// The composed draft as the create body the documents contract parses; a null field is left out, not sent.
export function toCreateDocumentBody(
  draft: ComposedDocumentDraft,
  content: DraftContent = NO_CONTENT,
): unknown {
  return {
    ...(content.attributes === null ? {} : { attributes: content.attributes }),
    currencyCode: draft.currencyCode,
    documentDate: draft.documentDate,
    ...(content.invoice === null || !isInvoiceKind(draft.kind)
      ? {}
      : { invoice: content.invoice }),
    kind: draft.kind,
    legalEntityId: draft.legalEntityId,
    ...(draft.partnerId === null ? {} : { partnerId: draft.partnerId }),
    ...(draft.reference === null ? {} : { reference: draft.reference }),
    title: draft.title,
    ...(content.totalAmount === null
      ? {}
      : { totalAmount: content.totalAmount }),
  };
}

// Item lines of parsed content take one category; deduction lines keep none. Null leaves the content untouched.
export function withLineCategory(
  content: DraftContent,
  category: string | null,
): DraftContent {
  const lines = content.invoice?.lines;

  if (category === null || content.invoice === null || !Array.isArray(lines)) {
    return content;
  }

  return {
    ...content,
    invoice: {
      ...content.invoice,
      lines: lines.map((line: unknown) => {
        const record = recordOf(line);
        return record !== null && record.lineKind === 'item'
          ? { ...record, category }
          : line;
      }),
    },
  };
}
