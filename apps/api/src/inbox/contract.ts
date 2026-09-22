import {
  blobScanStatuses,
  inboxAutomationReasons,
  inboxChannelKinds,
  inboxChannelKindsForChannels,
  inboxCorrectionFields,
  inboxCorrectionSources,
  inboxDecidedByKinds,
  inboxDiscardReasons,
  inboxEventKinds,
  inboxEventReasons,
  inboxItemStatuses,
  inboxPayloadKinds,
  inboxRoutingAutoPolicies,
  inboxRoutingDestinations,
  inboxRoutingPartnerPolicies,
  inboxUnprocessableReasons,
} from '@bap/db';
import { legalEntityIdentifierSchema } from '@bap/security';
import { z } from 'zod';

import {
  createDocumentBodyOpenApiSchema,
  createDocumentRequestSchema,
  DOCUMENT_KINDS,
  documentIdentifierSchema,
  documentKindSchema,
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
export const BLOB_SCAN_STATUSES = blobScanStatuses;
export const INBOX_DISCARD_REASONS = inboxDiscardReasons;
export const INBOX_UNPROCESSABLE_REASONS = inboxUnprocessableReasons;
export const INBOX_ROUTING_DESTINATIONS = inboxRoutingDestinations;
export const INBOX_ROUTING_PARTNER_POLICIES = inboxRoutingPartnerPolicies;
export const INBOX_ROUTING_AUTO_POLICIES = inboxRoutingAutoPolicies;
export const INBOX_AUTOMATION_REASONS = inboxAutomationReasons;
export const INBOX_CORRECTION_FIELDS = inboxCorrectionFields;
export const INBOX_CORRECTION_SOURCES = inboxCorrectionSources;
// Where the effective target came from: the platform constant or the organization's own row.
export const INBOX_ROUTING_TARGET_SOURCES = [
  'platform',
  'organization',
] as const;
export const MAX_REQUIRED_FIELDS = 32;

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
  'duplicate_probable',
  'entity_unresolved',
  'missing_required_field',
  'reference_conflict',
  ...inboxUnprocessableReasons,
] as const;

// The list's confidence bands: closed names, so the OpenAPI enum never carries a number pair.
export const INBOX_CONFIDENCE_BANDS = [
  'low',
  'medium',
  'high',
  'unknown',
] as const;
export const INBOX_CONFIDENCE_MEDIUM_FROM = 0.5;
export const INBOX_CONFIDENCE_HIGH_FROM = 0.9;
// The literal that filters the list to unassigned items.
export const INBOX_ASSIGNEE_NONE = 'none';
export const INBOX_BULK_ACTIONS = [
  'assign',
  'snooze',
  'discard',
  'approve',
] as const;
export const MAX_INBOX_BULK_ITEMS = 100;
// Why one id of a bulk request was refused; the single-item routes answer the same cases by status.
export const INBOX_BULK_REFUSAL_CODES = [
  'not_found',
  'not_open',
  'invalid',
  'reference_conflict',
  'duplicate_probable',
  'missing_required_field',
] as const;

export const PROVIDER_STEPS = ['sniff', 'hint', 'rule', 'manual'] as const;

// The events a person writes on an item; the automation counts them as a human touch and yields to them.
export const HUMAN_TOUCH_EVENT_KINDS = [
  'hint_added',
  'assigned',
  'restored',
  'reopened',
  'unrouted',
] as const satisfies readonly (typeof INBOX_EVENT_KINDS)[number][];

// Intake latency is bounded by the rule count, so an organization keeps at most this many enabled rules.
export const MAX_ENABLED_INBOX_RULES = 200;
export const MAX_INBOX_RULE_NAME_LENGTH = 120;
export const MAX_INBOX_RULE_KEYWORD_LENGTH = 120;
export const MAX_INBOX_CORRECTION_REASON_LENGTH = 500;

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

// The stored media type of a raw email blob; the route requires it and the store never sniffs it.
export const EMAIL_MEDIA_TYPE = 'message/rfc822';

export const TOKEN_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const MEDIA_TYPE_PATTERN =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const inboxItemIdentifierSchema = z.string().trim().toLowerCase().uuid();
export const inboxRuleIdentifierSchema = z.string().trim().toLowerCase().uuid();
export const blobIdentifierSchema = z.string().trim().toLowerCase().uuid();
export const inboxChannelIdentifierSchema = z
  .string()
  .trim()
  .toLowerCase()
  .uuid();
export const credentialIdentifierSchema = z
  .string()
  .trim()
  .toLowerCase()
  .uuid();
// The caller's own idempotency key: one item per (organization, channel, external id).
export const externalIdSchema = z.string().trim().min(1).max(255);
// The Mailgun token of the email route: an opaque provider id, never a Message-Id.
export const emailExternalIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._-]+$/);
// The envelope sender as the provider reported it; validated at the boundary, stored only from the parsed MIME.
export const emailSenderHeaderSchema = z
  .string()
  .min(1)
  .max(320)
  .regex(/^[\x20-\x7e]+$/);
