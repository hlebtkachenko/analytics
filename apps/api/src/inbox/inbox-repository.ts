import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { runInTenantContext } from '@bap/db';
import type {
  BlobScanStatus,
  InboxChannelKind,
  InboxCorrectionField,
  InboxCorrectionSource,
  TenantContext,
} from '@bap/db';
import { loadDatabaseConfiguration } from '@bap/db/config';
import { createDatabasePool } from '@bap/db/pool';
import type { DatabasePool } from '@bap/db/pool';
import type { PoolClient } from 'pg';

import type { ChannelPrincipalReader } from '../channel-access.js';
import type { EntityScopeSelector } from '../datasets/dataset-repository.js';
import { createDocumentRequestSchema } from '../documents/contract.js';
import type {
  CreateDocumentRequest,
  InvoiceLineCategory,
} from '../documents/contract.js';
import {
  createDocumentInTransaction,
  deleteDocumentInTransaction,
  documentTotalOf,
  isDuplicateDocumentReference,
} from '../documents/document-repository.js';
import { entityFilter } from '../documents/sql.js';
import {
  INBOX_ASSIGNEE_NONE,
  INBOX_CONFIDENCE_HIGH_FROM,
  INBOX_CONFIDENCE_MEDIUM_FROM,
  INBOX_TO_REVIEW_STATUSES,
} from './contract.js';
import type {
  CorrectionReasons,
  DuplicateCandidate,
  InboxChannel,
  InboxCorrection,
  InboxEvent,
  InboxExtraction,
  InboxItem,
  InboxItemDetail,
  InboxItemFile,
  InboxItemListEntry,
  InboxItemListQuery,
  InboxItemListResponse,
  InboxRoutingTarget,
  InboxRule,
  InboxSettings,
  IssueInboxChannelCredentialResponse,
  ProviderInput,
  RouteInboxItemJob,
  SplitEmailItemJob,
  UpdateInboxHintsRequest,
} from './contract.js';
import {
  CORRECTION_FIELD_BY_DRAFT_KEY,
  composeDocumentDraft,
  isInvoiceKind,
  parsedContent,
  toCreateDocumentBody,
  withLineCategory,
  type ComposedDocument,
  type ComposedDocumentDraft,
} from './draft-composer.js';
import {
  createChannel,
  issueCredential,
  listChannels,
  readChannel,
  readChannelPrincipal,
  revokeCredential,
  updateChannel,
  type ChannelSelector,
  type CreateChannelInput,
  type IssueCredentialInput,
  type RevokeCredentialInput,
  type UpdateChannelInput,
} from './inbox-channel-repository.js';
import {
  ITEM_COLUMNS,
  SCOPE_FILTER,
  appendEvent,
  insertExtraction,
  loadItem,
  loadItemFiles,
  loadLatestExtraction,
  loadRoutingTargetOverrides,
  toItem,
  type ExtractionRecord,
  type InboxEventKind,
  type InboxEventReason,
  type ItemFileRecord,
  type ItemRow,
} from './inbox-repository-support.js';
import { loadParsedDraft } from './parsed-draft.js';
import {
  adoptRule,
  applyInboxRules,
  createRule,
  deleteRule,
  listRules,
  invoiceRouteBlocker,
  loadMatchedLiveRules,
  loadSenderFacts,
  orderRules,
  readPartnerLineCategory,
  readRule,
  updateRule,
  type AdoptRuleInput,
  type CreateRuleInput,
  type OrderRulesInput,
  type RuleSelector,
  type UpdateRuleInput,
} from './inbox-rule-repository.js';
import {
  deleteRoutingTarget,
  listRoutingTargets,
  putRoutingTarget,
  readInboxSettings,
  updateInboxSettings,
  type PutRoutingTargetInput,
  type ReadInboxSettingsInput,
  type RoutingTargetSelector,
  type UpdateInboxSettingsInput,
} from './inbox-settings-repository.js';
import {
  MANUAL_PROVIDER,
  MANUAL_PROVIDER_VERSION,
  manualProvider,
} from './providers/manual.js';
import { routingTargetFor } from './routing-targets.js';
import type { InboxRuleDefinition } from './rules.js';

// The repository contract keeps one import site for its callers.
export type {
  AdoptRuleInput,
  ChannelSelector,
  CreateChannelInput,
  CreateRuleInput,
  EntityScopeSelector,
  ExtractionRecord,
  IssueCredentialInput,
  ItemFileRecord,
  OrderRulesInput,
  PutRoutingTargetInput,
  ReadInboxSettingsInput,
  RevokeCredentialInput,
  RoutingTargetSelector,
  RuleSelector,
  UpdateChannelInput,
  UpdateInboxSettingsInput,
  UpdateRuleInput,
};

export interface ReadItemInput extends EntityScopeSelector {
  itemId: string;
}

export interface ListItemsInput extends EntityScopeSelector {
  query: InboxItemListQuery;
}

export interface ReceiveIntakeInput extends EntityScopeSelector {
  byteSize: number;
  // Null for a manual upload; every other kind names the channel row the item came through.
  channelId: string | null;
  channelKind: InboxChannelKind;
  // The caller's idempotency key; a replay answers the existing item and writes nothing.
  externalId: string | null;
  mediaType: string;
  // The credential display prefix that pushed the item; null for a manual upload.
  origin: string | null;
  originalFilename: string | null;
  // The email item a child was cut from; null for every item that arrived on its own.
  parentItemId: string | null;
  payloadKind: 'email' | 'file' | 'structured' | 'text';
  // Runs last inside the transaction: a failed move rolls every row back, an earlier failure never moves the bytes.
  persist: () => Promise<void>;
  // The platform quota; the organization's own row can only tighten it, read inside the transaction.
  quotaBytes: number;
  // The parsed envelope sender a child inherits; null until the split has read the MIME.
  sender: string | null;
  // The DKIM alignment verdict a child inherits; false for every path that has no verified sender.
  senderAuthenticated: boolean;
  sha256: string;
  // Null for an email: the worker scans and splits it, so the item stays received and nothing is classified yet.
  sniff: ExtractionRecord | null;
  storageKey: string;
}

export interface ReceiveIntakeResult {
  duplicateOfItemId: string | null;
  files: InboxItemFile[];
  item: InboxItem;
  // True when the external id named an item that already existed and nothing was written.
  replayed: boolean;
  // The automatic route the rule pass asked for, sent by the caller once the transaction has committed.
  routeJob: RouteInboxItemJob | null;
}

export interface UpdateHintsInput extends ReadItemInput {
  body: UpdateInboxHintsRequest;
}

export interface RecordExtractionInput extends ReadItemInput {
  extraction: ExtractionRecord;
}

export interface RouteToDocumentInput extends ReadItemInput {
  // The candidate of a duplicate_probable refusal the person chose to route past.
  acknowledgeDuplicateOf?: string;
  // One line per draft field the person changed away from the suggestion; absent fields get no reason.
  correctionReasons: CorrectionReasons;
  document: CreateDocumentRequest;
  // The manual provider's verdict, stored so the decision keeps its provenance.
  extraction: ExtractionRecord;
  fileBlobIds: readonly string[];
  // The category every parsed item line takes; absent falls back to the partner's default.
  lineCategory?: InvoiceLineCategory;
  // The item's newest isdoc row, whose invoice, total and attributes replace anything the body carried.
  parsedExtractionId?: string;
  // The current document of a reference_conflict refusal; the new one becomes its next version.
  supersedesDocumentId?: string;
}

export interface AttachItemInput extends ReadItemInput {
  documentId: string;
}

// The pre-check that stopped a route: the same object is the 409 body and the issue the extraction row keeps.
export type RouteRefusal =
  | { code: 'duplicate_probable'; candidates: DuplicateCandidate[] }
  | { code: 'missing_required_field'; field: string }
  | { code: 'reference_conflict'; documentId: string };

export class RouteRefusedError extends Error {
  // The extraction row the refusal commits; a missing field is reported without one.
  constructor(
    readonly refusal: RouteRefusal,
    readonly extraction: ExtractionRecord | null,
  ) {
    super(refusal.code);
  }
}

export interface ReopenedEmailItem {
  detail: InboxItemDetail;
  job: SplitEmailItemJob;
}

// Who decided a route: the person, the rule that asked, or the editor of the target default that asked.
export type RouteDecision =
  | { kind: 'rule'; ruleId: string }
  | { kind: 'target_default'; userId: string }
  | { kind: 'user'; userId: string };

interface CorrectionRow {
  created_at: Date;
  created_by: string;
  field: string;
  final_value: string | null;
  id: string;
  reason: string | null;
  source: string;
  suggested_value: string | null;
}

