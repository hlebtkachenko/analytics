// The rows, mappers and writers every inbox repository slice shares.
import type { BlobScanStatus, TenantContext } from '@bap/db';
import type { PoolClient } from 'pg';

import { entityFilter } from '../documents/sql.js';
import { DETECTED_TYPES, HUMAN_TOUCH_EVENT_KINDS } from './contract.js';
import type {
  InboxEvent,
  InboxExtraction,
  InboxItem,
  InboxItemFile,
  ProviderOutput,
} from './contract.js';
import type {
  RoutingTarget,
  RoutingTargetOverrides,
} from './routing-targets.js';

export type InboxEventKind = InboxEvent['kind'];

export type InboxEventReason = NonNullable<InboxEvent['reason']>;

export interface ExtractionRecord {
  output: ProviderOutput;
  provider: string;
  providerVersion: string;
}

export interface ItemFileRecord extends InboxItemFile {
  storageKey: string;
}

export interface ItemRow {
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

export const ITEM_COLUMNS = `i.id, i.legal_entity_id, i.channel_kind, i.channel_id, i.origin, i.payload_kind, i.status, i.detected_type,
          i.confidence::text as confidence, i.hint_text, i.hint_legal_entity_id, i.hint_kind, i.hint_partner_id,
          i.hint_link_document_id, i.duplicate_of_item_id, i.document_id, i.dataset_id, i.partner_id,
          i.decided_by_kind, i.decided_by_rule_id, i.decided_by_user_id, i.routed_at, i.assignee_id, i.snoozed_until,
          i.received_at, i.created_at, i.updated_at,
          exists (select 1 from app.inbox_event as e
                   where e.item_id = i.id and e.organization_id = i.organization_id
                     and e.actor_user_id is not null
                     and e.kind in (${HUMAN_TOUCH_EVENT_KINDS.map((kind) => `'${kind}'`).join(', ')})) as human_touched`;

// An unrouted item has no entity, so only the unrestricted scope sees it; a restricted member sees its own entities.
export const SCOPE_FILTER = `($1::uuid[] is null
       or (i.legal_entity_id is not null and i.legal_entity_id = any($1::uuid[])))`;

export function toItem(row: ItemRow): InboxItem {
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
export async function loadRoutingTargetOverrides(
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

// A legal entity of another organization fails the composite foreign key, which is a not-visible entity, not a fault.
export function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === '23503'
  );
}

// An insert the row policy refuses raises instead of matching no row; the API gate answers before it, so this is not a fault.
export function isPolicyViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === '42501'
  );
}
