import { BadRequestException } from '@nestjs/common';
import { runInTenantContext } from '@bap/db';
import type { InboxDiscardReason, TenantContext } from '@bap/db';
import type { DatabasePool } from '@bap/db/pool';
import type { PoolClient } from 'pg';

import type { EntityScopeSelector } from '../datasets/dataset-repository.js';
import { entityFilter } from '../documents/sql.js';
import {
  MAX_ENABLED_INBOX_RULES,
  RULE_PROVIDER,
  RULE_PROVIDER_VERSION,
  ruleDraftSchema,
} from './contract.js';
import type {
  CreateInboxRuleRequest,
  InboxExtraction,
  InboxItem,
  InboxRoutingTarget,
  InboxRule,
  RouteInboxItemJob,
  RuleDraft,
  UpdateInboxRuleRequest,
} from './contract.js';
import {
  composeDocumentDraft,
  isInvoiceKind,
  type ComposedDocument,
  type ParsedLayer,
} from './draft-composer.js';
import {
  appendEvent,
  insertExtraction,
  isForeignKeyViolation,
  loadItem,
  loadItemFiles,
  loadLatestExtraction,
  loadRoutingTargetOverrides,
} from './inbox-repository-support.js';
import { loadParsedDraft } from './parsed-draft.js';
import { ADVANCE_TAX_DOCUMENT_TYPE } from './providers/isdoc.js';
import {
  evaluateRules,
  ruleReasons,
  type InboxRuleDefinition,
  type RuleActionField,
} from './rules.js';
import { routingTargetFor } from './routing-targets.js';

export interface RulePassInput extends TenantContext {
  itemId: string;
  // A rerun narrows the pass to one rule; absent means every live rule of the organization.
  ruleIds?: readonly string[];
  // The body text of a text payload, read outside the transaction; null for every other item.
  text: string | null;
}

export interface RulePassResult {
  discarded: boolean;
  matchedRuleIds: string[];
  // The route job to send after the commit, or null when the item waits for a person.
  routeJob: RouteInboxItemJob | null;
}

export interface RuleSelector extends TenantContext {
  ruleId: string;
}

// Adoption re-checks the rule's targets against the adopter's scope, exactly like a create or a patch.
export interface AdoptRuleInput extends EntityScopeSelector {
  ruleId: string;
}

export interface CreateRuleInput extends EntityScopeSelector {
  body: CreateInboxRuleRequest;
}

export interface UpdateRuleInput extends EntityScopeSelector {
  body: UpdateInboxRuleRequest;
  ruleId: string;
}

export interface OrderRulesInput extends TenantContext {
  ruleIds: readonly string[];
}

// The rule row as the table holds it, plus the author check the matcher applies.
interface RuleRow {
  auto_route: boolean;
  channel_id: string | null;
  created_at: Date;
  created_by: string;
  detected_type: string | null;
  discard_reason: string | null;
  enabled: boolean;
  id: string;
  keyword: string | null;
  name: string;
  paused: boolean;
  priority: number;
  sender_pattern: string | null;
  set_assignee_id: string | null;
  set_document_kind: string | null;
  set_legal_entity_id: string | null;
  set_partner_id: string | null;
  updated_at: Date;
}

interface RuleDefinitionRow {
  auto_route: boolean;
  channel_id: string | null;
  detected_type: string | null;
  discard_reason: string | null;
  id: string;
  keyword: string | null;
  priority: number;
  sender_pattern: string | null;
  set_assignee_id: string | null;
  set_document_kind: string | null;
  set_legal_entity_id: string | null;
  set_partner_id: string | null;
}

function toRuleDefinition(row: RuleDefinitionRow): InboxRuleDefinition {
  return {
    autoRoute: row.auto_route,
    channelId: row.channel_id,
    detectedType: row.detected_type,
    discardReason: row.discard_reason as InboxDiscardReason | null,
    id: row.id,
    keyword: row.keyword,
    priority: row.priority,
    senderPattern: row.sender_pattern,
    setAssigneeId: row.set_assignee_id,
    setDocumentKind: row.set_document_kind,
    setLegalEntityId: row.set_legal_entity_id,
    setPartnerId: row.set_partner_id,
  };
}

const RULE_DEFINITION_COLUMNS = `id, priority, channel_id, sender_pattern, keyword, detected_type, set_legal_entity_id,
          set_document_kind, set_partner_id, set_assignee_id, discard_reason, auto_route`;