export interface DiscardItemInput extends ReadItemInput {
  reason: InboxEventReason;
}

export interface AssignItemInput extends ReadItemInput {
  assigneeId: string | null;
}

export interface SnoozeItemInput extends ReadItemInput {
  snoozedUntil: string | null;
}

export interface ReadBlobInput extends EntityScopeSelector {
  blobId: string;
}

export interface BlobRecord {
  byteSize: number;
  id: string;
  mediaType: string;
  originalFilename: string | null;
  scanStatus: BlobScanStatus;
  sha256: string;
  storageKey: string;
}

interface ListRow extends ItemRow {
  decided_by_rule_name: string | null;
  file_count: number;
  primary_filename: string | null;
  sender: string | null;
  sender_authenticated: boolean;
}

function toListEntry(row: ListRow): InboxItemListEntry {
  return {
    ...toItem(row),
    decidedByRuleName: row.decided_by_rule_name,
    fileCount: row.file_count,
    primaryFilename: row.primary_filename,
    sender: row.sender,
    senderAuthenticated: row.sender_authenticated,
  };
}

// The storage key is a server-side address and never leaves the API.
function publicFile(file: ItemFileRecord): InboxItemFile {
  return {
    blobId: file.blobId,
    byteSize: file.byteSize,
    mediaType: file.mediaType,
    originalFilename: file.originalFilename,
    position: file.position,
    scanStatus: file.scanStatus,
    sha256: file.sha256,
  };
}

async function loadEvents(
  transaction: PoolClient,
  itemId: string,
): Promise<InboxEvent[]> {
  const result = await transaction.query<{
    actor_user_id: string | null;
    created_at: Date;
    id: string;
    kind: string;
    reason: string | null;
  }>(
    `select id, kind, reason, actor_user_id, created_at
       from app.inbox_event
      where item_id = $1
      order by created_at, id`,
    [itemId],
  );

  return result.rows.map((row) => ({
    actorUserId: row.actor_user_id,
    createdAt: row.created_at.toISOString(),
    id: row.id,
    kind: row.kind as InboxEvent['kind'],
    reason: row.reason as InboxEvent['reason'],
  }));
}

async function loadCorrections(
  transaction: PoolClient,
  itemId: string,
): Promise<InboxCorrection[]> {
  const result = await transaction.query<CorrectionRow>(
    `select id, field, suggested_value, final_value, source, reason, created_by, created_at
       from app.inbox_correction
      where inbox_item_id = $1
      order by created_at, id`,
    [itemId],
  );

  return result.rows.map((row) => ({
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by,
    field: row.field as InboxCorrectionField,
    finalValue: row.final_value,
    id: row.id,
    reason: row.reason,
    source: row.source as InboxCorrectionSource,
    suggestedValue: row.suggested_value,
  }));
}

// A parsed entity outside the reader's scope is masked, so the reader never learns the organization owns it.
function scopedEntity(
  legalEntityId: string | null,
  legalEntityIds: readonly string[] | null,
): string | null {
  return legalEntityIds === null ||
    legalEntityId === null ||
    legalEntityIds.includes(legalEntityId)
    ? legalEntityId
    : null;
}

function scopedExtraction(
  extraction: InboxExtraction | null,
  legalEntityIds: readonly string[] | null,
): InboxExtraction | null {
  if (extraction === null) {
    return null;
  }

  const draftEntity = extraction.draft.legalEntityId;

  return {
    ...extraction,
    draft:
      typeof draftEntity === 'string'
        ? {
            ...extraction.draft,
            legalEntityId: scopedEntity(draftEntity, legalEntityIds),
          }
        : extraction.draft,
    legalEntityId: scopedEntity(extraction.legalEntityId, legalEntityIds),
  };
}

async function loadDetail(
  transaction: PoolClient,
  item: InboxItem,
  legalEntityIds: readonly string[] | null,
): Promise<InboxItemDetail> {
  // The sender, its DKIM verdict, and the name of the rule that decided the item, in one read; a deleted rule still resolves.
  const meta = await transaction.query<{
    decided_by_rule_name: string | null;
    sender: string | null;
    sender_authenticated: boolean;
  }>(
    `select i.sender, i.sender_authenticated, rule.name as decided_by_rule_name
       from app.inbox_item as i
       left join app.inbox_rule as rule
         on rule.id = i.decided_by_rule_id and rule.organization_id = i.organization_id
      where i.id = $1`,
    [item.id],
  );

  const files = await loadItemFiles(transaction, item.id);
  const suggestion = await loadRouteSuggestion(transaction, item, files);

  return {
    corrections: await loadCorrections(transaction, item.id),
    events: await loadEvents(transaction, item.id),
    extraction: scopedExtraction(
      await loadLatestExtraction(transaction, item.id),
      legalEntityIds,
    ),
    files: files.map(publicFile),
    parsed: scopedExtraction(
      await loadParsedDraft(transaction, item.id),
      legalEntityIds,
    ),
    item: {
      ...item,
      decidedByRuleName: meta.rows[0]?.decided_by_rule_name ?? null,
      sender: meta.rows[0]?.sender ?? null,
      senderAuthenticated: meta.rows[0]?.sender_authenticated ?? false,
    },
    routeSuggestion: {
      kind: suggestion.draft.kind,
      legalEntityId: scopedEntity(
        suggestion.draft.legalEntityId,
        legalEntityIds,
      ),
      partnerId: suggestion.draft.partnerId,
    },
    routingTarget: routingTargetFor(
      item.detectedType,
      await loadRoutingTargetOverrides(transaction),
    ),
  };
}

// The organization row can only tighten the platform value; absent or null means the platform value.
async function loadEffectiveQuotaBytes(
  transaction: PoolClient,
  platformQuotaBytes: number,
): Promise<number> {
  const setting = await transaction.query<{ blob_quota_bytes: string | null }>(
    'select blob_quota_bytes::text as blob_quota_bytes from app.organization_inbox_setting',
  );
  const own = setting.rows[0]?.blob_quota_bytes ?? null;

  return own === null
    ? platformQuotaBytes
    : Math.min(Number(own), platformQuotaBytes);
}

// The whole intake in one transaction: blob, item, file, events and the sniff verdict, then the bytes move into place.
export async function receiveIntake(
  pool: DatabasePool,
  input: ReceiveIntakeInput,
): Promise<ReceiveIntakeResult> {
  return runInTenantContext(pool, input, (transaction) =>
    receiveIntakeInTransaction(transaction, input),
  );
}

