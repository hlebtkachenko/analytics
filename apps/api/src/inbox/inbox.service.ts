import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { InboxChannelKind, TenantContext } from '@bap/db';
import { z } from 'zod';

import { blobStorageKey, BlobStore } from '../blobs/blob-store.js';
import { MAX_UPLOAD_BYTES } from '../ingestion/contract.js';
import type { ReceivedFile } from '../request-context.js';
import { EMAIL_MEDIA_TYPE, INLINE_MEDIA_TYPES } from './contract.js';
import type {
  BulkInboxItemsRequest,
  BulkInboxItemsResponse,
  InboxChannel,
  InboxHints,
  InboxIntakeResponse,
  InboxItemDetail,
  InboxItemListResponse,
  InboxRoutingTarget,
  InboxRule,
  InboxSettings,
  InboxUploadResponse,
  IssueInboxChannelCredentialResponse,
  ProviderOutput,
  RouteInboxItemToDocumentRequest,
  ScanInboxItemJob,
  UpdateInboxSettingsRequest,
} from './contract.js';
import {
  InboxRepository,
  QuotaExceededError,
  RouteRefusedError,
  type AdoptRuleInput,
  type AssignItemInput,
  type AttachItemInput,
  type BlobRecord,
  type ChannelSelector,
  type CreateChannelInput,
  type CreateRuleInput,
  type DiscardItemInput,
  type EntityScopeSelector,
  type ListItemsInput,
  type OrderRulesInput,
  type PutRoutingTargetInput,
  type ReadItemInput,
  type ReceiveIntakeResult,
  type RevokeCredentialInput,
  type RoutingTargetSelector,
  type RuleSelector,
  type SnoozeItemInput,
  type UpdateChannelInput,
  type UpdateHintsInput,
  type UpdateRuleInput,
} from './inbox-repository.js';
import {
  MANUAL_PROVIDER,
  MANUAL_PROVIDER_VERSION,
  manualDraft,
  manualProvider,
} from './providers/manual.js';
import { InboxQueue } from './inbox-queue.js';
import { ISDOC_DETECTED_TYPE } from './providers/isdoc.js';
import {
  SNIFF_PROVIDER,
  SNIFF_PROVIDER_VERSION,
  SNIFF_WINDOW_BYTES,
  sniffBytes,
  toProviderOutput,
  type SniffResult,
} from './providers/sniff.js';

export const BLOB_QUOTA_BYTES = Symbol('BLOB_QUOTA_BYTES');
export const INTAKE_DOMAIN = Symbol('INTAKE_DOMAIN');

// Display metadata only: no separator, no control character and no bidirectional override.
const SAFE_FILENAME = /^[^\p{Cc}\p{Cf}\\/]{1,255}$/u;

const receivedFileSchema = z.object({
  originalname: z.string().trim().regex(SAFE_FILENAME).optional(),
  // multer reports the bytes it actually wrote, not a proxy header or a client claim.
  size: z.number().int().min(0).max(MAX_UPLOAD_BYTES),
  temporaryPath: z.string().min(1),
});

export interface UploadInput extends EntityScopeSelector {
  file: ReceivedFile | undefined;
}

// A push through a channel: the channel row, the caller's idempotency key and who pushed (a display prefix).
export interface ChannelIntakeInput extends TenantContext {
  channelId: string;
  externalId: string | null;
  origin: string | null;
}

export interface FileIntakeInput extends ChannelIntakeInput {
  file: ReceivedFile | undefined;
}

export interface StructuredIntakeInput extends ChannelIntakeInput {
  externalId: string;
  payload: Record<string, unknown>;
}

// A raw MIME message already streamed to the temporary directory under the email cap by the route.
export interface EmailIntakeInput extends ChannelIntakeInput {
  externalId: string;
  size: number;
  temporaryPath: string;
}

