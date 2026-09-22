import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { BlobScanStatus } from '@bap/db';
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
import type {
  InboxItem,
  InboxItemDetail,
  ProviderInput,
  SplitEmailItemJob,
} from './contract.js';
import { applyHints, InboxService } from './inbox.service.js';
import { routingTargetFor } from './routing-targets.js';
import {
  QuotaExceededError,
  type InboxRepository,
  type ItemFileRecord,
  type ReceiveIntakeInput,
  type RecordExtractionInput,
  type RouteToDocumentInput,
  type UpdateInboxSettingsInput,
} from './inbox-repository.js';
import * as fixtures from './providers/__fixtures__/index.js';

const ENTITY_ID = '4a2b7c1e-9f5d-4c3a-8b21-6e0f7d5a4c39';
const PARTNER_ID = 'a0813274-5fbd-4c90-a187-c45fd3b0a295';
const ITEM_ID = '6c4d9e30-1b7f-4e5c-ad43-801b9f7c6e51';
const BLOB_ID = '9f702163-4eac-4b8f-9076-b34ec2af9184';
const CHANNEL_ID = 'c2a35496-71df-4eb2-8309-e671f5d2c4b7';
const QUOTA = 100_000;
const INTAKE_DOMAIN_VALUE = 'in.bap.invalid';

const channelTenant = {
  organizationId: 'organization_1',
  role: 'channel' as const,
  userId: `channel_${CHANNEL_ID}`,
};

const tenant = {
  legalEntityIds: null,
  organizationId: 'organization_1',
  role: 'owner' as const,
  userId: 'user_1',
};

const item: InboxItem = {
  assigneeId: null,
  channelId: null,
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
  origin: null,
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
  routingTarget: routingTargetFor('pdf'),
};

