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
  UpdateInboxSettingsRequest,
} from './contract.js';
import {
  InboxRepository,
  QuotaExceededError,
  type AdoptRuleInput,
  type AssignItemInput,
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
  manualProvider,
} from './providers/manual.js';
import { InboxQueue } from './inbox-queue.js';
import {
  SNIFF_PROVIDER,
  SNIFF_PROVIDER_VERSION,
  SNIFF_WINDOW_BYTES,
  sniffBytes,
  toProviderOutput,
  type SniffResult,
} from './providers/sniff.js';
import { isInvoiceAutoRoute } from './rules.js';

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

function toIntakeResponse(result: ReceiveIntakeResult): InboxIntakeResponse {
  return {
    duplicateOfItemId: result.duplicateOfItemId,
    itemId: result.item.id,
    status: result.item.status,
  };
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

      return await this.receive({
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

      // Sent after the commit; nothing routes inside a request. A lost job leaves the item in review for a person.
      if (result.routeJob !== null) {
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

    const first = loaded.files[0];

    if (first === undefined) {
      throw new BadRequestException();
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

    return this.inbox.recordExtraction({
      ...input,
      extraction: {
        output: applyHints(toProviderOutput(sniffed), loaded.input.hints),
        provider: SNIFF_PROVIDER,
        providerVersion: SNIFF_PROVIDER_VERSION,
      },
    });
  }

  async routeToDocument(input: RouteInput): Promise<InboxItemDetail | null> {
    const { document, output } = manualProvider(input.body.document);

    return this.inbox.routeToDocument({
      ...input,
      correctionReasons: input.body.correctionReasons ?? {},
      document,
      extraction: {
        output,
        provider: MANUAL_PROVIDER,
        providerVersion: MANUAL_PROVIDER_VERSION,
      },
      fileBlobIds: input.body.fileBlobIds,
    });
  }

  listRules(input: TenantContext): Promise<InboxRule[]> {
    return this.inbox.listRules(input);
  }

  readRule(input: RuleSelector): Promise<InboxRule | null> {
    return this.inbox.readRule(input);
  }

  // The enabled cap and the invoice refusal are the controller's answers; the rerun is queued after the commit.
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

  // The invoice refusal needs the merged row: the stored rule plus the patch.
  async updateRule(input: UpdateRuleInput): Promise<InboxRule | null> {
    const current = await this.inbox.readRule(input);

    if (current === null) {
      return null;
    }

    if (
      isInvoiceAutoRoute({
        autoRoute: input.body.autoRoute ?? current.autoRoute,
        setDocumentKind:
          input.body.setDocumentKind === undefined
            ? current.setDocumentKind
            : input.body.setDocumentKind,
      })
    ) {
      throw new UnprocessableEntityException('not_available');
    }

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

    // A blob the scanner flagged, or could not scan, never leaves the store.
    if (blob.scanStatus === 'infected' || blob.scanStatus === 'failed') {
      throw new ConflictException('blob_quarantined');
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