// An issued intake address: the hex token local part and the platform intake domain.
export const intakeEmailAddressSchema = z
  .string()
  .regex(
    /^in-[0-9a-f]{32}@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/,
  );
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
    channelId: inboxChannelIdentifierSchema.nullable(),
    channelKind: z.enum(INBOX_CHANNEL_KINDS),
    confidence: confidenceSchema.nullable(),
    createdAt: z.iso.datetime(),
    datasetId: z.string().uuid().nullable(),
    decidedByKind: z.enum(INBOX_DECIDED_BY_KINDS).nullable(),
    decidedByRuleId: inboxRuleIdentifierSchema.nullable(),
    decidedByUserId: subjectIdentifierSchema.nullable(),
    detectedType: tokenSchema.nullable(),
    documentId: documentIdentifierSchema.nullable(),
    duplicateOfItemId: inboxItemIdentifierSchema.nullable(),
    // A person wrote one of HUMAN_TOUCH_EVENT_KINDS on the item; the automation yields to such an item.
    humanTouched: z.boolean(),
    id: inboxItemIdentifierSchema,
    legalEntityId: legalEntityIdentifierSchema.nullable(),
    // The credential display prefix that pushed the item; never what was pushed.
    origin: z.string().min(1).max(255).nullable(),
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
    // The verdict the blob routes enforce: infected or failed bytes are quarantined and never served.
    scanStatus: z.enum(BLOB_SCAN_STATUSES),
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

// The scheduled tick that sweeps orphaned files, reaps stalled items and requeues lost splits; empty payload.
export const INBOX_MAINTENANCE_QUEUE = 'inbox_maintenance';

// A draft field name a person must fill before routing: the destination contract names it, so any identifier.
export const requiredFieldSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/);

// The routing target fields shared by the platform constant, a stored row and the PUT body.
export const inboxRoutingTargetFieldsSchema = z
  .object({
    auto: z.enum(INBOX_ROUTING_AUTO_POLICIES),
    autoThreshold: confidenceSchema.nullable(),
    defaultAssigneeId: subjectIdentifierSchema.nullable(),
    defaultLegalEntityId: legalEntityIdentifierSchema.nullable(),
    // Null only on a platform default that names no destination yet; a saved row always names one.
    destination: z.enum(INBOX_ROUTING_DESTINATIONS).nullable(),
    documentKind: documentKindSchema.nullable(),
    partnerPolicy: z.enum(INBOX_ROUTING_PARTNER_POLICIES),
    requiredFields: z.array(requiredFieldSchema).max(MAX_REQUIRED_FIELDS),
  })
  .strict();

export type InboxRoutingTargetFields = z.infer<
  typeof inboxRoutingTargetFieldsSchema
>;

// The effective target of one detected type, with where it came from.
export const inboxRoutingTargetSchema = inboxRoutingTargetFieldsSchema
  .extend({
    detectedType: detectedTypeSchema,
    source: z.enum(INBOX_ROUTING_TARGET_SOURCES),
  })
  .strict();

export type InboxRoutingTarget = z.infer<typeof inboxRoutingTargetSchema>;

export const inboxRoutingTargetListResponseSchema = z
  .object({ targets: z.array(inboxRoutingTargetSchema) })
  .strict();

export type InboxRoutingTargetListResponse = z.infer<
  typeof inboxRoutingTargetListResponseSchema
>;

// The full target, never a partial patch: the form is prefilled from the effective target.
export const putInboxRoutingTargetRequestSchema = inboxRoutingTargetFieldsSchema
  .extend({ destination: z.enum(INBOX_ROUTING_DESTINATIONS) })
  .strict()
  .refine(
    (body) =>
      (body.destination === 'documents') === (body.documentKind !== null),
    {
      message: 'documentKind is set exactly when the destination is documents.',
      path: ['documentKind'],
    },
  )
  .refine(
    (body) => body.auto !== 'above_threshold' || body.autoThreshold !== null,
    {
      message: 'autoThreshold is required when auto is above_threshold.',
      path: ['autoThreshold'],
    },
  );

export type PutInboxRoutingTargetRequest = z.infer<
  typeof putInboxRoutingTargetRequestSchema
>;

export const blobQuotaBytesSchema = z.number().int().positive();

// The organization's own quota, the platform cap it can only tighten, and the bytes already stored.
export const inboxSettingsSchema = z
  .object({
    blobQuotaBytes: blobQuotaBytesSchema.nullable(),
    platformQuotaBytes: blobQuotaBytesSchema,
    usedBytes: z.number().int().min(0),
  })
  .strict();

export type InboxSettings = z.infer<typeof inboxSettingsSchema>;

// Null resets the organization to the platform value.
export const updateInboxSettingsRequestSchema = z
  .object({ blobQuotaBytes: blobQuotaBytesSchema.nullable() })
  .strict();

export type UpdateInboxSettingsRequest = z.infer<
  typeof updateInboxSettingsRequestSchema
>;

export const inboxUploadResponseSchema = z
  .object({
    // Set when the same bytes already existed in the organization; the new item is then discarded.
    duplicateOfItemId: inboxItemIdentifierSchema.nullable(),
    files: z.array(inboxItemFileSchema),
    item: inboxItemSchema,
  })
  .strict();

export type InboxUploadResponse = z.infer<typeof inboxUploadResponseSchema>;

// One draft field a person changed away from what the platform suggested when routing the item.
export const inboxCorrectionSchema = z
  .object({
    createdAt: z.iso.datetime(),
    createdBy: subjectIdentifierSchema,
    field: z.enum(INBOX_CORRECTION_FIELDS),
    finalValue: z.string().nullable(),
    id: z.string().uuid(),
    reason: z
      .string()
      .min(1)
      .max(MAX_INBOX_CORRECTION_REASON_LENGTH)
      .nullable(),
    source: z.enum(INBOX_CORRECTION_SOURCES),
    suggestedValue: z.string().nullable(),
  })
  .strict();

export type InboxCorrection = z.infer<typeof inboxCorrectionSchema>;