// The one read path of the matcher: the definer admits only rules whose author is still a verified owner or admin.
async function loadLiveRules(
  transaction: PoolClient,
): Promise<InboxRuleDefinition[]> {
  const result = await transaction.query<RuleDefinitionRow>(
    `select ${RULE_DEFINITION_COLUMNS} from app.list_inbox_rules()`,
  );

  return result.rows.map(toRuleDefinition);
}

// The rules a routed item's newest rule extraction named, for the composer; a deleted rule still reads.
export async function loadRulesById(
  transaction: PoolClient,
  ruleIds: readonly string[],
): Promise<InboxRuleDefinition[]> {
  if (ruleIds.length === 0) {
    return [];
  }

  const result = await transaction.query<RuleDefinitionRow>(
    `select ${RULE_DEFINITION_COLUMNS} from app.inbox_rule where id = any($1::uuid[]) order by priority`,
    [[...ruleIds]],
  );

  return result.rows.map(toRuleDefinition);
}

const EMPTY_RULE_DRAFT: RuleDraft = {
  kind: null,
  matchedRuleIds: [],
  partnerId: null,
};

// The newest rule extraction's draft: the rules that matched and the merged kind and partner a rerun keeps.
async function loadPreviousRuleDraft(
  transaction: PoolClient,
  itemId: string,
): Promise<RuleDraft> {
  const result = await transaction.query<{ draft: unknown }>(
    `select draft
       from app.inbox_item_extraction
      where item_id = $1 and provider = $2
      order by created_at desc, id desc
      limit 1`,
    [itemId, RULE_PROVIDER],
  );
  const parsed = ruleDraftSchema.safeParse(result.rows[0]?.draft);

  return parsed.success ? parsed.data : EMPTY_RULE_DRAFT;
}

// The newest rule extraction names the rules that matched; a rerun skips a rule already in that list.
export async function loadMatchedRuleIds(
  transaction: PoolClient,
  itemId: string,
): Promise<string[]> {
  return (await loadPreviousRuleDraft(transaction, itemId)).matchedRuleIds;
}

// The rules the newest rule row matched that are still live, through the matcher's definer, which a channel may call.
export async function loadMatchedLiveRules(
  transaction: PoolClient,
  itemId: string,
): Promise<InboxRuleDefinition[]> {
  const matchedRuleIds = await loadMatchedRuleIds(transaction, itemId);
  return (await loadLiveRules(transaction)).filter((rule) =>
    matchedRuleIds.includes(rule.id),
  );
}

// What the auto-route guard reads beyond the draft: the newest isdoc row and the rows written since, and the sender.
export interface AutoRouteFacts {
  // A parsed email child auto-routes only through a sender-bound rule and a DKIM-aligned sender.
  emailChild: boolean;
  // Some extraction row created at or after the newest isdoc row carries an issue, the isdoc row included.
  issuesSinceParsed: boolean;
  latestIssueCount: number;
  parsed: ParsedLayer | null;
  senderAuthenticated: boolean;
}

export type SenderFacts = Pick<
  AutoRouteFacts,
  'emailChild' | 'senderAuthenticated'
>;

export async function loadSenderFacts(
  transaction: PoolClient,
  itemId: string,
): Promise<SenderFacts> {
  const result = await transaction.query<{
    channel_kind: string;
    payload_kind: string;
    sender_authenticated: boolean;
  }>(
    'select channel_kind, payload_kind, sender_authenticated from app.inbox_item where id = $1',
    [itemId],
  );
  const row = result.rows[0];

  return {
    emailChild: row?.channel_kind === 'email' && row.payload_kind !== 'email',
    senderAuthenticated: row?.sender_authenticated ?? false,
  };
}

async function hasIssuesSinceParsed(
  transaction: PoolClient,
  itemId: string,
  createdAt: string,
): Promise<boolean> {
  const result = await transaction.query<{ issues_since: boolean }>(
    `select exists (select 1 from app.inbox_item_extraction
                     where item_id = $1 and created_at >= $2::timestamptz
                       and jsonb_array_length(issues) > 0) as issues_since`,
    [itemId, createdAt],
  );
  return result.rows[0]?.issues_since ?? false;
}

