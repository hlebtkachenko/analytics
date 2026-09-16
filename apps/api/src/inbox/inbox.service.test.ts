import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  createBlobDirectories,
  FilesystemBlobStore,
} from '../blobs/blob-store.js';
import type { InboxItem, InboxItemDetail, ProviderInput } from './contract.js';
import { applyHints, InboxService } from './inbox.service.js';
import {
  QuotaExceededError,
  type InboxRepository,
  type ItemFileRecord,
  type ReceiveUploadInput,
  type RecordExtractionInput,
  type RouteToDocumentInput,
} from './inbox-repository.js';
import * as fixtures from './providers/__fixtures__/index.js';

const ENTITY_ID = '4a2b7c1e-9f5d-4c3a-8b21-6e0f7d5a4c39';
const PARTNER_ID = 'a0813274-5fbd-4c90-a187-c45fd3b0a295';
const ITEM_ID = '6c4d9e30-1b7f-4e5c-ad43-801b9f7c6e51';
const BLOB_ID = '9f702163-4eac-4b8f-9076-b34ec2af9184';
const QUOTA = 100_000;

const tenant = {
  legalEntityIds: null,
  organizationId: 'organization_1',
  role: 'owner' as const,
  userId: 'user_1',
};

const item: InboxItem = {
  assigneeId: null,
  channelKind: 'upload',
  confidence: null,
  createdAt: '2026-09-16T06:00:00.000Z',
  datasetId: null,
  decidedByKind: null,
  decidedByUserId: null,
  detectedType: null,
  documentId: null,
  duplicateOfItemId: null,
  hintKind: null,
  hintLegalEntityId: null,
  hintLinkDocumentId: null,
  hintPartnerId: null,
  hintText: null,
  id: ITEM_ID,
  legalEntityId: null,
  partnerId: null,
  payloadKind: 'file',
  receivedAt: '2026-09-16T06:00:00.000Z',
  routedAt: null,
  snoozedUntil: null,
  status: 'needs_review',
  updatedAt: '2026-09-16T06:00:00.000Z',
};

const detail: InboxItemDetail = {
  events: [],
  extraction: null,
  files: [],
  item,
};

