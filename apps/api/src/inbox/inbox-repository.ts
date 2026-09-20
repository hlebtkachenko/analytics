import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { runInTenantContext } from '@bap/db';
import type {
  BlobScanStatus,
  InboxChannelKind,
  InboxCorrectionField,
  InboxCorrectionSource,
  InboxDiscardReason,
  TenantContext,
} from '@bap/db';
import { loadDatabaseConfiguration } from '@bap/db/config';
import { createDatabasePool } from '@bap/db/pool';
import type { DatabasePool } from '@bap/db/pool';
import type { PoolClient } from 'pg';

import {
  channelTenant,
  type ChannelPrincipalReader,
} from '../channel-access.js';
import type { EntityScopeSelector } from '../datasets/dataset-repository.js';
import {
  createDocumentRequestSchema,
  INVOICE_KINDS,
} from '../documents/contract.js';
import type { CreateDocumentRequest } from '../documents/contract.js';
import {
  createDocumentInTransaction,
  deleteDocumentInTransaction,
  documentTotalOf,
} from '../documents/document-repository.js';
import { entityFilter } from '../documents/sql.js';
import {
  DETECTED_TYPES,
  HUMAN_TOUCH_EVENT_KINDS,
  INBOX_ASSIGNEE_NONE,
  INBOX_CONFIDENCE_HIGH_FROM,
  INBOX_CONFIDENCE_MEDIUM_FROM,
  MAX_ENABLED_INBOX_RULES,
  RULE_PROVIDER,
  RULE_PROVIDER_VERSION,
  ruleDraftSchema,
} from './contract.js';
import type {
  CorrectionReasons,
  DuplicateCandidate,
  CreateInboxChannelRequest,
  CreateInboxRuleRequest,
  InboxChannel,
  InboxChannelCredential,
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
  ProviderOutput,
  PutInboxRoutingTargetRequest,
  RouteInboxItemJob,
  RuleDraft,
  SplitEmailItemJob,
  UpdateInboxChannelRequest,
  UpdateInboxHintsRequest,
  UpdateInboxRuleRequest,
} from './contract.js';
import {
  CORRECTION_FIELD_BY_DRAFT_KEY,
  composeDocumentDraft,
  toCreateDocumentBody,
  type ComposedDocumentDraft,
} from './draft-composer.js';
import {
  MANUAL_PROVIDER,
  MANUAL_PROVIDER_VERSION,
  manualProvider,
} from './providers/manual.js';
import {
  evaluateRules,
  ruleReasons,
  type InboxRuleDefinition,
  type RuleActionField,
} from './rules.js';
import {
  knownDetectedType,
  routingTargetFor,
  type DetectedType,
  type RoutingTarget,
  type RoutingTargetOverrides,
} from './routing-targets.js';

export type { EntityScopeSelector };

type InboxEventKind = InboxEvent['kind'];
type InboxEventReason = NonNullable<InboxEvent['reason']>;

export interface ReadItemInput extends EntityScopeSelector {
  itemId: string;
}

export interface ListItemsInput extends EntityScopeSelector {
  query: InboxItemListQuery;
}