export const inboxItemDetailSchema = z
  .object({
    corrections: z.array(inboxCorrectionSchema),
    events: z.array(inboxEventSchema),
    extraction: inboxExtractionSchema.nullable(),
    files: z.array(inboxItemFileSchema),
    // The item plus its sender and the sender's DKIM verdict: shown only on the detail, never in the list.
    item: inboxItemSchema
      .extend({
        sender: z.string().nullable(),
        senderAuthenticated: z.boolean(),
      })
      .strict(),
    // The effective target of the item's detected type, so the setting is visible on the item the day it lands.
    routingTarget: inboxRoutingTargetSchema,
  })
  .strict();

export type InboxItemDetail = z.infer<typeof inboxItemDetailSchema>;

export const inboxItemListQuerySchema = z
  .object({
    assigneeId: z
      .union([z.literal(INBOX_ASSIGNEE_NONE), subjectIdentifierSchema])
      .optional(),
    confidence: z.enum(INBOX_CONFIDENCE_BANDS).optional(),
    detectedType: tokenSchema.optional(),
    // Matches the issues of the newest extraction only.
    issue: inboxIssueCodeSchema.optional(),
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

// One line per corrected draft field; a field the person did not change is ignored.
export const correctionReasonsSchema = z
  .object(
    Object.fromEntries(
      INBOX_CORRECTION_FIELDS.map((field) => [
        field,
        z.string().trim().min(1).max(MAX_INBOX_CORRECTION_REASON_LENGTH),
      ]),
    ) as Record<(typeof INBOX_CORRECTION_FIELDS)[number], z.ZodString>,
  )
  .partial()
  .strict();

export type CorrectionReasons = z.infer<typeof correctionReasonsSchema>;

export const routeInboxItemToDocumentRequestSchema = z
  .object({
    // The candidate the person saw in the duplicate_probable refusal and chose to route past.
    acknowledgeDuplicateOf: documentIdentifierSchema.optional(),
    correctionReasons: correctionReasonsSchema.optional(),
    document: createDocumentRequestSchema,
    // The item's blobs in the order the document should keep them; every item file must be named once.
    fileBlobIds: z.array(blobIdentifierSchema).min(1).max(MAX_INBOX_FILES),
    // The current document of the reference_conflict refusal; the new document becomes its next version.
    supersedesDocumentId: documentIdentifierSchema.optional(),
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

// A probable duplicate the fingerprint found: what the person needs to tell a re-issue from a repeat.
export const duplicateCandidateSchema = z
  .object({
    documentDate: z.iso.date(),
    id: documentIdentifierSchema,
    reference: z.string().nullable(),
    totalAmount: z.string().nullable(),
  })
  .strict();

export type DuplicateCandidate = z.infer<typeof duplicateCandidateSchema>;

export const attachInboxItemRequestSchema = z
  .object({ documentId: documentIdentifierSchema })
  .strict();

export type AttachInboxItemRequest = z.infer<
  typeof attachInboxItemRequestSchema
>;

// One action over up to a page of ids; the field of the action is required and every other one refused.
export const bulkInboxItemsRequestSchema = z
  .object({
    action: z.enum(INBOX_BULK_ACTIONS),
    assigneeId: subjectIdentifierSchema.nullable().optional(),
    itemIds: z
      .array(inboxItemIdentifierSchema)
      .min(1)
      .max(MAX_INBOX_BULK_ITEMS)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: 'itemIds must not repeat an item.',
      }),
    reason: inboxDiscardReasonSchema.optional(),
    snoozedUntil: z.iso.datetime().nullable().optional(),
  })
  .strict()
  .superRefine((body, context) => {
    const expected = {
      approve: null,
      assign: 'assigneeId',
      discard: 'reason',
      snooze: 'snoozedUntil',
    }[body.action];

    for (const field of ['assigneeId', 'reason', 'snoozedUntil'] as const) {
      if ((body[field] !== undefined) !== (field === expected)) {
        context.addIssue({
          code: 'custom',
          message:
            field === expected
              ? `${field} is required for ${body.action}.`
              : `${field} is not accepted for ${body.action}.`,
          path: [field],
        });
      }
    }
  });

export type BulkInboxItemsRequest = z.infer<typeof bulkInboxItemsRequestSchema>;

export const bulkInboxItemsResponseSchema = z
  .object({
    results: z.array(
      z
        .object({
          code: z.enum(INBOX_BULK_REFUSAL_CODES).optional(),
          itemId: inboxItemIdentifierSchema,
          status: z.enum(['ok', 'refused']),
        })
        .strict(),
    ),
  })
  .strict();

export type BulkInboxItemsResponse = z.infer<
  typeof bulkInboxItemsResponseSchema
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

// A structured push: the body itself becomes the item's single file, so the envelope stays the one of a file.
// The JSON body parser caps the whole request at 1 MiB, so the payload needs no second size check here.
export const structuredIntakeRequestSchema = z
  .object({
    externalId: externalIdSchema,
    payload: z.record(z.string(), jsonValueSchema),
  })
  .strict();

export type StructuredIntakeRequest = z.infer<
  typeof structuredIntakeRequestSchema
>;

// Multipart text fields beside the file part; the external id is optional for a file.
export const fileIntakeFieldsSchema = z
  .object({ externalId: externalIdSchema.optional() })
  .strict();

// Accepted, never the content: a channel learns the item id and whether the bytes were already known.
export const inboxIntakeResponseSchema = z
  .object({
    duplicateOfItemId: inboxItemIdentifierSchema.nullable(),
    itemId: inboxItemIdentifierSchema,
    status: inboxItemStatusSchema,
  })
  .strict();

export type InboxIntakeResponse = z.infer<typeof inboxIntakeResponseSchema>;

export const inboxChannelCredentialSchema = z
  .object({
    createdAt: z.iso.datetime(),
    credentialId: credentialIdentifierSchema,
    displayPrefix: z.string().length(8),
    lastUsedAt: z.iso.datetime().nullable(),
  })
  .strict();

export type InboxChannelCredential = z.infer<
  typeof inboxChannelCredentialSchema
>;

export const inboxChannelNameSchema = z.string().trim().min(1).max(200);

export const inboxChannelSchema = z
  .object({
    createdAt: z.iso.datetime(),
    credentials: z.array(inboxChannelCredentialSchema),
    // The active intake address of an email channel, stored plain by ADR 0016; null for every other channel.
    emailAddress: intakeEmailAddressSchema.nullable(),
    enabled: z.boolean(),
    hintKind: tokenSchema.nullable(),
    id: inboxChannelIdentifierSchema,
    itemCount: z.number().int().min(0),
    kind: z.enum(inboxChannelKindsForChannels),
    legalEntityId: legalEntityIdentifierSchema.nullable(),
    name: inboxChannelNameSchema,
    updatedAt: z.iso.datetime(),
  })
  .strict();

export type InboxChannel = z.infer<typeof inboxChannelSchema>;

export const inboxChannelListResponseSchema = z
  .object({ channels: z.array(inboxChannelSchema) })
  .strict();

export type InboxChannelListResponse = z.infer<
  typeof inboxChannelListResponseSchema
>;

// The kinds with a principal of their own; an email channel gets its address through the credential route.
export const createInboxChannelRequestSchema = z
  .object({
    hintKind: tokenSchema.optional(),
    kind: z.enum(inboxChannelKindsForChannels),
    legalEntityId: legalEntityIdentifierSchema.optional(),
    name: inboxChannelNameSchema,
  })
  .strict();

export type CreateInboxChannelRequest = z.infer<
  typeof createInboxChannelRequestSchema
>;

// Absence leaves a column alone; null clears it. A soft delete is `enabled: false, deleted: true`.
export const updateInboxChannelRequestSchema = z
  .object({
    deleted: z.literal(true).optional(),
    enabled: z.boolean().optional(),
    hintKind: tokenSchema.nullable().optional(),
    legalEntityId: legalEntityIdentifierSchema.nullable().optional(),
    name: inboxChannelNameSchema.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be given.',
  })
  .refine((body) => body.deleted !== true || body.enabled === false, {
    message: 'A deleted channel must be disabled in the same request.',
    path: ['deleted'],
  });

export type UpdateInboxChannelRequest = z.infer<
  typeof updateInboxChannelRequestSchema
>;

export const intakeTokenSchema = z
  .string()
  .regex(/^bap_intake_[A-Za-z0-9_-]{43}$/);

// The plain secret crosses this boundary exactly once: an API token, or the intake address of an email channel.
export const issueInboxChannelCredentialResponseSchema = z
  .object({
    credentialId: credentialIdentifierSchema,
    displayPrefix: z.string().length(8),
    secret: z.union([intakeTokenSchema, intakeEmailAddressSchema]),
  })
  .strict();

export type IssueInboxChannelCredentialResponse = z.infer<
  typeof issueInboxChannelCredentialResponseSchema
>;

// The worker job that scans and splits an email item; identifiers only, because pgboss.job is cross-tenant readable.
export const SPLIT_EMAIL_ITEM_QUEUE = 'split_email_item';

export const splitEmailItemJobSchema = z
  .object({
    channelId: inboxChannelIdentifierSchema,
    itemId: inboxItemIdentifierSchema,
    organizationId: z.string().trim().min(1),
  })
  .strict();

export type SplitEmailItemJob = z.infer<typeof splitEmailItemJobSchema>;

// The worker job that routes one item automatically: the item, and the rule that asked or null for a target default.
export const ROUTE_INBOX_ITEM_QUEUE = 'route_inbox_item';

export const routeInboxItemJobSchema = z
  .object({
    itemId: inboxItemIdentifierSchema,
    organizationId: z.string().trim().min(1),
    ruleId: inboxRuleIdentifierSchema.nullable(),
  })
  .strict();

export type RouteInboxItemJob = z.infer<typeof routeInboxItemJobSchema>;

// The worker job that applies a new rule to the untouched items in review, as its creator; the cursor resumes a walk.
export const RERUN_INBOX_RULE_QUEUE = 'rerun_inbox_rule';

export const rerunInboxRuleCursorSchema = z
  .object({
    itemId: inboxItemIdentifierSchema,
    receivedAt: z.iso.datetime(),
  })
  .strict();

export const rerunInboxRuleJobSchema = z
  .object({
    cursor: rerunInboxRuleCursorSchema.optional(),
    organizationId: z.string().trim().min(1),
    ruleId: inboxRuleIdentifierSchema,
    userId: subjectIdentifierSchema,
  })
  .strict();

export type RerunInboxRuleJob = z.infer<typeof rerunInboxRuleJobSchema>;

// The one provider row the rule pass writes; the typed draft names the rules that matched so a rerun can skip them.
export const RULE_PROVIDER = 'rule';
export const RULE_PROVIDER_VERSION = '2026-09-17.1';

export const ruleDraftSchema = z
  .object({
    kind: z.string().nullable().default(null),
    matchedRuleIds: z.array(inboxRuleIdentifierSchema),
    partnerId: z.string().nullable().default(null),
  })
  .passthrough();

export type RuleDraft = z.infer<typeof ruleDraftSchema>;

// A lowercase @domain suffix or a full address; the matcher compares the sender or its suffix from the @.
export const senderPatternSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(320)
  .regex(/^(@|[^@\s]+@)[^@\s]+$/);

export const inboxRuleNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_INBOX_RULE_NAME_LENGTH);
export const inboxRuleKeywordSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_INBOX_RULE_KEYWORD_LENGTH);

