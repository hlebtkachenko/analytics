import { readEntityScope, withTenantContext } from '@bap/db';
import type { EntityScope, TenantContext } from '@bap/db';
import { resolveMembership } from '@bap/db/access';
import type { DatabasePool } from '@bap/db/pool';
import type { PoolClient } from 'pg';

import { createDocumentRequestSchema } from '../documents/contract.js';
import type { CreateDocumentRequest } from '../documents/contract.js';
import {
  createDocumentInTransaction,
  documentTotalOf,
  isDuplicateDocumentReference,
} from '../documents/document-repository.js';
import {
  HUMAN_TOUCH_EVENT_KINDS,
  ROUTE_INBOX_ITEM_QUEUE,
} from '../inbox/contract.js';
import type { InboxItem, ProviderIssue } from '../inbox/contract.js';
import { toCreateDocumentBody } from '../inbox/draft-composer.js';
import type { ComposedDocument } from '../inbox/draft-composer.js';
import {
  findDuplicateCandidates,
  finishRouteInTransaction,
  insertExtraction,
  loadItem,
  loadItemFiles,
  loadLatestExtraction,
  loadRouteSuggestion,
} from '../inbox/inbox-repository.js';
import type { RouteDecision } from '../inbox/inbox-repository.js';
import { knownDetectedType } from '../inbox/routing-targets.js';
import { routeInboxItemJobPayloadSchema } from './job-context.js';
import type { RouteInboxItemJobPayload } from './job-context.js';
import type { WorkerMetrics } from './worker-metrics.js';

// The read-only subject of the first transaction (ADR 0016): a member that writes nothing except through the definer.
export const AUTOMATION_SUBJECT = 'system_automation';
export const AUTO_ROUTE_PROVIDER = 'auto_route';
export const AUTO_ROUTE_PROVIDER_VERSION = '2026-09-17.1';
const AUTHOR_UNAVAILABLE_REASON = 'rule_author_unavailable';
const CONTEXT = 'route_inbox_item';

export interface RouteJobLogger {
  log(message: string, context?: string): void;
}

export interface RouteInboxItemOptions {
  data: unknown;
  logger: RouteJobLogger;
  metrics: WorkerMetrics;
  pool: DatabasePool;
}

// Why the job wrote nothing: each is a committed no-op, never a retry.
export type RouteRefusal =
  | 'already_attempted'
  | 'destination_refused'
  | 'item_unavailable'
  | 'rule_unavailable'
  | 'snoozed'
  | 'status'
  | 'user_decided';

export type RouteInboxItemOutcome =
  | { kind: 'author_unavailable' }
  | { kind: 'failed'; field: string | null; issue: ProviderIssue['code'] }
  | { kind: 'refused'; reason: RouteRefusal }
  | { kind: 'routed'; documentId: string };

// The item and the author the read-only transaction found; a refusal when the item or the rule is gone.
interface AuthorLookup {
  author: string | null;
  item: InboxItem;
}

type Author = { role: 'admin' | 'owner'; userId: string };

async function inTransaction<T>(
  pool: DatabasePool,
  tenant: TenantContext,
  operation: (transaction: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    return await withTenantContext(client, tenant, operation);
  } finally {
    client.release();
  }
}

// The rule's author while the rule is live; null once the rule was disabled or deleted after the enqueue.
async function readRuleAuthor(
  transaction: PoolClient,
  ruleId: string,
): Promise<string | null> {
  const rule = await transaction.query<{ created_by: string }>(
    'select created_by from app.inbox_rule where id = $1 and enabled and deleted_at is null',
    [ruleId],
  );
  return rule.rows[0]?.created_by ?? null;
}

// The editor of the organization's target row, through the same definer as the pass; a platform default has none.
async function readTargetEditor(
  transaction: PoolClient,
  item: InboxItem,
): Promise<string | null> {
  const target = await transaction.query<{ updated_by: string }>(
    'select updated_by from app.list_inbox_routing_targets() where detected_type = $1',
    [knownDetectedType(item.detectedType)],
  );
  return target.rows[0]?.updated_by ?? null;
}

// Owner or admin, verified, and never a tombstone; anything else leaves the item in review with a visible event.
async function resolveAuthor(
  pool: DatabasePool,
  organizationId: string,
  author: string | null,
): Promise<Author | null> {
  if (author === null || author.startsWith('erased_')) {
    return null;
  }

  const membership = await resolveMembership(pool, {
    organizationId,
    subjectId: author,
  });

  if (membership === null || membership.role === 'member') {
    return null;
  }

  return { role: membership.role, userId: author };
}

function scopeAdmits(scope: EntityScope, legalEntityId: string): boolean {
  return scope.mode === 'all' || scope.legalEntityIds.includes(legalEntityId);
}