// The split job creates children inside its own tenant transaction, so the intake core runs on a given client.
export async function receiveIntakeInTransaction(
  transaction: PoolClient,
  input: ReceiveIntakeInput,
): Promise<ReceiveIntakeResult> {
  // One intake at a time per organization, so the quota sum, the replay and the duplicate lookup see every earlier row.
  await transaction.query('select pg_advisory_xact_lock(hashtext($1))', [
    input.organizationId,
  ]);

  // A channel item inherits the entity and the kind hint of its channel; a disabled or foreign channel is not found.
  // Checked before the replay, so a replay never answers through a disabled or deleted channel.
  let legalEntityId: string | null = null;
  let hintKind: string | null = null;

  if (input.channelId !== null) {
    const channel = await transaction.query<{
      hint_kind: string | null;
      legal_entity_id: string | null;
    }>(
      `select legal_entity_id, hint_kind
           from app.inbox_channel
          where id = $1 and kind = $2 and enabled and deleted_at is null`,
      [input.channelId, input.channelKind],
    );
    const row = channel.rows[0];

    if (row === undefined) {
      throw new NotFoundException();
    }

    legalEntityId = row.legal_entity_id;
    hintKind = row.hint_kind;
  }

  // A replayed external id answers the item its channel already created and writes nothing.
  if (input.externalId !== null && input.channelId !== null) {
    const replayed = await transaction.query<{ id: string }>(
      `select id from app.inbox_item
          where organization_id = $1 and channel_id = $2 and external_id = $3`,
      [input.organizationId, input.channelId, input.externalId],
    );
    const replayedId = replayed.rows[0]?.id;

    if (replayedId !== undefined) {
      const item = await loadItem(
        transaction,
        replayedId,
        input.legalEntityIds,
      );

      if (item === null) {
        throw new Error('The replayed item is not readable in its own scope.');
      }

      return {
        duplicateOfItemId: item.duplicateOfItemId,
        files: (await loadItemFiles(transaction, replayedId)).map(publicFile),
        item,
        replayed: true,
        routeJob: null,
      };
    }
  }

  const existing = await transaction.query<{ id: string }>(
    'select id from app.blob where sha256 = $1',
    [input.sha256],
  );
  let blobId = existing.rows[0]?.id ?? null;
  let duplicateOfItemId: string | null = null;

  if (blobId === null) {
    const used = await transaction.query<{ total: string }>(
      'select coalesce(sum(byte_size), 0)::text as total from app.blob',
    );
    const quotaBytes = await loadEffectiveQuotaBytes(
      transaction,
      input.quotaBytes,
    );

    if (Number(used.rows[0]?.total ?? 0) + input.byteSize > quotaBytes) {
      throw new QuotaExceededError();
    }

    const created = await transaction.query<{ id: string }>(
      `insert into app.blob
           (organization_id, sha256, byte_size, media_type, storage_key, original_filename, created_by)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning id`,
      [
        input.organizationId,
        input.sha256,
        input.byteSize,
        input.mediaType,
        input.storageKey,
        input.originalFilename,
        input.userId,
      ],
    );
    blobId = created.rows[0]?.id ?? null;
  } else {
    // The earliest item that carries the blob is the one the duplicate points at.
    const earliest = await transaction.query<{ id: string }>(
      `select i.id
           from app.inbox_item as i
           join app.inbox_item_file as f on f.item_id = i.id
          where f.blob_id = $1
          order by i.received_at, i.id
          limit 1`,
      [blobId],
    );
    duplicateOfItemId = earliest.rows[0]?.id ?? null;
  }

  if (blobId === null) {
    throw new Error('The blob insert returned no row.');
  }

  const inserted = await transaction.query<{ id: string }>(
    `insert into app.inbox_item
         (organization_id, channel_kind, channel_id, payload_kind, status, duplicate_of_item_id,
          legal_entity_id, hint_kind, origin, external_id, parent_item_id, sender,
          sender_authenticated, created_by)
       values ($1, $2, $3, $4, 'received', $5, $6, $7, $8, $9, $10, $11, $12, $13)
       returning id`,
    [
      input.organizationId,
      input.channelKind,
      input.channelId,
      input.payloadKind,
      duplicateOfItemId,
      legalEntityId,
      hintKind,
      input.origin,
      input.externalId,
      input.parentItemId,
      input.sender,
      input.senderAuthenticated,
      input.userId,
    ],
  );
  const itemId = inserted.rows[0]?.id;

  if (itemId === undefined) {
    throw new Error('The inbox item insert returned no row.');
  }

  await transaction.query(
    `insert into app.inbox_item_file (item_id, organization_id, blob_id, position)
       values ($1, $2, $3, 1)`,
    [itemId, input.organizationId, blobId],
  );
  await appendEvent(transaction, input, itemId, 'received');

  const duplicate = existing.rows.length > 0;

  // Without a sniff the item stays received for the worker; a duplicate is still discarded on the spot.
  if (input.sniff !== null) {
    const sniff: ExtractionRecord = duplicate
      ? {
          ...input.sniff,
          output: {
            ...input.sniff.output,
            issues: [
              {
                code: 'duplicate_exact',
                message: 'The same file was already received.',
              },
              ...input.sniff.output.issues,
            ],
          },
        }
      : input.sniff;
    await insertExtraction(transaction, input, itemId, sniff);
  }

  if (input.sniff !== null || duplicate) {
    await transaction.query(
      `update app.inbox_item set status = $2, updated_at = now() where id = $1`,
      [itemId, duplicate ? 'discarded' : 'needs_review'],
    );
  }

  if (duplicate) {
    await appendEvent(transaction, input, itemId, 'discarded', 'duplicate');
  }

  // The rule pass runs after the sniff, still inside the intake transaction; a duplicate is already decided.
  const rulePass =
    input.sniff !== null && !duplicate
      ? await applyInboxRules(transaction, { ...input, itemId, text: null })
      : null;

  // Identifiers and kinds only: the audit log never carries the filename, the hash or the payload.
  await transaction.query(
    "select app.record_audit('inbox_item.received', 'inbox_item', $1, $2::jsonb)",
    [
      itemId,
      JSON.stringify({
        channelId: input.channelId,
        channelKind: input.channelKind,
        duplicate,
        payloadKind: input.payloadKind,
      }),
    ],
  );

  const item = await loadItem(transaction, itemId, input.legalEntityIds);

  if (item === null) {
    throw new Error('The received item is not readable in its own scope.');
  }

  const files = (await loadItemFiles(transaction, itemId)).map(publicFile);

  // The bytes move last: every earlier failure rolls back with the temporary file still in place.
  if (!duplicate) {
    await input.persist();
  }

  return {
    duplicateOfItemId,
    files,
    item,
    replayed: false,
    routeJob: rulePass?.routeJob ?? null,
  };
}

export class QuotaExceededError extends Error {
  constructor() {
    super('The organization blob quota would be exceeded.');
  }
}

export async function listItems(
  pool: DatabasePool,
  input: ListItemsInput,
): Promise<InboxItemListResponse> {
  const { query } = input;

  return runInTenantContext(pool, input, async (transaction) => {
    const values = [
      entityFilter(input.legalEntityIds),
      query.status === undefined ? null : [...query.status],
      query.detectedType ?? null,
      query.issue ?? null,
      query.assigneeId ?? null,
      query.confidence ?? null,
      INBOX_CONFIDENCE_MEDIUM_FROM,
      INBOX_CONFIDENCE_HIGH_FROM,
      query.snoozed === 'exclude',
    ];
    const filter = `${SCOPE_FILTER}
       and ($2::text[] is null or i.status = any($2::text[]))
       and ($3::text is null or i.detected_type = $3::text)
       and ($4::text is null or exists (
             select 1
               from (select x.issues from app.inbox_item_extraction as x
                      where x.item_id = i.id
                      order by x.created_at desc, x.id desc
                      limit 1) as newest
              where newest.issues @> jsonb_build_array(jsonb_build_object('code', $4::text))))
       and ($5::text is null or case when $5::text = '${INBOX_ASSIGNEE_NONE}'
                                     then i.assignee_id is null
                                     else i.assignee_id = $5::text end)
       and ($6::text is null or case $6::text
                                     when 'unknown' then i.confidence is null
                                     when 'low' then i.confidence < $7::numeric
                                     when 'medium' then i.confidence >= $7::numeric and i.confidence < $8::numeric
                                     else i.confidence >= $8::numeric end)
       and (not $9::boolean or i.snoozed_until is null or i.snoozed_until <= now())`;
    // The counts ignore every status, issue, assignee and snooze filter but keep the caller's scope.
    const counts = await transaction.query<{
      all_count: number;
      discarded_count: number;
      filed_count: number;
      to_review: number;
    }>(
      `select count(*)::int as all_count,
              count(*) filter (where i.status = 'routed')::int as filed_count,
              count(*) filter (where i.status = 'discarded')::int as discarded_count,
              count(*) filter (
                where i.status = any($2::text[])
                  and (i.snoozed_until is null or i.snoozed_until <= now())
              )::int as to_review
         from app.inbox_item as i
        where ${SCOPE_FILTER}`,
      [values[0], [...INBOX_TO_REVIEW_STATUSES]],
    );
    const total = await transaction.query<{ total: number }>(
      `select count(*)::int as total from app.inbox_item as i where ${filter}`,
      values,
    );
    // The page is cut first so the file summary only runs for the rows it returns.
    const items = await transaction.query<ListRow>(
      `select p.*, files.file_count, files.primary_filename
         from (select ${ITEM_COLUMNS}, i.organization_id, i.sender,
                      i.sender_authenticated, rule.name as decided_by_rule_name
                 from app.inbox_item as i
                 left join app.inbox_rule as rule
                   on rule.id = i.decided_by_rule_id and rule.organization_id = i.organization_id
                where ${filter}
                order by i.received_at desc, i.id desc
                limit $10 offset $11) as p
        cross join lateral (
          select count(*)::int as file_count,
                 max(b.original_filename) filter (where f.position = 1) as primary_filename
            from app.inbox_item_file as f
            join app.blob as b
              on b.id = f.blob_id and b.organization_id = f.organization_id
           where f.item_id = p.id and f.organization_id = p.organization_id
        ) as files
        order by p.received_at desc, p.id desc`,
      [...values, query.pageSize, (query.page - 1) * query.pageSize],
    );
    const countRow = counts.rows[0];

    return {
      counts: {
        all: countRow?.all_count ?? 0,
        discarded: countRow?.discarded_count ?? 0,
        filed: countRow?.filed_count ?? 0,
        toReview: countRow?.to_review ?? 0,
      },
      items: items.rows.map(toListEntry),
      page: query.page,
      pageSize: query.pageSize,
      total: total.rows[0]?.total ?? 0,
    };
  });
}

