import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { runInTenantContext } from '@bap/db';
import type { InboxChannelKind, TenantContext } from '@bap/db';
import { loadDatabaseConfiguration } from '@bap/db/config';
import { createDatabasePool } from '@bap/db/pool';
import type { DatabasePool } from '@bap/db/pool';
import type { PoolClient } from 'pg';

import {
  channelTenant,
  type ChannelPrincipalReader,
} from '../channel-access.js';
import type { EntityScopeSelector } from '../datasets/dataset-repository.js';
import type { CreateDocumentRequest } from '../documents/contract.js';
import {
  createDocumentInTransaction,
  deleteDocumentInTransaction,
} from '../documents/document-repository.js';
import { entityFilter } from '../documents/sql.js';
import type {
  CreateInboxChannelRequest,
  InboxChannel,
  InboxChannelCredential,
  InboxEvent,
  InboxExtraction,
  InboxItem,
  InboxItemDetail,
  InboxItemFile,
  InboxItemListEntry,
  InboxItemListQuery,
  InboxItemListResponse,
  IssueInboxChannelCredentialResponse,
  ProviderInput,
  ProviderOutput,
  UpdateInboxChannelRequest,
  UpdateInboxHintsRequest,
} from './contract.js';

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
  payloadKind: 'file' | 'structured';
  // Runs last inside the transaction: a failed move rolls every row back, an earlier failure never moves the bytes.
  persist: () => Promise<void>;
  quotaBytes: number;
  sha256: string;
  sniff: ExtractionRecord;
  storageKey: string;
}

export interface ReceiveIntakeResult {
  duplicateOfItemId: string | null;
  files: InboxItemFile[];
  item: InboxItem;
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

export interface UpdateHintsInput extends ReadItemInput {
  body: UpdateInboxHintsRequest;
}

export interface RecordExtractionInput extends ReadItemInput {
  extraction: ExtractionRecord;
}

export interface RouteToDocumentInput extends ReadItemInput {
  document: CreateDocumentRequest;
  // The manual provider's verdict, stored so the decision keeps its provenance.
  extraction: ExtractionRecord;
  fileBlobIds: readonly string[];
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
  decided_by_user_id: string | null;
  detected_type: string | null;
  document_id: string | null;
  duplicate_of_item_id: string | null;
  hint_kind: string | null;
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

interface FileRow {
  blob_id: string;
  byte_size: string;
  media_type: string;
  original_filename: string | null;
  position: number;
  sha256: string;
  storage_key: string;
}

const ITEM_COLUMNS = `i.id, i.legal_entity_id, i.channel_kind, i.channel_id, i.origin, i.payload_kind, i.status, i.detected_type,
          i.confidence::text as confidence, i.hint_text, i.hint_legal_entity_id, i.hint_kind, i.hint_partner_id,
          i.hint_link_document_id, i.duplicate_of_item_id, i.document_id, i.dataset_id, i.partner_id,
          i.decided_by_kind, i.decided_by_user_id, i.routed_at, i.assignee_id, i.snoozed_until,
          i.received_at, i.created_at, i.updated_at`;

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
    decidedByUserId: row.decided_by_user_id,
    detectedType: row.detected_type,
    documentId: row.document_id,
    duplicateOfItemId: row.duplicate_of_item_id,
    hintKind: row.hint_kind,
    hintLegalEntityId: row.hint_legal_entity_id,
    hintLinkDocumentId: row.hint_link_document_id,
    hintPartnerId: row.hint_partner_id,
    hintText: row.hint_text,
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
    sha256: file.sha256,
  };
}

