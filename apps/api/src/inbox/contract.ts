import {
  inboxChannelKinds,
  inboxDecidedByKinds,
  inboxDiscardReasons,
  inboxEventKinds,
  inboxEventReasons,
  inboxItemStatuses,
  inboxPayloadKinds,
  inboxUnprocessableReasons,
} from '@bap/db';
import { legalEntityIdentifierSchema } from '@bap/security';
import { z } from 'zod';

import {
  createDocumentBodyOpenApiSchema,
  createDocumentRequestSchema,
  documentIdentifierSchema,
  partnerIdentifierSchema,
  repeatedOrCsv,
} from '../documents/contract.js';
import { subjectIdentifierSchema } from '../worker/job-context.js';

// The closed vocabularies of the migration, re-exported from @bap/db so Zod, OpenAPI and SQL cannot drift.
export const INBOX_ITEM_STATUSES = inboxItemStatuses;
export const INBOX_CHANNEL_KINDS = inboxChannelKinds;
export const INBOX_PAYLOAD_KINDS = inboxPayloadKinds;
export const INBOX_DECIDED_BY_KINDS = inboxDecidedByKinds;
export const INBOX_EVENT_KINDS = inboxEventKinds;
export const INBOX_EVENT_REASONS = inboxEventReasons;
export const INBOX_DISCARD_REASONS = inboxDiscardReasons;
export const INBOX_UNPROCESSABLE_REASONS = inboxUnprocessableReasons;

// What the sniff provider can name in Phase 0; a hint may name any lowercase token beyond this list.
export const DETECTED_TYPES = [
  'isdoc_invoice',
  'money_s3_export',
  'pohoda_export',
  'camt_statement',
  'gpc_statement',
  'tabular',
  'pdf',
  'image',
  'text',
  'unknown',
] as const;

// Issues a provider may raise in Phase 0: the taxonomy is stored whole, only these are produced.
export const INBOX_ISSUE_CODES = [
  'duplicate_exact',
  'entity_unresolved',
  'missing_required_field',
  'reference_conflict',
  ...inboxUnprocessableReasons,
] as const;

export const PROVIDER_STEPS = ['sniff', 'hint', 'manual'] as const;

export const MAX_INBOX_PAGE_SIZE = 100;
export const DEFAULT_INBOX_PAGE_SIZE = 25;
export const MAX_INBOX_WINDOW = 10_000;
export const MAX_INBOX_FILES = 20;

// Only these render inside the sandboxed frame; anything else is a download, or an SVG would run under the session.
export const INLINE_MEDIA_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

export const TOKEN_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const MEDIA_TYPE_PATTERN =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const inboxItemIdentifierSchema = z.string().trim().toLowerCase().uuid();
export const blobIdentifierSchema = z.string().trim().toLowerCase().uuid();
export const tokenSchema = z.string().regex(TOKEN_PATTERN);
export const inboxItemStatusSchema = z.enum(INBOX_ITEM_STATUSES);
export const inboxEventKindSchema = z.enum(INBOX_EVENT_KINDS);
export const inboxEventReasonSchema = z.enum(INBOX_EVENT_REASONS);
export const inboxDiscardReasonSchema = z.enum(INBOX_DISCARD_REASONS);
export const inboxIssueCodeSchema = z.enum(INBOX_ISSUE_CODES);
export const detectedTypeSchema = z.enum(DETECTED_TYPES);
export const confidenceSchema = z.number().min(0).max(1);
export const hintTextSchema = z.string().trim().min(1).max(2000);

export const inboxHintsSchema = z
  .object({
    hintKind: tokenSchema.nullable(),
    hintLegalEntityId: legalEntityIdentifierSchema.nullable(),
    hintLinkDocumentId: documentIdentifierSchema.nullable(),
    hintPartnerId: partnerIdentifierSchema.nullable(),
    hintText: hintTextSchema.nullable(),
  })
  .strict();

export type InboxHints = z.infer<typeof inboxHintsSchema>;