export async function readItem(
  pool: DatabasePool,
  input: ReadItemInput,
): Promise<InboxItemDetail | null> {
  return runInTenantContext(pool, input, async (transaction) => {
    const item = await loadItem(
      transaction,
      input.itemId,
      input.legalEntityIds,
    );
    return item === null
      ? null
      : loadDetail(transaction, item, input.legalEntityIds);
  });
}

// Everything a provider may read: the item, its files with their storage keys, and the organization context.
export async function readProviderInput(
  pool: DatabasePool,
  input: ReadItemInput,
): Promise<{ files: ItemFileRecord[]; input: ProviderInput } | null> {
  return runInTenantContext(pool, input, async (transaction) => {
    const item = await loadItem(
      transaction,
      input.itemId,
      input.legalEntityIds,
    );

    if (item === null) {
      return null;
    }

    const files = await loadItemFiles(transaction, item.id);
    const legalEntities = await transaction.query<{
      id: string;
      name: string;
      registration_number: string | null;
    }>(
      `select id, name, registration_number
         from app.legal_entity
        where ($1::uuid[] is null or id = any($1::uuid[]))
        order by name`,
      [entityFilter(input.legalEntityIds)],
    );
    const partners = await transaction.query<{
      id: string;
      name: string;
      registration_number: string | null;
      vat_number: string | null;
    }>(
      'select id, name, registration_number, vat_number from app.partner order by name',
    );

    return {
      files,
      input: {
        context: {
          legalEntities: legalEntities.rows.map((row) => ({
            id: row.id,
            name: row.name,
            registrationNumber: row.registration_number,
          })),
          partners: partners.rows.map((row) => ({
            id: row.id,
            name: row.name,
            registrationNumber: row.registration_number,
            vatNumber: row.vat_number,
          })),
        },
        files: files.map((file) => ({
          ...publicFile(file),
          sniffedMediaType: file.mediaType,
        })),
        hints: {
          hintKind: item.hintKind,
          hintLegalEntityId: item.hintLegalEntityId,
          hintLinkDocumentId: item.hintLinkDocumentId,
          hintPartnerId: item.hintPartnerId,
          hintText: item.hintText,
        },
        item,
      },
    };
  });
}

export async function recordExtraction(
  pool: DatabasePool,
  input: RecordExtractionInput,
): Promise<InboxItemDetail | null> {
  return runInTenantContext(pool, input, async (transaction) => {
    const before = await loadItem(
      transaction,
      input.itemId,
      input.legalEntityIds,
      true,
    );

    if (before === null) {
      return null;
    }

    // A routed item is a decision already taken; automation never overrides it.
    if (before.status === 'routed') {
      throw new ConflictException();
    }

    await insertExtraction(transaction, input, before.id, input.extraction);

    if (before.status === 'received' || before.status === 'failed') {
      await transaction.query(
        `update app.inbox_item set status = 'needs_review', updated_at = now() where id = $1`,
        [before.id],
      );
    }

    const after = await loadItem(transaction, before.id, input.legalEntityIds);
    return after === null
      ? null
      : loadDetail(transaction, after, input.legalEntityIds);
  });
}

export async function updateHints(
  pool: DatabasePool,
  input: UpdateHintsInput,
): Promise<InboxItemDetail | null> {
  const { body } = input;

  return runInTenantContext(pool, input, async (transaction) => {
    const before = await loadItem(
      transaction,
      input.itemId,
      input.legalEntityIds,
      true,
    );

    if (before === null) {
      return null;
    }

    const updated = await transaction.query(
      `update app.inbox_item
          set hint_text = case when $2 then $3 else hint_text end,
              hint_legal_entity_id = case when $4 then $5::uuid else hint_legal_entity_id end,
              hint_kind = case when $6 then $7 else hint_kind end,
              hint_partner_id = case when $8 then $9::uuid else hint_partner_id end,
              hint_link_document_id = case when $10 then $11::uuid else hint_link_document_id end,
              updated_at = now()
        where id = $1`,
      [
        before.id,
        body.hintText !== undefined,
        body.hintText ?? null,
        body.hintLegalEntityId !== undefined,
        body.hintLegalEntityId ?? null,
        body.hintKind !== undefined,
        body.hintKind ?? null,
        body.hintPartnerId !== undefined,
        body.hintPartnerId ?? null,
        body.hintLinkDocumentId !== undefined,
        body.hintLinkDocumentId ?? null,
      ],
    );

    // The member role holds no write capability, so a policy-blocked update matches no row.
    if (updated.rowCount === 0) {
      return null;
    }

    await appendEvent(transaction, input, before.id, 'hint_added');

    const after = await loadItem(transaction, before.id, input.legalEntityIds);
    return after === null
      ? null
      : loadDetail(transaction, after, input.legalEntityIds);
  });
}

// The pre-checks of a route, before the document insert: a reference the entity already uses under the kind,
// and a probable duplicate by partner. Each refusal names what it found, so a person can choose.
export async function checkRoutePreconditions(
  transaction: PoolClient,
  input: {
    acknowledgeDuplicateOf?: string;
    document: CreateDocumentRequest;
    extraction: ExtractionRecord;
    legalEntityIds: readonly string[] | null;
    organizationId: string;
    supersedesDocumentId?: string;
  },
): Promise<{ documentId: string; version: number } | null> {
  const { document } = input;
  const conflict =
    document.reference === undefined
      ? null
      : await transaction.query<{ id: string; version: number }>(
          `select id, version
             from app.document
            where legal_entity_id = $1 and kind = $2 and reference = $3 and is_current
              for update`,
          [document.legalEntityId, document.kind, document.reference],
        );
  const current = conflict?.rows[0] ?? null;

  if (current !== null && input.supersedesDocumentId === undefined) {
    throw new RouteRefusedError(
      { code: 'reference_conflict', documentId: current.id },
      input.extraction,
    );
  }

  // A version names exactly the current row of its reference; anything else is a stale or forged request.
  if (
    input.supersedesDocumentId !== undefined &&
    input.supersedesDocumentId !== current?.id
  ) {
    throw new BadRequestException();
  }

  if (document.partnerId !== undefined) {
    const candidates = await findDuplicateCandidates(transaction, {
      documentDate: document.documentDate,
      excludeDocumentId: current?.id ?? null,
      legalEntityIds: input.legalEntityIds,
      organizationId: input.organizationId,
      partnerId: document.partnerId,
      reference: document.reference ?? null,
      totalAmount: documentTotalOf(document),
    });

    if (candidates.length > 0 && input.acknowledgeDuplicateOf === undefined) {
      throw new RouteRefusedError(
        { candidates, code: 'duplicate_probable' },
        input.extraction,
      );
    }

    if (
      input.acknowledgeDuplicateOf !== undefined &&
      !candidates.some(
        (candidate) => candidate.id === input.acknowledgeDuplicateOf,
      )
    ) {
      throw new BadRequestException();
    }
  } else if (input.acknowledgeDuplicateOf !== undefined) {
    // No partner means the duplicate check never ran, so an acknowledgement names a candidate that cannot exist.
    throw new BadRequestException();
  }

  return current === null
    ? null
    : { documentId: current.id, version: current.version };
}

// Organization-wide within the caller's entities: the same supplier invoices several entities, and a partner is
// organization-wide. Exact reference regardless of kind, or the same total within three days of the date.
export async function findDuplicateCandidates(
  transaction: PoolClient,
  input: {
    documentDate: string;
    excludeDocumentId: string | null;
    legalEntityIds: readonly string[] | null;
    organizationId: string;
    partnerId: string;
    reference: string | null;
    totalAmount: string | null;
  },
): Promise<DuplicateCandidate[]> {
  const result = await transaction.query<{
    document_date: string;
    id: string;
    reference: string | null;
    total_amount: string | null;
  }>(
    `select id, reference, document_date::text as document_date, total_amount::text as total_amount
       from app.document
      where organization_id = $1
        and ($7::uuid[] is null or legal_entity_id = any($7::uuid[]))
        and partner_id = $2
        and is_current
        and id <> coalesce($5::uuid, '00000000-0000-0000-0000-000000000000')
        and ((reference is not null and reference = $3)
             or ($4::numeric is not null and total_amount = $4::numeric
                 and document_date between $6::date - 3 and $6::date + 3))
      order by document_date desc, id
      limit 10`,
    [
      input.organizationId,
      input.partnerId,
      input.reference,
      input.totalAmount,
      input.excludeDocumentId,
      input.documentDate,
      entityFilter(input.legalEntityIds),
    ],
  );

  return result.rows.map((row) => ({
    documentDate: row.document_date,
    id: row.id,
    reference: row.reference,
    totalAmount: row.total_amount,
  }));
}