export interface ExtractionRecord {
  output: ProviderOutput;
  provider: string;
  providerVersion: string;
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

export interface ChannelSelector extends TenantContext {
  channelId: string;
}

export interface CreateChannelInput extends TenantContext {
  body: CreateInboxChannelRequest;
}

export interface UpdateChannelInput extends ChannelSelector {
  body: UpdateInboxChannelRequest;
}

export interface RevokeCredentialInput extends ChannelSelector {
  credentialId: string;
}

export interface IssueCredentialInput extends ChannelSelector {
  // The platform intake domain an email address is issued under; unused for an API channel.
  intakeDomain: string;
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

export interface RulePassInput extends TenantContext {
  itemId: string;
  // A rerun narrows the pass to one rule; absent means every live rule of the organization.
  ruleIds?: readonly string[];
  // The body text of a text payload, read outside the transaction; null for every other item.
  text: string | null;
}

// Who decided a route: the person, the rule that asked, or the editor of the target default that asked.
export type RouteDecision =
  | { kind: 'rule'; ruleId: string }
  | { kind: 'target_default'; userId: string }
  | { kind: 'user'; userId: string };

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

export interface RoutingTargetSelector extends TenantContext {
  detectedType: DetectedType;
}

export interface PutRoutingTargetInput extends RoutingTargetSelector {
  body: PutInboxRoutingTargetRequest;
}

export interface ReadInboxSettingsInput extends TenantContext {
  platformQuotaBytes: number;
}

export interface UpdateInboxSettingsInput extends ReadInboxSettingsInput {
  blobQuotaBytes: number | null;
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

export interface ItemFileRecord extends InboxItemFile {
  storageKey: string;
}

interface ItemRow {
  assignee_id: string | null;
  channel_id: string | null;
  channel_kind: string;
  confidence: string | null;
  created_at: Date;
  dataset_id: string | null;
  decided_by_kind: string | null;
  decided_by_rule_id: string | null;
  decided_by_user_id: string | null;
  detected_type: string | null;
  document_id: string | null;
  duplicate_of_item_id: string | null;
  hint_kind: string | null;
  human_touched: boolean;
  hint_legal_entity_id: string | null;
  hint_link_document_id: string | null;
  hint_partner_id: string | null;
  hint_text: string | null;
  id: string;
  legal_entity_id: string | null;
  origin: string | null;
  partner_id: string | null;
  payload_kind: string;
  received_at: Date;
  routed_at: Date | null;
  snoozed_until: Date | null;
  status: string;
  updated_at: Date;
}

interface ChannelRow {
  created_at: Date;
  email_address: string | null;
  enabled: boolean;
  hint_kind: string | null;
  id: string;
  item_count: number;
  kind: string;
  legal_entity_id: string | null;
  name: string;
  updated_at: Date;
}

interface CredentialRow {
  created_at: Date;
  credential_id: string;
  display_prefix: string;
  last_used_at: Date | null;
}

interface ListRow extends ItemRow {
  file_count: number;
  primary_filename: string | null;
}

interface RoutingTargetRow {
  auto: string;
  auto_threshold: string | null;
  default_assignee_id: string | null;
  default_legal_entity_id: string | null;
  destination: string;
  detected_type: string;
  document_kind: string | null;
  partner_policy: string;
  required_fields: string[];
}

interface FileRow {
  blob_id: string;
  byte_size: string;
  media_type: string;
  original_filename: string | null;
  position: number;
  scan_status: BlobScanStatus;
  sha256: string;
  storage_key: string;
}

const ITEM_COLUMNS = `i.id, i.legal_entity_id, i.channel_kind, i.channel_id, i.origin, i.payload_kind, i.status, i.detected_type,
          i.confidence::text as confidence, i.hint_text, i.hint_legal_entity_id, i.hint_kind, i.hint_partner_id,
          i.hint_link_document_id, i.duplicate_of_item_id, i.document_id, i.dataset_id, i.partner_id,
          i.decided_by_kind, i.decided_by_rule_id, i.decided_by_user_id, i.routed_at, i.assignee_id, i.snoozed_until,
          i.received_at, i.created_at, i.updated_at,
          exists (select 1 from app.inbox_event as e
                   where e.item_id = i.id and e.organization_id = i.organization_id
                     and e.actor_user_id is not null
                     and e.kind in (${HUMAN_TOUCH_EVENT_KINDS.map((kind) => `'${kind}'`).join(', ')})) as human_touched`;

// An unrouted item has no entity, so only the unrestricted scope sees it; a restricted member sees its own entities.
const SCOPE_FILTER = `($1::uuid[] is null
       or (i.legal_entity_id is not null and i.legal_entity_id = any($1::uuid[])))`;

function toItem(row: ItemRow): InboxItem {
  return {
    assigneeId: row.assignee_id,
    channelId: row.channel_id,
    channelKind: row.channel_kind as InboxItem['channelKind'],
    confidence: row.confidence === null ? null : Number(row.confidence),
    createdAt: row.created_at.toISOString(),
    datasetId: row.dataset_id,
    decidedByKind: row.decided_by_kind as InboxItem['decidedByKind'],
    decidedByRuleId: row.decided_by_rule_id,
    decidedByUserId: row.decided_by_user_id,
    detectedType: row.detected_type,
    documentId: row.document_id,
    duplicateOfItemId: row.duplicate_of_item_id,
    hintKind: row.hint_kind,
    hintLegalEntityId: row.hint_legal_entity_id,
    hintLinkDocumentId: row.hint_link_document_id,
    hintPartnerId: row.hint_partner_id,
    hintText: row.hint_text,
    humanTouched: row.human_touched,
    id: row.id,
    legalEntityId: row.legal_entity_id,
    origin: row.origin,
    partnerId: row.partner_id,
    payloadKind: row.payload_kind as InboxItem['payloadKind'],
    receivedAt: row.received_at.toISOString(),
    routedAt: row.routed_at === null ? null : row.routed_at.toISOString(),
    snoozedUntil:
      row.snoozed_until === null ? null : row.snoozed_until.toISOString(),
    status: row.status as InboxItem['status'],
    updatedAt: row.updated_at.toISOString(),
  };
}

function toListEntry(row: ListRow): InboxItemListEntry {
  return {
    ...toItem(row),
    fileCount: row.file_count,
    primaryFilename: row.primary_filename,
  };
}

function toFile(row: FileRow): ItemFileRecord {
  return {
    blobId: row.blob_id,
    byteSize: Number(row.byte_size),
    mediaType: row.media_type,
    originalFilename: row.original_filename,
    position: row.position,
    scanStatus: row.scan_status,
    sha256: row.sha256,
    storageKey: row.storage_key,
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

// Every write path locks the row it is about to change, so two concurrent decisions on one item serialise.
export async function loadItem(
  transaction: PoolClient,
  itemId: string,
  legalEntityIds: readonly string[] | null,
  forUpdate = false,
): Promise<InboxItem | null> {
  const result = await transaction.query<ItemRow>(
    `select ${ITEM_COLUMNS}
       from app.inbox_item as i
      where i.id = $2 and ${SCOPE_FILTER}${forUpdate ? ' for update' : ''}`,
    [entityFilter(legalEntityIds), itemId],
  );
  const row = result.rows[0];

  return row === undefined ? null : toItem(row);
}

export async function loadItemFiles(
  transaction: PoolClient,
  itemId: string,
): Promise<ItemFileRecord[]> {
  const result = await transaction.query<FileRow>(
    `select f.blob_id, f.position, b.sha256, b.byte_size::text as byte_size, b.media_type,
            b.original_filename, b.scan_status, b.storage_key
       from app.inbox_item_file as f
       join app.blob as b on b.id = f.blob_id
      where f.item_id = $1
      order by f.position`,
    [itemId],
  );

  return result.rows.map(toFile);
}

export async function loadLatestExtraction(
  transaction: PoolClient,
  itemId: string,
): Promise<InboxExtraction | null> {
  const result = await transaction.query<{
    confidence: string;
    created_at: Date;
    detected_type: string | null;
    draft: Record<string, unknown>;
    field_confidences: Record<string, number>;
    id: string;
    issues: InboxExtraction['issues'];
    legal_entity_id: string | null;
    provider: string;
    provider_version: string;
    reasons: InboxExtraction['reasons'];
  }>(
    `select id, provider, provider_version, detected_type, confidence::text as confidence, legal_entity_id,
            draft, field_confidences, reasons, issues, created_at
       from app.inbox_item_extraction
      where item_id = $1
      order by created_at desc, id desc
      limit 1`,
    [itemId],
  );
  const row = result.rows[0];

  return row === undefined
    ? null
    : {
        confidence: Number(row.confidence),
        createdAt: row.created_at.toISOString(),
        detectedType: row.detected_type,
        draft: row.draft,
        fieldConfidences: row.field_confidences,
        id: row.id,
        issues: row.issues,
        legalEntityId: row.legal_entity_id,
        provider: row.provider,
        providerVersion: row.provider_version,
        reasons: row.reasons,
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

function toRoutingTarget(row: RoutingTargetRow): RoutingTarget {
  return {
    auto: row.auto as RoutingTarget['auto'],
    autoThreshold:
      row.auto_threshold === null ? null : Number(row.auto_threshold),
    defaultAssigneeId: row.default_assignee_id,
    defaultLegalEntityId: row.default_legal_entity_id,
    destination: row.destination as RoutingTarget['destination'],
    documentKind: row.document_kind as RoutingTarget['documentKind'],
    partnerPolicy: row.partner_policy as RoutingTarget['partnerPolicy'],
    requiredFields: row.required_fields,
  };
}

// The one read path of the targets: the definer serves the organization's rows to every principal, the channel included.
async function loadRoutingTargetOverrides(
  transaction: PoolClient,
): Promise<RoutingTargetOverrides> {
  const result = await transaction.query<RoutingTargetRow>(
    `select detected_type, destination, document_kind, default_legal_entity_id, partner_policy,
            auto, auto_threshold::text as auto_threshold, default_assignee_id, required_fields
       from app.list_inbox_routing_targets()`,
  );
  const overrides: RoutingTargetOverrides = {};

  for (const row of result.rows) {
    const known = DETECTED_TYPES.find((type) => type === row.detected_type);

    if (known !== undefined) {
      overrides[known] = toRoutingTarget(row);
    }
  }

  return overrides;
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

async function loadDetail(
  transaction: PoolClient,
  item: InboxItem,
): Promise<InboxItemDetail> {
  const sender = await transaction.query<{ sender: string | null }>(
    'select sender from app.inbox_item where id = $1',
    [item.id],
  );

  return {
    corrections: await loadCorrections(transaction, item.id),
    events: await loadEvents(transaction, item.id),
    extraction: await loadLatestExtraction(transaction, item.id),
    files: (await loadItemFiles(transaction, item.id)).map(publicFile),
    item: { ...item, sender: sender.rows[0]?.sender ?? null },
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

export async function appendEvent(
  transaction: PoolClient,
  input: TenantContext,
  itemId: string,
  kind: InboxEventKind,
  reason: InboxEventReason | null = null,
): Promise<void> {
  // clock_timestamp, not now(): several events of one transaction must keep their insertion order.
  // A channel is not a person, so its events carry no actor; the audit log still names the channel subject.
  await transaction.query(
    `insert into app.inbox_event (organization_id, item_id, kind, reason, actor_user_id, created_at)
     values ($1, $2, $3, $4, $5, clock_timestamp())`,
    [
      input.organizationId,
      itemId,
      kind,
      reason,
      input.role === 'channel' ? null : input.userId,
    ],
  );
}

// One row per provider run; the item carries the latest verdict so the list can filter on it.
export async function insertExtraction(
  transaction: PoolClient,
  input: TenantContext,
  itemId: string,
  extraction: ExtractionRecord,
  event: InboxEventKind = 'classified',
): Promise<void> {
  const { output } = extraction;

  await transaction.query(
    `insert into app.inbox_item_extraction
       (organization_id, item_id, provider, provider_version, detected_type, confidence, legal_entity_id,
        draft, field_confidences, reasons, issues, created_by, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12, clock_timestamp())`,
    [
      input.organizationId,
      itemId,
      extraction.provider,
      extraction.providerVersion,
      output.detectedType,
      output.confidence,
      output.legalEntityId ?? null,
      JSON.stringify(output.draft),
      JSON.stringify(output.fieldConfidences),
      JSON.stringify(output.reasons),
      JSON.stringify(output.issues),
      input.userId,
    ],
  );
  await transaction.query(
    `update app.inbox_item
        set detected_type = $2, confidence = $3, updated_at = now()
      where id = $1`,
    [itemId, output.detectedType, output.confidence],
  );
  await appendEvent(transaction, input, itemId, event);
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
          legal_entity_id, hint_kind, origin, external_id, parent_item_id, sender, created_by)
       values ($1, $2, $3, $4, 'received', $5, $6, $7, $8, $9, $10, $11, $12)
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
async function loadRulesById(
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

// The auto-route decision of the spec, conditions (a) to (e), taken inside the same transaction as the matcher.
function decideAutoRoute(input: {
  autoRouteRuleId: string | null;
  confidence: number;
  latestIssueCount: number;
  missing: readonly string[];
  resolvedKind: string | null;
  target: InboxRoutingTarget;
}): { job: 'route' | null; reason: string | null } {
  const { target } = input;
  const asked =
    input.autoRouteRuleId !== null ||
    target.auto === 'always' ||
    (target.auto === 'above_threshold' &&
      target.autoThreshold !== null &&
      input.confidence >= target.autoThreshold);

  if (!asked) {
    return { job: null, reason: null };
  }

  if (target.destination !== 'documents') {
    return {
      job: null,
      reason:
        'Auto-route waits: only the documents destination routes automatically.',
    };
  }

  if (
    input.resolvedKind !== null &&
    INVOICE_KINDS.includes(input.resolvedKind as (typeof INVOICE_KINDS)[number])
  ) {
    return {
      job: null,
      reason:
        'Auto-route waits: an invoice kind needs the ISDOC parser on the connections track.',
    };
  }

  if (input.missing.length > 0) {
    return {
      job: null,
      reason: `Auto-route waits: the draft is missing ${input.missing.join(', ')}.`,
    };
  }

  if (input.latestIssueCount > 0) {
    return {
      job: null,
      reason: 'Auto-route waits: the newest extraction raised an issue.',
    };
  }

  return { job: 'route', reason: null };
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

  const sender = await transaction.query<{ sender: string | null }>(
    'select sender from app.inbox_item where id = $1',
    [item.id],
  );
  const files = await loadItemFiles(transaction, item.id);
  const primaryFilename = files[0]?.originalFilename ?? null;
  const evaluation = evaluateRules(rules, {
    channelId: item.channelId,
    detectedType: item.detectedType,
    filename: primaryFilename,
    hintText: item.hintText,
    sender: sender.rows[0]?.sender ?? null,
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
  const latest = await loadLatestExtraction(transaction, item.id);
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
  );
  const decision =
    evaluation.discard === null
      ? decideAutoRoute({
          autoRouteRuleId: evaluation.autoRouteRuleId,
          confidence: item.confidence ?? 0,
          latestIssueCount: latest?.issues.length ?? 0,
          missing: composed.missing,
          resolvedKind: composed.draft.kind,
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
                                     else i.confidence >= $8::numeric end)`;
    const total = await transaction.query<{ total: number }>(
      `select count(*)::int as total from app.inbox_item as i where ${filter}`,
      values,
    );
    // The page is cut first so the file summary only runs for the rows it returns.
    const items = await transaction.query<ListRow>(
      `select p.*, files.file_count, files.primary_filename
         from (select ${ITEM_COLUMNS}, i.organization_id
                 from app.inbox_item as i
                where ${filter}
                order by i.received_at desc, i.id desc
                limit $9 offset $10) as p
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

    return {
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
    return item === null ? null : loadDetail(transaction, item);
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
    return after === null ? null : loadDetail(transaction, after);
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
    return after === null ? null : loadDetail(transaction, after);
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

    return routeInTransaction(transaction, input, before, files);
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
            toCreateDocumentBody(composed.draft),
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
    return null;
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
  return after === null ? null : loadDetail(transaction, after);
}

// The draft a route suggests: the hints, the rules the newest rule extraction named, and the effective target.
export async function loadRouteSuggestion(
  transaction: PoolClient,
  item: InboxItem,
  files: readonly ItemFileRecord[],
): Promise<ReturnType<typeof composeDocumentDraft>> {
  return composeDocumentDraft(
    { ...item, primaryFilename: files[0]?.originalFilename ?? null },
    await loadRulesById(
      transaction,
      await loadMatchedRuleIds(transaction, item.id),
    ),
    routingTargetFor(
      item.detectedType,
      await loadRoutingTargetOverrides(transaction),
    ),
  );
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
    return after === null ? null : loadDetail(transaction, after);
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
          detail: await loadDetail(transaction, after),
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
  suggested: ReturnType<typeof composeDocumentDraft>,
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
      const deleted = await deleteDocumentInTransaction(transaction, {
        ...input,
        documentId: before.documentId,
      });

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
    return after === null ? null : loadDetail(transaction, after);
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
    return after === null ? null : loadDetail(transaction, after);
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
    return after === null ? null : loadDetail(transaction, after);
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
    return after === null ? null : loadDetail(transaction, after);
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

// The channel answers only for itself: the tenant transaction runs as the channel and RLS shows it its own row.
export async function readChannelPrincipal(
  pool: DatabasePool,
  input: { channelId: string; organizationId: string },
): Promise<boolean> {
  return runInTenantContext(
    pool,
    channelTenant(input.organizationId, input.channelId),
    async (transaction) => {
      const found = await transaction.query(
        'select 1 from app.inbox_channel where id = $1 and enabled and deleted_at is null',
        [input.channelId],
      );
      return found.rows.length > 0;
    },
  );
}

const CHANNEL_COLUMNS = `c.id, c.kind, c.name, c.enabled, c.email_address, c.legal_entity_id, c.hint_kind, c.created_at,
          c.updated_at,
          (select count(*)::int from app.inbox_item as i where i.channel_id = c.id) as item_count`;

async function loadCredentials(
  transaction: PoolClient,
  channelId: string,
): Promise<InboxChannelCredential[]> {
  const result = await transaction.query<CredentialRow>(
    'select credential_id, display_prefix, created_at, last_used_at from auth.list_channel_credentials($1)',
    [channelId],
  );

  return result.rows.map((row) => ({
    createdAt: row.created_at.toISOString(),
    credentialId: row.credential_id,
    displayPrefix: row.display_prefix,
    lastUsedAt:
      row.last_used_at === null ? null : row.last_used_at.toISOString(),
  }));
}

async function toChannel(
  transaction: PoolClient,
  row: ChannelRow,
): Promise<InboxChannel> {
  return {
    createdAt: row.created_at.toISOString(),
    credentials: await loadCredentials(transaction, row.id),
    emailAddress: row.email_address,
    enabled: row.enabled,
    hintKind: row.hint_kind,
    id: row.id,
    itemCount: row.item_count,
    kind: row.kind as InboxChannel['kind'],
    legalEntityId: row.legal_entity_id,
    name: row.name,
    updatedAt: row.updated_at.toISOString(),
  };
}

async function loadChannel(
  transaction: PoolClient,
  channelId: string,
): Promise<InboxChannel | null> {
  const result = await transaction.query<ChannelRow>(
    `select ${CHANNEL_COLUMNS}
       from app.inbox_channel as c
      where c.id = $1 and c.deleted_at is null`,
    [channelId],
  );
  const row = result.rows[0];

  return row === undefined ? null : toChannel(transaction, row);
}

// A legal entity of another organization fails the composite foreign key, which is a not-visible entity, not a fault.
function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === '23503'
  );
}

// An insert the row policy refuses raises instead of matching no row; the API gate answers before it, so this is not a fault.
function isPolicyViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === '42501'
  );
}

export async function listChannels(
  pool: DatabasePool,
  input: TenantContext,
): Promise<InboxChannel[]> {
  return runInTenantContext(pool, input, async (transaction) => {
    const result = await transaction.query<ChannelRow>(
      `select ${CHANNEL_COLUMNS}
         from app.inbox_channel as c
        where c.deleted_at is null
        order by c.created_at, c.id`,
    );
    const channels: InboxChannel[] = [];

    for (const row of result.rows) {
      channels.push(await toChannel(transaction, row));
    }

    return channels;
  });
}

export async function readChannel(
  pool: DatabasePool,
  input: ChannelSelector,
): Promise<InboxChannel | null> {
  return runInTenantContext(pool, input, (transaction) =>
    loadChannel(transaction, input.channelId),
  );
}

export async function createChannel(
  pool: DatabasePool,
  input: CreateChannelInput,
): Promise<InboxChannel | null> {
  const { body } = input;

  return runInTenantContext(pool, input, async (transaction) => {
    let created: { rows: { id: string }[] };

    try {
      created = await transaction.query<{ id: string }>(
        `insert into app.inbox_channel (organization_id, kind, name, legal_entity_id, hint_kind, created_by)
         values ($1, $2, $3, $4::uuid, $5, $6)
         returning id`,
        [
          input.organizationId,
          body.kind,
          body.name,
          body.legalEntityId ?? null,
          body.hintKind ?? null,
          input.userId,
        ],
      );
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        return null;
      }

      throw error;
    }

    const channelId = created.rows[0]?.id;

    if (channelId === undefined) {
      throw new Error('The inbox channel insert returned no row.');
    }

    await transaction.query(
      "select app.record_audit('inbox_channel.created', 'inbox_channel', $1, $2::jsonb)",
      [channelId, JSON.stringify({ kind: body.kind })],
    );

    return loadChannel(transaction, channelId);
  });
}

export async function updateChannel(
  pool: DatabasePool,
  input: UpdateChannelInput,
): Promise<InboxChannel | null> {
  const { body } = input;

  return runInTenantContext(pool, input, async (transaction) => {
    let updated: { rowCount: number | null };

    try {
      updated = await transaction.query(
        `update app.inbox_channel
            set name = case when $2 then $3 else name end,
                enabled = case when $4 then $5 else enabled end,
                legal_entity_id = case when $6 then $7::uuid else legal_entity_id end,
                hint_kind = case when $8 then $9 else hint_kind end,
                deleted_at = case when $10 then now() else deleted_at end,
                updated_at = now()
          where id = $1 and deleted_at is null`,
        [
          input.channelId,
          body.name !== undefined,
          body.name ?? null,
          body.enabled !== undefined,
          body.enabled ?? null,
          body.legalEntityId !== undefined,
          body.legalEntityId ?? null,
          body.hintKind !== undefined,
          body.hintKind ?? null,
          body.deleted === true,
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
      "select app.record_audit('inbox_channel.updated', 'inbox_channel', $1, $2::jsonb)",
      [
        input.channelId,
        JSON.stringify({
          deleted: body.deleted === true,
          enabled: body.enabled ?? null,
        }),
      ],
    );

    // A soft deleted channel is gone for the caller from this response on.
    if (body.deleted === true) {
      const gone = await transaction.query<ChannelRow>(
        `select ${CHANNEL_COLUMNS} from app.inbox_channel as c where c.id = $1`,
        [input.channelId],
      );
      const row = gone.rows[0];
      return row === undefined ? null : toChannel(transaction, row);
    }

    return loadChannel(transaction, input.channelId);
  });
}

// The definer decides everything: owner role, organization, the per-kind active limit. Its errors map in the service.
// The credential kind follows the channel kind; an email channel is issued its address under the intake domain.
export async function issueCredential(
  pool: DatabasePool,
  input: IssueCredentialInput,
): Promise<IssueInboxChannelCredentialResponse> {
  return runInTenantContext(pool, input, async (transaction) => {
    const channel = await transaction.query<{ kind: string }>(
      'select kind from app.inbox_channel where id = $1 and deleted_at is null',
      [input.channelId],
    );
    const kind = channel.rows[0]?.kind;

    if (kind === undefined) {
      throw new NotFoundException();
    }

    const issued = await transaction.query<{
      credential_id: string;
      display_prefix: string;
      secret: string;
    }>(
      'select credential_id, secret, display_prefix from auth.issue_channel_credential($1, $2, $3)',
      kind === 'email'
        ? [input.channelId, 'email_address', input.intakeDomain]
        : [input.channelId, 'api_token', null],
    );
    const row = issued.rows[0];

    if (row === undefined) {
      throw new Error('The credential issue returned no row.');
    }

    await transaction.query(
      "select app.record_audit('inbox_channel_credential.issued', 'inbox_channel', $1, $2::jsonb)",
      [input.channelId, JSON.stringify({ credentialId: row.credential_id })],
    );

    return {
      credentialId: row.credential_id,
      displayPrefix: row.display_prefix,
      secret: row.secret,
    };
  });
}

// False when the credential is unknown, revoked, or not one of this channel's; the caller answers 404.
export async function revokeCredential(
  pool: DatabasePool,
  input: RevokeCredentialInput,
): Promise<boolean> {
  return runInTenantContext(pool, input, async (transaction) => {
    const active = await loadCredentials(transaction, input.channelId);

    if (
      !active.some(
        (credential) => credential.credentialId === input.credentialId,
      )
    ) {
      return false;
    }

    const revoked = await transaction.query<{ revoked: boolean }>(
      'select auth.revoke_channel_credential($1) as revoked',
      [input.credentialId],
    );

    if (revoked.rows[0]?.revoked !== true) {
      return false;
    }

    await transaction.query(
      "select app.record_audit('inbox_channel_credential.revoked', 'inbox_channel', $1, $2::jsonb)",
      [input.channelId, JSON.stringify({ credentialId: input.credentialId })],
    );

    return true;
  });
}

export async function listRoutingTargets(
  pool: DatabasePool,
  input: TenantContext,
): Promise<InboxRoutingTarget[]> {
  return runInTenantContext(pool, input, async (transaction) => {
    const overrides = await loadRoutingTargetOverrides(transaction);
    return DETECTED_TYPES.map((type) => routingTargetFor(type, overrides));
  });
}

// An upsert of the whole target; the row remembers who saved it because the rules auto-route runs as that account.
export async function putRoutingTarget(
  pool: DatabasePool,
  input: PutRoutingTargetInput,
): Promise<InboxRoutingTarget | null> {
  const { body } = input;
  const detectedType = knownDetectedType(input.detectedType);

  return runInTenantContext(pool, input, async (transaction) => {
    let saved: { rows: { id: string }[] };

    try {
      saved = await transaction.query<{ id: string }>(
        `insert into app.inbox_routing_target
           (organization_id, detected_type, destination, document_kind, default_legal_entity_id, partner_policy,
            auto, auto_threshold, default_assignee_id, required_fields, created_by, updated_by)
         values ($1, $2, $3, $4, $5::uuid, $6, $7, $8, $9, $10::text[], $11, $11)
         on conflict (organization_id, detected_type) do update
           set destination = excluded.destination,
               document_kind = excluded.document_kind,
               default_legal_entity_id = excluded.default_legal_entity_id,
               partner_policy = excluded.partner_policy,
               auto = excluded.auto,
               auto_threshold = excluded.auto_threshold,
               default_assignee_id = excluded.default_assignee_id,
               required_fields = excluded.required_fields,
               updated_at = now(),
               updated_by = excluded.updated_by
         returning id`,
        [
          input.organizationId,
          detectedType,
          body.destination,
          body.documentKind,
          body.defaultLegalEntityId,
          body.partnerPolicy,
          body.auto,
          body.autoThreshold,
          body.defaultAssigneeId,
          body.requiredFields,
          input.userId,
        ],
      );
    } catch (error) {
      if (isForeignKeyViolation(error) || isPolicyViolation(error)) {
        return null;
      }

      throw error;
    }

    const id = saved.rows[0]?.id;

    if (id === undefined) {
      throw new Error('The routing target upsert returned no row.');
    }

    await transaction.query(
      "select app.record_audit('inbox_routing_target.updated', 'inbox_routing_target', $1, $2::jsonb)",
      [
        id,
        JSON.stringify({
          auto: body.auto,
          destination: body.destination,
          detectedType,
          documentKind: body.documentKind,
        }),
      ],
    );

    return routingTargetFor(
      detectedType,
      await loadRoutingTargetOverrides(transaction),
    );
  });
}

// False when the organization holds no row for the type; the platform default was already in force.
export async function deleteRoutingTarget(
  pool: DatabasePool,
  input: RoutingTargetSelector,
): Promise<boolean> {
  const detectedType = knownDetectedType(input.detectedType);

  return runInTenantContext(pool, input, async (transaction) => {
    const deleted = await transaction.query<{ id: string }>(
      'delete from app.inbox_routing_target where detected_type = $1 returning id',
      [detectedType],
    );
    const id = deleted.rows[0]?.id;

    if (id === undefined) {
      return false;
    }

    await transaction.query(
      "select app.record_audit('inbox_routing_target.deleted', 'inbox_routing_target', $1, $2::jsonb)",
      [id, JSON.stringify({ detectedType })],
    );

    return true;
  });
}

async function loadInboxSettings(
  transaction: PoolClient,
  platformQuotaBytes: number,
): Promise<InboxSettings> {
  const setting = await transaction.query<{ blob_quota_bytes: string | null }>(
    'select blob_quota_bytes::text as blob_quota_bytes from app.organization_inbox_setting',
  );
  const used = await transaction.query<{ total: string }>(
    'select coalesce(sum(byte_size), 0)::text as total from app.blob',
  );
  const own = setting.rows[0]?.blob_quota_bytes ?? null;

  return {
    blobQuotaBytes: own === null ? null : Number(own),
    platformQuotaBytes,
    usedBytes: Number(used.rows[0]?.total ?? 0),
  };
}

export async function readInboxSettings(
  pool: DatabasePool,
  input: ReadInboxSettingsInput,
): Promise<InboxSettings> {
  return runInTenantContext(pool, input, (transaction) =>
    loadInboxSettings(transaction, input.platformQuotaBytes),
  );
}

// The row is created on first write and reset by nulling the column, never deleted; only an owner passes the policy.
export async function updateInboxSettings(
  pool: DatabasePool,
  input: UpdateInboxSettingsInput,
): Promise<InboxSettings | null> {
  return runInTenantContext(pool, input, async (transaction) => {
    try {
      await transaction.query(
        `insert into app.organization_inbox_setting (organization_id, blob_quota_bytes, created_by)
         values ($1, $2, $3)
         on conflict (organization_id) do update
           set blob_quota_bytes = excluded.blob_quota_bytes, updated_at = now()`,
        [input.organizationId, input.blobQuotaBytes, input.userId],
      );
    } catch (error) {
      if (isPolicyViolation(error)) {
        return null;
      }

      throw error;
    }

    await transaction.query(
      "select app.record_audit('organization_inbox_setting.updated', 'organization_inbox_setting', $1, $2::jsonb)",
      [
        input.organizationId,
        JSON.stringify({ blobQuotaBytes: input.blobQuotaBytes }),
      ],
    );

    return loadInboxSettings(transaction, input.platformQuotaBytes);
  });
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
