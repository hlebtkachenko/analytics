import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import type { BlobScanStatus } from '@bap/db';
import type { DatabasePool } from '@bap/db/pool';
import { simpleParser } from 'mailparser';
import type { ParsedMail } from 'mailparser';
import type { PoolClient } from 'pg';
import { z } from 'zod';

import { blobStorageKey } from '../blobs/blob-store.js';
import type { BlobStore } from '../blobs/blob-store.js';
import { channelTenant } from '../channel-access.js';
import {
  MEDIA_TYPE_PATTERN,
  SPLIT_EMAIL_ITEM_QUEUE,
} from '../inbox/contract.js';
import type { RouteInboxItemJob } from '../inbox/contract.js';
import {
  appendEvent,
  applyInboxRules,
  insertExtraction,
  receiveIntakeInTransaction,
} from '../inbox/inbox-repository.js';
import type {
  ExtractionRecord,
  ReceiveIntakeResult,
} from '../inbox/inbox-repository.js';
import { sniffFile } from '../inbox/inbox.service.js';
import {
  SNIFF_PROVIDER,
  SNIFF_PROVIDER_VERSION,
  toProviderOutput,
} from '../inbox/providers/sniff.js';
import type { BlobScanner } from '../scanning/clamd-client.js';
import { runTenantJob } from './job-context.js';
import type { WorkerMetrics } from './worker-metrics.js';

// The caps mailparser cannot enforce, applied in code around the parse (ADR 0016, Worker).
export const MAX_ATTACHMENTS = 20;
export const MAX_ATTACHMENT_BYTES = 25_000_000;
export const MAX_TEXT_BYTES = 1_000_000;
export const MAX_NESTING_DEPTH = 10;
const MAX_HTML_LENGTH_TO_PARSE = 1_000_000;
const NESTED_MESSAGE_TYPE = 'message/rfc822';
const SPLIT_PROVIDER = 'split';
const SPLIT_PROVIDER_VERSION = '2026-09-17.1';

// The strict channel payload: the split names its channel and its item, nothing else.
const splitEmailItemPayloadSchema = z
  .object({
    channelId: z.string().uuid(),
    itemId: z.string().uuid(),
    organizationId: z.string().trim().min(1),
  })
  .strict();

type SplitEmailItemPayload = z.infer<typeof splitEmailItemPayloadSchema>;

export interface SplitEmailItemOptions {
  blobs: BlobStore;
  data: unknown;
  // Sent after a child's transaction has committed when its rule pass asked for an automatic route.
  enqueueRouteInboxItem: (job: RouteInboxItemJob) => Promise<void>;
  metrics: WorkerMetrics;
  pool: DatabasePool;
  quotaBytes: number;
  // pg-boss metadata of this attempt: the failure is recorded on the last one only.
  retry: { count: number; limit: number };
  scanner: BlobScanner;
}

// The only error shape that leaves the handler: a code, never a path, an address or a row value.
export class SplitEmailError extends Error {
  constructor(
    readonly code:
      | 'channel_unavailable'
      | 'item_unavailable'
      | 'parse_failed'
      | 'scan_failed'
      | 'store_failed',
  ) {
    super(`split_email_item failed: ${code}`);
    this.name = 'SplitEmailError';
  }
}

interface ParentItem {
  blobId: string;
  byteSize: number;
  hintKind: string | null;
  legalEntityId: string | null;
  origin: string | null;
  scanStatus: BlobScanStatus;
  status: string;
  storageKey: string;
}

// One part cut out of the message, staged on disk with what the intake row needs.
interface StagedPart {
  byteSize: number;
  // A cid-referenced inline image: stored and scanned like any part, then discarded as decoration.
  decorative: boolean;
  // Null when the sniff decides; text and decoration carry their type from the start.
  mediaType: string | null;
  originalFilename: string | null;
  payloadKind: 'file' | 'text';
  sha256: string;
  temporaryPath: string;
}

const HTML_ENTITIES: Record<string, string> = {
  '&#39;': "'",
  '&amp;': '&',
  '&gt;': '>',
  '&lt;': '<',
  '&quot;': '"',
};