// The superseded row steps aside: not current, and without its event or open issues, so nothing counts twice.
export async function supersedeDocument(
  transaction: PoolClient,
  documentId: string,
): Promise<void> {
  const flipped = await transaction.query(
    'update app.document set is_current = false, updated_at = now() where id = $1 and is_current',
    [documentId],
  );

  // Zero rows means another transaction versioned it first.
  if (flipped.rowCount === 0) {
    throw new ConflictException();
  }

  await transaction.query(
    'delete from app.economic_event where document_id = $1',
    [documentId],
  );
  await transaction.query(
    'delete from app.data_issue where document_id = $1 and resolved_at is null',
    [documentId],
  );
}

// A refused route commits the extraction row with its issue in a transaction of its own, then answers 409.
async function routeOrRefuse(
  pool: DatabasePool,
  input: ReadItemInput,
  route: (transaction: PoolClient) => Promise<InboxItemDetail | null>,
): Promise<InboxItemDetail | null> {
  try {
    return await runInTenantContext(pool, input, route);
  } catch (error) {
    if (!(error instanceof RouteRefusedError)) {
      throw error;
    }

    const { extraction, refusal } = error;

    if (refusal.code === 'missing_required_field' || extraction === null) {
      throw error;
    }

    const issue =
      refusal.code === 'reference_conflict'
        ? {
            code: refusal.code,
            field: 'reference',
            message: `A current document already carries this reference: ${refusal.documentId}.`,
          }
        : {
            code: refusal.code,
            message: `Probable duplicate of ${refusal.candidates.map((candidate) => candidate.id).join(', ')}.`,
          };

    await runInTenantContext(pool, input, (transaction) =>
      insertExtraction(transaction, input, input.itemId, {
        ...extraction,
        output: {
          ...extraction.output,
          issues: [...extraction.output.issues, issue],
        },
      }),
    );

    throw new ConflictException(refusal);
  }
}

export function routeToDocument(
  pool: DatabasePool,
  input: RouteToDocumentInput,
): Promise<InboxItemDetail | null> {
  return routeOrRefuse(pool, input, async (transaction) => {
    const before = await loadItem(
      transaction,
      input.itemId,
      input.legalEntityIds,
      true,
    );

    if (before === null) {
      return null;
    }

    if (before.status !== 'needs_review' && before.status !== 'received') {
      throw new ConflictException();
    }

    const files = await loadItemFiles(transaction, before.id);
    const itemBlobIds = new Set(files.map((file) => file.blobId));

    // The body orders the item's own blobs and nothing else, so no foreign blob can be attached to the document.
    if (
      input.fileBlobIds.length !== itemBlobIds.size ||
      !input.fileBlobIds.every((blobId) => itemBlobIds.has(blobId))
    ) {
      throw new BadRequestException();
    }

    return routeInTransaction(
      transaction,
      await withParsedContent(transaction, input, before),
      before,
      files,
    );
  });
}

// Bulk approve: the composed suggestion is the draft, routed as the person with nothing acknowledged or superseded.
export function approveItem(
  pool: DatabasePool,
  input: ReadItemInput,
): Promise<InboxItemDetail | null> {
  return routeOrRefuse(pool, input, async (transaction) => {
    const before = await loadItem(
      transaction,
      input.itemId,
      input.legalEntityIds,
      true,
    );

    if (before === null) {
      return null;
    }

    if (before.status !== 'needs_review' && before.status !== 'received') {
      throw new ConflictException();
    }

    const files = await loadItemFiles(transaction, before.id);
    const composed = await loadRouteSuggestion(transaction, before, files);
    const parsed =
      composed.missing.length === 0
        ? createDocumentRequestSchema.safeParse(
            toCreateDocumentBody(composed.draft, composed.content),
          )
        : null;
    const field =
      parsed === null
        ? composed.missing[0]
        : parsed.success
          ? undefined
          : String(parsed.error.issues[0]?.path[0] ?? 'kind');

    if (parsed === null || !parsed.success) {
      throw new RouteRefusedError(
        { code: 'missing_required_field', field: field ?? 'kind' },
        null,
      );
    }

    // Parsed invoice content is filed in bulk only when the parse is clean and names the same entity, kind and
    // partner; the parse's own issues count, a later failed auto-route row does not.
    if (composed.content.invoice !== null) {
      const newest = await loadParsedDraft(transaction, before.id);
      const blocked = invoiceRouteBlocker({
        asker: { kind: 'person' },
        composed,
        facts: {
          ...(await loadSenderFacts(transaction, before.id)),
          issuesSinceParsed: (newest?.issues.length ?? 0) > 0,
          latestIssueCount: newest?.issues.length ?? 0,
          parsed:
            newest === null
              ? null
              : { draft: newest.draft, legalEntityId: newest.legalEntityId },
        },
        lineCategory: composed.lineCategory,
      });

      if (blocked !== null) {
        throw new BadRequestException();
      }
    }

    const { document, output } = manualProvider(parsed.data);

    return routeInTransaction(
      transaction,
      {
        ...input,
        correctionReasons: {},
        document,
        extraction: {
          output,
          provider: MANUAL_PROVIDER,
          providerVersion: MANUAL_PROVIDER_VERSION,
        },
        fileBlobIds: files.map((file) => file.blobId),
      },
      before,
      files,
    );
  });
}

async function routeInTransaction(
  transaction: PoolClient,
  input: RouteToDocumentInput,
  before: InboxItem,
  files: readonly ItemFileRecord[],
): Promise<InboxItemDetail | null> {
  // The draft's entity is checked before either pre-check query runs, so neither can read outside the scope.
  const entity = await transaction.query(
    `select 1 from app.legal_entity
      where id = $1 and ($2::uuid[] is null or id = any($2::uuid[]))`,
    [input.document.legalEntityId, entityFilter(input.legalEntityIds)],
  );

  if (entity.rowCount === 0) {
    return null;
  }

  // The suggestion is computed from the pre-route state, before the manual row becomes the newest extraction.
  const suggested = await loadRouteSuggestion(transaction, before, files);
  const superseded = await checkRoutePreconditions(transaction, input);

  if (superseded !== null) {
    await supersedeDocument(transaction, superseded.documentId);
  }

  const created = await createDocumentInTransaction(transaction, {
    ...input,
    body: input.document,
    inbox: { itemId: before.id, source: 'upload' },
    ...(superseded === null ? {} : { supersedes: superseded }),
  });

  if (created === null) {
    // A superseded row was already flipped, so a null here must abort the transaction, not commit a dangling document.
    throw new NotFoundException();
  }

  await insertExtraction(transaction, input, before.id, input.extraction);
  await insertCorrections(transaction, input, before.id, suggested, {
    currencyCode: input.document.currencyCode,
    documentDate: input.document.documentDate,
    kind: input.document.kind,
    legalEntityId: input.document.legalEntityId,
    partnerId: input.document.partnerId ?? null,
    reference: input.document.reference ?? null,
    title: input.document.title,
  });

  await finishRouteInTransaction(
    transaction,
    input,
    before,
    created.document,
    input.fileBlobIds,
    { kind: 'user', userId: input.userId },
    {
      acknowledgeDuplicateOf: input.acknowledgeDuplicateOf ?? null,
      supersedesDocumentId: superseded?.documentId ?? null,
    },
  );

  const after = await loadItem(transaction, before.id, input.legalEntityIds);
  return after === null
    ? null
    : loadDetail(transaction, after, input.legalEntityIds);
}

// The composed draft plus the partner default its parsed item lines took; null when no line took one.
export type RouteSuggestion = ComposedDocument & {
  lineCategory: string | null;
};

// The draft a route suggests: the hints, the live rules the newest rule extraction named (the set the parse used),
// the newest isdoc row and the effective target; parsed item lines take the partner's default category.
export async function loadRouteSuggestion(
  transaction: PoolClient,
  item: InboxItem,
  files: readonly ItemFileRecord[],
  matchedRules?: readonly InboxRuleDefinition[],
): Promise<RouteSuggestion> {
  const parsed = await loadParsedDraft(transaction, item.id);
  const composed = composeDocumentDraft(
    { ...item, primaryFilename: files[0]?.originalFilename ?? null },
    matchedRules ?? (await loadMatchedLiveRules(transaction, item.id)),
    routingTargetFor(
      item.detectedType,
      await loadRoutingTargetOverrides(transaction),
    ),
    parsed === null
      ? null
      : { draft: parsed.draft, legalEntityId: parsed.legalEntityId },
  );
  const category =
    composed.content.invoice === null
      ? null
      : await readPartnerLineCategory(transaction, composed.draft.partnerId);

  return category === null
    ? { ...composed, lineCategory: null }
    : {
        ...composed,
        content: withLineCategory(composed.content, category),
        lineCategory: category,
      };
}