const ruleConditionFields = {
  channelId: inboxChannelIdentifierSchema.nullable(),
  detectedType: tokenSchema.nullable(),
  keyword: inboxRuleKeywordSchema.nullable(),
  senderPattern: senderPatternSchema.nullable(),
};

const ruleActionFields = {
  autoRoute: z.boolean(),
  discardReason: inboxDiscardReasonSchema.nullable(),
  setAssigneeId: subjectIdentifierSchema.nullable(),
  setDocumentKind: documentKindSchema.nullable(),
  setLegalEntityId: legalEntityIdentifierSchema.nullable(),
  setPartnerId: partnerIdentifierSchema.nullable(),
};

export const inboxRuleSchema = z
  .object({
    ...ruleConditionFields,
    ...ruleActionFields,
    createdAt: z.iso.datetime(),
    // The author the rule runs as; only adoption changes it.
    createdBy: subjectIdentifierSchema,
    enabled: z.boolean(),
    id: inboxRuleIdentifierSchema,
    name: inboxRuleNameSchema,
    // True when the author is no longer a verified owner or admin, so the matcher skips the rule until it is adopted.
    paused: z.boolean(),
    priority: z.number().int().min(1),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export type InboxRule = z.infer<typeof inboxRuleSchema>;

export const inboxRuleListResponseSchema = z
  .object({ rules: z.array(inboxRuleSchema) })
  .strict();

export type InboxRuleListResponse = z.infer<typeof inboxRuleListResponseSchema>;

type RuleShape = {
  autoRoute: boolean;
  channelId: string | null;
  detectedType: string | null;
  discardReason: string | null;
  keyword: string | null;
  senderPattern: string | null;
  setAssigneeId: string | null;
  setDocumentKind: string | null;
  setLegalEntityId: string | null;
  setPartnerId: string | null;
};

export function hasRuleCondition(rule: RuleShape): boolean {
  return (
    rule.channelId !== null ||
    rule.senderPattern !== null ||
    rule.keyword !== null ||
    rule.detectedType !== null
  );
}

export function hasRuleAction(rule: RuleShape): boolean {
  return (
    rule.setLegalEntityId !== null ||
    rule.setDocumentKind !== null ||
    rule.setPartnerId !== null ||
    rule.setAssigneeId !== null ||
    rule.discardReason !== null ||
    rule.autoRoute
  );
}

// A discarded item has no fields to set, so a discard rule carries no other action.
export function isDiscardExclusive(rule: RuleShape): boolean {
  return (
    rule.discardReason === null ||
    (rule.setLegalEntityId === null &&
      rule.setDocumentKind === null &&
      rule.setPartnerId === null &&
      rule.setAssigneeId === null &&
      !rule.autoRoute)
  );
}

// Every condition and action is optional and defaults to unset; the three shape checks mirror the table constraints.
export const createInboxRuleRequestSchema = z
  .object({
    ...ruleConditionFields,
    ...ruleActionFields,
    // True re-runs the new rule on the untouched items in review through the rerun job, as the creator.
    applyToExisting: z.boolean().default(false),
    enabled: z.boolean().default(true),
    name: inboxRuleNameSchema,
  })
  .partial({
    autoRoute: true,
    channelId: true,
    detectedType: true,
    discardReason: true,
    keyword: true,
    senderPattern: true,
    setAssigneeId: true,
    setDocumentKind: true,
    setLegalEntityId: true,
    setPartnerId: true,
  })
  .strict()
  .transform((body) => ({
    ...body,
    autoRoute: body.autoRoute ?? false,
    channelId: body.channelId ?? null,
    detectedType: body.detectedType ?? null,
    discardReason: body.discardReason ?? null,
    keyword: body.keyword ?? null,
    senderPattern: body.senderPattern ?? null,
    setAssigneeId: body.setAssigneeId ?? null,
    setDocumentKind: body.setDocumentKind ?? null,
    setLegalEntityId: body.setLegalEntityId ?? null,
    setPartnerId: body.setPartnerId ?? null,
  }))
  .refine(hasRuleCondition, { message: 'At least one condition must be set.' })
  .refine(hasRuleAction, { message: 'At least one action must be set.' })
  .refine(isDiscardExclusive, {
    message: 'A discard rule carries no other action.',
    path: ['discardReason'],
  });

export type CreateInboxRuleRequest = z.infer<
  typeof createInboxRuleRequestSchema
>;

// Absence leaves a column alone; null clears it. The shape checks run on the merged row in the database.
export const updateInboxRuleRequestSchema = z
  .object({
    ...ruleConditionFields,
    ...ruleActionFields,
    enabled: z.boolean(),
    name: inboxRuleNameSchema,
  })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be given.',
  });

