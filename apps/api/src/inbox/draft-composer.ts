import type { InboxCorrectionField, InboxCorrectionSource } from '@bap/db';

import { DOCUMENT_KINDS } from '../documents/contract.js';
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

export interface ComposedDocument {
  draft: ComposedDocumentDraft;
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

// Precedence per field is hint, rule, target default, provider; the rules come in priority order, first writer wins.
export function composeDocumentDraft(
  item: DraftSourceItem,
  matchedRules: readonly InboxRuleDefinition[],
  effectiveTarget: InboxRoutingTarget,
): ComposedDocument {
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
  }

  const title = (item.primaryFilename ?? item.detectedType ?? 'unknown')
    .trim()
    .slice(0, MAX_TITLE_LENGTH);
  const draft: ComposedDocumentDraft = {
    currencyCode: DEFAULT_DRAFT_CURRENCY,
    documentDate: item.receivedAt.slice(0, 10),
    kind,
    legalEntityId,
    partnerId,
    reference: null,
    title: title.length > 0 ? title : 'unknown',
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

  return { draft, missing, sources };
}

// The composed draft as the create body the documents contract parses; a null partner is left out, not sent.
export function toCreateDocumentBody(draft: ComposedDocumentDraft): unknown {
  return {
    currencyCode: draft.currencyCode,
    documentDate: draft.documentDate,
    kind: draft.kind,
    legalEntityId: draft.legalEntityId,
    ...(draft.partnerId === null ? {} : { partnerId: draft.partnerId }),
    title: draft.title,
  };
}