// A parsed route copies the invoice, total and attributes from the stored row the body names, never the body's own;
// a client invoice beside a parsed invoice is refused, and a stale row id is refused too.
async function withParsedContent(
  transaction: PoolClient,
  input: RouteToDocumentInput,
  item: InboxItem,
): Promise<RouteToDocumentInput> {
  const newest = await loadParsedDraft(transaction, item.id);

  if (newest?.draft.invoice != null && !isInvoiceKind(input.document.kind)) {
    throw new UnprocessableEntityException('parsed_kind_mismatch');
  }

  if (input.parsedExtractionId === undefined) {
    if (input.document.invoice !== undefined && newest?.draft.invoice != null) {
      throw new UnprocessableEntityException('parsed_invoice_only');
    }

    return input;
  }

  if (newest === null || newest.id !== input.parsedExtractionId) {
    throw new UnprocessableEntityException('parsed_extraction_stale');
  }

  const content = parsedContent(newest.draft, input.document.kind);
  const category =
    input.lineCategory ??
    (await readPartnerLineCategory(
      transaction,
      input.document.partnerId ?? null,
    ));
  const filled = withLineCategory(content, category);
  const merged = createDocumentRequestSchema.safeParse({
    ...input.document,
    ...(filled.attributes === null ? {} : { attributes: filled.attributes }),
    ...(filled.invoice === null ? {} : { invoice: filled.invoice }),
    ...(filled.totalAmount === null ? {} : { totalAmount: filled.totalAmount }),
  });

  if (!merged.success) {
    throw new UnprocessableEntityException(
      filled.invoice !== null && category === null
        ? 'line_category_required'
        : 'parsed_content_invalid',
    );
  }

  const { document, output } = manualProvider(merged.data);

  return { ...input, document, extraction: { ...input.extraction, output } };
}

// The rows every route writes once the document exists: its files, the item's decision, the event and the audit entry.
export async function finishRouteInTransaction(
  transaction: PoolClient,
  input: TenantContext,
  item: InboxItem,
  document: { id: string; kind: string; legalEntityId: string },
  fileBlobIds: readonly string[],
  decision: RouteDecision,
  audit: {
    acknowledgeDuplicateOf: string | null;
    supersedesDocumentId: string | null;
  } = { acknowledgeDuplicateOf: null, supersedesDocumentId: null },
): Promise<void> {
  await transaction.query(
    `insert into app.document_file (document_id, organization_id, blob_id, position, created_by)
     select $1, $2, blob_id, position, $4
       from unnest($3::uuid[]) with ordinality as file(blob_id, position)`,
    [document.id, input.organizationId, [...fileBlobIds], input.userId],
  );
  await transaction.query(
    `update app.inbox_item
        set document_id = $2,
            legal_entity_id = $3,
            status = 'routed',
            decided_by_kind = $4,
            decided_by_rule_id = $5,
            decided_by_user_id = $6,
            routed_at = now(),
            updated_at = now()
      where id = $1`,
    [
      item.id,
      document.id,
      document.legalEntityId,
      decision.kind,
      decision.kind === 'rule' ? decision.ruleId : null,
      decision.kind === 'rule' ? null : decision.userId,
    ],
  );
  await appendEvent(transaction, input, item.id, 'routed');
  await transaction.query(
    "select app.record_audit('inbox_item.routed', 'inbox_item', $1, $2::jsonb)",
    [
      item.id,
      JSON.stringify({
        ...audit,
        decidedByKind: decision.kind,
        documentId: document.id,
        kind: document.kind,
        ruleId: decision.kind === 'rule' ? decision.ruleId : null,
      }),
    ],
  );
}

// The item's files join an existing document at the next positions; the item is routed to it without a create.
export async function attachItem(
  pool: DatabasePool,
  input: AttachItemInput,
): Promise<InboxItemDetail | null> {
  return runInTenantContext(pool, input, async (transaction) => {
    const before = await loadItem(
      transaction,
      input.itemId,
      input.legalEntityIds,
      true,
    );

    if (before === null) {
      return null;
    }

    if (before.status !== 'needs_review' && before.status !== 'received') {
      throw new ConflictException();
    }

    const document = await transaction.query<{
      id: string;
      kind: string;
      legal_entity_id: string;
    }>(
      `select id, kind, legal_entity_id
         from app.document
        where id = $1 and ($2::uuid[] is null or legal_entity_id = any($2::uuid[]))
          for update`,
      [input.documentId, entityFilter(input.legalEntityIds)],
    );
    const target = document.rows[0];

    if (target === undefined) {
      return null;
    }

    const files = await loadItemFiles(transaction, before.id);

    // Nothing to add: attaching zero files would route the item without ever joining the document.
    if (files.length === 0) {
      throw new ConflictException('no_files');
    }

    const blobIds = files.map((file) => file.blobId);
    const present = await transaction.query(
      'select 1 from app.document_file where document_id = $1 and blob_id = any($2::uuid[])',
      [target.id, blobIds],
    );

    // The same bytes twice on one document is the duplicate this action exists to avoid.
    if ((present.rowCount ?? 0) > 0) {
      throw new ConflictException('blob_already_attached');
    }

    await transaction.query(
      `insert into app.document_file (document_id, organization_id, blob_id, position, created_by)
       select $1, $2, blob_id,
              coalesce((select max(position) from app.document_file where document_id = $1), 0) + position,
              $4
         from unnest($3::uuid[]) with ordinality as file(blob_id, position)`,
      [target.id, input.organizationId, blobIds, input.userId],
    );
    await transaction.query(
      `update app.inbox_item
          set document_id = $2,
              legal_entity_id = $3,
              status = 'routed',
              decided_by_kind = 'user',
              decided_by_rule_id = null,
              decided_by_user_id = $4,
              routed_at = now(),
              updated_at = now()
        where id = $1`,
      [before.id, target.id, target.legal_entity_id, input.userId],
    );
    await appendEvent(transaction, input, before.id, 'attached');
    await transaction.query(
      "select app.record_audit('inbox_item.attached', 'inbox_item', $1, $2::jsonb)",
      [before.id, JSON.stringify({ documentId: target.id, kind: target.kind })],
    );

    const after = await loadItem(transaction, before.id, input.legalEntityIds);
    return after === null
      ? null
      : loadDetail(transaction, after, input.legalEntityIds);
  });
}

// A failed email parent goes back to received so the split job accepts it again; the caller enqueues the job.
export async function reopenEmailItem(
  pool: DatabasePool,
  input: ReadItemInput,
): Promise<ReopenedEmailItem | null> {
  return runInTenantContext(pool, input, async (transaction) => {
    const before = await loadItem(
      transaction,
      input.itemId,
      input.legalEntityIds,
      true,
    );

    if (before === null) {
      return null;
    }

    if (
      before.status !== 'failed' ||
      before.payloadKind !== 'email' ||
      before.channelId === null
    ) {
      throw new ConflictException();
    }

    await transaction.query(
      "update app.inbox_item set status = 'received', updated_at = now() where id = $1",
      [before.id],
    );
    await appendEvent(transaction, input, before.id, 'reopened');
    await transaction.query(
      "select app.record_audit('inbox_item.reopened', 'inbox_item', $1, '{}'::jsonb)",
      [before.id],
    );

    const after = await loadItem(transaction, before.id, input.legalEntityIds);

    return after === null
      ? null
      : {
          detail: await loadDetail(transaction, after, input.legalEntityIds),
          job: {
            channelId: before.channelId,
            itemId: before.id,
            organizationId: input.organizationId,
          },
        };
  });
}