// The rule pass reads stored parse and issue rows; the parse job uses its pending output directly.
export async function loadAutoRouteFacts(
  transaction: PoolClient,
  itemId: string,
): Promise<AutoRouteFacts> {
  const latest = await loadLatestExtraction(transaction, itemId);
  const parsed = await loadParsedDraft(transaction, itemId);

  return {
    ...(await loadSenderFacts(transaction, itemId)),
    issuesSinceParsed:
      parsed === null
        ? false
        : await hasIssuesSinceParsed(transaction, itemId, parsed.createdAt),
    latestIssueCount: latest?.issues.length ?? 0,
    parsed:
      parsed === null
        ? null
        : { draft: parsed.draft, legalEntityId: parsed.legalEntityId },
  };
}

// The category the parsed partner gives item lines; a channel reads no partner, so it gets null and the item waits.
export async function readPartnerLineCategory(
  transaction: PoolClient,
  partnerId: string | null,
): Promise<string | null> {
  if (partnerId === null) {
    return null;
  }

  const result = await transaction.query<{
    default_line_category: string | null;
  }>('select default_line_category from app.partner where id = $1', [
    partnerId,
  ]);
  return result.rows[0]?.default_line_category ?? null;
}

function waits(reason: string): { job: null; reason: string } {
  return { job: null, reason: `Auto-route waits: ${reason}` };
}

// Who asks for a route: automation through a rule or, with no rule, a target default; or a person approving.
export type RouteAsker =
  | {
      kind: 'automation';
      rule: Pick<InboxRuleDefinition, 'senderPattern'> | null;
    }
  | { kind: 'person' };

// The parsed-content guard, run when a route is decided and again when it runs or a person bulk-approves: null when
// nothing blocks, else the reason the item stays in review.
export function invoiceRouteBlocker(input: {
  asker: RouteAsker;
  composed: ComposedDocument;
  facts: AutoRouteFacts;
  lineCategory: string | null;
}): string | null {
  const { asker, composed, facts } = input;
  const { parsed } = facts;
  const parsedDraft = parsed?.draft ?? null;
  const resolvedKind = composed.draft.kind;

  // DKIM alignment proves only that the sender owns its domain, so any parsed email child needs a rule bound to it.
  if (
    asker.kind === 'automation' &&
    facts.emailChild &&
    parsed !== null &&
    (asker.rule === null ||
      asker.rule.senderPattern === null ||
      !facts.senderAuthenticated)
  ) {
    return 'an email document auto-routes only through a sender-bound rule and an authenticated sender.';
  }

  if (!isInvoiceKind(resolvedKind)) {
    return null;
  }

  const invoice = parsedDraft?.invoice;

  if (parsed === null || invoice == null || facts.issuesSinceParsed) {
    return 'an invoice kind needs a clean ISDOC parse.';
  }

  if (
    parsed.legalEntityId === null ||
    composed.draft.legalEntityId !== parsed.legalEntityId
  ) {
    return 'the legal entity is not the one the file names.';
  }

  if (parsedDraft?.kind !== resolvedKind) {
    return 'the kind is not the one the file states.';
  }

  const parsedPartner = parsedDraft?.partnerId ?? null;

  if (parsedPartner === null) {
    return 'the parse resolved no partner.';
  }

  if (composed.draft.partnerId !== parsedPartner) {
    return 'the hint or rule partner differs from the parsed partner.';
  }

  if (input.lineCategory === null) {
    return 'the partner has no default line category.';
  }

  return null;
}

// The auto-route decision, taken inside the same transaction as the matcher or the parse; the parsed-content guard
// is invoiceRouteBlocker.
export function decideAutoRoute(input: {
  autoRouteRule: InboxRuleDefinition | null;
  composed: ComposedDocument;
  confidence: number;
  facts: AutoRouteFacts;
  lineCategory: string | null;
  target: InboxRoutingTarget;
}): { job: 'route' | null; reason: string | null } {
  const { composed, facts, target } = input;
  const { parsed } = facts;
  const asked =
    input.autoRouteRule !== null ||
    target.auto === 'always' ||
    (target.auto === 'above_threshold' &&
      target.autoThreshold !== null &&
      input.confidence >= target.autoThreshold);

  if (!asked) {
    return { job: null, reason: null };
  }

  if (target.destination !== 'documents') {
    return waits('only the documents destination routes automatically.');
  }

  const attributes = parsed?.draft.attributes;

  if (attributes?.isdoc_document_type === ADVANCE_TAX_DOCUMENT_TYPE) {
    return waits(
      'an advance tax document carries a VAT claim that is not derived.',
    );
  }

  const blocked = invoiceRouteBlocker({
    asker: { kind: 'automation', rule: input.autoRouteRule },
    composed,
    facts,
    lineCategory: input.lineCategory,
  });

  if (blocked !== null) {
    return waits(blocked);
  }

  if (composed.missing.length > 0) {
    return waits(`the draft is missing ${composed.missing.join(', ')}.`);
  }

  if (
    facts.latestIssueCount > 0 ||
    (parsed !== null && facts.issuesSinceParsed)
  ) {
    return waits('the newest extraction raised an issue.');
  }

  return { job: 'route', reason: null };
}