// The text of an HTML-only message: a bounded tag strip, never a render; only the five basic entities decode.
export function textFromHtml(html: string): string {
  return html
    .slice(0, MAX_HTML_LENGTH_TO_PARSE)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => HTML_ENTITIES[entity]!)
    .trim();
}

function bodyText(mail: ParsedMail): string {
  const text = mail.text?.trim() ?? '';

  if (text.length > 0 || typeof mail.html !== 'string') {
    return text;
  }

  return textFromHtml(mail.html);
}

type SplitOutcome =
  { kind: 'done' } | { kind: 'empty' } | { kind: 'too_large' };

async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

// The scan verdict is written by the definer and evented; an error never reaches the database so a retry sees not_scanned.
async function recordScan(
  transaction: PoolClient,
  tenant: ReturnType<typeof channelTenant>,
  itemId: string,
  blobId: string,
  status: 'clean' | 'infected' | 'failed',
): Promise<void> {
  await transaction.query('select app.record_blob_scan($1, $2)', [
    blobId,
    status,
  ]);
  await appendEvent(transaction, tenant, itemId, 'scanned');
}

// The parent's terminal updates are guarded on processing: a reaped (failed) parent is never resurrected.
async function setStatus(
  transaction: PoolClient,
  itemId: string,
  status: string,
  expected: 'processing' | null = null,
): Promise<void> {
  const updated = await transaction.query(
    `update app.inbox_item set status = $2, updated_at = now()
      where id = $1 and ($3::text is null or status = $3::text)`,
    [itemId, status, expected],
  );

  // The channel update policy refused the row, or the reaper failed it meanwhile: the split stops here.
  if (updated.rowCount !== 1) {
    throw new SplitEmailError('item_unavailable');
  }
}

async function loadParent(
  transaction: PoolClient,
  payload: SplitEmailItemPayload,
): Promise<ParentItem | null> {
  const result = await transaction.query<{
    blob_id: string;
    byte_size: string;
    hint_kind: string | null;
    legal_entity_id: string | null;
    origin: string | null;
    scan_status: BlobScanStatus;
    status: string;
    storage_key: string;
  }>(
    `select i.status, i.origin, i.legal_entity_id, i.hint_kind,
            b.id as blob_id, b.byte_size::text as byte_size, b.scan_status, b.storage_key
       from app.inbox_item as i
       join app.inbox_item_file as f on f.item_id = i.id and f.position = 1
       join app.blob as b on b.id = f.blob_id
      where i.id = $1 and i.channel_id = $2 and i.payload_kind = 'email'
      for update of i`,
    [payload.itemId, payload.channelId],
  );
  const row = result.rows[0];

  return row === undefined
    ? null
    : {
        blobId: row.blob_id,
        byteSize: Number(row.byte_size),
        hintKind: row.hint_kind,
        legalEntityId: row.legal_entity_id,
        origin: row.origin,
        scanStatus: row.scan_status,
        status: row.status,
        storageKey: row.storage_key,
      };
}

function envelopeSender(mail: ParsedMail): string | null {
  const address = mail.from?.value[0]?.address ?? null;
  return address !== null && address.length >= 1 && address.length <= 320
    ? address
    : null;
}

// Every d= tag of every DKIM-Signature header, lowercased; the raw lines keep the RFC 6376 tag list and its folding.
function signatureDomains(mail: ParsedMail): string[] {
  const domains: string[] = [];

  for (const header of mail.headerLines) {
    if (header.key !== 'dkim-signature') {
      continue;
    }

    for (const tag of header.line
      .slice(header.line.indexOf(':') + 1)
      .split(';')) {
      const separator = tag.indexOf('=');

      if (separator < 0 || tag.slice(0, separator).trim() !== 'd') {
        continue;
      }

      domains.push(
        tag
          .slice(separator + 1)
          .replaceAll(/\s+/gu, '')
          .toLowerCase(),
      );
    }
  }

  return domains;
}

