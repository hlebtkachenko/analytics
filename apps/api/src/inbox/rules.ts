import type { InboxDiscardReason } from '@bap/db';

import { INVOICE_KINDS } from '../documents/contract.js';
import type { ProviderReason } from './contract.js';

// createDocumentRequestSchema refuses an invoice kind without invoice content no 1b provider supplies,
// so a rule that auto-routes into an invoice kind is not available yet.
export function isInvoiceAutoRoute(rule: {
  autoRoute: boolean;
  setDocumentKind: string | null;
}): boolean {
  return (
    rule.autoRoute &&
    rule.setDocumentKind !== null &&
    INVOICE_KINDS.includes(
      rule.setDocumentKind as (typeof INVOICE_KINDS)[number],
    )
  );
}

// The columns app.list_inbox_rules() returns: conditions, actions, id and priority, nothing else.
export interface InboxRuleDefinition {
  autoRoute: boolean;
  channelId: string | null;
  detectedType: string | null;
  discardReason: InboxDiscardReason | null;
  id: string;
  keyword: string | null;
  priority: number;
  senderPattern: string | null;
  setAssigneeId: string | null;
  setDocumentKind: string | null;
  setLegalEntityId: string | null;
  setPartnerId: string | null;
}

// What the item already knows when the pass runs; the email subject is never stored, so it is not a source.
export interface RuleFacts {
  channelId: string | null;
  detectedType: string | null;
  filename: string | null;
  hintText: string | null;
  // The lowercased envelope sender of an email child; null for every other item.
  sender: string | null;
  // The body text of a text payload, at most MAX_TEXT_BYTES, read outside the transaction.
  text: string | null;
}

export type RuleActionField =
  'assigneeId' | 'documentKind' | 'legalEntityId' | 'partnerId';

export interface RuleActionValue {
  ruleId: string;
  value: string;
}

export interface RuleEvaluation {
  // Set by the first matched rule that asks; that rule decides the route.
  autoRouteRuleId: string | null;
  // The first discard rule met; nothing after it runs.
  discard: { reason: InboxDiscardReason; ruleId: string } | null;
  // First-writer-wins per field across the matched rules in priority order.
  fields: Record<RuleActionField, RuleActionValue | null>;
  // Every rule that matched, in priority order, up to and including a discard.
  matched: InboxRuleDefinition[];
}

const EMPTY_FIELDS: RuleEvaluation['fields'] = {
  assigneeId: null,
  documentKind: null,
  legalEntityId: null,
  partnerId: null,
};

// A full address matches exactly; an @domain pattern matches the sender's suffix from its own @.
export function senderMatches(pattern: string, sender: string | null): boolean {
  if (sender === null) {
    return false;
  }

  const lowered = sender.toLowerCase();

  if (!pattern.startsWith('@')) {
    return lowered === pattern;
  }

  const at = lowered.indexOf('@');
  return at >= 0 && lowered.slice(at) === pattern;
}

function keywordMatches(keyword: string, facts: RuleFacts): boolean {
  const needle = keyword.toLowerCase();

  return [facts.filename, facts.hintText, facts.text].some(
    (text) => text !== null && text.toLowerCase().includes(needle),
  );
}

// Every non-null condition must hold.
export function ruleMatches(
  rule: InboxRuleDefinition,
  facts: RuleFacts,
): boolean {
  if (rule.channelId !== null && rule.channelId !== facts.channelId) {
    return false;
  }

  if (
    rule.senderPattern !== null &&
    !senderMatches(rule.senderPattern, facts.sender)
  ) {
    return false;
  }

  if (rule.keyword !== null && !keywordMatches(rule.keyword, facts)) {
    return false;
  }

  return rule.detectedType === null || rule.detectedType === facts.detectedType;
}