// The parse job's decision from the stored rule matches, read through the same definer as the matcher.
export function decideParsedAutoRoute(
  input: TenantContext & {
    facts: AutoRouteFacts;
    item: InboxItem;
    lineCategory: string | null;
    output: Pick<InboxExtraction, 'confidence' | 'detectedType'>;
    primaryFilename: string | null;
    rules: readonly InboxRuleDefinition[];
    target: InboxRoutingTarget;
  },
): { reason: string | null; routeJob: RouteInboxItemJob | null } {
  const facts = input.facts;
  const autoRouteRule =
    input.rules.find(
      (rule) =>
        rule.autoRoute &&
        (rule.senderPattern === null || facts.senderAuthenticated),
    ) ?? null;
  const composed = composeDocumentDraft(
    { ...input.item, primaryFilename: input.primaryFilename },
    input.rules,
    input.target,
    facts.parsed,
  );
  const decision = decideAutoRoute({
    autoRouteRule,
    composed,
    confidence: input.output.confidence,
    facts,
    lineCategory: input.lineCategory,
    target: input.target,
  });

  return {
    reason: decision.reason,
    routeJob:
      decision.job === null
        ? null
        : {
            itemId: input.item.id,
            organizationId: input.organizationId,
            ruleId: autoRouteRule?.id ?? null,
          },
  };
}