// DKIM alignment, never DMARC: Mailgun's check must have passed and a signature domain must cover the From domain.
// A missing or repeated verdict header is no verdict, so it reads as not authenticated.
export function senderAuthenticated(mail: ParsedMail): boolean {
  const verdict = mail.headers.get('x-mailgun-dkim-check-result');

  if (typeof verdict !== 'string' || verdict.trim().toLowerCase() !== 'pass') {
    return false;
  }

  const address = envelopeSender(mail);
  const at = address === null ? -1 : address.lastIndexOf('@');

  if (address === null || at < 0) {
    return false;
  }

  // Relaxed alignment: the signature domain is the From domain or a parent of it.
  const from = address.slice(at + 1).toLowerCase();

  return (
    from.length > 0 &&
    signatureDomains(mail).some(
      (domain) =>
        domain.length > 0 && (from === domain || from.endsWith(`.${domain}`)),
    )
  );
}

// Counts how deep message/rfc822 parts nest by parsing each nested message for its structure only.
async function nestingDepth(mail: ParsedMail, depth: number): Promise<number> {
  let deepest = depth;

  for (const attachment of mail.attachments) {
    if (attachment.contentType.toLowerCase() !== NESTED_MESSAGE_TYPE) {
      continue;
    }

    // Past the cap there is nothing left to learn, so the walk stops early.
    if (depth + 1 > MAX_NESTING_DEPTH) {
      return depth + 1;
    }

    const nested = await simpleParser(attachment.content, {
      maxHtmlLengthToParse: 0,
      skipHtmlToText: true,
      skipImageLinks: true,
      skipTextToHtml: true,
    });
    deepest = Math.max(deepest, await nestingDepth(nested, depth + 1));

    if (deepest > MAX_NESTING_DEPTH) {
      return deepest;
    }
  }

  return deepest;
}

async function stage(
  blobs: BlobStore,
  bytes: Buffer,
  part: Pick<
    StagedPart,
    'decorative' | 'mediaType' | 'originalFilename' | 'payloadKind'
  >,
): Promise<StagedPart> {
  const temporaryPath = join(
    blobs.temporaryDirectory(),
    `split-${randomUUID()}`,
  );
  await writeFile(temporaryPath, bytes, { flag: 'wx' });

  return {
    ...part,
    byteSize: bytes.length,
    sha256: await sha256Of(temporaryPath),
    temporaryPath,
  };
}

// A decorative image is not sniffed; its declared image type is kept when well-formed, anything else is opaque bytes.
function declaredImageType(contentType: string): string {
  const declared = contentType.trim().toLowerCase();
  return declared.startsWith('image/') && MEDIA_TYPE_PATTERN.test(declared)
    ? declared
    : 'application/octet-stream';
}

// Display metadata only, the same rule as an upload: no separator, no control character and no bidi override.
const SAFE_FILENAME = /^[^\p{Cc}\p{Cf}\\/]{1,255}$/u;

function displayFilename(filename: string | undefined): string | null {
  const trimmed = filename?.trim() ?? '';
  return SAFE_FILENAME.test(trimmed) ? trimmed : null;
}

