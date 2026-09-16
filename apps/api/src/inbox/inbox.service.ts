import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { z } from 'zod';

import { blobStorageKey, BlobStore } from '../blobs/blob-store.js';
import { MAX_UPLOAD_BYTES } from '../ingestion/contract.js';
import type { ReceivedFile } from '../request-context.js';
import { INLINE_MEDIA_TYPES } from './contract.js';
import type {
  InboxHints,
  InboxItemDetail,
  InboxItemListResponse,
  InboxUploadResponse,
  ProviderOutput,
  RouteInboxItemToDocumentRequest,
} from './contract.js';
import {
  InboxRepository,
  QuotaExceededError,
  type AssignItemInput,
  type BlobRecord,
  type DiscardItemInput,
  type EntityScopeSelector,
  type ListItemsInput,
  type ReadItemInput,
  type SnoozeItemInput,
  type UpdateHintsInput,
} from './inbox-repository.js';
import {
  MANUAL_PROVIDER,
  MANUAL_PROVIDER_VERSION,
  manualProvider,
} from './providers/manual.js';
import {
  SNIFF_PROVIDER,
  SNIFF_PROVIDER_VERSION,
  SNIFF_WINDOW_BYTES,
  sniffBytes,
  toProviderOutput,
} from './providers/sniff.js';

export const BLOB_QUOTA_BYTES = Symbol('BLOB_QUOTA_BYTES');

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

export interface RouteInput extends ReadItemInput {
  body: RouteInboxItemToDocumentRequest;
}

export interface OpenBlobInput extends EntityScopeSelector {
  blobId: string;
  inline: boolean;
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
  constructor(
    @Inject(InboxRepository) private readonly inbox: InboxRepository,
    @Inject(BlobStore) private readonly blobs: BlobStore,
    @Inject(BLOB_QUOTA_BYTES) private readonly quotaBytes: number,
  ) {}

  async upload(input: UploadInput): Promise<InboxUploadResponse> {
    const received = input.file;
    let cleanupTemporaryPath = received?.path ?? null;

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

      const { size, temporaryPath } = file.data;
      const sha256 = await sha256Of(temporaryPath);
      const range = windows(size);
      const sniffed = sniffBytes({
        byteSize: size,
        head: await readWindow(
          temporaryPath,
          range.head[0],
          range.head[1] - range.head[0] + 1,
        ),
        tail: await readWindow(
          temporaryPath,
          range.tail[0],
          range.tail[1] - range.tail[0] + 1,
        ),
      });
      const storageKey = blobStorageKey(input.organizationId, sha256);
      const result = await this.inbox.receiveUpload({
        ...input,
        byteSize: size,
        mediaType: sniffed.mediaType,
        originalFilename: file.data.originalname ?? null,
        persist: async () => {
          await this.blobs.put({ key: storageKey, temporaryPath });
          // The temporary name is gone once moved, so nothing is left to clean up.
          cleanupTemporaryPath = null;
        },
        quotaBytes: this.quotaBytes,
        sha256,
        sniff: {
          output: toProviderOutput(sniffed),
          provider: SNIFF_PROVIDER,
          providerVersion: SNIFF_PROVIDER_VERSION,
        },
        storageKey,
      });

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
      document,
      extraction: {
        output,
        provider: MANUAL_PROVIDER,
        providerVersion: MANUAL_PROVIDER_VERSION,
      },
      fileBlobIds: input.body.fileBlobIds,
    });
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