// The rule pass: reads the live rules through the definer, applies the actions under hint precedence, writes one
// rule extraction row and the rule_matched event, discards synchronously on a discard rule, and decides the route job.
// The route decision runs even without a match: a target default that asks enqueues on its own, with no rule row.
export async function applyInboxRules(
  transaction: PoolClient,
  input: RulePassInput,
): Promise<RulePassResult> {
  const live = await loadLiveRules(transaction);
  const rules =
    input.ruleIds === undefined
      ? live
      : live.filter((rule) => input.ruleIds?.includes(rule.id));
  const item = await loadItem(transaction, input.itemId, null);

  if (item === null) {
    throw new Error('The rule pass names an item that is not readable.');
  }

  const sender = await transaction.query<{
    sender: string | null;
    sender_authenticated: boolean;
  }>('select sender, sender_authenticated from app.inbox_item where id = $1', [
    item.id,
  ]);
  const files = await loadItemFiles(transaction, item.id);
  const primaryFilename = files[0]?.originalFilename ?? null;
  const evaluation = evaluateRules(rules, {
    channelId: item.channelId,
    detectedType: item.detectedType,
    filename: primaryFilename,
    hintText: item.hintText,
    sender: sender.rows[0]?.sender ?? null,
    senderAuthenticated: sender.rows[0]?.sender_authenticated ?? false,
    text: input.text,
  });

  // A rerun merges with the newest rule row: its matches stay listed and its kind and partner keep first-writer-wins.
  const previous =
    input.ruleIds === undefined
      ? EMPTY_RULE_DRAFT
      : await loadPreviousRuleDraft(transaction, item.id);
  const previousRules = await loadRulesById(
    transaction,
    previous.matchedRuleIds,
  );
  const facts = await loadAutoRouteFacts(transaction, item.id);
  const target = routingTargetFor(
    item.detectedType,
    await loadRoutingTargetOverrides(transaction),
  );
  const composed = composeDocumentDraft(
    { ...item, primaryFilename },
    evaluation.discard === null
      ? [...previousRules, ...evaluation.matched]
      : [],
    target,
    facts.parsed === null
      ? null
      : {
          draft: facts.parsed.draft,
          legalEntityId: facts.parsed.legalEntityId,
        },
  );
  const decision =
    evaluation.discard === null
      ? decideAutoRoute({
          autoRouteRule:
            evaluation.matched.find(
              (rule) => rule.id === evaluation.autoRouteRuleId,
            ) ?? null,
          composed,
          confidence: item.confidence ?? 0,
          facts,
          lineCategory: await readPartnerLineCategory(
            transaction,
            facts.parsed?.draft.partnerId ?? null,
          ),
          target,
        })
      : { job: null, reason: null };
  const routeJob: RouteInboxItemJob | null =
    decision.job === null
      ? null
      : {
          itemId: item.id,
          organizationId: input.organizationId,
          ruleId: evaluation.autoRouteRuleId,
        };

  // Without a match the target default alone decides the route, and the item keeps its rows untouched.
  if (evaluation.matched.length === 0) {
    return { discarded: false, matchedRuleIds: [], routeJob };
  }

  // A hint a person set and the standing channel hint copied at intake both outrank every rule action.
  const applied: Partial<Record<RuleActionField, boolean>> = {};
  const { fields } = evaluation;
  const entityFromRule =
    fields.legalEntityId !== null &&
    item.legalEntityId === null &&
    item.hintLegalEntityId === null;
  const kindFromRule =
    fields.documentKind !== null &&
    item.hintKind === null &&
    previous.kind === null;
  const partnerFromRule =
    fields.partnerId !== null &&
    item.hintPartnerId === null &&
    previous.partnerId === null;
  const assigneeFromRule =
    fields.assigneeId !== null && item.assigneeId === null;

  if (fields.legalEntityId !== null) {
    applied.legalEntityId = entityFromRule;
  }
  if (fields.documentKind !== null) {
    applied.documentKind = kindFromRule;
  }
  if (fields.partnerId !== null) {
    applied.partnerId = partnerFromRule;
  }
  if (fields.assigneeId !== null) {
    applied.assigneeId = assigneeFromRule;
  }

  const legalEntityId =
    item.hintLegalEntityId ??
    item.legalEntityId ??
    (entityFromRule ? (fields.legalEntityId?.value ?? null) : null);
  const partnerId =
    item.hintPartnerId ??
    previous.partnerId ??
    (partnerFromRule ? (fields.partnerId?.value ?? null) : null);
  const matchedRuleIds = [
    ...new Set([
      ...previous.matchedRuleIds,
      ...evaluation.matched.map((rule) => rule.id),
    ]),
  ];
  const reasons = ruleReasons({ applied, evaluation });

  if (decision.reason !== null) {
    reasons.push({ evidence: decision.reason, step: 'rule', weight: 1 });
  }

  // The merged output: the sniff plus the hints plus the rule actions, with the matched rules typed in the draft.
  await insertExtraction(
    transaction,
    input,
    item.id,
    {
      output: {
        confidence: item.hintKind !== null ? 1 : (item.confidence ?? 0),
        detectedType: item.hintKind ?? item.detectedType ?? 'unknown',
        draft: {
          kind:
            item.hintKind ??
            previous.kind ??
            (kindFromRule ? composed.draft.kind : null),
          matchedRuleIds,
          partnerId,
        },
        fieldConfidences: {},
        issues: [],
        ...(legalEntityId === null ? {} : { legalEntityId }),
        ...(partnerId === null ? {} : { partnerId }),
        reasons,
      },
      provider: RULE_PROVIDER,
      providerVersion: RULE_PROVIDER_VERSION,
    },
    'rule_matched',
  );

  if (entityFromRule || assigneeFromRule) {
    await transaction.query(
      `update app.inbox_item
          set legal_entity_id = case when $2 then $3::uuid else legal_entity_id end,
              assignee_id = case when $4 then $5 else assignee_id end,
              updated_at = now()
        where id = $1`,
      [
        item.id,
        entityFromRule,
        fields.legalEntityId?.value ?? null,
        assigneeFromRule,
        fields.assigneeId?.value ?? null,
      ],
    );
  }

  if (evaluation.discard !== null) {
    await transaction.query(
      `update app.inbox_item
          set status = 'discarded',
              decided_by_kind = 'rule',
              decided_by_rule_id = $2,
              decided_by_user_id = null,
              updated_at = now()
        where id = $1`,
      [item.id, evaluation.discard.ruleId],
    );
    await appendEvent(
      transaction,
      input,
      item.id,
      'discarded',
      evaluation.discard.reason,
    );
    await transaction.query(
      "select app.record_audit('inbox_item.discarded', 'inbox_item', $1, $2::jsonb)",
      [
        item.id,
        JSON.stringify({
          decidedByKind: 'rule',
          reason: evaluation.discard.reason,
          ruleId: evaluation.discard.ruleId,
        }),
      ],
    );

    return { discarded: true, matchedRuleIds, routeJob: null };
  }

  return { discarded: false, matchedRuleIds, routeJob };
}