export async function splitEmailItem(
  options: SplitEmailItemOptions,
): Promise<void> {
  const payload = splitEmailItemPayloadSchema.parse(options.data);
  const tenant = channelTenant(payload.organizationId, payload.channelId);
  // The blob the failure recorder marks failed when the scan is what failed.
  let scanning: { blobId: string; itemId: string } | null = null;
  const staged: string[] = [];

  try {
    const parent = await runTenantJob({
      data: payload,
      pool: options.pool,
      work: async (transaction) => {
        const loaded = await loadParent(transaction, payload);

        // Already split, discarded or decided: the job is a no-op, never a second split.
        if (
          loaded === null ||
          (loaded.status !== 'received' && loaded.status !== 'processing')
        ) {
          return null;
        }

        // Every attempt touches updated_at, so the reaper's clock runs from the first attempt, not the last.
        await setStatus(transaction, payload.itemId, 'processing');

        return loaded;
      },
    });

    if (parent === null) {
      options.metrics.recordJob(SPLIT_EMAIL_ITEM_QUEUE, 'completed');
      return;
    }

    // The .eml is scanned before anything parses it; a retry after a clean verdict does not scan twice.
    if (parent.scanStatus !== 'clean') {
      scanning = { blobId: parent.blobId, itemId: payload.itemId };
      const verdict = await options.scanner.scan(
        options.blobs.open(parent.storageKey),
        parent.byteSize,
      );

      if (verdict.outcome === 'error') {
        throw new SplitEmailError('scan_failed');
      }

      const infected = await runTenantJob({
        data: payload,
        pool: options.pool,
        work: async (transaction) => {
          await recordScan(
            transaction,
            tenant,
            payload.itemId,
            parent.blobId,
            verdict.outcome,
          );

          if (verdict.outcome === 'infected') {
            await setStatus(
              transaction,
              payload.itemId,
              'discarded',
              'processing',
            );
            await appendEvent(
              transaction,
              tenant,
              payload.itemId,
              'discarded',
              'policy_rejected',
            );
            return true;
          }

          return false;
        },
      });
      scanning = null;

      if (infected) {
        options.metrics.recordJob(SPLIT_EMAIL_ITEM_QUEUE, 'completed');
        return;
      }
    }

    let mail: ParsedMail;

    try {
      mail = await simpleParser(options.blobs.open(parent.storageKey), {
        maxHtmlLengthToParse: MAX_HTML_LENGTH_TO_PARSE,
        skipHtmlToText: true,
        skipImageLinks: true,
        skipTextToHtml: true,
      });
    } catch {
      throw new SplitEmailError('parse_failed');
    }

    const sender = envelopeSender(mail);
    const authenticated = senderAuthenticated(mail);
    const outcome = await splitParts(options, payload, tenant, parent, mail, {
      sender,
      senderAuthenticated: authenticated,
      staged,
    });

    await runTenantJob({
      data: payload,
      pool: options.pool,
      work: async (transaction) => {
        await transaction.query(
          `update app.inbox_item
              set sender = $2, sender_authenticated = $3, updated_at = now()
            where id = $1`,
          [payload.itemId, sender, authenticated],
        );

        if (outcome.kind === 'empty') {
          await insertExtraction(transaction, tenant, payload.itemId, {
            output: {
              confidence: 0,
              detectedType: 'unknown',
              draft: {},
              fieldConfidences: {},
              issues: [
                {
                  code: 'empty',
                  message: 'The message carries no attachment and no text.',
                },
              ],
              reasons: [],
            },
            provider: SPLIT_PROVIDER,
            providerVersion: SPLIT_PROVIDER_VERSION,
          });
        } else {
          if (outcome.kind === 'too_large') {
            await appendEvent(
              transaction,
              tenant,
              payload.itemId,
              'failed',
              'too_large',
            );
          }

          await appendEvent(transaction, tenant, payload.itemId, 'classified');
        }

        await setStatus(
          transaction,
          payload.itemId,
          'needs_review',
          'processing',
        );
        await transaction.query(
          "select app.record_audit('inbox_item.split', 'inbox_item', $1, $2::jsonb)",
          [payload.itemId, JSON.stringify({ outcome: outcome.kind })],
        );
      },
    });
    options.metrics.recordJob(SPLIT_EMAIL_ITEM_QUEUE, 'completed');
  } catch (error) {
    options.metrics.recordJob(SPLIT_EMAIL_ITEM_QUEUE, 'failed');
    const failure = toSplitError(error);

    if (options.retry.count >= options.retry.limit) {
      await recordFailure(options, payload, tenant, failure, scanning).catch(
        () => undefined,
      );
    }

    throw failure;
  } finally {
    // A staged part that was moved into the store is already gone; the rest must not linger.
    for (const path of staged) {
      await options.blobs.deleteTemporary(path);
    }
  }
}