// At most one attempt per human touch: a second auto_route row needs a newer event a person wrote.
async function attemptedSinceLastTouch(
  transaction: PoolClient,
  itemId: string,
): Promise<boolean> {
  const result = await transaction.query<{
    last_attempt: Date | null;
    last_touch: Date | null;
  }>(
    `select (select max(created_at) from app.inbox_item_extraction
              where item_id = $1 and provider = $2) as last_attempt,
            (select max(created_at) from app.inbox_event
              where item_id = $1 and kind = any($3::text[]) and actor_user_id is not null) as last_touch`,
    [itemId, AUTO_ROUTE_PROVIDER, [...HUMAN_TOUCH_EVENT_KINDS]],
  );
  const row = result.rows[0];
  const attempt = row?.last_attempt ?? null;
  const touch = row?.last_touch ?? null;

  return attempt !== null && (touch === null || touch <= attempt);
}

function refusal(item: InboxItem): RouteRefusal | null {
  if (item.status !== 'needs_review') {
    return 'status';
  }

  if (item.decidedByKind === 'user') {
    return 'user_decided';
  }

  if (item.snoozedUntil !== null && new Date(item.snoozedUntil) > new Date()) {
    return 'snoozed';
  }

  return null;
}

// Every attempt leaves its row: the composed draft, the reasons of the newest earlier extraction, and any issue.
async function recordAttempt(
  transaction: PoolClient,
  tenant: TenantContext,
  item: InboxItem,
  composed: ComposedDocument,
  issues: ProviderIssue[],
): Promise<void> {
  const latest = await loadLatestExtraction(transaction, item.id);
  const { draft } = composed;

  await insertExtraction(transaction, tenant, item.id, {
    output: {
      confidence: item.confidence ?? 0,
      detectedType: item.hintKind ?? item.detectedType ?? 'unknown',
      draft: { ...draft },
      fieldConfidences: {},
      issues,
      ...(draft.legalEntityId === null
        ? {}
        : { legalEntityId: draft.legalEntityId }),
      ...(draft.partnerId === null ? {} : { partnerId: draft.partnerId }),
      reasons: latest?.reasons ?? [],
    },
    provider: AUTO_ROUTE_PROVIDER,
    providerVersion: AUTO_ROUTE_PROVIDER_VERSION,
  });
}

// The author transaction: the row lock, the guardrails, the draft, the document and the route, in that order.
async function routeAsAuthor(
  transaction: PoolClient,
  tenant: TenantContext,
  payload: RouteInboxItemJobPayload,
): Promise<RouteInboxItemOutcome> {
  const item = await loadItem(transaction, payload.itemId, null, true);

  if (item === null) {
    return { kind: 'refused', reason: 'item_unavailable' };
  }

  const refused = refusal(item);

  if (refused !== null) {
    return { kind: 'refused', reason: refused };
  }

  if (await attemptedSinceLastTouch(transaction, item.id)) {
    return { kind: 'refused', reason: 'already_attempted' };
  }

  // The hints are re-read from the locked row and win per field inside the composer.
  const files = await loadItemFiles(transaction, item.id);
  const composed = await loadRouteSuggestion(transaction, item, files);
  const scope = await readEntityScope(transaction, tenant);
  const legalEntityId = composed.draft.legalEntityId;

  // The scope check comes first: an author outside the entity leaves no attempt row behind.
  if (legalEntityId !== null && !scopeAdmits(scope, legalEntityId)) {
    return { kind: 'author_unavailable' };
  }

  const missing = composed.missing[0] ?? null;

  if (missing !== null) {
    await recordAttempt(transaction, tenant, item, composed, [
      {
        code: 'missing_required_field',
        field: missing,
        message: `The automatic route needs ${missing}.`,
      },
    ]);
    return { field: missing, issue: 'missing_required_field', kind: 'failed' };
  }

  const parsed = createDocumentRequestSchema.safeParse(
    toCreateDocumentBody(composed.draft),
  );

  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? 'kind');
    await recordAttempt(transaction, tenant, item, composed, [
      {
        code: 'missing_required_field',
        field,
        message: `The automatic route cannot fill ${field}.`,
      },
    ]);
    return { field, issue: 'missing_required_field', kind: 'failed' };
  }

  // A probable duplicate is a person's call, the same as a taken reference: the item stays in review.
  const candidates =
    parsed.data.partnerId === undefined
      ? []
      : await findDuplicateCandidates(transaction, {
          documentDate: parsed.data.documentDate,
          excludeDocumentId: null,
          legalEntityIds: scope.mode === 'all' ? null : scope.legalEntityIds,
          organizationId: tenant.organizationId,
          partnerId: parsed.data.partnerId,
          reference: parsed.data.reference ?? null,
          totalAmount: documentTotalOf(parsed.data),
        });

  if (candidates.length > 0) {
    await recordAttempt(transaction, tenant, item, composed, [
      {
        code: 'duplicate_probable',
        message: `Probable duplicate of ${candidates.map((candidate) => candidate.id).join(', ')}.`,
      },
    ]);
    return { field: null, issue: 'duplicate_probable', kind: 'failed' };
  }

  const created = await createDocumentOrConflict(
    transaction,
    tenant,
    scope,
    item,
    parsed.data,
  );

  if (created === 'conflict') {
    await recordAttempt(transaction, tenant, item, composed, [
      {
        code: 'reference_conflict',
        field: 'reference',
        message: 'A current document already carries this reference.',
      },
    ]);
    return { field: 'reference', issue: 'reference_conflict', kind: 'failed' };
  }

  if (created === null) {
    return { kind: 'refused', reason: 'destination_refused' };
  }

  await recordAttempt(transaction, tenant, item, composed, []);
  const decision: RouteDecision =
    payload.ruleId === null
      ? { kind: 'target_default', userId: tenant.userId }
      : { kind: 'rule', ruleId: payload.ruleId };
  await finishRouteInTransaction(
    transaction,
    tenant,
    item,
    created,
    files.map((file) => file.blobId),
    decision,
  );

  return { documentId: created.id, kind: 'routed' };
}