// One row per suggested field the person changed; a field nothing suggested has no source and gets no row.
async function insertCorrections(
  transaction: PoolClient,
  input: RouteToDocumentInput,
  itemId: string,
  suggested: ComposedDocument,
  final: ComposedDocumentDraft,
): Promise<void> {
  for (const key of Object.keys(
    CORRECTION_FIELD_BY_DRAFT_KEY,
  ) as (keyof ComposedDocumentDraft)[]) {
    const field = CORRECTION_FIELD_BY_DRAFT_KEY[key];
    const source = suggested.sources[field];
    const suggestedValue = suggested.draft[key];
    const finalValue = final[key];

    if (source === null || suggestedValue === finalValue) {
      continue;
    }

    await transaction.query(
      `insert into app.inbox_correction
         (organization_id, inbox_item_id, field, suggested_value, final_value, source, reason, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.organizationId,
        itemId,
        field,
        suggestedValue,
        finalValue,
        source,
        input.correctionReasons[field] ?? null,
        input.userId,
      ],
    );
  }
}

// Undo is the documents delete path: it un-routes the item, appends the event and removes the document.
export async function undoRoute(
  pool: DatabasePool,
  input: ReadItemInput,
): Promise<InboxItemDetail | null> {
  return runInTenantContext(pool, input, async (transaction) => {
    const before = await loadItem(
      transaction,
      input.itemId,
      input.legalEntityIds,
      true,
    );

    if (before === null) {
      return null;
    }

    if (before.status !== 'routed' || before.documentId === null) {
      throw new ConflictException();
    }

    const owner = await transaction.query<{ inbox_item_id: string | null }>(
      `select inbox_item_id
         from app.document
        where id = $1 and ($2::uuid[] is null or legal_entity_id = any($2::uuid[]))
          for update`,
      [before.documentId, entityFilter(input.legalEntityIds)],
    );
    const document = owner.rows[0];

    if (document === undefined) {
      return null;
    }

    // This item created the document: the delete path removes it. Otherwise the item was attached to a document
    // another item created, so only the rows this item brought go and the document stays.
    if (document.inbox_item_id === before.id) {
      let deleted: boolean;

      try {
        deleted = await deleteDocumentInTransaction(transaction, {
          ...input,
          documentId: before.documentId,
        });
      } catch (error) {
        // The restored predecessor's reference can now collide with a current document; answer the same as a route.
        if (isDuplicateDocumentReference(error)) {
          throw new ConflictException();
        }

        throw error;
      }

      if (!deleted) {
        return null;
      }
    } else {
      await transaction.query(
        `delete from app.document_file
          where document_id = $1
            and blob_id in (select blob_id from app.inbox_item_file where item_id = $2)`,
        [before.documentId, before.id],
      );
      await transaction.query(
        `update app.inbox_item
            set document_id = null,
                status = 'needs_review',
                decided_by_kind = null,
                decided_by_user_id = null,
                routed_at = null,
                updated_at = now()
          where id = $1`,
        [before.id],
      );
      await appendEvent(transaction, input, before.id, 'unrouted');
    }

    await transaction.query(
      "select app.record_audit('inbox_item.unrouted', 'inbox_item', $1, '{}'::jsonb)",
      [before.id],
    );

    const after = await loadItem(transaction, before.id, input.legalEntityIds);
    return after === null
      ? null
      : loadDetail(transaction, after, input.legalEntityIds);
  });
}

// A person's decision: a discard records who decided, a restore clears it so a channel may work the item again.
async function transition(
  pool: DatabasePool,
  input: ReadItemInput,
  allowed: readonly InboxItem['status'][],
  status: InboxItem['status'],
  event: InboxEventKind,
  reason: InboxEventReason | null,
  decidedByUserId: string | null,
): Promise<InboxItemDetail | null> {
  return runInTenantContext(pool, input, async (transaction) => {
    const before = await loadItem(
      transaction,
      input.itemId,
      input.legalEntityIds,
      true,
    );

    if (before === null) {
      return null;
    }

    if (!allowed.includes(before.status)) {
      throw new ConflictException();
    }

    const updated = await transaction.query(
      `update app.inbox_item
          set status = $2,
              decided_by_kind = case when $3::text is null then null else 'user' end,
              decided_by_user_id = $3::text,
              updated_at = now()
        where id = $1`,
      [before.id, status, decidedByUserId],
    );

    if (updated.rowCount === 0) {
      return null;
    }

    await appendEvent(transaction, input, before.id, event, reason);
    await transaction.query(
      "select app.record_audit($2, 'inbox_item', $1, $3::jsonb)",
      [before.id, `inbox_item.${event}`, JSON.stringify({ reason })],
    );

    const after = await loadItem(transaction, before.id, input.legalEntityIds);
    return after === null
      ? null
      : loadDetail(transaction, after, input.legalEntityIds);
  });
}

export function discardItem(
  pool: DatabasePool,
  input: DiscardItemInput,
): Promise<InboxItemDetail | null> {
  return transition(
    pool,
    input,
    ['received', 'processing', 'needs_review', 'failed'],
    'discarded',
    'discarded',
    input.reason,
    input.userId,
  );
}

export function restoreItem(
  pool: DatabasePool,
  input: ReadItemInput,
): Promise<InboxItemDetail | null> {
  return transition(
    pool,
    input,
    ['discarded'],
    'needs_review',
    'restored',
    null,
    null,
  );
}

export async function assignItem(
  pool: DatabasePool,
  input: AssignItemInput,
): Promise<InboxItemDetail | null> {
  return runInTenantContext(pool, input, async (transaction) => {
    const before = await loadItem(
      transaction,
      input.itemId,
      input.legalEntityIds,
      true,
    );

    if (before === null) {
      return null;
    }

    // A decided item is nobody's work item any more.
    if (before.status === 'routed' || before.status === 'discarded') {
      throw new ConflictException();
    }

    const updated = await transaction.query(
      'update app.inbox_item set assignee_id = $2, updated_at = now() where id = $1',
      [before.id, input.assigneeId],
    );

    if (updated.rowCount === 0) {
      return null;
    }

    await appendEvent(transaction, input, before.id, 'assigned');

    const after = await loadItem(transaction, before.id, input.legalEntityIds);
    return after === null
      ? null
      : loadDetail(transaction, after, input.legalEntityIds);
  });
}

export async function snoozeItem(
  pool: DatabasePool,
  input: SnoozeItemInput,
): Promise<InboxItemDetail | null> {
  return runInTenantContext(pool, input, async (transaction) => {
    const before = await loadItem(
      transaction,
      input.itemId,
      input.legalEntityIds,
      true,
    );

    if (before === null) {
      return null;
    }

    if (before.status === 'routed' || before.status === 'discarded') {
      throw new ConflictException();
    }

    const updated = await transaction.query(
      'update app.inbox_item set snoozed_until = $2::timestamptz, updated_at = now() where id = $1',
      [before.id, input.snoozedUntil],
    );

    if (updated.rowCount === 0) {
      return null;
    }

    const after = await loadItem(transaction, before.id, input.legalEntityIds);
    return after === null
      ? null
      : loadDetail(transaction, after, input.legalEntityIds);
  });
}

// A blob is visible exactly when one of the items carrying it is, so the routes share the list scope.
export async function readBlob(
  pool: DatabasePool,
  input: ReadBlobInput,
): Promise<BlobRecord | null> {
  return runInTenantContext(pool, input, async (transaction) => {
    const result = await transaction.query<{
      byte_size: string;
      id: string;
      media_type: string;
      original_filename: string | null;
      scan_status: BlobScanStatus;
      sha256: string;
      storage_key: string;
    }>(
      `select b.id, b.sha256, b.byte_size::text as byte_size, b.media_type, b.original_filename, b.scan_status,
              b.storage_key
         from app.blob as b
        where b.id = $2
          and exists (
            select 1
              from app.inbox_item_file as f
              join app.inbox_item as i on i.id = f.item_id
             where f.blob_id = b.id and ${SCOPE_FILTER}
          )`,
      [entityFilter(input.legalEntityIds), input.blobId],
    );
    const row = result.rows[0];

    return row === undefined
      ? null
      : {
          byteSize: Number(row.byte_size),
          id: row.id,
          mediaType: row.media_type,
          originalFilename: row.original_filename,
          scanStatus: row.scan_status,
          sha256: row.sha256,
          storageKey: row.storage_key,
        };
  });
}

export abstract class InboxRepository implements ChannelPrincipalReader {
  abstract adoptRule(input: AdoptRuleInput): Promise<InboxRule | null>;
  abstract approveItem(input: ReadItemInput): Promise<InboxItemDetail | null>;
  abstract assignItem(input: AssignItemInput): Promise<InboxItemDetail | null>;
  abstract attachItem(input: AttachItemInput): Promise<InboxItemDetail | null>;
  abstract createChannel(
    input: CreateChannelInput,
  ): Promise<InboxChannel | null>;
  abstract createRule(input: CreateRuleInput): Promise<InboxRule | null>;
  abstract deleteRoutingTarget(input: RoutingTargetSelector): Promise<boolean>;
  abstract deleteRule(input: RuleSelector): Promise<boolean>;
  abstract discardItem(
    input: DiscardItemInput,
  ): Promise<InboxItemDetail | null>;
  abstract issueCredential(
    input: IssueCredentialInput,
  ): Promise<IssueInboxChannelCredentialResponse>;
  abstract listChannels(input: TenantContext): Promise<InboxChannel[]>;
  abstract listItems(input: ListItemsInput): Promise<InboxItemListResponse>;
  abstract listRoutingTargets(
    input: TenantContext,
  ): Promise<InboxRoutingTarget[]>;
  abstract listRules(input: TenantContext): Promise<InboxRule[]>;
  abstract orderRules(input: OrderRulesInput): Promise<InboxRule[]>;
  abstract putRoutingTarget(
    input: PutRoutingTargetInput,
  ): Promise<InboxRoutingTarget | null>;
  abstract readBlob(input: ReadBlobInput): Promise<BlobRecord | null>;
  abstract readChannel(input: ChannelSelector): Promise<InboxChannel | null>;
  abstract readChannelPrincipal(input: {
    channelId: string;
    organizationId: string;
  }): Promise<boolean>;
  abstract readInboxSettings(
    input: ReadInboxSettingsInput,
  ): Promise<InboxSettings>;
  abstract readItem(input: ReadItemInput): Promise<InboxItemDetail | null>;
  abstract readRule(input: RuleSelector): Promise<InboxRule | null>;
  abstract readProviderInput(
    input: ReadItemInput,
  ): Promise<{ files: ItemFileRecord[]; input: ProviderInput } | null>;
  abstract receiveIntake(
    input: ReceiveIntakeInput,
  ): Promise<ReceiveIntakeResult>;
  abstract recordExtraction(
    input: RecordExtractionInput,
  ): Promise<InboxItemDetail | null>;
  abstract reopenEmailItem(
    input: ReadItemInput,
  ): Promise<ReopenedEmailItem | null>;
  abstract restoreItem(input: ReadItemInput): Promise<InboxItemDetail | null>;
  abstract revokeCredential(input: RevokeCredentialInput): Promise<boolean>;
  abstract routeToDocument(
    input: RouteToDocumentInput,
  ): Promise<InboxItemDetail | null>;
  abstract snoozeItem(input: SnoozeItemInput): Promise<InboxItemDetail | null>;
  abstract undoRoute(input: ReadItemInput): Promise<InboxItemDetail | null>;
  abstract updateChannel(
    input: UpdateChannelInput,
  ): Promise<InboxChannel | null>;
  abstract updateHints(
    input: UpdateHintsInput,
  ): Promise<InboxItemDetail | null>;
  abstract updateInboxSettings(
    input: UpdateInboxSettingsInput,
  ): Promise<InboxSettings | null>;
  abstract updateRule(input: UpdateRuleInput): Promise<InboxRule | null>;
}

@Injectable()
export class DatabaseInboxRepository
  extends InboxRepository
  implements OnModuleDestroy
{
  private poolPromise: Promise<DatabasePool> | undefined;

  async adoptRule(input: AdoptRuleInput): Promise<InboxRule | null> {
    return adoptRule(await this.getPool(), input);
  }

  async approveItem(input: ReadItemInput): Promise<InboxItemDetail | null> {
    return approveItem(await this.getPool(), input);
  }

  async assignItem(input: AssignItemInput): Promise<InboxItemDetail | null> {
    return assignItem(await this.getPool(), input);
  }

  async attachItem(input: AttachItemInput): Promise<InboxItemDetail | null> {
    return attachItem(await this.getPool(), input);
  }

  async createRule(input: CreateRuleInput): Promise<InboxRule | null> {
    return createRule(await this.getPool(), input);
  }

  async deleteRule(input: RuleSelector): Promise<boolean> {
    return deleteRule(await this.getPool(), input);
  }

  async listRules(input: TenantContext): Promise<InboxRule[]> {
    return listRules(await this.getPool(), input);
  }

  async orderRules(input: OrderRulesInput): Promise<InboxRule[]> {
    return orderRules(await this.getPool(), input);
  }

  async readRule(input: RuleSelector): Promise<InboxRule | null> {
    return readRule(await this.getPool(), input);
  }

  async updateRule(input: UpdateRuleInput): Promise<InboxRule | null> {
    return updateRule(await this.getPool(), input);
  }

  async createChannel(input: CreateChannelInput): Promise<InboxChannel | null> {
    return createChannel(await this.getPool(), input);
  }

  async deleteRoutingTarget(input: RoutingTargetSelector): Promise<boolean> {
    return deleteRoutingTarget(await this.getPool(), input);
  }

  async discardItem(input: DiscardItemInput): Promise<InboxItemDetail | null> {
    return discardItem(await this.getPool(), input);
  }

  async issueCredential(
    input: IssueCredentialInput,
  ): Promise<IssueInboxChannelCredentialResponse> {
    return issueCredential(await this.getPool(), input);
  }

  async listChannels(input: TenantContext): Promise<InboxChannel[]> {
    return listChannels(await this.getPool(), input);
  }

  async listItems(input: ListItemsInput): Promise<InboxItemListResponse> {
    return listItems(await this.getPool(), input);
  }

  async listRoutingTargets(
    input: TenantContext,
  ): Promise<InboxRoutingTarget[]> {
    return listRoutingTargets(await this.getPool(), input);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.poolPromise !== undefined) {
      await (await this.poolPromise).end();
    }
  }

  async putRoutingTarget(
    input: PutRoutingTargetInput,
  ): Promise<InboxRoutingTarget | null> {
    return putRoutingTarget(await this.getPool(), input);
  }

  async readBlob(input: ReadBlobInput): Promise<BlobRecord | null> {
    return readBlob(await this.getPool(), input);
  }

  async readChannel(input: ChannelSelector): Promise<InboxChannel | null> {
    return readChannel(await this.getPool(), input);
  }

  async readChannelPrincipal(input: {
    channelId: string;
    organizationId: string;
  }): Promise<boolean> {
    return readChannelPrincipal(await this.getPool(), input);
  }

  async readInboxSettings(
    input: ReadInboxSettingsInput,
  ): Promise<InboxSettings> {
    return readInboxSettings(await this.getPool(), input);
  }

  async readItem(input: ReadItemInput): Promise<InboxItemDetail | null> {
    return readItem(await this.getPool(), input);
  }

  async readProviderInput(
    input: ReadItemInput,
  ): Promise<{ files: ItemFileRecord[]; input: ProviderInput } | null> {
    return readProviderInput(await this.getPool(), input);
  }

  async receiveIntake(input: ReceiveIntakeInput): Promise<ReceiveIntakeResult> {
    return receiveIntake(await this.getPool(), input);
  }

  async recordExtraction(
    input: RecordExtractionInput,
  ): Promise<InboxItemDetail | null> {
    return recordExtraction(await this.getPool(), input);
  }

  async reopenEmailItem(
    input: ReadItemInput,
  ): Promise<ReopenedEmailItem | null> {
    return reopenEmailItem(await this.getPool(), input);
  }

  async restoreItem(input: ReadItemInput): Promise<InboxItemDetail | null> {
    return restoreItem(await this.getPool(), input);
  }

  async revokeCredential(input: RevokeCredentialInput): Promise<boolean> {
    return revokeCredential(await this.getPool(), input);
  }

  async routeToDocument(
    input: RouteToDocumentInput,
  ): Promise<InboxItemDetail | null> {
    return routeToDocument(await this.getPool(), input);
  }

  async snoozeItem(input: SnoozeItemInput): Promise<InboxItemDetail | null> {
    return snoozeItem(await this.getPool(), input);
  }

  async undoRoute(input: ReadItemInput): Promise<InboxItemDetail | null> {
    return undoRoute(await this.getPool(), input);
  }

  async updateChannel(input: UpdateChannelInput): Promise<InboxChannel | null> {
    return updateChannel(await this.getPool(), input);
  }

  async updateHints(input: UpdateHintsInput): Promise<InboxItemDetail | null> {
    return updateHints(await this.getPool(), input);
  }

  async updateInboxSettings(
    input: UpdateInboxSettingsInput,
  ): Promise<InboxSettings | null> {
    return updateInboxSettings(await this.getPool(), input);
  }

  private getPool(): Promise<DatabasePool> {
    this.poolPromise ??= loadDatabaseConfiguration(process.env, {
      role: 'bap_api',
    }).then(createDatabasePool);
    return this.poolPromise;
  }
}