export class RuleLimitError extends Error {
  constructor() {
    super(
      'The organization already holds the maximum number of enabled rules.',
    );
  }
}

const RULE_COLUMNS = `r.id, r.name, r.enabled, r.priority, r.channel_id, r.sender_pattern, r.keyword, r.detected_type,
          r.set_legal_entity_id, r.set_document_kind, r.set_partner_id, r.set_assignee_id, r.discard_reason,
          r.auto_route, r.created_by, r.created_at, r.updated_at,
          not exists (
            select 1 from auth.resolve_membership(r.created_by, r.organization_id) as m
             where m.role in ('owner', 'admin')
          ) as paused`;

function toRule(row: RuleRow): InboxRule {
  return {
    autoRoute: row.auto_route,
    channelId: row.channel_id,
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by,
    detectedType: row.detected_type,
    discardReason: row.discard_reason as InboxRule['discardReason'],
    enabled: row.enabled,
    id: row.id,
    keyword: row.keyword,
    name: row.name,
    paused: row.paused,
    priority: row.priority,
    senderPattern: row.sender_pattern,
    setAssigneeId: row.set_assignee_id,
    setDocumentKind: row.set_document_kind as InboxRule['setDocumentKind'],
    setLegalEntityId: row.set_legal_entity_id,
    setPartnerId: row.set_partner_id,
    updatedAt: row.updated_at.toISOString(),
  };
}

async function loadRule(
  transaction: PoolClient,
  ruleId: string,
): Promise<InboxRule | null> {
  const result = await transaction.query<RuleRow>(
    `select ${RULE_COLUMNS} from app.inbox_rule as r where r.id = $1 and r.deleted_at is null`,
    [ruleId],
  );
  const row = result.rows[0];

  return row === undefined ? null : toRule(row);
}

// A rule steers items into an entity or a partner, so both must be visible to the caller; false answers 404.
async function ruleTargetsVisible(
  transaction: PoolClient,
  input: EntityScopeSelector,
  targets: {
    setLegalEntityId?: string | null | undefined;
    setPartnerId?: string | null | undefined;
  },
): Promise<boolean> {
  if (
    targets.setLegalEntityId !== undefined &&
    targets.setLegalEntityId !== null
  ) {
    const entity = await transaction.query(
      `select 1 from app.legal_entity
        where id = $1 and ($2::uuid[] is null or id = any($2::uuid[]))`,
      [targets.setLegalEntityId, entityFilter(input.legalEntityIds)],
    );

    if (entity.rows.length === 0) {
      return false;
    }
  }

  if (targets.setPartnerId !== undefined && targets.setPartnerId !== null) {
    const partner = await transaction.query(
      'select 1 from app.partner where id = $1',
      [targets.setPartnerId],
    );

    if (partner.rows.length === 0) {
      return false;
    }
  }

  return true;
}

export async function listRules(
  pool: DatabasePool,
  input: TenantContext,
): Promise<InboxRule[]> {
  return runInTenantContext(pool, input, async (transaction) => {
    const result = await transaction.query<RuleRow>(
      `select ${RULE_COLUMNS} from app.inbox_rule as r where r.deleted_at is null order by r.priority`,
    );
    return result.rows.map(toRule);
  });
}

export async function readRule(
  pool: DatabasePool,
  input: RuleSelector,
): Promise<InboxRule | null> {
  return runInTenantContext(pool, input, (transaction) =>
    loadRule(transaction, input.ruleId),
  );
}