describe('InboxService', () => {
  let directory: string;
  let store: FilesystemBlobStore;
  let service: InboxService;
  let usedBytes = 0;
  let existingSha256: string | null = null;
  let storedFile: ItemFileRecord | null = null;
  let hints: ProviderInput['hints'] = {
    hintKind: null,
    hintLegalEntityId: null,
    hintLinkDocumentId: null,
    hintPartnerId: null,
    hintText: null,
  };
  const received: ReceiveUploadInput[] = [];
  const extractions: RecordExtractionInput[] = [];
  const routed: RouteToDocumentInput[] = [];

  // The repository stub mirrors the real transaction order: quota, duplicate, then persist only for new bytes.
  const repository = {
    assignItem: vi.fn(),
    discardItem: vi.fn(),
    listItems: vi.fn(),
    readBlob: vi.fn(async (input: { blobId: string }) =>
      storedFile === null || input.blobId !== storedFile.blobId
        ? null
        : { id: storedFile.blobId, ...storedFile },
    ),
    readItem: vi.fn(),
    readProviderInput: vi.fn(async (input: { itemId: string }) =>
      input.itemId !== ITEM_ID || storedFile === null
        ? null
        : {
            files: [storedFile],
            input: {
              context: { legalEntities: [], partners: [] },
              files: [
                { ...storedFile, sniffedMediaType: storedFile.mediaType },
              ],
              hints,
              item,
            },
          },
    ),
    receiveUpload: vi.fn(async (input: ReceiveUploadInput) => {
      received.push(input);
      if (input.sha256 === existingSha256) {
        return {
          duplicateOfItemId: ITEM_ID,
          files: [],
          item: { ...item, status: 'discarded' as const },
        };
      }
      if (usedBytes + input.byteSize > input.quotaBytes) {
        throw new QuotaExceededError();
      }
      await input.persist();
      usedBytes += input.byteSize;
      return { duplicateOfItemId: null, files: [], item };
    }),
    recordExtraction: vi.fn(async (input: RecordExtractionInput) => {
      extractions.push(input);
      return detail;
    }),
    restoreItem: vi.fn(),
    routeToDocument: vi.fn(async (input: RouteToDocumentInput) => {
      routed.push(input);
      return detail;
    }),
    snoozeItem: vi.fn(),
    undoRoute: vi.fn(),
    updateHints: vi.fn(),
  } satisfies InboxRepository;

  async function stage(bytes: Buffer, name = 'upload-1'): Promise<string> {
    const path = join(store.temporaryDirectory(), name);
    await writeFile(path, bytes);
    return path;
  }

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'bap-inbox-service-'));
    await createBlobDirectories(directory);
    store = new FilesystemBlobStore(directory);
    service = new InboxService(repository, store, QUOTA);
  });

  afterAll(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  beforeEach(() => {
    received.length = 0;
    extractions.length = 0;
    routed.length = 0;
    existingSha256 = null;
  });

  it('hashes, sniffs and stores a new upload, then leaves no temporary file', async () => {
    const bytes = fixtures.pdf();
    const path = await stage(bytes);

    const response = await service.upload({
      ...tenant,
      file: { originalname: 'placeholder.pdf', path, size: bytes.length },
    });

    expect(response.item).toEqual(item);
    const input = received[0];
    expect(input).toMatchObject({
      byteSize: bytes.length,
      mediaType: 'application/pdf',
      originalFilename: 'placeholder.pdf',
      quotaBytes: QUOTA,
      sniff: {
        output: { detectedType: 'pdf', issues: [] },
        provider: 'sniff',
      },
    });
    expect(input?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(input?.storageKey).toBe(`org/organization_1/${input?.sha256}`);
    expect(await store.stat(input?.storageKey ?? '')).toEqual({
      byteSize: bytes.length,
    });
    expect(await readdir(store.temporaryDirectory())).toEqual([]);

    storedFile = {
      blobId: BLOB_ID,
      byteSize: bytes.length,
      mediaType: 'application/pdf',
      originalFilename: 'placeholder.pdf',
      position: 1,
      sha256: input?.sha256 ?? '',
      storageKey: input?.storageKey ?? '',
    };
  });

  it('answers a duplicate without moving bytes and deletes the temporary file', async () => {
    const bytes = fixtures.pdf();
    const path = await stage(bytes, 'upload-2');
    existingSha256 =
      received.length === 0 ? null : (received[0]?.sha256 ?? null);
    existingSha256 = storedFile?.sha256 ?? null;

    const response = await service.upload({
      ...tenant,
      file: { originalname: 'again.pdf', path, size: bytes.length },
    });

    expect(response.duplicateOfItemId).toBe(ITEM_ID);
    expect(response.item.status).toBe('discarded');
    await expect(stat(path)).rejects.toThrow();
    expect(await readdir(store.temporaryDirectory())).toEqual([]);
  });

  it('refuses an upload over the quota with 413 and stores nothing', async () => {
    const bytes = fixtures.padded(fixtures.PDF_MAGIC, QUOTA);
    const path = await stage(bytes, 'upload-3');

    await expect(
      service.upload({
        ...tenant,
        file: { originalname: 'huge.pdf', path, size: bytes.length },
      }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);

    await expect(stat(path)).rejects.toThrow();
    expect(await readdir(store.temporaryDirectory())).toEqual([]);
    expect(
      await readdir(join(directory, 'org', 'organization_1')),
    ).toHaveLength(1);
  });

  it('refuses a missing or unsafe file part and deletes the temporary file', async () => {
    await expect(
      service.upload({ ...tenant, file: undefined }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const path = await stage(fixtures.text(), 'upload-4');
    await expect(
      service.upload({
        ...tenant,
        file: { originalname: 'bad/name.txt', path, size: 5 },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(stat(path)).rejects.toThrow();
  });

  it('re-runs the sniff on the stored bytes and lets the hints outrank it', async () => {
    hints = {
      hintKind: 'payroll_sheet',
      hintLegalEntityId: ENTITY_ID,
      hintLinkDocumentId: null,
      hintPartnerId: PARTNER_ID,
      hintText: 'placeholder note',
    };

    const result = await service.process({ ...tenant, itemId: ITEM_ID });

    expect(result).toEqual(detail);
    const output = extractions[0]?.extraction.output;
    expect(output).toMatchObject({
      confidence: 1,
      detectedType: 'payroll_sheet',
      legalEntityId: ENTITY_ID,
      partnerId: PARTNER_ID,
    });
    expect(output?.reasons.map((reason) => reason.step)).toEqual([
      'sniff',
      'hint',
      'hint',
      'hint',
    ]);
    expect(output?.reasons[0]?.evidence).toContain('PDF');
    // The hint text is never copied into a reason or a draft.
    expect(JSON.stringify(output)).not.toContain('placeholder note');

    expect(await service.process({ ...tenant, itemId: 'unknown' })).toBeNull();
  });

  it('keeps the sniff verdict when no hint is set', () => {
    const output = applyHints(
      {
        confidence: 0.6,
        detectedType: 'text',
        draft: {},
        fieldConfidences: {},
        issues: [],
        reasons: [{ evidence: 'placeholder', step: 'sniff', weight: 0.6 }],
      },
      {
        hintKind: null,
        hintLegalEntityId: null,
        hintLinkDocumentId: null,
        hintPartnerId: null,
        hintText: 'a note alone changes nothing',
      },
    );

    expect(output.detectedType).toBe('text');
    expect(output.confidence).toBe(0.6);
    expect(output.reasons).toHaveLength(1);
  });

  it('validates the draft through the manual provider before routing', async () => {
    await service.routeToDocument({
      ...tenant,
      body: {
        document: {
          currencyCode: 'CZK',
          documentDate: '2026-09-14',
          kind: 'contract',
          legalEntityId: ENTITY_ID,
          title: 'Placeholder contract',
        },
        fileBlobIds: [BLOB_ID],
      },
      itemId: ITEM_ID,
    });

    expect(routed[0]).toMatchObject({
      document: { kind: 'contract', title: 'Placeholder contract' },
      extraction: {
        output: { confidence: 1, detectedType: 'contract' },
        provider: 'manual',
      },
      fileBlobIds: [BLOB_ID],
    });
  });

  it('opens a stored blob for download, refuses inline for a non-allowed type and hides an unknown one', async () => {
    const opened = await service.openBlob({
      ...tenant,
      blobId: BLOB_ID,
      inline: true,
    });
    expect(opened.blob.mediaType).toBe('application/pdf');
    opened.stream.destroy();

    storedFile =
      storedFile === null ? null : { ...storedFile, mediaType: 'text/html' };
    await expect(
      service.openBlob({ ...tenant, blobId: BLOB_ID, inline: true }),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    const download = await service.openBlob({
      ...tenant,
      blobId: BLOB_ID,
      inline: false,
    });
    download.stream.destroy();

    await expect(
      service.openBlob({ ...tenant, blobId: 'missing', inline: false }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