export const inboxItemSchema = inboxHintsSchema
  .extend({
    assigneeId: subjectIdentifierSchema.nullable(),
    channelKind: z.enum(INBOX_CHANNEL_KINDS),
    confidence: confidenceSchema.nullable(),
    createdAt: z.iso.datetime(),
    datasetId: z.string().uuid().nullable(),
    decidedByKind: z.enum(INBOX_DECIDED_BY_KINDS).nullable(),
    decidedByUserId: subjectIdentifierSchema.nullable(),
    detectedType: tokenSchema.nullable(),
    documentId: documentIdentifierSchema.nullable(),
    duplicateOfItemId: inboxItemIdentifierSchema.nullable(),
    id: inboxItemIdentifierSchema,
    legalEntityId: legalEntityIdentifierSchema.nullable(),
    partnerId: partnerIdentifierSchema.nullable(),
    payloadKind: z.enum(INBOX_PAYLOAD_KINDS),
    receivedAt: z.iso.datetime(),
    routedAt: z.iso.datetime().nullable(),
    snoozedUntil: z.iso.datetime().nullable(),
    status: inboxItemStatusSchema,
    updatedAt: z.iso.datetime(),
  })
  .strict();

export type InboxItem = z.infer<typeof inboxItemSchema>;

export const inboxItemFileSchema = z
  .object({
    blobId: blobIdentifierSchema,
    byteSize: z.number().int().positive(),
    mediaType: z.string().regex(MEDIA_TYPE_PATTERN),
    originalFilename: z.string().min(1).max(255).nullable(),
    position: z.number().int().min(1),
    sha256: z.string().regex(SHA256_PATTERN),
  })
  .strict();

export type InboxItemFile = z.infer<typeof inboxItemFileSchema>;

export const providerReasonSchema = z
  .object({
    evidence: z.string().min(1).max(500),
    step: z.enum(PROVIDER_STEPS),
    weight: confidenceSchema,
  })
  .strict();

export type ProviderReason = z.infer<typeof providerReasonSchema>;

export const providerIssueSchema = z
  .object({
    code: inboxIssueCodeSchema,
    field: z.string().min(1).max(100).optional(),
    message: z.string().min(1).max(500),
  })
  .strict();

export type ProviderIssue = z.infer<typeof providerIssueSchema>;

// A JSON object with no fixed keys: the destination contract, not the inbox, decides the draft shape.
const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
export const draftSchema = z.record(z.string(), jsonValueSchema);
export const fieldConfidencesSchema = z.record(z.string(), confidenceSchema);

export const providerOutputSchema = z
  .object({
    confidence: confidenceSchema,
    detectedType: tokenSchema,
    draft: draftSchema,
    fieldConfidences: fieldConfidencesSchema,
    issues: z.array(providerIssueSchema),
    legalEntityId: legalEntityIdentifierSchema.optional(),
    partnerId: partnerIdentifierSchema.optional(),
    reasons: z.array(providerReasonSchema),
  })
  .strict();

export type ProviderOutput = z.infer<typeof providerOutputSchema>;

export const providerFileSchema = inboxItemFileSchema.extend({
  // What the bytes say, sniffed by the API; the stored media type is what the previous run decided.
  sniffedMediaType: z.string().regex(MEDIA_TYPE_PATTERN),
});