// A new rule takes the next priority slot; the enabled cap is checked here, under the per-organization lock.
export async function createRule(
  pool: DatabasePool,
  input: CreateRuleInput,
): Promise<InboxRule | null> {
  const { body } = input;

  return runInTenantContext(pool, input, async (transaction) => {
    await transaction.query('select pg_advisory_xact_lock(hashtext($1))', [
      `inbox_rule:${input.organizationId}`,
    ]);

    if (!(await ruleTargetsVisible(transaction, input, body))) {
      return null;
    }

    const counted = await transaction.query<{ enabled: number; top: number }>(
      `select count(*) filter (where enabled)::int as enabled, coalesce(max(priority), 0)::int as top
         from app.inbox_rule
        where deleted_at is null`,
    );
    const { enabled = 0, top = 0 } = counted.rows[0] ?? {};

    if (body.enabled && enabled >= MAX_ENABLED_INBOX_RULES) {
      throw new RuleLimitError();
    }

    let created: { rows: { id: string }[] };

    try {
      created = await transaction.query<{ id: string }>(
        `insert into app.inbox_rule
           (organization_id, name, enabled, priority, channel_id, sender_pattern, keyword, detected_type,
            set_legal_entity_id, set_document_kind, set_partner_id, set_assignee_id, discard_reason, auto_route,
            created_by)
         values ($1, $2, $3, $4, $5::uuid, $6, $7, $8, $9::uuid, $10, $11::uuid, $12, $13, $14, $15)
         returning id`,
        [
          input.organizationId,
          body.name,
          body.enabled,
          top + 1,
          body.channelId,
          body.senderPattern,
          body.keyword,
          body.detectedType,
          body.setLegalEntityId,
          body.setDocumentKind,
          body.setPartnerId,
          body.setAssigneeId,
          body.discardReason,
          body.autoRoute,
          input.userId,
        ],
      );
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        return null;
      }

      throw error;
    }

    const ruleId = created.rows[0]?.id;

    if (ruleId === undefined) {
      throw new Error('The inbox rule insert returned no row.');
    }

    // Identifiers and enum values only: never the pattern, the keyword or the name.
    await transaction.query(
      "select app.record_audit('inbox_rule.created', 'inbox_rule', $1, $2::jsonb)",
      [
        ruleId,
        JSON.stringify({
          autoRoute: body.autoRoute,
          discardReason: body.discardReason,
          enabled: body.enabled,
          setDocumentKind: body.setDocumentKind,
        }),
      ],
    );

    return loadRule(transaction, ruleId);
  });
}

// Absence leaves a column alone; null clears it. created_by never changes here: adoption is its own route.
export async function updateRule(
  pool: DatabasePool,
  input: UpdateRuleInput,
): Promise<InboxRule | null> {
  const { body } = input;

  return runInTenantContext(pool, input, async (transaction) => {
    if (!(await ruleTargetsVisible(transaction, input, body))) {
      return null;
    }

    // Enabling counts against the same cap as a create, under the same per-organization lock.
    if (body.enabled === true) {
      await transaction.query('select pg_advisory_xact_lock(hashtext($1))', [
        `inbox_rule:${input.organizationId}`,
      ]);
      const counted = await transaction.query<{ enabled: number }>(
        `select count(*) filter (where enabled and id <> $1)::int as enabled
           from app.inbox_rule
          where deleted_at is null`,
        [input.ruleId],
      );

      if ((counted.rows[0]?.enabled ?? 0) >= MAX_ENABLED_INBOX_RULES) {
        throw new RuleLimitError();
      }
    }

    let updated: { rowCount: number | null };

    try {
      updated = await transaction.query(
        `update app.inbox_rule
            set name = case when $2 then $3 else name end,
                enabled = case when $4 then $5 else enabled end,
                channel_id = case when $6 then $7::uuid else channel_id end,
                sender_pattern = case when $8 then $9 else sender_pattern end,
                keyword = case when $10 then $11 else keyword end,
                detected_type = case when $12 then $13 else detected_type end,
                set_legal_entity_id = case when $14 then $15::uuid else set_legal_entity_id end,
                set_document_kind = case when $16 then $17 else set_document_kind end,
                set_partner_id = case when $18 then $19::uuid else set_partner_id end,
                set_assignee_id = case when $20 then $21 else set_assignee_id end,
                discard_reason = case when $22 then $23 else discard_reason end,
                auto_route = case when $24 then $25 else auto_route end,
                updated_at = now()
          where id = $1 and deleted_at is null`,
        [
          input.ruleId,
          body.name !== undefined,
          body.name ?? null,
          body.enabled !== undefined,
          body.enabled ?? null,
          body.channelId !== undefined,
          body.channelId ?? null,
          body.senderPattern !== undefined,
          body.senderPattern ?? null,
          body.keyword !== undefined,
          body.keyword ?? null,
          body.detectedType !== undefined,
          body.detectedType ?? null,
          body.setLegalEntityId !== undefined,
          body.setLegalEntityId ?? null,
          body.setDocumentKind !== undefined,
          body.setDocumentKind ?? null,
          body.setPartnerId !== undefined,
          body.setPartnerId ?? null,
          body.setAssigneeId !== undefined,
          body.setAssigneeId ?? null,
          body.discardReason !== undefined,
          body.discardReason ?? null,
          body.autoRoute !== undefined,
          body.autoRoute ?? null,
        ],
      );
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        return null;
      }

      throw error;
    }

    if (updated.rowCount === 0) {
      return null;
    }

    await transaction.query(
      "select app.record_audit('inbox_rule.updated', 'inbox_rule', $1, $2::jsonb)",
      [
        input.ruleId,
        JSON.stringify({
          autoRoute: body.autoRoute ?? null,
          discardReason: body.discardReason ?? null,
          enabled: body.enabled ?? null,
          setDocumentKind: body.setDocumentKind ?? null,
        }),
      ],
    );

    return loadRule(transaction, input.ruleId);
  });
}