export type UpdateInboxRuleRequest = z.infer<
  typeof updateInboxRuleRequestSchema
>;

// The full ordered id list of the live rules; the first id becomes priority 1. Disabled rules hold slots too.
export const orderInboxRulesRequestSchema = z
  .object({
    ruleIds: z.array(inboxRuleIdentifierSchema).min(1).max(1000),
  })
  .strict()
  .refine((body) => new Set(body.ruleIds).size === body.ruleIds.length, {
    message: 'ruleIds must not repeat a rule.',
    path: ['ruleIds'],
  });

export type OrderInboxRulesRequest = z.infer<
  typeof orderInboxRulesRequestSchema
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
    channelId: nullable(uuidProperty),
    channelKind: { enum: [...INBOX_CHANNEL_KINDS], type: 'string' },
    confidence: nullable(confidenceProperty),
    createdAt: dateTimeProperty,
    datasetId: nullable(uuidProperty),
    decidedByKind: {
      enum: [...INBOX_DECIDED_BY_KINDS],
      nullable: true,
      type: 'string',
    },
    decidedByRuleId: nullable(uuidProperty),
    decidedByUserId: { nullable: true, type: 'string' },
    detectedType: nullable(tokenProperty),
    documentId: nullable(uuidProperty),
    duplicateOfItemId: nullable(uuidProperty),
    humanTouched: { type: 'boolean' },
    id: uuidProperty,
    legalEntityId: nullable(uuidProperty),
    origin: { maxLength: 255, minLength: 1, nullable: true, type: 'string' },
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
    'channelId',
    'channelKind',
    'confidence',
    'createdAt',
    'datasetId',
    'decidedByKind',
    'decidedByRuleId',
    'decidedByUserId',
    'detectedType',
    'documentId',
    'duplicateOfItemId',
    'hintKind',
    'hintLegalEntityId',
    'hintLinkDocumentId',
    'hintPartnerId',
    'hintText',
    'humanTouched',
    'id',
    'legalEntityId',
    'origin',
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
    scanStatus: { enum: [...BLOB_SCAN_STATUSES], type: 'string' },
    sha256: { pattern: SHA256_PATTERN.source, type: 'string' },
  },
  required: [
    'blobId',
    'byteSize',
    'mediaType',
    'originalFilename',
    'position',
    'scanStatus',
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

const routingTargetFieldProperties = {
  auto: { enum: [...INBOX_ROUTING_AUTO_POLICIES], type: 'string' },
  autoThreshold: nullable(confidenceProperty),
  defaultAssigneeId: { nullable: true, type: 'string' },
  defaultLegalEntityId: nullable(uuidProperty),
  documentKind: { enum: [...DOCUMENT_KINDS], nullable: true, type: 'string' },
  partnerPolicy: { enum: [...INBOX_ROUTING_PARTNER_POLICIES], type: 'string' },
  requiredFields: {
    items: { pattern: '^[A-Za-z][A-Za-z0-9_]{0,63}$', type: 'string' },
    maxItems: MAX_REQUIRED_FIELDS,
    type: 'array',
  },
};

const routingTargetFieldsRequired = [
  'auto',
  'autoThreshold',
  'defaultAssigneeId',
  'defaultLegalEntityId',
  'destination',
  'documentKind',
  'partnerPolicy',
  'requiredFields',
];

export const inboxRoutingTargetOpenApiSchema = {
  additionalProperties: false,
  properties: {
    ...routingTargetFieldProperties,
    destination: {
      enum: [...INBOX_ROUTING_DESTINATIONS],
      nullable: true,
      type: 'string',
    },
    detectedType: { enum: [...DETECTED_TYPES], type: 'string' },
    source: { enum: [...INBOX_ROUTING_TARGET_SOURCES], type: 'string' },
  },
  required: [...routingTargetFieldsRequired, 'detectedType', 'source'],
  type: 'object',
};

export const inboxRoutingTargetListOpenApiSchema = {
  additionalProperties: false,
  properties: {
    targets: { items: inboxRoutingTargetOpenApiSchema, type: 'array' },
  },
  required: ['targets'],
  type: 'object',
};

export const putInboxRoutingTargetBodyOpenApiSchema = {
  additionalProperties: false,
  properties: {
    ...routingTargetFieldProperties,
    destination: { enum: [...INBOX_ROUTING_DESTINATIONS], type: 'string' },
  },
  required: routingTargetFieldsRequired,
  type: 'object',
};

const quotaBytesProperty = { minimum: 1, type: 'integer' };

export const inboxSettingsOpenApiSchema = {
  additionalProperties: false,
  properties: {
    blobQuotaBytes: nullable(quotaBytesProperty),
    platformQuotaBytes: quotaBytesProperty,
    usedBytes: { minimum: 0, type: 'integer' },
  },
  required: ['blobQuotaBytes', 'platformQuotaBytes', 'usedBytes'],
  type: 'object',
};

export const updateInboxSettingsBodyOpenApiSchema = {
  additionalProperties: false,
  properties: { blobQuotaBytes: nullable(quotaBytesProperty) },
  required: ['blobQuotaBytes'],
  type: 'object',
};

export const inboxCorrectionOpenApiSchema = {
  additionalProperties: false,
  properties: {
    createdAt: dateTimeProperty,
    createdBy: { type: 'string' },
    field: { enum: [...INBOX_CORRECTION_FIELDS], type: 'string' },
    finalValue: { nullable: true, type: 'string' },
    id: uuidProperty,
    reason: {
      maxLength: MAX_INBOX_CORRECTION_REASON_LENGTH,
      minLength: 1,
      nullable: true,
      type: 'string',
    },
    source: { enum: [...INBOX_CORRECTION_SOURCES], type: 'string' },
    suggestedValue: { nullable: true, type: 'string' },
  },
  required: [
    'createdAt',
    'createdBy',
    'field',
    'finalValue',
    'id',
    'reason',
    'source',
    'suggestedValue',
  ],
  type: 'object',
};

// The item plus its sender and the sender's DKIM verdict: shown only on the detail, never in the list.
const inboxItemDetailItemOpenApiSchema = {
  additionalProperties: false,
  properties: {
    ...inboxItemOpenApiSchema.properties,
    sender: { nullable: true, type: 'string' },
    senderAuthenticated: { type: 'boolean' },
  },
  required: [
    ...inboxItemOpenApiSchema.required,
    'sender',
    'senderAuthenticated',
  ],
  type: 'object',
};

export const inboxItemDetailOpenApiSchema = {
  additionalProperties: false,
  properties: {
    corrections: { items: inboxCorrectionOpenApiSchema, type: 'array' },
    events: { items: inboxEventOpenApiSchema, type: 'array' },
    extraction: { ...inboxExtractionOpenApiSchema, nullable: true },
    files: { items: inboxItemFileOpenApiSchema, type: 'array' },
    item: inboxItemDetailItemOpenApiSchema,
    routingTarget: inboxRoutingTargetOpenApiSchema,
  },
  required: [
    'corrections',
    'events',
    'extraction',
    'files',
    'item',
    'routingTarget',
  ],
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
    acknowledgeDuplicateOf: uuidProperty,
    correctionReasons: {
      additionalProperties: false,
      properties: Object.fromEntries(
        INBOX_CORRECTION_FIELDS.map((field) => [
          field,
          {
            maxLength: MAX_INBOX_CORRECTION_REASON_LENGTH,
            minLength: 1,
            type: 'string',
          },
        ]),
      ),
      type: 'object',
    },
    document: createDocumentBodyOpenApiSchema,
    fileBlobIds: {
      items: uuidProperty,
      maxItems: MAX_INBOX_FILES,
      minItems: 1,
      type: 'array',
    },
    supersedesDocumentId: uuidProperty,
  },
  required: ['document', 'fileBlobIds'],
  type: 'object',
};