export function evaluateRules(
  rules: readonly InboxRuleDefinition[],
  facts: RuleFacts,
): RuleEvaluation {
  const ordered = [...rules].sort((a, b) => a.priority - b.priority);
  const fields: RuleEvaluation['fields'] = { ...EMPTY_FIELDS };
  const matched: InboxRuleDefinition[] = [];
  let autoRouteRuleId: string | null = null;

  for (const rule of ordered) {
    if (!ruleMatches(rule, facts)) {
      continue;
    }

    matched.push(rule);

    if (rule.discardReason !== null) {
      return {
        autoRouteRuleId: null,
        discard: { reason: rule.discardReason, ruleId: rule.id },
        fields,
        matched,
      };
    }

    const actions: [RuleActionField, string | null][] = [
      ['legalEntityId', rule.setLegalEntityId],
      ['documentKind', rule.setDocumentKind],
      ['partnerId', rule.setPartnerId],
      ['assigneeId', rule.setAssigneeId],
    ];

    for (const [field, value] of actions) {
      if (value !== null && fields[field] === null) {
        fields[field] = { ruleId: rule.id, value };
      }
    }

    if (rule.autoRoute && autoRouteRuleId === null) {
      autoRouteRuleId = rule.id;
    }
  }

  return { autoRouteRuleId, discard: null, fields, matched };
}

// The matched conditions of one rule in words, for the reasons a person reads.
export function describeConditions(rule: InboxRuleDefinition): string {
  const parts: string[] = [];

  if (rule.channelId !== null) {
    parts.push(`channel ${rule.channelId}`);
  }

  if (rule.senderPattern !== null) {
    parts.push(`sender ${rule.senderPattern}`);
  }

  if (rule.keyword !== null) {
    parts.push(`keyword "${rule.keyword}"`);
  }

  if (rule.detectedType !== null) {
    parts.push(`type ${rule.detectedType}`);
  }

  return parts.join(', ');
}

// The action order of the sentences: entity, kind, partner, assignee.
const FIELD_LABELS: Record<RuleActionField, string> = {
  legalEntityId: 'legal entity',
  documentKind: 'kind',
  partnerId: 'partner',
  assigneeId: 'assignee',
};

export interface RuleReasonInput {
  evaluation: RuleEvaluation;
  // The fields the pass actually applied; a hint or an earlier value keeps a rule action out of the item.
  applied: Partial<Record<RuleActionField, boolean>>;
}

// One sentence per action in priority order, then the discard or the auto-route, each naming its rule.
export function ruleReasons(input: RuleReasonInput): ProviderReason[] {
  const { evaluation } = input;
  const byRule = new Map(evaluation.matched.map((rule) => [rule.id, rule]));
  const reasons: ProviderReason[] = [];
  const sentence = (ruleId: string, action: string): ProviderReason => {
    const rule = byRule.get(ruleId);
    const label =
      rule === undefined
        ? `rule ${ruleId}`
        : `rule ${rule.priority}: ${describeConditions(rule)}`;
    return {
      evidence: `${label} ${action}`.slice(0, 500),
      step: 'rule',
      weight: 1,
    };
  };

  for (const rule of evaluation.matched) {
    for (const field of Object.keys(FIELD_LABELS) as RuleActionField[]) {
      const value = evaluation.fields[field];

      if (value === null || value.ruleId !== rule.id) {
        continue;
      }

      const outcome =
        input.applied[field] === false
          ? `would set ${FIELD_LABELS[field]} ${value.value}, kept the earlier value`
          : `sets ${FIELD_LABELS[field]} ${value.value}`;
      reasons.push(sentence(rule.id, outcome));
    }
  }

  if (evaluation.discard !== null) {
    reasons.push(
      sentence(
        evaluation.discard.ruleId,
        `discards the item as ${evaluation.discard.reason}`,
      ),
    );
  }

  if (evaluation.autoRouteRuleId !== null) {
    reasons.push(sentence(evaluation.autoRouteRuleId, 'routes automatically'));
  }

  // A rule that matched and applied nothing still leaves its trace.
  for (const rule of evaluation.matched) {
    if (
      !reasons.some((reason) =>
        reason.evidence.startsWith(`rule ${rule.priority}:`),
      )
    ) {
      reasons.push(sentence(rule.id, 'matched'));
    }
  }

  return reasons;
}