// Soft: the row stays for the items it decided, disabled, with its priority slot freed.
export async function deleteRule(
  pool: DatabasePool,
  input: RuleSelector,
): Promise<boolean> {
  return runInTenantContext(pool, input, async (transaction) => {
    const deleted = await transaction.query(
      `update app.inbox_rule
          set enabled = false, priority = null, deleted_at = now(), updated_at = now()
        where id = $1 and deleted_at is null`,
      [input.ruleId],
    );

    if (deleted.rowCount === 0) {
      return false;
    }

    await transaction.query(
      "select app.record_audit('inbox_rule.updated', 'inbox_rule', $1, $2::jsonb)",
      [input.ruleId, JSON.stringify({ deleted: true, enabled: false })],
    );

    return true;
  });
}

// The full ordered id list in one statement; the deferred unique lets every priority move at once.
export async function orderRules(
  pool: DatabasePool,
  input: OrderRulesInput,
): Promise<InboxRule[]> {
  return runInTenantContext(pool, input, async (transaction) => {
    const live = await transaction.query<{ id: string }>(
      'select id from app.inbox_rule where deleted_at is null',
    );
    const liveIds = new Set(live.rows.map((row) => row.id));

    // The list names every live rule exactly once and nothing else.
    if (
      liveIds.size !== input.ruleIds.length ||
      !input.ruleIds.every((ruleId) => liveIds.has(ruleId))
    ) {
      throw new BadRequestException();
    }

    await transaction.query(
      `update app.inbox_rule as r
          set priority = ordered.position, updated_at = now()
         from unnest($1::uuid[]) with ordinality as ordered(id, position)
        where r.id = ordered.id and r.deleted_at is null`,
      [[...input.ruleIds]],
    );
    await transaction.query(
      "select app.record_audit('inbox_rule.reordered', 'inbox_rule', null, $1::jsonb)",
      [JSON.stringify({ count: input.ruleIds.length })],
    );

    const result = await transaction.query<RuleRow>(
      `select ${RULE_COLUMNS} from app.inbox_rule as r where r.deleted_at is null order by r.priority`,
    );
    return result.rows.map(toRule);
  });
}

// The caller becomes the author; the trigger refuses any other created_by, so this is the only way it moves.
export async function adoptRule(
  pool: DatabasePool,
  input: AdoptRuleInput,
): Promise<InboxRule | null> {
  return runInTenantContext(pool, input, async (transaction) => {
    const current = await loadRule(transaction, input.ruleId);

    if (
      current === null ||
      !(await ruleTargetsVisible(transaction, input, current))
    ) {
      return null;
    }

    const adopted = await transaction.query(
      `update app.inbox_rule
          set created_by = $2, updated_at = now()
        where id = $1 and deleted_at is null`,
      [input.ruleId, input.userId],
    );

    if (adopted.rowCount === 0) {
      return null;
    }

    await transaction.query(
      "select app.record_audit('inbox_rule.adopted', 'inbox_rule', $1, '{}'::jsonb)",
      [input.ruleId],
    );

    return loadRule(transaction, input.ruleId);
  });
}