export const providerContextSchema = z
  .object({
    legalEntities: z.array(
      z
        .object({
          id: legalEntityIdentifierSchema,
          name: z.string(),
          registrationNumber: z.string().nullable(),
        })
        .strict(),
    ),
    partners: z.array(
      z
        .object({
          id: partnerIdentifierSchema,
          name: z.string(),
          registrationNumber: z.string().nullable(),
          vatNumber: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export const providerInputSchema = z
  .object({
    context: providerContextSchema,
    files: z.array(providerFileSchema),
    hints: inboxHintsSchema,
    item: inboxItemSchema,
  })
  .strict();

export type ProviderInput = z.infer<typeof providerInputSchema>;

export const inboxExtractionSchema = z
  .object({
    confidence: confidenceSchema,
    createdAt: z.iso.datetime(),
    detectedType: tokenSchema.nullable(),
    draft: draftSchema,
    fieldConfidences: fieldConfidencesSchema,
    id: z.string().uuid(),
    issues: z.array(providerIssueSchema),
    legalEntityId: legalEntityIdentifierSchema.nullable(),
    provider: tokenSchema,
    providerVersion: z.string().min(1).max(64),
    reasons: z.array(providerReasonSchema),
  })
  .strict();

export type InboxExtraction = z.infer<typeof inboxExtractionSchema>;

export const inboxEventSchema = z
  .object({
    actorUserId: subjectIdentifierSchema.nullable(),
    createdAt: z.iso.datetime(),
    id: z.string().uuid(),
    kind: inboxEventKindSchema,
    reason: inboxEventReasonSchema.nullable(),
  })
  .strict();

export type InboxEvent = z.infer<typeof inboxEventSchema>;

export const inboxUploadResponseSchema = z
  .object({
    // Set when the same bytes already existed in the organization; the new item is then discarded.
    duplicateOfItemId: inboxItemIdentifierSchema.nullable(),
    files: z.array(inboxItemFileSchema),
    item: inboxItemSchema,
  })
  .strict();

export type InboxUploadResponse = z.infer<typeof inboxUploadResponseSchema>;

export const inboxItemDetailSchema = z
  .object({
    events: z.array(inboxEventSchema),
    extraction: inboxExtractionSchema.nullable(),
    files: z.array(inboxItemFileSchema),
    item: inboxItemSchema,
  })
  .strict();

export type InboxItemDetail = z.infer<typeof inboxItemDetailSchema>;

export const inboxItemListQuerySchema = z
  .object({
    detectedType: tokenSchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_INBOX_PAGE_SIZE)
      .default(DEFAULT_INBOX_PAGE_SIZE),
    status: repeatedOrCsv(INBOX_ITEM_STATUSES).optional(),
  })
  .strict()
  .refine((query) => query.page * query.pageSize <= MAX_INBOX_WINDOW, {
    message: `page multiplied by pageSize must not exceed ${MAX_INBOX_WINDOW}.`,
    path: ['page'],
  });

export type InboxItemListQuery = z.infer<typeof inboxItemListQuerySchema>;

// The list carries the first file name and the file count so the browser needs no second request.
export const inboxItemListEntrySchema = inboxItemSchema
  .extend({
    fileCount: z.number().int().min(0),
    primaryFilename: z.string().min(1).max(255).nullable(),
  })
  .strict();

export type InboxItemListEntry = z.infer<typeof inboxItemListEntrySchema>;

export const inboxItemListResponseSchema = z
  .object({
    items: z.array(inboxItemListEntrySchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(MAX_INBOX_PAGE_SIZE),
    total: z.number().int().min(0),
  })
  .strict();

export type InboxItemListResponse = z.infer<typeof inboxItemListResponseSchema>;

// Every hint is optional; a null clears it. Absence leaves the stored hint alone.
export const updateInboxHintsRequestSchema = inboxHintsSchema
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one hint must be given.',
  });

export type UpdateInboxHintsRequest = z.infer<
  typeof updateInboxHintsRequestSchema
>;

export const routeInboxItemToDocumentRequestSchema = z
  .object({
    document: createDocumentRequestSchema,
    // The item's blobs in the order the document should keep them; every item file must be named once.
    fileBlobIds: z.array(blobIdentifierSchema).min(1).max(MAX_INBOX_FILES),
  })
  .strict()
  .refine(
    (body) => new Set(body.fileBlobIds).size === body.fileBlobIds.length,
    {
      message: 'fileBlobIds must not repeat a blob.',
      path: ['fileBlobIds'],
    },
  );

export type RouteInboxItemToDocumentRequest = z.infer<
  typeof routeInboxItemToDocumentRequestSchema
>;

export const discardInboxItemRequestSchema = z
  .object({ reason: inboxDiscardReasonSchema })
  .strict();

export type DiscardInboxItemRequest = z.infer<
  typeof discardInboxItemRequestSchema
>;

export const assignInboxItemRequestSchema = z
  .object({ assigneeId: subjectIdentifierSchema.nullable() })
  .strict();

export type AssignInboxItemRequest = z.infer<
  typeof assignInboxItemRequestSchema
>;

export const snoozeInboxItemRequestSchema = z
  .object({ snoozedUntil: z.iso.datetime().nullable() })
  .strict();

export type SnoozeInboxItemRequest = z.infer<
  typeof snoozeInboxItemRequestSchema
>;

// A display filename for Content-Disposition: ASCII only, no quote, no separator, no control character.
export function contentDispositionFilename(
  originalFilename: string | null,
  sha256: string,
): string {
  const sanitised = (originalFilename ?? '')
    .replaceAll(/[^\x20-\x7e]/g, '')
    .replaceAll(/["\\/;]/g, '')
    .trim();

  return sanitised.length > 0 ? sanitised : sha256;
}

const uuidProperty = { format: 'uuid', type: 'string' };
const dateTimeProperty = { format: 'date-time', type: 'string' };
const tokenProperty = { pattern: TOKEN_PATTERN.source, type: 'string' };
const confidenceProperty = { maximum: 1, minimum: 0, type: 'number' };
const nullable = (property: Record<string, unknown>) => ({
  ...property,
  nullable: true,
});

const hintProperties = {
  hintKind: nullable(tokenProperty),
  hintLegalEntityId: nullable(uuidProperty),
  hintLinkDocumentId: nullable(uuidProperty),
  hintPartnerId: nullable(uuidProperty),
  hintText: { maxLength: 2000, minLength: 1, nullable: true, type: 'string' },
};

export const inboxItemOpenApiSchema = {
  additionalProperties: false,
  properties: {
    ...hintProperties,
    assigneeId: { nullable: true, type: 'string' },
    channelKind: { enum: [...INBOX_CHANNEL_KINDS], type: 'string' },
    confidence: nullable(confidenceProperty),
    createdAt: dateTimeProperty,
    datasetId: nullable(uuidProperty),
    decidedByKind: {
      enum: [...INBOX_DECIDED_BY_KINDS],
      nullable: true,
      type: 'string',
    },
    decidedByUserId: { nullable: true, type: 'string' },
    detectedType: nullable(tokenProperty),
    documentId: nullable(uuidProperty),
    duplicateOfItemId: nullable(uuidProperty),
    id: uuidProperty,
    legalEntityId: nullable(uuidProperty),
    partnerId: nullable(uuidProperty),
    payloadKind: { enum: [...INBOX_PAYLOAD_KINDS], type: 'string' },
    receivedAt: dateTimeProperty,
    routedAt: nullable(dateTimeProperty),
    snoozedUntil: nullable(dateTimeProperty),
    status: { enum: [...INBOX_ITEM_STATUSES], type: 'string' },
    updatedAt: dateTimeProperty,
  },
  required: [
    'assigneeId',
    'channelKind',
    'confidence',
    'createdAt',
    'datasetId',
    'decidedByKind',
    'decidedByUserId',
    'detectedType',
    'documentId',
    'duplicateOfItemId',
    'hintKind',
    'hintLegalEntityId',
    'hintLinkDocumentId',
    'hintPartnerId',
    'hintText',
    'id',
    'legalEntityId',
    'partnerId',
    'payloadKind',
    'receivedAt',
    'routedAt',
    'snoozedUntil',
    'status',
    'updatedAt',
  ],
  type: 'object',
};

export const inboxItemFileOpenApiSchema = {
  additionalProperties: false,
  properties: {
    blobId: uuidProperty,
    byteSize: { minimum: 1, type: 'integer' },
    mediaType: { pattern: MEDIA_TYPE_PATTERN.source, type: 'string' },
    originalFilename: {
      maxLength: 255,
      minLength: 1,
      nullable: true,
      type: 'string',
    },
    position: { minimum: 1, type: 'integer' },
    sha256: { pattern: SHA256_PATTERN.source, type: 'string' },
  },
  required: [
    'blobId',
    'byteSize',
    'mediaType',
    'originalFilename',
    'position',
    'sha256',
  ],
  type: 'object',
};

const providerReasonOpenApiSchema = {
  additionalProperties: false,
  properties: {
    evidence: { maxLength: 500, minLength: 1, type: 'string' },
    step: { enum: [...PROVIDER_STEPS], type: 'string' },
    weight: confidenceProperty,
  },
  required: ['evidence', 'step', 'weight'],
  type: 'object',
};

const providerIssueOpenApiSchema = {
  additionalProperties: false,
  properties: {
    code: { enum: [...INBOX_ISSUE_CODES], type: 'string' },
    field: { maxLength: 100, minLength: 1, type: 'string' },
    message: { maxLength: 500, minLength: 1, type: 'string' },
  },
  required: ['code', 'message'],
  type: 'object',
};

export const inboxExtractionOpenApiSchema = {
  additionalProperties: false,
  properties: {
    confidence: confidenceProperty,
    createdAt: dateTimeProperty,
    detectedType: nullable(tokenProperty),
    draft: { additionalProperties: true, type: 'object' },
    fieldConfidences: {
      additionalProperties: confidenceProperty,
      type: 'object',
    },
    id: uuidProperty,
    issues: { items: providerIssueOpenApiSchema, type: 'array' },
    legalEntityId: nullable(uuidProperty),
    provider: tokenProperty,
    providerVersion: { maxLength: 64, minLength: 1, type: 'string' },
    reasons: { items: providerReasonOpenApiSchema, type: 'array' },
  },
  required: [
    'confidence',
    'createdAt',
    'detectedType',
    'draft',
    'fieldConfidences',
    'id',
    'issues',
    'legalEntityId',
    'provider',
    'providerVersion',
    'reasons',
  ],
  type: 'object',
};

export const inboxEventOpenApiSchema = {
  additionalProperties: false,
  properties: {
    actorUserId: { nullable: true, type: 'string' },
    createdAt: dateTimeProperty,
    id: uuidProperty,
    kind: { enum: [...INBOX_EVENT_KINDS], type: 'string' },
    reason: { enum: [...INBOX_EVENT_REASONS], nullable: true, type: 'string' },
  },
  required: ['actorUserId', 'createdAt', 'id', 'kind', 'reason'],
  type: 'object',
};

export const inboxUploadResponseOpenApiSchema = {
  additionalProperties: false,
  properties: {
    duplicateOfItemId: nullable(uuidProperty),
    files: { items: inboxItemFileOpenApiSchema, type: 'array' },
    item: inboxItemOpenApiSchema,
  },
  required: ['duplicateOfItemId', 'files', 'item'],
  type: 'object',
};

export const inboxItemDetailOpenApiSchema = {
  additionalProperties: false,
  properties: {
    events: { items: inboxEventOpenApiSchema, type: 'array' },
    extraction: { ...inboxExtractionOpenApiSchema, nullable: true },
    files: { items: inboxItemFileOpenApiSchema, type: 'array' },
    item: inboxItemOpenApiSchema,
  },
  required: ['events', 'extraction', 'files', 'item'],
  type: 'object',
};

export const inboxItemListEntryOpenApiSchema = {
  additionalProperties: false,
  properties: {
    ...inboxItemOpenApiSchema.properties,
    fileCount: { minimum: 0, type: 'integer' },
    primaryFilename: {
      maxLength: 255,
      minLength: 1,
      nullable: true,
      type: 'string',
    },
  },
  required: [
    ...inboxItemOpenApiSchema.required,
    'fileCount',
    'primaryFilename',
  ],
  type: 'object',
};

export const inboxItemListOpenApiSchema = {
  additionalProperties: false,
  properties: {
    items: { items: inboxItemListEntryOpenApiSchema, type: 'array' },
    page: { minimum: 1, type: 'integer' },
    pageSize: { maximum: MAX_INBOX_PAGE_SIZE, minimum: 1, type: 'integer' },
    total: { minimum: 0, type: 'integer' },
  },
  required: ['items', 'page', 'pageSize', 'total'],
  type: 'object',
};

export const updateInboxHintsBodyOpenApiSchema = {
  additionalProperties: false,
  minProperties: 1,
  properties: hintProperties,
  type: 'object',
};

export const routeInboxItemToDocumentBodyOpenApiSchema = {
  additionalProperties: false,
  properties: {
    document: createDocumentBodyOpenApiSchema,
    fileBlobIds: {
      items: uuidProperty,
      maxItems: MAX_INBOX_FILES,
      minItems: 1,
      type: 'array',
    },
  },
  required: ['document', 'fileBlobIds'],
  type: 'object',
};

export const discardInboxItemBodyOpenApiSchema = {
  additionalProperties: false,
  properties: {
    reason: { enum: [...INBOX_DISCARD_REASONS], type: 'string' },
  },
  required: ['reason'],
  type: 'object',
};

export const assignInboxItemBodyOpenApiSchema = {
  additionalProperties: false,
  properties: { assigneeId: { nullable: true, type: 'string' } },
  required: ['assigneeId'],
  type: 'object',
};

export const snoozeInboxItemBodyOpenApiSchema = {
  additionalProperties: false,
  properties: { snoozedUntil: nullable(dateTimeProperty) },
  required: ['snoozedUntil'],
  type: 'object',
};