async function splitParts(
  options: SplitEmailItemOptions,
  payload: SplitEmailItemPayload,
  tenant: ReturnType<typeof channelTenant>,
  parent: ParentItem,
  mail: ParsedMail,
  context: {
    sender: string | null;
    senderAuthenticated: boolean;
    staged: string[];
  },
): Promise<SplitOutcome> {
  let depth: number;

  // A nested message that does not parse is a parse failure of the whole, the same as its outer envelope.
  try {
    depth = await nestingDepth(mail, 0);
  } catch {
    throw new SplitEmailError('parse_failed');
  }

  if (depth > MAX_NESTING_DEPTH) {
    return { kind: 'too_large' };
  }

  const parts: StagedPart[] = [];

  for (const attachment of mail.attachments) {
    if (parts.length >= MAX_ATTACHMENTS) {
      return await createChildren(options, payload, tenant, parent, parts, {
        ...context,
        outcome: { kind: 'too_large' },
      });
    }

    if (attachment.content.length > MAX_ATTACHMENT_BYTES) {
      return await createChildren(options, payload, tenant, parent, parts, {
        ...context,
        outcome: { kind: 'too_large' },
      });
    }

    // A zero-byte part cannot be a blob and carries nothing to review.
    if (attachment.content.length === 0) {
      continue;
    }

    const decorative = attachment.related === true;
    const part = await stage(options.blobs, attachment.content, {
      decorative,
      mediaType: decorative ? declaredImageType(attachment.contentType) : null,
      originalFilename: displayFilename(attachment.filename),
      payloadKind: 'file',
    });
    context.staged.push(part.temporaryPath);
    parts.push(part);
  }

  // Decoration alone is no content: the body text is still the review item when every part is a cid image.
  if (parts.every((part) => part.decorative)) {
    const text = Buffer.from(bodyText(mail), 'utf8');

    if (text.length > MAX_TEXT_BYTES) {
      return { kind: 'too_large' };
    }

    if (text.length === 0 && parts.length === 0) {
      return { kind: 'empty' };
    }

    if (text.length > 0) {
      const part = await stage(options.blobs, text, {
        decorative: false,
        mediaType: 'text/plain',
        originalFilename: null,
        payloadKind: 'text',
      });
      context.staged.push(part.temporaryPath);
      parts.push(part);
    }
  }

  return createChildren(options, payload, tenant, parent, parts, {
    ...context,
    outcome: { kind: 'done' },
  });
}