// The two refusals the route can answer with 409 beside the generic conflict; the browser reads the code.
export const routeInboxItemConflictOpenApiSchema = {
  oneOf: [
    {
      additionalProperties: true,
      properties: {
        code: { enum: ['reference_conflict'], type: 'string' },
        documentId: uuidProperty,
      },
      required: ['code', 'documentId'],
      type: 'object',
    },
    {
      additionalProperties: true,
      properties: {
        candidates: {
          items: {
            additionalProperties: false,
            properties: {
              documentDate: { format: 'date', type: 'string' },
              id: uuidProperty,
              reference: { nullable: true, type: 'string' },
              totalAmount: { nullable: true, type: 'string' },
            },
            required: ['documentDate', 'id', 'reference', 'totalAmount'],
            type: 'object',
          },
          type: 'array',
        },
        code: { enum: ['duplicate_probable'], type: 'string' },
      },
      required: ['candidates', 'code'],
      type: 'object',
    },
  ],
};

export const attachInboxItemBodyOpenApiSchema = {
  additionalProperties: false,
  properties: { documentId: uuidProperty },
  required: ['documentId'],
  type: 'object',
};

export const bulkInboxItemsBodyOpenApiSchema = {
  additionalProperties: false,
  properties: {
    action: { enum: [...INBOX_BULK_ACTIONS], type: 'string' },
    assigneeId: { nullable: true, type: 'string' },
    itemIds: {
      items: uuidProperty,
      maxItems: MAX_INBOX_BULK_ITEMS,
      minItems: 1,
      type: 'array',
      uniqueItems: true,
    },
    reason: { enum: [...INBOX_DISCARD_REASONS], type: 'string' },
    snoozedUntil: nullable(dateTimeProperty),
  },
  required: ['action', 'itemIds'],
  type: 'object',
};