// Every write path locks the row it is about to change, so two concurrent decisions on one item serialise.
async function loadItem(
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
            b.original_filename, b.storage_key
       from app.inbox_item_file as f
       join app.blob as b on b.id = f.blob_id
      where f.item_id = $1
      order by f.position`,
    [itemId],
  );

  return result.rows.map(toFile);
}

async function loadLatestExtraction(
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

async function loadDetail(
  transaction: PoolClient,
  item: InboxItem,
): Promise<InboxItemDetail> {
  return {
    events: await loadEvents(transaction, item.id),
    extraction: await loadLatestExtraction(transaction, item.id),
    files: (await loadItemFiles(transaction, item.id)).map(publicFile),
    item,
  };
}

async function appendEvent(
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
async function insertExtraction(
  transaction: PoolClient,
  input: TenantContext,
  itemId: string,
  extraction: ExtractionRecord,
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
  await appendEvent(transaction, input, itemId, 'classified');
}

// The whole intake in one transaction: blob, item, file, events and the sniff verdict, then the bytes move into place.
export async function receiveIntake(
  pool: DatabasePool,
  input: ReceiveIntakeInput,
): Promise<ReceiveIntakeResult> {
  return runInTenantContext(pool, input, async (transaction) => {
    // One intake at a time per organization, so the quota sum, the replay and the duplicate lookup see every earlier row.
    await transaction.query('select pg_advisory_xact_lock(hashtext($1))', [
      input.organizationId,
    ]);

    // A replayed external id answers the item it already created and writes nothing.
    if (input.externalId !== null) {
      const replayed = await transaction.query<{ id: string }>(
        `select id from app.inbox_item
          where channel_kind = $1 and external_id = $2`,
        [input.channelKind, input.externalId],
      );
      const replayedId = replayed.rows[0]?.id;

      if (replayedId !== undefined) {
        const item = await loadItem(
          transaction,
          replayedId,
          input.legalEntityIds,
        );

        if (item === null) {
          throw new Error(
            'The replayed item is not readable in its own scope.',
          );
        }

        return {
          duplicateOfItemId: item.duplicateOfItemId,
          files: (await loadItemFiles(transaction, replayedId)).map(publicFile),
          item,
        };
      }
    }

    // A channel item inherits the entity and the kind hint of its channel; a disabled or foreign channel is not found.
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

      if (
        Number(used.rows[0]?.total ?? 0) + input.byteSize >
        input.quotaBytes
      ) {
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
          legal_entity_id, hint_kind, origin, external_id, created_by)
       values ($1, $2, $3, $4, 'received', $5, $6, $7, $8, $9, $10)
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
    await transaction.query(
      `update app.inbox_item set status = $2, updated_at = now() where id = $1`,
      [itemId, duplicate ? 'discarded' : 'needs_review'],
    );

    if (duplicate) {
      await appendEvent(transaction, input, itemId, 'discarded', 'duplicate');
    }

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

    return { duplicateOfItemId, files, item };
  });
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
    ];
    const filter = `${SCOPE_FILTER}
       and ($2::text[] is null or i.status = any($2::text[]))
       and ($3::text is null or i.detected_type = $3::text)`;
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
                limit $4 offset $5) as p
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

export async function routeToDocument(
  pool: DatabasePool,
  input: RouteToDocumentInput,
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

    const files = await loadItemFiles(transaction, before.id);
    const itemBlobIds = new Set(files.map((file) => file.blobId));

    // The body orders the item's own blobs and nothing else, so no foreign blob can be attached to the document.
    if (
      input.fileBlobIds.length !== itemBlobIds.size ||
      !input.fileBlobIds.every((blobId) => itemBlobIds.has(blobId))
    ) {
      throw new BadRequestException();
    }

    const created = await createDocumentInTransaction(transaction, {
      ...input,
      body: input.document,
      inbox: { itemId: before.id, source: 'upload' },
    });

    if (created === null) {
      return null;
    }

    await insertExtraction(transaction, input, before.id, input.extraction);

    const documentId = created.document.id;
    await transaction.query(
      `insert into app.document_file (document_id, organization_id, blob_id, position, created_by)
       select $1, $2, blob_id, position, $4
         from unnest($3::uuid[]) with ordinality as file(blob_id, position)`,
      [documentId, input.organizationId, [...input.fileBlobIds], input.userId],
    );
    await transaction.query(
      `update app.inbox_item
          set document_id = $2,
              legal_entity_id = $3,
              status = 'routed',
              decided_by_kind = 'user',
              decided_by_user_id = $4,
              routed_at = now(),
              updated_at = now()
        where id = $1`,
      [before.id, documentId, created.document.legalEntityId, input.userId],
    );
    await appendEvent(transaction, input, before.id, 'routed');
    await transaction.query(
      "select app.record_audit('inbox_item.routed', 'inbox_item', $1, $2::jsonb)",
      [before.id, JSON.stringify({ documentId, kind: input.document.kind })],
    );

    const after = await loadItem(transaction, before.id, input.legalEntityIds);
    return after === null ? null : loadDetail(transaction, after);
  });
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

    const deleted = await deleteDocumentInTransaction(transaction, {
      ...input,
      documentId: before.documentId,
    });

    if (!deleted) {
      return null;
    }

    await transaction.query(
      "select app.record_audit('inbox_item.unrouted', 'inbox_item', $1, '{}'::jsonb)",
      [before.id],
    );

    const after = await loadItem(transaction, before.id, input.legalEntityIds);
    return after === null ? null : loadDetail(transaction, after);
  });
}

async function transition(
  pool: DatabasePool,
  input: ReadItemInput,
  allowed: readonly InboxItem['status'][],
  status: InboxItem['status'],
  event: InboxEventKind,
  reason: InboxEventReason | null = null,
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
      'update app.inbox_item set status = $2, updated_at = now() where id = $1',
      [before.id, status],
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
  );
}

export function restoreItem(
  pool: DatabasePool,
  input: ReadItemInput,
): Promise<InboxItemDetail | null> {
  return transition(pool, input, ['discarded'], 'needs_review', 'restored');
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
      sha256: string;
      storage_key: string;
    }>(
      `select b.id, b.sha256, b.byte_size::text as byte_size, b.media_type, b.original_filename, b.storage_key
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

const CHANNEL_COLUMNS = `c.id, c.kind, c.name, c.enabled, c.legal_entity_id, c.hint_kind, c.created_at, c.updated_at,
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

// The definer decides everything: owner role, organization, the two-credential limit. Its errors map in the service.
export async function issueCredential(
  pool: DatabasePool,
  input: ChannelSelector,
): Promise<IssueInboxChannelCredentialResponse> {
  return runInTenantContext(pool, input, async (transaction) => {
    const issued = await transaction.query<{
      credential_id: string;
      display_prefix: string;
      secret: string;
    }>(
      "select credential_id, secret, display_prefix from auth.issue_channel_credential($1, 'api_token')",
      [input.channelId],
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

export abstract class InboxRepository implements ChannelPrincipalReader {
  abstract assignItem(input: AssignItemInput): Promise<InboxItemDetail | null>;
  abstract createChannel(
    input: CreateChannelInput,
  ): Promise<InboxChannel | null>;
  abstract discardItem(
    input: DiscardItemInput,
  ): Promise<InboxItemDetail | null>;
  abstract issueCredential(
    input: ChannelSelector,
  ): Promise<IssueInboxChannelCredentialResponse>;
  abstract listChannels(input: TenantContext): Promise<InboxChannel[]>;
  abstract listItems(input: ListItemsInput): Promise<InboxItemListResponse>;
  abstract readBlob(input: ReadBlobInput): Promise<BlobRecord | null>;
  abstract readChannel(input: ChannelSelector): Promise<InboxChannel | null>;
  abstract readChannelPrincipal(input: {
    channelId: string;
    organizationId: string;
  }): Promise<boolean>;
  abstract readItem(input: ReadItemInput): Promise<InboxItemDetail | null>;
  abstract readProviderInput(
    input: ReadItemInput,
  ): Promise<{ files: ItemFileRecord[]; input: ProviderInput } | null>;
  abstract receiveIntake(
    input: ReceiveIntakeInput,
  ): Promise<ReceiveIntakeResult>;
  abstract recordExtraction(
    input: RecordExtractionInput,
  ): Promise<InboxItemDetail | null>;
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
}

@Injectable()
export class DatabaseInboxRepository
  extends InboxRepository
  implements OnModuleDestroy
{
  private poolPromise: Promise<DatabasePool> | undefined;

  async assignItem(input: AssignItemInput): Promise<InboxItemDetail | null> {
    return assignItem(await this.getPool(), input);
  }

  async createChannel(input: CreateChannelInput): Promise<InboxChannel | null> {
    return createChannel(await this.getPool(), input);
  }

  async discardItem(input: DiscardItemInput): Promise<InboxItemDetail | null> {
    return discardItem(await this.getPool(), input);
  }

  async issueCredential(
    input: ChannelSelector,
  ): Promise<IssueInboxChannelCredentialResponse> {
    return issueCredential(await this.getPool(), input);
  }

  async listChannels(input: TenantContext): Promise<InboxChannel[]> {
    return listChannels(await this.getPool(), input);
  }

  async listItems(input: ListItemsInput): Promise<InboxItemListResponse> {
    return listItems(await this.getPool(), input);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.poolPromise !== undefined) {
      await (await this.poolPromise).end();
    }
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

  private getPool(): Promise<DatabasePool> {
    this.poolPromise ??= loadDatabaseConfiguration(process.env, {
      role: 'bap_api',
    }).then(createDatabasePool);
    return this.poolPromise;
  }
}