// One temporary file on disk plus everything the intake row needs beyond the bytes.
interface StagedIntake extends EntityScopeSelector {
  channelId: string | null;
  channelKind: InboxChannelKind;
  externalId: string | null;
  origin: string | null;
  originalFilename: string | null;
  payloadKind: 'email' | 'file' | 'structured';
  size: number;
  temporaryPath: string;
}

export interface RouteInput extends ReadItemInput {
  body: RouteInboxItemToDocumentRequest;
}

export interface BulkInput extends EntityScopeSelector {
  body: BulkInboxItemsRequest;
}

export interface OpenBlobInput extends EntityScopeSelector {
  blobId: string;
  inline: boolean;
}

export interface UpdateSettingsInput extends TenantContext {
  body: UpdateInboxSettingsRequest;
}

export interface OpenedBlob {
  blob: BlobRecord;
  stream: Readable;
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

async function readWindow(
  path: string,
  start: number,
  length: number,
): Promise<Uint8Array> {
  const handle = await open(path, 'r');

  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function collect(stream: Readable): Promise<Uint8Array> {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

function windows(byteSize: number): {
  head: [number, number];
  tail: [number, number];
} {
  const window = Math.min(SNIFF_WINDOW_BYTES, byteSize);
  return {
    head: [0, Math.max(0, window - 1)],
    tail: [Math.max(0, byteSize - window), Math.max(0, byteSize - 1)],
  };
}

// The Phase 0 sniff over a file on disk: the head and tail windows only, never the whole file in memory.
export async function sniffFile(
  path: string,
  byteSize: number,
): Promise<SniffResult> {
  const range = windows(byteSize);
  return sniffBytes({
    byteSize,
    head: await readWindow(
      path,
      range.head[0],
      range.head[1] - range.head[0] + 1,
    ),
    tail: await readWindow(
      path,
      range.tail[0],
      range.tail[1] - range.tail[0] + 1,
    ),
  });
}

// The definer functions raise these; the service turns them into the response the route documents.
function databaseErrorCode(error: unknown): {
  code: string | undefined;
  constraint: string | undefined;
} {
  const { code, constraint } =
    typeof error === 'object' && error !== null
      ? (error as { code?: unknown; constraint?: unknown })
      : {};

  return {
    code: typeof code === 'string' ? code : undefined,
    constraint: typeof constraint === 'string' ? constraint : undefined,
  };
}

function mediaTypeOf(
  payloadKind: StagedIntake['payloadKind'],
  sniffed: SniffResult | null,
): string {
  if (payloadKind === 'structured') {
    return 'application/json';
  }

  if (payloadKind === 'email' || sniffed === null) {
    return EMAIL_MEDIA_TYPE;
  }

  return sniffed.mediaType;
}

// A direct upload and an API push store an unscanned blob: the scan job runs before anything serves or routes it.
// A duplicate shares the blob row of the item that first carried it, so its verdict is already recorded.
function scanJobFor(
  staged: StagedIntake,
  result: ReceiveIntakeResult,
): ScanInboxItemJob | null {
  const pending =
    (staged.channelKind === 'upload' || staged.channelKind === 'api') &&
    result.files.some((file) => file.scanStatus === 'not_scanned');

  if (!pending) {
    return null;
  }

  // The route the rule pass asked for is deferred, not dropped: the scan job sends it after a clean verdict.
  const route =
    result.routeJob === null ? {} : { routeRuleId: result.routeJob.ruleId };

  return staged.channelId === null
    ? {
        ...route,
        itemId: result.item.id,
        organizationId: staged.organizationId,
        userId: staged.userId,
      }
    : {
        ...route,
        channelId: staged.channelId,
        itemId: result.item.id,
        organizationId: staged.organizationId,
      };
}

function toIntakeResponse(result: ReceiveIntakeResult): InboxIntakeResponse {
  return {
    duplicateOfItemId: result.duplicateOfItemId,
    itemId: result.item.id,
    status: result.item.status,
  };
}

// The per-id verdict of a bulk action: the single-item refusals by status, and a route's own refusal by code.
function bulkRefusalCode(
  error: unknown,
): BulkInboxItemsResponse['results'][number]['code'] {
  if (error instanceof RouteRefusedError) {
    return error.refusal.code;
  }

  if (error instanceof HttpException) {
    const body = error.getResponse();
    const code =
      typeof body === 'object' && body !== null
        ? (body as { code?: unknown }).code
        : undefined;

    if (code === 'reference_conflict' || code === 'duplicate_probable') {
      return code;
    }

    if (error.getStatus() === 404) {
      return 'not_found';
    }

    if (error.getStatus() === 409) {
      return 'not_open';
    }

    if (error.getStatus() === 400) {
      return 'invalid';
    }
  }

  throw error;
}

// A person's hint outranks the sniff for the type and the entity; the reasons keep both steps visible.
export function applyHints(
  output: ProviderOutput,
  hints: InboxHints,
): ProviderOutput {
  const reasons = [...output.reasons];
  let { confidence, detectedType } = output;
  let legalEntityId = output.legalEntityId;
  let partnerId = output.partnerId;

  if (hints.hintKind !== null) {
    detectedType = hints.hintKind;
    confidence = 1;
    reasons.push({
      evidence: 'A person named the kind.',
      step: 'hint',
      weight: 1,
    });
  }

  if (hints.hintLegalEntityId !== null) {
    legalEntityId = hints.hintLegalEntityId;
    reasons.push({
      evidence: 'A person named the legal entity.',
      step: 'hint',
      weight: 1,
    });
  }

  if (hints.hintPartnerId !== null) {
    partnerId = hints.hintPartnerId;
    reasons.push({
      evidence: 'A person named the partner.',
      step: 'hint',
      weight: 1,
    });
  }

  return {
    ...output,
    confidence,
    detectedType,
    legalEntityId,
    partnerId,
    reasons,
  };
}

@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  constructor(
    @Inject(InboxRepository) private readonly inbox: InboxRepository,
    @Inject(BlobStore) private readonly blobs: BlobStore,
    @Inject(BLOB_QUOTA_BYTES) private readonly quotaBytes: number,
    @Inject(INTAKE_DOMAIN) private readonly intakeDomain: string,
    @Inject(InboxQueue) private readonly queue: InboxQueue,
  ) {}

  async upload(input: UploadInput): Promise<InboxUploadResponse> {
    const received = input.file;

    try {
      // A new item has no entity yet, so a restricted scope could never read back what it just uploaded.
      if (input.legalEntityIds !== null) {
        throw new ForbiddenException();
      }

      const file = receivedFileSchema.safeParse({
        originalname: received?.originalname,
        size: received?.size,
        temporaryPath: received?.path,
      });

      if (!file.success) {
        throw new BadRequestException();
      }

      const result = await this.receive({
        ...input,
        channelId: null,
        channelKind: 'upload',
        externalId: null,
        origin: null,
        originalFilename: file.data.originalname ?? null,
        payloadKind: 'file',
        size: file.data.size,
        temporaryPath: file.data.temporaryPath,
      });

      // The strict response contract refuses the replay and route-job fields the receive result carries.
      return {
        duplicateOfItemId: result.duplicateOfItemId,
        files: result.files,
        item: result.item,
      };
    } catch (error) {
      // Covers a refusal before receive took over; after it the file is already gone and this is a no-op.
      if (received?.path !== undefined) {
        await this.blobs.deleteTemporary(received.path);
      }

      throw error;
    }
  }

  // A file pushed through an API channel; the channel row decides the entity and the kind hint.
  async intakeFile(input: FileIntakeInput): Promise<InboxIntakeResponse> {
    const received = input.file;

    try {
      const file = receivedFileSchema.safeParse({
        originalname: received?.originalname,
        size: received?.size,
        temporaryPath: received?.path,
      });

      if (!file.success) {
        throw new BadRequestException();
      }

      return toIntakeResponse(
        await this.receive({
          ...input,
          channelKind: 'api',
          legalEntityIds: null,
          originalFilename: file.data.originalname ?? null,
          payloadKind: 'file',
          size: file.data.size,
          temporaryPath: file.data.temporaryPath,
        }),
      );
    } catch (error) {
      // Covers a refusal before receive took over; after it the file is already gone and this is a no-op.
      if (received?.path !== undefined) {
        await this.blobs.deleteTemporary(received.path);
      }

      throw error;
    }
  }

  // A structured push is stored as its JSON bytes, so the item keeps the same one-file envelope as an upload.
  async intakeStructured(
    input: StructuredIntakeInput,
  ): Promise<InboxIntakeResponse> {
    const bytes = Buffer.from(JSON.stringify(input.payload), 'utf8');
    const temporaryPath = join(
      this.blobs.temporaryDirectory(),
      `structured-${randomUUID()}`,
    );
    await writeFile(temporaryPath, bytes);

    return toIntakeResponse(
      await this.receive({
        ...input,
        channelKind: 'api',
        legalEntityIds: null,
        originalFilename: null,
        payloadKind: 'structured',
        size: bytes.length,
        temporaryPath,
      }),
    );
  }

  // A raw message through an email channel: stored as it came, left received for the worker to scan and split.
  async intakeEmail(input: EmailIntakeInput): Promise<InboxIntakeResponse> {
    const result = await this.receive({
      ...input,
      channelKind: 'email',
      legalEntityIds: null,
      originalFilename: null,
      payloadKind: 'email',
    });

    // Enqueued after the commit; a replay of an item already past received enqueues nothing.
    if (result.item.status === 'received') {
      try {
        await this.queue.enqueueSplitEmailItem({
          channelId: input.channelId,
          itemId: result.item.id,
          organizationId: input.organizationId,
        });
      } catch {
        // The item stays received; 503 makes the poster retry and the replay enqueues it again.
        this.logger.error(
          `Enqueue of split_email_item failed for item ${result.item.id} of channel ${input.channelId}.`,
        );
        throw new ServiceUnavailableException();
      }
    }

    return toIntakeResponse(result);
  }

  // Hash, sniff, then one transaction; the temporary file is gone whatever happens.
  private async receive(staged: StagedIntake): Promise<ReceiveIntakeResult> {
    let cleanupTemporaryPath: string | null = staged.temporaryPath;

    try {
      const { size, temporaryPath } = staged;
      const sha256 = await sha256Of(temporaryPath);
      // An email is stored whole for the worker; nothing is sniffed until the split has scanned it.
      const sniffed =
        staged.payloadKind === 'email'
          ? null
          : await sniffFile(temporaryPath, size);
      const storageKey = blobStorageKey(staged.organizationId, sha256);

      const result = await this.inbox.receiveIntake({
        ...staged,
        byteSize: size,
        // A structured payload is JSON by construction; every file is what its bytes say.
        mediaType: mediaTypeOf(staged.payloadKind, sniffed),
        parentItemId: null,
        persist: async () => {
          await this.blobs.put({ key: storageKey, temporaryPath });
          // The temporary name is gone once moved, so nothing is left to clean up.
          cleanupTemporaryPath = null;
        },
        quotaBytes: this.quotaBytes,
        sender: null,
        // An upload and an API-channel item carry no sender at all, so nothing is authenticated.
        senderAuthenticated: false,
        sha256,
        sniff:
          sniffed === null
            ? null
            : {
                output: toProviderOutput(sniffed),
                provider: SNIFF_PROVIDER,
                providerVersion: SNIFF_PROVIDER_VERSION,
              },
        storageKey,
      });

      // Sent after the commit; nothing scans or routes inside a request. A lost job is resent by the maintenance tick.
      const scanJob = scanJobFor(staged, result);

      if (scanJob !== null) {
        try {
          await this.queue.enqueueScanInboxItem(scanJob);
        } catch {
          this.logger.error(
            `Enqueue of scan_inbox_item failed for item ${result.item.id}.`,
          );
        }
      } else if (result.routeJob !== null) {
        // A lost job leaves the item in review for a person.
        try {
          await this.queue.enqueueRouteInboxItem(result.routeJob);
        } catch {
          this.logger.error(
            `Enqueue of route_inbox_item failed for item ${result.item.id}.`,
          );
        }
      }

      return result;
    } catch (error) {
      if (error instanceof QuotaExceededError) {
        throw new PayloadTooLargeException();
      }

      throw error;
    } finally {
      if (cleanupTemporaryPath !== null) {
        await this.blobs.deleteTemporary(cleanupTemporaryPath);
      }
    }
  }

  listChannels(input: TenantContext): Promise<InboxChannel[]> {
    return this.inbox.listChannels(input);
  }

  readChannel(input: ChannelSelector): Promise<InboxChannel | null> {
    return this.inbox.readChannel(input);
  }

  createChannel(input: CreateChannelInput): Promise<InboxChannel | null> {
    return this.inbox.createChannel(input);
  }

  updateChannel(input: UpdateChannelInput): Promise<InboxChannel | null> {
    return this.inbox.updateChannel(input);
  }

  // The definer's verdicts: one active credential too many is a conflict, a missing channel is not found, a non-owner is forbidden.
  async issueCredential(
    input: ChannelSelector,
  ): Promise<IssueInboxChannelCredentialResponse> {
    try {
      return await this.inbox.issueCredential({
        ...input,
        intakeDomain: this.intakeDomain,
      });
    } catch (error) {
      const { code, constraint } = databaseErrorCode(error);

      if (
        code === '23514' &&
        constraint === 'inbox_channel_credential_active_limit'
      ) {
        throw new ConflictException();
      }

      if (
        code === '23514' &&
        constraint === 'inbox_channel_credential_kind_match'
      ) {
        throw new BadRequestException();
      }

      // The definer refused an empty intake domain: a deployment fault, never the caller's.
      if (code === '22023') {
        this.logger.error(
          `Credential issue for channel ${input.channelId} was refused: BAP_INTAKE_DOMAIN is not set.`,
        );
        throw new InternalServerErrorException();
      }

      if (code === 'P0002') {
        throw new NotFoundException();
      }

      if (code === '42501') {
        throw new ForbiddenException();
      }

      throw error;
    }
  }

  revokeCredential(input: RevokeCredentialInput): Promise<boolean> {
    return this.inbox.revokeCredential(input);
  }

  listRoutingTargets(input: TenantContext): Promise<InboxRoutingTarget[]> {
    return this.inbox.listRoutingTargets(input);
  }

  putRoutingTarget(
    input: PutRoutingTargetInput,
  ): Promise<InboxRoutingTarget | null> {
    return this.inbox.putRoutingTarget(input);
  }

  deleteRoutingTarget(input: RoutingTargetSelector): Promise<boolean> {
    return this.inbox.deleteRoutingTarget(input);
  }

  readSettings(input: TenantContext): Promise<InboxSettings> {
    return this.inbox.readInboxSettings({
      ...input,
      platformQuotaBytes: this.quotaBytes,
    });
  }

  // The platform value is the cap: an owner can only tighten it, so anything above is unprocessable.
  async updateSettings(
    input: UpdateSettingsInput,
  ): Promise<InboxSettings | null> {
    const { blobQuotaBytes } = input.body;

    if (blobQuotaBytes !== null && blobQuotaBytes > this.quotaBytes) {
      throw new UnprocessableEntityException();
    }

    return this.inbox.updateInboxSettings({
      ...input,
      blobQuotaBytes,
      platformQuotaBytes: this.quotaBytes,
    });
  }

  // Re-runs the sniff on the first file and lets the stored hints outrank it.
  async process(input: ReadItemInput): Promise<InboxItemDetail | null> {
    const loaded = await this.inbox.readProviderInput(input);

    if (loaded === null) {
      return null;
    }

    // A failed email parent is split again, not sniffed: the children already made are idempotent.
    if (
      loaded.input.item.status === 'failed' &&
      loaded.input.item.payloadKind === 'email'
    ) {
      const reopened = await this.inbox.reopenEmailItem(input);

      if (reopened === null) {
        return null;
      }

      try {
        await this.queue.enqueueSplitEmailItem(reopened.job);
      } catch {
        // The item is received again; the maintenance requeue picks it up like any lost split.
        this.logger.error(
          `Enqueue of split_email_item failed for item ${reopened.job.itemId}.`,
        );
      }

      return reopened.detail;
    }

    const first = loaded.files[0];

    if (first === undefined) {
      throw new BadRequestException();
    }

    // Only scanned, clean bytes are read again: an unanswered blob waits and a flagged one is quarantined.
    const unclean = loaded.files.find((file) => file.scanStatus !== 'clean');

    if (unclean !== undefined) {
      throw new ConflictException(
        unclean.scanStatus === 'not_scanned'
          ? 'blob_scan_pending'
          : 'blob_quarantined',
      );
    }

    const range = windows(first.byteSize);
    const sniffed = sniffBytes({
      byteSize: first.byteSize,
      head: await collect(
        this.blobs.open(first.storageKey, {
          end: range.head[1],
          start: range.head[0],
        }),
      ),
      tail: await collect(
        this.blobs.open(first.storageKey, {
          end: range.tail[1],
          start: range.tail[0],
        }),
      ),
    });

    const detail = await this.inbox.recordExtraction({
      ...input,
      extraction: {
        output: applyHints(toProviderOutput(sniffed), loaded.input.hints),
        provider: SNIFF_PROVIDER,
        providerVersion: SNIFF_PROVIDER_VERSION,
      },
    });

    // An ISDOC is parsed in the worker under the person pressing process, never inside this request.
    if (detail !== null && sniffed.detectedType === ISDOC_DETECTED_TYPE) {
      try {
        await this.queue.enqueueParseInboxItem({
          itemId: detail.item.id,
          organizationId: input.organizationId,
          userId: input.userId,
        });
      } catch {
        this.logger.error(
          `Enqueue of parse_inbox_item failed for item ${detail.item.id}.`,
        );
      }
    }

    return detail;
  }

  async routeToDocument(input: RouteInput): Promise<InboxItemDetail | null> {
    // A parsed route is completed and re-validated from the stored row inside the route transaction.
    const { document, output } =
      input.body.parsedExtractionId === undefined
        ? manualProvider(input.body.document)
        : manualDraft(input.body.document);

    return this.inbox.routeToDocument({
      ...input,
      ...(input.body.acknowledgeDuplicateOf === undefined
        ? {}
        : { acknowledgeDuplicateOf: input.body.acknowledgeDuplicateOf }),
      correctionReasons: input.body.correctionReasons ?? {},
      document,
      extraction: {
        output,
        provider: MANUAL_PROVIDER,
        providerVersion: MANUAL_PROVIDER_VERSION,
      },
      fileBlobIds: input.body.fileBlobIds,
      ...(input.body.lineCategory === undefined
        ? {}
        : { lineCategory: input.body.lineCategory }),
      ...(input.body.parsedExtractionId === undefined
        ? {}
        : { parsedExtractionId: input.body.parsedExtractionId }),
      ...(input.body.supersedesDocumentId === undefined
        ? {}
        : { supersedesDocumentId: input.body.supersedesDocumentId }),
    });
  }

  attachItem(input: AttachItemInput): Promise<InboxItemDetail | null> {
    return this.inbox.attachItem(input);
  }

  // One transaction per id in body order; a refusal on one item never rolls back another.
  async bulk(input: BulkInput): Promise<BulkInboxItemsResponse> {
    const { body } = input;
    const results: BulkInboxItemsResponse['results'] = [];

    for (const itemId of body.itemIds) {
      const selector = {
        ...input,
        itemId,
        legalEntityIds: input.legalEntityIds,
      };

      try {
        const detail = await (body.action === 'assign'
          ? this.inbox.assignItem({
              ...selector,
              assigneeId: body.assigneeId ?? null,
            })
          : body.action === 'snooze'
            ? this.inbox.snoozeItem({
                ...selector,
                snoozedUntil: body.snoozedUntil ?? null,
              })
            : body.action === 'discard'
              ? this.inbox.discardItem({
                  ...selector,
                  reason: body.reason ?? 'irrelevant',
                })
              : this.inbox.approveItem(selector));

        results.push(
          detail === null
            ? { code: 'not_found', itemId, status: 'refused' }
            : { itemId, status: 'ok' },
        );
      } catch (error) {
        results.push({
          code: bulkRefusalCode(error),
          itemId,
          status: 'refused',
        });
      }
    }

    return { results };
  }

  listRules(input: TenantContext): Promise<InboxRule[]> {
    return this.inbox.listRules(input);
  }

  readRule(input: RuleSelector): Promise<InboxRule | null> {
    return this.inbox.readRule(input);
  }

  // The enabled cap is the controller's answer; the rerun is queued after the commit.
  async createRule(input: CreateRuleInput): Promise<InboxRule | null> {
    const created = await this.inbox.createRule(input);

    // Enqueued after the commit, as the creator; the rule stands either way and a lost rerun is logged, not a 503.
    if (created !== null && input.body.applyToExisting) {
      try {
        await this.queue.enqueueRerunInboxRule({
          organizationId: input.organizationId,
          ruleId: created.id,
          userId: input.userId,
        });
      } catch {
        this.logger.error(
          `Enqueue of rerun_inbox_rule failed for rule ${created.id}.`,
        );
      }
    }

    return created;
  }

  updateRule(input: UpdateRuleInput): Promise<InboxRule | null> {
    return this.inbox.updateRule(input);
  }

  deleteRule(input: RuleSelector): Promise<boolean> {
    return this.inbox.deleteRule(input);
  }

  orderRules(input: OrderRulesInput): Promise<InboxRule[]> {
    return this.inbox.orderRules(input);
  }

  adoptRule(input: AdoptRuleInput): Promise<InboxRule | null> {
    return this.inbox.adoptRule(input);
  }

  listItems(input: ListItemsInput): Promise<InboxItemListResponse> {
    return this.inbox.listItems(input);
  }

  readItem(input: ReadItemInput): Promise<InboxItemDetail | null> {
    return this.inbox.readItem(input);
  }

  updateHints(input: UpdateHintsInput): Promise<InboxItemDetail | null> {
    return this.inbox.updateHints(input);
  }

  undoRoute(input: ReadItemInput): Promise<InboxItemDetail | null> {
    return this.inbox.undoRoute(input);
  }

  discardItem(input: DiscardItemInput): Promise<InboxItemDetail | null> {
    return this.inbox.discardItem(input);
  }

  restoreItem(input: ReadItemInput): Promise<InboxItemDetail | null> {
    return this.inbox.restoreItem(input);
  }

  assignItem(input: AssignItemInput): Promise<InboxItemDetail | null> {
    return this.inbox.assignItem(input);
  }

  snoozeItem(input: SnoozeItemInput): Promise<InboxItemDetail | null> {
    return this.inbox.snoozeItem(input);
  }

  async openBlob(input: OpenBlobInput): Promise<OpenedBlob> {
    const blob = await this.inbox.readBlob(input);

    if (blob === null) {
      throw new NotFoundException();
    }

    // Only a clean verdict leaves the store: a flagged or unscannable blob is quarantined, an unanswered one waits.
    if (blob.scanStatus !== 'clean') {
      throw new ConflictException(
        blob.scanStatus === 'not_scanned'
          ? 'blob_scan_pending'
          : 'blob_quarantined',
      );
    }

    if (
      input.inline &&
      !INLINE_MEDIA_TYPES.includes(
        blob.mediaType as (typeof INLINE_MEDIA_TYPES)[number],
      )
    ) {
      throw new UnsupportedMediaTypeException();
    }

    if ((await this.blobs.stat(blob.storageKey)) === null) {
      throw new NotFoundException();
    }

    return { blob, stream: this.blobs.open(blob.storageKey) };
  }
}