// Each child is one transaction so a retry after a crash resumes at the first child that does not exist yet.
async function createChildren(
  options: SplitEmailItemOptions,
  payload: SplitEmailItemPayload,
  tenant: ReturnType<typeof channelTenant>,
  parent: ParentItem,
  parts: readonly StagedPart[],
  context: {
    outcome: SplitOutcome;
    sender: string | null;
    senderAuthenticated: boolean;
    staged: string[];
  },
): Promise<SplitOutcome> {
  for (const [index, part] of parts.entries()) {
    const externalId = `${payload.itemId}:${index + 1}`;
    const storageKey = blobStorageKey(payload.organizationId, part.sha256);

    // A child an earlier attempt created is complete: it was scanned and settled in its own transaction.
    const exists = await runTenantJob({
      data: payload,
      pool: options.pool,
      work: async (transaction) =>
        (
          await transaction.query(
            'select 1 from app.inbox_item where channel_id = $1 and external_id = $2',
            [payload.channelId, externalId],
          )
        ).rows.length > 0,
    });

    if (exists) {
      continue;
    }

    // Scanned and sniffed on the staged copy before the transaction; network and file reads stay outside it.
    const verdict = await options.scanner.scan(
      createReadStream(part.temporaryPath),
      part.byteSize,
    );

    if (verdict.outcome === 'error') {
      throw new SplitEmailError('scan_failed');
    }

    // A decorative image is never sniffed: it is discarded whatever its bytes say.
    const sniffed = part.decorative
      ? null
      : await sniffFile(part.temporaryPath, part.byteSize);
    const mediaType =
      part.mediaType ?? sniffed?.mediaType ?? 'application/octet-stream';
    const extraction: ExtractionRecord | null =
      sniffed === null
        ? null
        : {
            output: toProviderOutput(sniffed),
            provider: SNIFF_PROVIDER,
            providerVersion: SNIFF_PROVIDER_VERSION,
          };
    // The keyword source of a text child, read outside the transaction; the part is already under MAX_TEXT_BYTES.
    const text =
      part.payloadKind === 'text'
        ? await readFile(part.temporaryPath, 'utf8')
        : null;
    const routeJob = await runTenantJob<RouteInboxItemJob | null>({
      data: payload,
      pool: options.pool,
      work: async (transaction) => {
        const result: ReceiveIntakeResult = await receiveIntakeInTransaction(
          transaction,
          {
            ...tenant,
            byteSize: part.byteSize,
            channelId: payload.channelId,
            channelKind: 'email',
            externalId,
            legalEntityIds: null,
            mediaType,
            origin: parent.origin,
            originalFilename: part.originalFilename,
            parentItemId: payload.itemId,
            payloadKind: part.payloadKind,
            persist: async () => {
              await options.blobs.put({
                key: storageKey,
                temporaryPath: part.temporaryPath,
              });
            },
            quotaBytes: options.quotaBytes,
            sender: context.sender,
            senderAuthenticated: context.senderAuthenticated,
            sha256: part.sha256,
            sniff: null,
            storageKey,
          },
        );

        // A replayed child was handled by an earlier attempt; a duplicate blob was scanned when it first arrived.
        if (result.replayed || result.duplicateOfItemId !== null) {
          return null;
        }

        const blobId = result.files[0]?.blobId;

        if (blobId === undefined) {
          throw new SplitEmailError('store_failed');
        }

        await recordScan(
          transaction,
          tenant,
          result.item.id,
          blobId,
          verdict.outcome,
        );

        if (verdict.outcome === 'infected') {
          await setStatus(transaction, result.item.id, 'discarded');
          await appendEvent(
            transaction,
            tenant,
            result.item.id,
            'discarded',
            'policy_rejected',
          );
          return null;
        }

        if (extraction === null) {
          await setStatus(transaction, result.item.id, 'discarded');
          await appendEvent(
            transaction,
            tenant,
            result.item.id,
            'discarded',
            'decorative_image',
          );
          return null;
        }

        await insertExtraction(transaction, tenant, result.item.id, extraction);
        await setStatus(transaction, result.item.id, 'needs_review');

        // The rule pass runs under the channel principal, still inside the child's transaction.
        const rulePass = await applyInboxRules(transaction, {
          ...tenant,
          itemId: result.item.id,
          text,
        });
        return rulePass.routeJob;
      },
    });

    if (routeJob !== null) {
      await options.enqueueRouteInboxItem(routeJob);
    }
  }

  return context.outcome;
}

function toSplitError(error: unknown): SplitEmailError {
  if (error instanceof SplitEmailError) {
    return error;
  }

  const message = error instanceof Error ? error.message : '';

  if (message.startsWith('Job channel is')) {
    return new SplitEmailError('channel_unavailable');
  }

  return new SplitEmailError('store_failed');
}

// The last attempt leaves a verdict behind: the parent is failed, and a blob whose scan never answered is failed too.
async function recordFailure(
  options: SplitEmailItemOptions,
  payload: SplitEmailItemPayload,
  tenant: ReturnType<typeof channelTenant>,
  failure: SplitEmailError,
  scanning: { blobId: string; itemId: string } | null,
): Promise<void> {
  await runTenantJob({
    data: payload,
    pool: options.pool,
    work: async (transaction) => {
      if (failure.code === 'scan_failed' && scanning !== null) {
        await transaction.query('select app.record_blob_scan($1, $2)', [
          scanning.blobId,
          'failed',
        ]);
      }

      await setStatus(transaction, payload.itemId, 'failed', 'processing');
      await appendEvent(transaction, tenant, payload.itemId, 'failed');
      await transaction.query(
        "select app.record_audit('inbox_item.split_failed', 'inbox_item', $1, $2::jsonb)",
        [payload.itemId, JSON.stringify({ code: failure.code })],
      );
    },
  });
}