describe('InboxService', () => {
  let directory: string;
  let store: FilesystemBlobStore;
  let service: InboxService;
  let usedBytes = 0;
  let existingSha256: string | null = null;
  let storedFile: ItemFileRecord | null = null;
  let blobScanStatus: BlobScanStatus = 'not_scanned';
  let hints: ProviderInput['hints'] = {
    hintKind: null,
    hintLegalEntityId: null,
    hintLinkDocumentId: null,
    hintPartnerId: null,
    hintText: null,
  };
  const received: ReceiveIntakeInput[] = [];
  const extractions: RecordExtractionInput[] = [];
  const routed: RouteToDocumentInput[] = [];
  const enqueued: SplitEmailItemJob[] = [];
  const settingsUpdates: UpdateInboxSettingsInput[] = [];
  let enqueueFails = false;
  const queue = {
    enqueueSplitEmailItem: vi.fn(async (job: SplitEmailItemJob) => {
      if (enqueueFails) {
        throw new Error('queue down');
      }
      enqueued.push(job);
    }),
  };

  // The repository stub mirrors the real transaction order: quota, duplicate, then persist only for new bytes.
  const repository = {
    assignItem: vi.fn(),
    createChannel: vi.fn(),
    deleteRoutingTarget: vi.fn(),
    discardItem: vi.fn(),
    issueCredential: vi.fn(
      async (input: { channelId: string; intakeDomain: string }) => {
        if (input.channelId === 'limit') {
          throw Object.assign(new Error('limit'), {
            code: '23514',
            constraint: 'inbox_channel_credential_active_limit',
          });
        }
        if (input.channelId === 'missing') {
          throw Object.assign(new Error('missing'), { code: 'P0002' });
        }
        if (input.channelId === 'admin') {
          throw Object.assign(new Error('admin'), { code: '42501' });
        }
        if (input.channelId === 'other') {
          throw Object.assign(new Error('other'), {
            code: '23514',
            constraint: 'inbox_channel_credential_kind_check',
          });
        }
        if (input.channelId === 'mismatch') {
          throw Object.assign(new Error('mismatch'), {
            code: '23514',
            constraint: 'inbox_channel_credential_kind_match',
          });
        }
        if (input.channelId === 'no-domain') {
          throw Object.assign(new Error('no domain'), { code: '22023' });
        }
        if (input.channelId === 'email') {
          return {
            credentialId: CHANNEL_ID,
            displayPrefix: 'abcdef01',
            secret: `in-abcdef01${'0'.repeat(24)}@${input.intakeDomain}`,
          };
        }
        return {
          credentialId: CHANNEL_ID,
          displayPrefix: 'AAAAAAAA',
          secret: `bap_intake_${'A'.repeat(43)}`,
        };
      },
    ),
    listChannels: vi.fn(),
    listItems: vi.fn(),
    listRoutingTargets: vi.fn(),
    putRoutingTarget: vi.fn(),
    readBlob: vi.fn(async (input: { blobId: string }) =>
      storedFile === null || input.blobId !== storedFile.blobId
        ? null
        : { ...storedFile, id: storedFile.blobId, scanStatus: blobScanStatus },
    ),
    readChannel: vi.fn(),
    readChannelPrincipal: vi.fn(),
    readInboxSettings: vi.fn(async (input: { platformQuotaBytes: number }) => ({
      blobQuotaBytes: null,
      platformQuotaBytes: input.platformQuotaBytes,
      usedBytes,
    })),
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
    receiveIntake: vi.fn(async (input: ReceiveIntakeInput) => {
      received.push(input);
      if (input.sha256 === existingSha256) {
        return {
          duplicateOfItemId: ITEM_ID,
          files: [],
          item: { ...item, status: 'discarded' as const },
          replayed: false,
        };
      }
      if (usedBytes + input.byteSize > input.quotaBytes) {
        throw new QuotaExceededError();
      }
      await input.persist();
      usedBytes += input.byteSize;
      return { duplicateOfItemId: null, files: [], item, replayed: false };
    }),
    recordExtraction: vi.fn(async (input: RecordExtractionInput) => {
      extractions.push(input);
      return detail;
    }),
    restoreItem: vi.fn(),
    revokeCredential: vi.fn(),
    routeToDocument: vi.fn(async (input: RouteToDocumentInput) => {
      routed.push(input);
      return detail;
    }),
    snoozeItem: vi.fn(),
    undoRoute: vi.fn(),
    updateChannel: vi.fn(),
    updateHints: vi.fn(),
    updateInboxSettings: vi.fn(async (input: UpdateInboxSettingsInput) => {
      settingsUpdates.push(input);
      return {
        blobQuotaBytes: input.blobQuotaBytes,
        platformQuotaBytes: input.platformQuotaBytes,
        usedBytes,
      };
    }),
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
    service = new InboxService(
      repository,
      store,
      QUOTA,
      INTAKE_DOMAIN_VALUE,
      queue,
    );
  });

  afterAll(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  beforeEach(() => {
    received.length = 0;
    extractions.length = 0;
    routed.length = 0;
    enqueued.length = 0;
    enqueueFails = false;
    existingSha256 = null;
    blobScanStatus = 'not_scanned';
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
      scanStatus: 'clean',
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

  it('refuses a restricted scope with 403 before hashing and deletes the temporary file', async () => {
    const path = await stage(fixtures.pdf(), 'upload-restricted');

    await expect(
      service.upload({
        ...tenant,
        file: { originalname: 'placeholder.pdf', path, size: 5 },
        legalEntityIds: [ENTITY_ID],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(received).toEqual([]);
    await expect(stat(path)).rejects.toThrow();
    expect(await readdir(store.temporaryDirectory())).toEqual([]);
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

  it('quarantines an infected or unscannable blob on download and inline alike', async () => {
    for (const status of ['infected', 'failed'] as const) {
      blobScanStatus = status;
      for (const inline of [false, true]) {
        await expect(
          service.openBlob({ ...tenant, blobId: BLOB_ID, inline }),
        ).rejects.toMatchObject({ message: 'blob_quarantined', status: 409 });
      }
    }

    blobScanStatus = 'clean';
    const opened = await service.openBlob({
      ...tenant,
      blobId: BLOB_ID,
      inline: false,
    });
    opened.stream.destroy();
  });

  it('stores a raw email unsniffed as received and enqueues the split after the commit', async () => {
    const bytes = Buffer.from(
      'From: a@example.org\r\nSubject: x\r\n\r\nbody\r\n',
    );
    const path = await stage(bytes, 'email-1');
    repository.receiveIntake.mockImplementationOnce(
      async (input: ReceiveIntakeInput) => {
        received.push(input);
        await input.persist();
        return {
          duplicateOfItemId: null,
          files: [],
          item: { ...item, status: 'received' as const },
          replayed: false,
        };
      },
    );

    const response = await service.intakeEmail({
      ...channelTenant,
      channelId: CHANNEL_ID,
      externalId: 'mailgun-token-1',
      origin: 'abcdef01',
      size: bytes.length,
      temporaryPath: path,
    });

    expect(response).toEqual({
      duplicateOfItemId: null,
      itemId: ITEM_ID,
      status: 'received',
    });
    expect(received[0]).toMatchObject({
      byteSize: bytes.length,
      channelId: CHANNEL_ID,
      channelKind: 'email',
      externalId: 'mailgun-token-1',
      mediaType: 'message/rfc822',
      origin: 'abcdef01',
      originalFilename: null,
      parentItemId: null,
      payloadKind: 'email',
      sender: null,
      sniff: null,
    });
    expect(enqueued).toEqual([
      {
        channelId: CHANNEL_ID,
        itemId: ITEM_ID,
        organizationId: 'organization_1',
      },
    ]);
    expect(await readdir(store.temporaryDirectory())).toEqual([]);
  });

  it('enqueues nothing for an email replay already past received', async () => {
    const bytes = Buffer.from('Subject: y\r\n\r\n');
    // The stub answers the default needs_review item: a replay of a split message.
    await service.intakeEmail({
      ...channelTenant,
      channelId: CHANNEL_ID,
      externalId: 'mailgun-token-2',
      origin: null,
      size: bytes.length,
      temporaryPath: await stage(bytes, 'email-2'),
    });
    expect(enqueued).toEqual([]);
  });

  it('answers 503 when the enqueue after the commit fails and enqueues on the replay', async () => {
    const bytes = Buffer.from('Subject: z\r\n\r\n');
    const receivedItem = async (input: ReceiveIntakeInput) => {
      received.push(input);
      await input.persist();
      return {
        duplicateOfItemId: null,
        files: [],
        item: { ...item, status: 'received' as const },
        replayed: false,
      };
    };

    enqueueFails = true;
    repository.receiveIntake.mockImplementationOnce(receivedItem);
    await expect(
      service.intakeEmail({
        ...channelTenant,
        channelId: CHANNEL_ID,
        externalId: 'mailgun-token-3',
        origin: null,
        size: bytes.length,
        temporaryPath: await stage(bytes, 'email-3'),
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    // The item was committed as received before the enqueue, so nothing is rolled back.
    expect(received).toHaveLength(1);
    expect(enqueued).toEqual([]);

    // The poster retries: the replay answers the same received item and enqueues it this time.
    enqueueFails = false;
    repository.receiveIntake.mockImplementationOnce(async (input) => ({
      ...(await receivedItem(input)),
      replayed: true,
    }));
    const response = await service.intakeEmail({
      ...channelTenant,
      channelId: CHANNEL_ID,
      externalId: 'mailgun-token-3',
      origin: null,
      size: bytes.length,
      temporaryPath: await stage(bytes, 'email-3-retry'),
    });
    expect(response.status).toBe('received');
    expect(enqueued).toEqual([
      {
        channelId: CHANNEL_ID,
        itemId: ITEM_ID,
        organizationId: 'organization_1',
      },
    ]);
  });
  it('stores a structured payload as JSON bytes on the channel and leaves no temporary file', async () => {
    const response = await service.intakeStructured({
      ...channelTenant,
      channelId: CHANNEL_ID,
      externalId: 'erp-42',
      origin: 'AAAAAAAA',
      payload: { lines: [{ amount: '10.00' }], total: '10.00' },
    });

    expect(response).toEqual({
      duplicateOfItemId: null,
      itemId: ITEM_ID,
      status: 'needs_review',
    });
    const input = received[0];
    expect(input).toMatchObject({
      channelId: CHANNEL_ID,
      channelKind: 'api',
      externalId: 'erp-42',
      legalEntityIds: null,
      mediaType: 'application/json',
      origin: 'AAAAAAAA',
      originalFilename: null,
      payloadKind: 'structured',
      role: 'channel',
      userId: `channel_${CHANNEL_ID}`,
    });
    const bytes = Buffer.from(
      JSON.stringify({ lines: [{ amount: '10.00' }], total: '10.00' }),
    );
    expect(input?.byteSize).toBe(bytes.length);
    expect(input?.sha256).toBe(
      createHash('sha256').update(bytes).digest('hex'),
    );
    expect(await store.stat(input?.storageKey ?? '')).toEqual({
      byteSize: bytes.length,
    });
    expect(await readdir(store.temporaryDirectory())).toEqual([]);
  });

  it('pushes a file through the channel with the external id and never a restricted scope', async () => {
    const bytes = fixtures.pdf();
    const path = await stage(bytes, 'channel-file');

    const response = await service.intakeFile({
      ...channelTenant,
      channelId: CHANNEL_ID,
      externalId: null,
      file: { originalname: 'invoice.pdf', path, size: bytes.length },
      origin: null,
    });

    expect(response.itemId).toBe(ITEM_ID);
    expect(received[0]).toMatchObject({
      channelId: CHANNEL_ID,
      channelKind: 'api',
      externalId: null,
      legalEntityIds: null,
      mediaType: 'application/pdf',
      originalFilename: 'invoice.pdf',
      payloadKind: 'file',
    });
    expect(await readdir(store.temporaryDirectory())).toEqual([]);

    await expect(
      service.intakeFile({
        ...channelTenant,
        channelId: CHANNEL_ID,
        externalId: null,
        file: undefined,
        origin: null,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps the credential definer verdicts to 409, 404 and 403 and passes the rest through', async () => {
    await expect(
      service.issueCredential({ ...tenant, channelId: CHANNEL_ID }),
    ).resolves.toMatchObject({ displayPrefix: 'AAAAAAAA' });
    await expect(
      service.issueCredential({ ...tenant, channelId: 'limit' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.issueCredential({ ...tenant, channelId: 'missing' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.issueCredential({ ...tenant, channelId: 'admin' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.issueCredential({ ...tenant, channelId: 'other' }),
    ).rejects.toThrow('other');
  });

  it('issues an email address under the configured intake domain and maps the email verdicts', async () => {
    await expect(
      service.issueCredential({ ...tenant, channelId: 'email' }),
    ).resolves.toEqual({
      credentialId: CHANNEL_ID,
      displayPrefix: 'abcdef01',
      secret: `in-abcdef01${'0'.repeat(24)}@in.bap.invalid`,
    });
    expect(repository.issueCredential).toHaveBeenLastCalledWith(
      expect.objectContaining({ intakeDomain: INTAKE_DOMAIN_VALUE }),
    );
    await expect(
      service.issueCredential({ ...tenant, channelId: 'mismatch' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.issueCredential({ ...tenant, channelId: 'no-domain' }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('reads the settings against the platform cap and refuses a quota above it with 422', async () => {
    const organization = {
      organizationId: 'organization_1',
      role: 'owner' as const,
      userId: 'user_1',
    };

    await expect(service.readSettings(organization)).resolves.toEqual({
      blobQuotaBytes: null,
      platformQuotaBytes: QUOTA,
      usedBytes,
    });

    await expect(
      service.updateSettings({
        ...organization,
        body: { blobQuotaBytes: QUOTA + 1 },
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(settingsUpdates).toEqual([]);

    // The cap itself, anything below it and a reset to null all reach the repository with the platform value.
    await expect(
      service.updateSettings({
        ...organization,
        body: { blobQuotaBytes: QUOTA },
      }),
    ).resolves.toMatchObject({ blobQuotaBytes: QUOTA });
    await expect(
      service.updateSettings({
        ...organization,
        body: { blobQuotaBytes: null },
      }),
    ).resolves.toMatchObject({ blobQuotaBytes: null });
    expect(settingsUpdates).toEqual([
      expect.objectContaining({
        blobQuotaBytes: QUOTA,
        platformQuotaBytes: QUOTA,
        userId: 'user_1',
      }),
      expect.objectContaining({
        blobQuotaBytes: null,
        platformQuotaBytes: QUOTA,
      }),
    ]);
  });
});