// A taken reference aborts the statement, so the create runs under a savepoint the failure row can survive.
async function createDocumentOrConflict(
  transaction: PoolClient,
  tenant: TenantContext,
  scope: EntityScope,
  item: InboxItem,
  body: CreateDocumentRequest,
): Promise<
  { id: string; kind: string; legalEntityId: string } | 'conflict' | null
> {
  await transaction.query('savepoint auto_route_document');

  try {
    const created = await createDocumentInTransaction(transaction, {
      ...tenant,
      body,
      inbox: { itemId: item.id, source: 'upload' },
      legalEntityIds: scope.mode === 'all' ? null : scope.legalEntityIds,
    });
    await transaction.query('release savepoint auto_route_document');
    return created === null ? null : created.document;
  } catch (error) {
    if (!isDuplicateDocumentReference(error)) {
      throw error;
    }

    await transaction.query('rollback to savepoint auto_route_document');
    return 'conflict';
  }
}

export async function routeInboxItem(
  options: RouteInboxItemOptions,
): Promise<RouteInboxItemOutcome> {
  const payload = routeInboxItemJobPayloadSchema.parse(options.data);
  const automation: TenantContext = {
    organizationId: payload.organizationId,
    role: 'member',
    userId: AUTOMATION_SUBJECT,
  };

  try {
    // Organization-wide read, never through readEntityScope: a fake subject's scope default would be unrestricted.
    const lookup = await inTransaction<AuthorLookup | RouteRefusal>(
      options.pool,
      automation,
      async (transaction) => {
        const item = await loadItem(transaction, payload.itemId, null);

        if (item === null || item.status !== 'needs_review') {
          return 'item_unavailable';
        }

        if (payload.ruleId === null) {
          return { author: await readTargetEditor(transaction, item), item };
        }

        const author = await readRuleAuthor(transaction, payload.ruleId);
        return author === null ? 'rule_unavailable' : { author, item };
      },
    );

    if (typeof lookup === 'string') {
      return finish(options, payload, { kind: 'refused', reason: lookup });
    }

    const author = await resolveAuthor(
      options.pool,
      payload.organizationId,
      lookup.author,
    );
    const outcome =
      author === null
        ? { kind: 'author_unavailable' as const }
        : await inTransaction(
            options.pool,
            { organizationId: payload.organizationId, ...author },
            (transaction) =>
              routeAsAuthor(
                transaction,
                { organizationId: payload.organizationId, ...author },
                payload,
              ),
          );

    // The one write the automation subject has: a failed event with no actor, through the definer.
    if (outcome.kind === 'author_unavailable') {
      try {
        await inTransaction(options.pool, automation, (transaction) =>
          transaction.query('select app.record_inbox_automation_skip($1, $2)', [
            payload.itemId,
            AUTHOR_UNAVAILABLE_REASON,
          ]),
        );
      } catch {
        // The item left review between the two transactions: the definer refused, nothing to retry.
        return finish(options, payload, {
          kind: 'refused',
          reason: 'item_unavailable',
        });
      }
    }

    return finish(options, payload, outcome);
  } catch (error) {
    options.metrics.recordJob(ROUTE_INBOX_ITEM_QUEUE, 'failed');
    throw error;
  }
}

// Ids and outcome codes only on the log line, never a pattern, a filename or a draft value.
function finish(
  options: RouteInboxItemOptions,
  payload: RouteInboxItemJobPayload,
  outcome: RouteInboxItemOutcome,
): RouteInboxItemOutcome {
  options.metrics.recordJob(ROUTE_INBOX_ITEM_QUEUE, 'completed');
  const detail =
    outcome.kind === 'refused'
      ? outcome.reason
      : outcome.kind === 'failed'
        ? outcome.issue
        : outcome.kind === 'routed'
          ? outcome.documentId
          : AUTHOR_UNAVAILABLE_REASON;
  options.logger.log(
    `Route inbox item ${payload.itemId}: ${outcome.kind} (${detail})`,
    CONTEXT,
  );

  return outcome;
}