export const bulkInboxItemsResponseOpenApiSchema = {
  additionalProperties: false,
  properties: {
    results: {
      items: {
        additionalProperties: false,
        properties: {
          code: { enum: [...INBOX_BULK_REFUSAL_CODES], type: 'string' },
          itemId: uuidProperty,
          status: { enum: ['ok', 'refused'], type: 'string' },
        },
        required: ['itemId', 'status'],
        type: 'object',
      },
      type: 'array',
    },
  },
  required: ['results'],
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

export const structuredIntakeBodyOpenApiSchema = {
  additionalProperties: false,
  properties: {
    externalId: { maxLength: 255, minLength: 1, type: 'string' },
    payload: { additionalProperties: true, type: 'object' },
  },
  required: ['externalId', 'payload'],
  type: 'object',
};

export const fileIntakeBodyOpenApiSchema = {
  properties: {
    externalId: { maxLength: 255, minLength: 1, type: 'string' },
    file: { format: 'binary', type: 'string' },
  },
  required: ['file'],
  type: 'object',
};

export const emailIntakeBodyOpenApiSchema = {
  description: 'The raw MIME message as received from the provider',
  format: 'binary',
  type: 'string',
};

export const inboxIntakeResponseOpenApiSchema = {
  additionalProperties: false,
  properties: {
    duplicateOfItemId: nullable(uuidProperty),
    itemId: uuidProperty,
    status: { enum: [...INBOX_ITEM_STATUSES], type: 'string' },
  },
  required: ['duplicateOfItemId', 'itemId', 'status'],
  type: 'object',
};

const inboxChannelCredentialOpenApiSchema = {
  additionalProperties: false,
  properties: {
    createdAt: dateTimeProperty,
    credentialId: uuidProperty,
    displayPrefix: { maxLength: 8, minLength: 8, type: 'string' },
    lastUsedAt: nullable(dateTimeProperty),
  },
  required: ['createdAt', 'credentialId', 'displayPrefix', 'lastUsedAt'],
  type: 'object',
};

const channelNameProperty = { maxLength: 200, minLength: 1, type: 'string' };

export const inboxChannelOpenApiSchema = {
  additionalProperties: false,
  properties: {
    createdAt: dateTimeProperty,
    credentials: { items: inboxChannelCredentialOpenApiSchema, type: 'array' },
    emailAddress: nullable({ maxLength: 320, minLength: 1, type: 'string' }),
    enabled: { type: 'boolean' },
    hintKind: nullable(tokenProperty),
    id: uuidProperty,
    itemCount: { minimum: 0, type: 'integer' },
    kind: { enum: [...inboxChannelKindsForChannels], type: 'string' },
    legalEntityId: nullable(uuidProperty),
    name: channelNameProperty,
    updatedAt: dateTimeProperty,
  },
  required: [
    'createdAt',
    'credentials',
    'emailAddress',
    'enabled',
    'hintKind',
    'id',
    'itemCount',
    'kind',
    'legalEntityId',
    'name',
    'updatedAt',
  ],
  type: 'object',
};

export const inboxChannelListOpenApiSchema = {
  additionalProperties: false,
  properties: {
    channels: { items: inboxChannelOpenApiSchema, type: 'array' },
  },
  required: ['channels'],
  type: 'object',
};

export const createInboxChannelBodyOpenApiSchema = {
  additionalProperties: false,
  properties: {
    hintKind: tokenProperty,
    kind: { enum: [...inboxChannelKindsForChannels], type: 'string' },
    legalEntityId: uuidProperty,
    name: channelNameProperty,
  },
  required: ['kind', 'name'],
  type: 'object',
};

export const updateInboxChannelBodyOpenApiSchema = {
  additionalProperties: false,
  minProperties: 1,
  properties: {
    deleted: { enum: [true], type: 'boolean' },
    enabled: { type: 'boolean' },
    hintKind: nullable(tokenProperty),
    legalEntityId: nullable(uuidProperty),
    name: channelNameProperty,
  },
  type: 'object',
};

export const issueInboxChannelCredentialResponseOpenApiSchema = {
  additionalProperties: false,
  properties: {
    credentialId: uuidProperty,
    displayPrefix: { maxLength: 8, minLength: 8, type: 'string' },
    secret: { maxLength: 320, minLength: 1, type: 'string' },
  },
  required: ['credentialId', 'displayPrefix', 'secret'],
  type: 'object',
};

const ruleConditionProperties = {
  channelId: nullable(uuidProperty),
  detectedType: nullable(tokenProperty),
  keyword: {
    maxLength: MAX_INBOX_RULE_KEYWORD_LENGTH,
    minLength: 1,
    nullable: true,
    type: 'string',
  },
  senderPattern: {
    maxLength: 320,
    minLength: 2,
    nullable: true,
    type: 'string',
  },
};

const ruleActionProperties = {
  autoRoute: { type: 'boolean' },
  discardReason: {
    enum: [...INBOX_DISCARD_REASONS],
    nullable: true,
    type: 'string',
  },
  setAssigneeId: { nullable: true, type: 'string' },
  setDocumentKind: {
    enum: [...DOCUMENT_KINDS],
    nullable: true,
    type: 'string',
  },
  setLegalEntityId: nullable(uuidProperty),
  setPartnerId: nullable(uuidProperty),
};

const ruleNameProperty = {
  maxLength: MAX_INBOX_RULE_NAME_LENGTH,
  minLength: 1,
  type: 'string',
};

export const inboxRuleOpenApiSchema = {
  additionalProperties: false,
  properties: {
    ...ruleConditionProperties,
    ...ruleActionProperties,
    createdAt: dateTimeProperty,
    createdBy: { type: 'string' },
    enabled: { type: 'boolean' },
    id: uuidProperty,
    name: ruleNameProperty,
    paused: { type: 'boolean' },
    priority: { minimum: 1, type: 'integer' },
    updatedAt: dateTimeProperty,
  },
  required: [
    'autoRoute',
    'channelId',
    'createdAt',
    'createdBy',
    'detectedType',
    'discardReason',
    'enabled',
    'id',
    'keyword',
    'name',
    'paused',
    'priority',
    'senderPattern',
    'setAssigneeId',
    'setDocumentKind',
    'setLegalEntityId',
    'setPartnerId',
    'updatedAt',
  ],
  type: 'object',
};

export const inboxRuleListOpenApiSchema = {
  additionalProperties: false,
  properties: { rules: { items: inboxRuleOpenApiSchema, type: 'array' } },
  required: ['rules'],
  type: 'object',
};

export const createInboxRuleBodyOpenApiSchema = {
  additionalProperties: false,
  properties: {
    ...ruleConditionProperties,
    ...ruleActionProperties,
    applyToExisting: { type: 'boolean' },
    enabled: { type: 'boolean' },
    name: ruleNameProperty,
  },
  required: ['name'],
  type: 'object',
};

export const updateInboxRuleBodyOpenApiSchema = {
  additionalProperties: false,
  minProperties: 1,
  properties: {
    ...ruleConditionProperties,
    ...ruleActionProperties,
    enabled: { type: 'boolean' },
    name: ruleNameProperty,
  },
  type: 'object',
};

export const orderInboxRulesBodyOpenApiSchema = {
  additionalProperties: false,
  properties: {
    ruleIds: {
      items: uuidProperty,
      maxItems: 1000,
      minItems: 1,
      type: 'array',
    },
  },
  required: ['ruleIds'],
  type: 'object',
};
