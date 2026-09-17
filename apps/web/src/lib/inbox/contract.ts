import { z } from 'zod';

import {
  createDocumentRequestSchema,
  documentKindSchema,
  identifierSchema,
} from '../documents/contract.ts';

// Mirrors apps/api inbox contract, which apps/web must not import.

export const MAX_INBOX_PAGE_SIZE = 100;
export const DEFAULT_INBOX_PAGE_SIZE = 25;
export const MAX_INBOX_WINDOW = 10_000;
export const MAX_INBOX_FILES = 20;
// The API refuses a larger file with 413, so the browser can say so before sending.
export const MAX_INBOX_FILE_BYTES = 25_000_000;

// Only these render inside the sandboxed frame; anything else is a download link.
export const INLINE_MEDIA_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

export function isInlineMediaType(mediaType: string): boolean {
  return (INLINE_MEDIA_TYPES as readonly string[]).includes(mediaType);
}

const TOKEN_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const MEDIA_TYPE_PATTERN =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

// Better Auth mints opaque text user ids, bounded like an organization selector.
const subjectIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const inboxItemStatusSchema = z.enum([
  'received',
  'processing',
  'needs_review',
  'routed',
  'discarded',
  'failed',
]);
export const inboxChannelKindSchema = z.enum([
  'upload',
  'email',
  'api',
  'mcp',
  'money_s3',
  'pohoda',
  'isdoc',
  'bank_file',
  'bank_api',
  'fakturoid',
  'idoklad',
  'isds',
  'drive',
]);
export const inboxPayloadKindSchema = z.enum([
  'file',
  'email',
  'structured',
  'text',
]);
export const inboxDecidedByKindSchema = z.enum([
  'hint',
  'rule',
  'target_default',
  'provider',
  'user',
]);
export const inboxEventKindSchema = z.enum([
  'received',
  'scanned',
  'classified',
  'extracted',
  'rule_matched',
  'routed',
  'unrouted',
  'reopened',
  'discarded',
  'restored',
  'assigned',
  'hint_added',
  'failed',
]);
export const inboxDiscardReasonSchema = z.enum([
  'irrelevant',
  'duplicate',
  'not_ours',
  'spam',
]);
export const inboxUnprocessableReasonSchema = z.enum([
  'unsupported_type',
  'password_protected',
  'encrypted',
  'empty',
  'unreadable',
  'decorative_image',
  'too_large',
  'policy_rejected',
]);
// The reaper writes this on an item it failed for being stuck in processing; no person chooses it.
export const inboxMaintenanceReasonSchema = z.enum(['stalled']);
// The automation writes this when a rule's author is no longer a verified owner or admin.
export const inboxAutomationReasonSchema = z.enum(['rule_author_unavailable']);
export const inboxEventReasonSchema = z.enum([
  ...inboxDiscardReasonSchema.options,
  ...inboxUnprocessableReasonSchema.options,
  ...inboxMaintenanceReasonSchema.options,
  ...inboxAutomationReasonSchema.options,
]);
export const inboxIssueCodeSchema = z.enum([
  'duplicate_exact',
  'entity_unresolved',
  'missing_required_field',
  'reference_conflict',
  ...inboxUnprocessableReasonSchema.options,
]);
export const providerStepSchema = z.enum(['sniff', 'hint', 'rule', 'manual']);

export const tokenSchema = z.string().regex(TOKEN_PATTERN);
const confidenceSchema = z.number().min(0).max(1);
const hintTextSchema = z.string().trim().min(1).max(2000);

export const inboxHintsSchema = z
  .object({
    hintKind: tokenSchema.nullable(),
    hintLegalEntityId: identifierSchema.nullable(),
    hintLinkDocumentId: identifierSchema.nullable(),
    hintPartnerId: identifierSchema.nullable(),
    hintText: hintTextSchema.nullable(),
  })
  .strict();

export const inboxItemSchema = inboxHintsSchema
  .extend({
    assigneeId: subjectIdentifierSchema.nullable(),
    channelId: identifierSchema.nullable(),
    channelKind: inboxChannelKindSchema,
    confidence: confidenceSchema.nullable(),
    createdAt: z.iso.datetime(),
    datasetId: identifierSchema.nullable(),
    decidedByKind: inboxDecidedByKindSchema.nullable(),
    decidedByRuleId: identifierSchema.nullable(),
    decidedByUserId: subjectIdentifierSchema.nullable(),
    detectedType: tokenSchema.nullable(),
    documentId: identifierSchema.nullable(),
    duplicateOfItemId: identifierSchema.nullable(),
    id: identifierSchema,
    legalEntityId: identifierSchema.nullable(),
    // The credential display prefix that pushed the item; never what was pushed.
    origin: z.string().min(1).max(255).nullable(),
    partnerId: identifierSchema.nullable(),
    payloadKind: inboxPayloadKindSchema,
    receivedAt: z.iso.datetime(),
    routedAt: z.iso.datetime().nullable(),
    snoozedUntil: z.iso.datetime().nullable(),
    status: inboxItemStatusSchema,
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const blobScanStatusSchema = z.enum([
  'not_scanned',
  'clean',
  'infected',
  'failed',
]);

export const inboxItemFileSchema = z
  .object({
    blobId: identifierSchema,
    byteSize: z.number().int().positive(),
    mediaType: z.string().regex(MEDIA_TYPE_PATTERN),
    originalFilename: z.string().min(1).max(255).nullable(),
    position: z.number().int().min(1),
    scanStatus: blobScanStatusSchema,
    sha256: z.string().regex(SHA256_PATTERN),
  })
  .strict();

// The blob routes answer 409 for these verdicts, so the page shows the notice instead of the links.
export function isBlobQuarantined(file: InboxItemFile): boolean {
  return file.scanStatus === 'infected' || file.scanStatus === 'failed';
}

export const providerReasonSchema = z
  .object({
    evidence: z.string().min(1).max(500),
    step: providerStepSchema,
    weight: confidenceSchema,
  })
  .strict();

export const providerIssueSchema = z
  .object({
    code: inboxIssueCodeSchema,
    field: z.string().min(1).max(100).optional(),
    message: z.string().min(1).max(500),
  })
  .strict();

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

export const inboxExtractionSchema = z
  .object({
    confidence: confidenceSchema,
    createdAt: z.iso.datetime(),
    detectedType: tokenSchema.nullable(),
    draft: draftSchema,
    fieldConfidences: z.record(z.string(), confidenceSchema),
    id: identifierSchema,
    issues: z.array(providerIssueSchema),
    legalEntityId: identifierSchema.nullable(),
    provider: tokenSchema,
    providerVersion: z.string().min(1).max(64),
    reasons: z.array(providerReasonSchema),
  })
  .strict();

export const inboxEventSchema = z
  .object({
    actorUserId: subjectIdentifierSchema.nullable(),
    createdAt: z.iso.datetime(),
    id: identifierSchema,
    kind: inboxEventKindSchema,
    reason: inboxEventReasonSchema.nullable(),
  })
  .strict();

export const inboxUploadResponseSchema = z
  .object({
    duplicateOfItemId: identifierSchema.nullable(),
    files: z.array(inboxItemFileSchema),
    item: inboxItemSchema,
  })
  .strict();

export const inboxRoutingDestinationSchema = z.enum([
  'documents',
  'datasets',
  'discard',
]);
export const inboxRoutingPartnerPolicySchema = z.enum(['match_only']);
export const inboxRoutingAutoPolicySchema = z.enum([
  'never',
  'above_threshold',
  'always',
]);
export const inboxRoutingTargetSourceSchema = z.enum([
  'platform',
  'organization',
]);
export const MAX_ROUTING_REQUIRED_FIELDS = 32;

// A draft field name a person must fill before routing: any identifier the destination contract names.
const routingRequiredFieldSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/);

// The editable part of a target; a PUT carries all of it, so one edit never resets another field.
const routingTargetFieldsSchema = z.object({
  auto: inboxRoutingAutoPolicySchema,
  autoThreshold: confidenceSchema.nullable(),
  defaultAssigneeId: subjectIdentifierSchema.nullable(),
  defaultLegalEntityId: identifierSchema.nullable(),
  // Null only on a platform default that names no destination yet; a saved row always names one.
  destination: inboxRoutingDestinationSchema.nullable(),
  documentKind: documentKindSchema.nullable(),
  partnerPolicy: inboxRoutingPartnerPolicySchema,
  requiredFields: z
    .array(routingRequiredFieldSchema)
    .max(MAX_ROUTING_REQUIRED_FIELDS),
});

// The two row checks: a kind exactly when the destination is documents, a threshold when the policy needs one.
function routingTargetInvariants(
  target: z.infer<typeof routingTargetFieldsSchema>,
  context: z.RefinementCtx,
): void {
  if ((target.documentKind !== null) !== (target.destination === 'documents')) {
    context.addIssue({
      code: 'custom',
      message:
        'A document kind is set exactly when the destination is documents.',
      path: ['documentKind'],
    });
  }
  if (target.auto === 'above_threshold' && target.autoThreshold === null) {
    context.addIssue({
      code: 'custom',
      message: 'A threshold is required for above_threshold.',
      path: ['autoThreshold'],
    });
  }
}

// The full target, never a partial patch: the form is prefilled from the effective target.
export const putInboxRoutingTargetRequestSchema = routingTargetFieldsSchema
  .extend({ destination: inboxRoutingDestinationSchema })
  .strict()
  .superRefine(routingTargetInvariants);

// The effective target for one detected type: the organization row when present, else the platform default.
export const inboxRoutingTargetSchema = routingTargetFieldsSchema
  .extend({
    detectedType: tokenSchema,
    source: inboxRoutingTargetSourceSchema,
  })
  .strict()
  .superRefine(routingTargetInvariants);

export const inboxRoutingTargetListResponseSchema = z
  .object({ targets: z.array(inboxRoutingTargetSchema) })
  .strict();

const blobQuotaBytesSchema = z.number().int().positive();

// The platform value is both the default and the cap, so an owner can only tighten it.
export const inboxSettingsSchema = z
  .object({
    blobQuotaBytes: blobQuotaBytesSchema.nullable(),
    platformQuotaBytes: blobQuotaBytesSchema,
    usedBytes: z.number().int().min(0),
  })
  .strict();

export const updateInboxSettingsRequestSchema = z
  .object({ blobQuotaBytes: blobQuotaBytesSchema.nullable() })
  .strict();

// The draft fields the create form edits; a correction records where the final value diverged from the suggestion.
export const inboxCorrectionFieldSchema = z.enum([
  'kind',
  'legal_entity_id',
  'partner_id',
  'document_date',
  'title',
  'reference',
  'currency_code',
]);
export const inboxCorrectionSourceSchema = z.enum([
  'hint',
  'rule',
  'target_default',
  'provider',
]);
export const MAX_CORRECTION_REASON_LENGTH = 500;
const correctionReasonSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_CORRECTION_REASON_LENGTH);

export const inboxCorrectionSchema = z
  .object({
    createdAt: z.iso.datetime(),
    field: inboxCorrectionFieldSchema,
    finalValue: z.string().nullable(),
    reason: z.string().max(MAX_CORRECTION_REASON_LENGTH).nullable(),
    source: inboxCorrectionSourceSchema,
    suggestedValue: z.string().nullable(),
  })
  .strict();

export const inboxItemDetailSchema = z
  .object({
    corrections: z.array(inboxCorrectionSchema),
    events: z.array(inboxEventSchema),
    extraction: inboxExtractionSchema.nullable(),
    files: z.array(inboxItemFileSchema),
    item: inboxItemSchema,
    // The effective target of the item's detected type, so the setting is visible on the item the day it lands.
    routingTarget: inboxRoutingTargetSchema,
  })
  .strict();

// The list carries the first file name and the file count so the browser needs no second request.
export const inboxItemListEntrySchema = inboxItemSchema
  .extend({
    fileCount: z.number().int().min(0),
    primaryFilename: z.string().min(1).max(255).nullable(),
  })
  .strict();

export const inboxItemListResponseSchema = z
  .object({
    items: z.array(inboxItemListEntrySchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(MAX_INBOX_PAGE_SIZE),
    total: z.number().int().min(0),
  })
  .strict();

// Comma separated statuses, capped at the vocabulary so a repeat cannot pad the query.
const csvStatusSchema = z
  .string()
  .transform((value) => value.split(','))
  .pipe(
    z
      .array(inboxItemStatusSchema)
      .min(1)
      .max(inboxItemStatusSchema.options.length),
  );

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
    status: csvStatusSchema.optional(),
  })
  .strict()
  .refine((query) => query.page * query.pageSize <= MAX_INBOX_WINDOW);

// Every hint is optional; a null clears it. Absence leaves the stored hint alone.
export const updateInboxHintsRequestSchema = inboxHintsSchema
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0);

// One optional line per changed field; absence records the correction without a reason.
export const correctionReasonsSchema = z
  .partialRecord(inboxCorrectionFieldSchema, correctionReasonSchema)
  .refine((reasons) => Object.keys(reasons).length > 0);

export const routeInboxItemToDocumentRequestSchema = z
  .object({
    correctionReasons: correctionReasonsSchema.optional(),
    document: createDocumentRequestSchema,
    fileBlobIds: z.array(identifierSchema).min(1).max(MAX_INBOX_FILES),
  })
  .strict()
  .refine((body) => new Set(body.fileBlobIds).size === body.fileBlobIds.length);

export const discardInboxItemRequestSchema = z
  .object({ reason: inboxDiscardReasonSchema })
  .strict();

export const assignInboxItemRequestSchema = z
  .object({ assigneeId: subjectIdentifierSchema.nullable() })
  .strict();

export const snoozeInboxItemRequestSchema = z
  .object({ snoozedUntil: z.iso.datetime().nullable() })
  .strict();

// A rule: closed condition and action columns, never a free-form expression.
export const MAX_ENABLED_INBOX_RULES = 200;
export const inboxRuleNameSchema = z.string().trim().min(1).max(120);
// Lowercase, `@domain` or a full address, the database check pattern.
export const inboxRuleSenderPatternSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(320)
  .regex(/^(@|[^@\s]+@)[^@\s]+$/);
export const inboxRuleKeywordSchema = z.string().trim().min(1).max(120);

const inboxRuleConditionsSchema = z.object({
  channelId: identifierSchema.nullable(),
  detectedType: tokenSchema.nullable(),
  keyword: inboxRuleKeywordSchema.nullable(),
  senderPattern: inboxRuleSenderPatternSchema.nullable(),
});

const inboxRuleActionsSchema = z.object({
  autoRoute: z.boolean(),
  discardReason: inboxDiscardReasonSchema.nullable(),
  setAssigneeId: subjectIdentifierSchema.nullable(),
  setDocumentKind: documentKindSchema.nullable(),
  setLegalEntityId: identifierSchema.nullable(),
  setPartnerId: identifierSchema.nullable(),
});

type InboxRuleConditions = z.infer<typeof inboxRuleConditionsSchema>;
type InboxRuleActions = z.infer<typeof inboxRuleActionsSchema>;

// The three row checks: one condition, one action, and a discard rule sets nothing else.
function inboxRuleInvariants(
  rule: InboxRuleConditions & InboxRuleActions,
  context: z.RefinementCtx,
): void {
  const hasCondition =
    rule.channelId !== null ||
    rule.detectedType !== null ||
    rule.keyword !== null ||
    rule.senderPattern !== null;
  if (!hasCondition) {
    context.addIssue({
      code: 'custom',
      message: 'A rule needs at least one condition.',
      path: ['senderPattern'],
    });
  }
  const sets =
    rule.setAssigneeId !== null ||
    rule.setDocumentKind !== null ||
    rule.setLegalEntityId !== null ||
    rule.setPartnerId !== null ||
    rule.autoRoute;
  if (!sets && rule.discardReason === null) {
    context.addIssue({
      code: 'custom',
      message: 'A rule needs at least one action.',
      path: ['discardReason'],
    });
  }
  if (sets && rule.discardReason !== null) {
    context.addIssue({
      code: 'custom',
      message: 'A discard rule carries no other action.',
      path: ['discardReason'],
    });
  }
}

export const inboxRuleSchema = inboxRuleConditionsSchema
  .extend(inboxRuleActionsSchema.shape)
  .extend({
    createdAt: z.iso.datetime(),
    createdBy: subjectIdentifierSchema,
    enabled: z.boolean(),
    id: identifierSchema,
    name: inboxRuleNameSchema,
    // The author is no longer a verified owner or admin, so the rule does not run until adopted.
    paused: z.boolean(),
    // Null only on a deleted rule, which the list never returns.
    priority: z.number().int().min(1).nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine(inboxRuleInvariants);

export const inboxRuleListResponseSchema = z
  .object({ rules: z.array(inboxRuleSchema) })
  .strict();

export const createInboxRuleRequestSchema = inboxRuleConditionsSchema
  .extend(inboxRuleActionsSchema.shape)
  .extend({
    name: inboxRuleNameSchema,
    // Also apply the new rule to the untouched needs_review items, not only future arrivals.
    rerunOnReview: z.boolean(),
  })
  .strict()
  .superRefine(inboxRuleInvariants);

// Any subset of the editable columns; the API re-checks the row invariants against the stored rule.
export const updateInboxRuleRequestSchema = inboxRuleConditionsSchema
  .extend(inboxRuleActionsSchema.shape)
  .extend({ enabled: z.boolean(), name: inboxRuleNameSchema })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0);

export const putInboxRuleOrderRequestSchema = z
  .object({ ruleIds: z.array(identifierSchema).min(1) })
  .strict()
  .refine((body) => new Set(body.ruleIds).size === body.ruleIds.length);

// The two refusals a rule write names beside the generic rejection code.
export const inboxRuleRefusalCodeSchema = z.enum([
  'rule_limit',
  'not_available',
]);

// An intake secret: the fixed prefix, then 32 random bytes in base64url. The 8 characters after the prefix are shown.
export const INTAKE_SECRET_PREFIX = 'bap_intake_';
export const INTAKE_DISPLAY_PREFIX_LENGTH = 8;
export const intakeSecretSchema = z
  .string()
  .regex(/^bap_intake_[A-Za-z0-9_-]{43}$/);
const displayPrefixSchema = z.string().length(INTAKE_DISPLAY_PREFIX_LENGTH);
// An intake address: `in-` then 32 lowercase hex characters at the platform intake domain.
export const intakeEmailAddressSchema = z
  .string()
  .regex(
    /^in-[0-9a-f]{32}@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/,
  );
// Only email and api channels exist as rows; the wider vocabulary above names an item's source.
export const inboxChannelKindForChannelsSchema = z.enum(['email', 'api']);
export const inboxChannelNameSchema = z.string().trim().min(1).max(200);

export const inboxChannelCredentialSchema = z
  .object({
    createdAt: z.iso.datetime(),
    credentialId: identifierSchema,
    displayPrefix: displayPrefixSchema,
    lastUsedAt: z.iso.datetime().nullable(),
  })
  .strict();

export const inboxChannelSchema = z
  .object({
    createdAt: z.iso.datetime(),
    credentials: z.array(inboxChannelCredentialSchema),
    // Stored plain on the row for an email channel; an api channel never has one.
    emailAddress: intakeEmailAddressSchema.nullable(),
    enabled: z.boolean(),
    hintKind: tokenSchema.nullable(),
    id: identifierSchema,
    itemCount: z.number().int().min(0),
    kind: inboxChannelKindForChannelsSchema,
    legalEntityId: identifierSchema.nullable(),
    name: inboxChannelNameSchema,
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const inboxChannelListResponseSchema = z
  .object({ channels: z.array(inboxChannelSchema) })
  .strict();

export const createInboxChannelRequestSchema = z
  .object({
    hintKind: tokenSchema.optional(),
    kind: inboxChannelKindForChannelsSchema,
    legalEntityId: identifierSchema.optional(),
    name: inboxChannelNameSchema,
  })
  .strict();

// Absence leaves a column alone; null clears it. A soft delete is `enabled: false, deleted: true`.
export const updateInboxChannelRequestSchema = z
  .object({
    deleted: z.literal(true).optional(),
    enabled: z.boolean().optional(),
    hintKind: tokenSchema.nullable().optional(),
    legalEntityId: identifierSchema.nullable().optional(),
    name: inboxChannelNameSchema.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0)
  .refine((body) => body.deleted !== true || body.enabled === false);

// The plain secret crosses this boundary exactly once; an email channel's secret is its address.
export const issueInboxChannelCredentialResponseSchema = z
  .object({
    credentialId: identifierSchema,
    displayPrefix: displayPrefixSchema,
    secret: z.union([intakeSecretSchema, intakeEmailAddressSchema]),
  })
  .strict();

// Accepted, never the content: a pushing client learns the item id and whether the bytes were known.
export const inboxIntakeResponseSchema = z
  .object({
    duplicateOfItemId: identifierSchema.nullable(),
    itemId: identifierSchema,
    status: inboxItemStatusSchema,
  })
  .strict();

export type CreateInboxChannelRequest = z.infer<
  typeof createInboxChannelRequestSchema
>;
export type CreateInboxRuleRequest = z.infer<
  typeof createInboxRuleRequestSchema
>;
export type InboxCorrection = z.infer<typeof inboxCorrectionSchema>;
export type InboxCorrectionField = z.infer<typeof inboxCorrectionFieldSchema>;
export type InboxCorrectionSource = z.infer<typeof inboxCorrectionSourceSchema>;
export type InboxRule = z.infer<typeof inboxRuleSchema>;
export type InboxRuleListResponse = z.infer<typeof inboxRuleListResponseSchema>;
export type InboxRuleRefusalCode = z.infer<typeof inboxRuleRefusalCodeSchema>;
export type PutInboxRuleOrderRequest = z.infer<
  typeof putInboxRuleOrderRequestSchema
>;
export type UpdateInboxRuleRequest = z.infer<
  typeof updateInboxRuleRequestSchema
>;
export type InboxChannel = z.infer<typeof inboxChannelSchema>;
export type InboxChannelCredential = z.infer<
  typeof inboxChannelCredentialSchema
>;
export type InboxChannelListResponse = z.infer<
  typeof inboxChannelListResponseSchema
>;
export type InboxDiscardReason = z.infer<typeof inboxDiscardReasonSchema>;
export type InboxEvent = z.infer<typeof inboxEventSchema>;
export type InboxExtraction = z.infer<typeof inboxExtractionSchema>;
export type InboxHints = z.infer<typeof inboxHintsSchema>;
export type InboxItem = z.infer<typeof inboxItemSchema>;
export type InboxItemDetail = z.infer<typeof inboxItemDetailSchema>;
export type InboxItemFile = z.infer<typeof inboxItemFileSchema>;
export type InboxItemListEntry = z.infer<typeof inboxItemListEntrySchema>;
export type InboxItemListResponse = z.infer<typeof inboxItemListResponseSchema>;
export type InboxItemStatus = z.infer<typeof inboxItemStatusSchema>;
export type InboxIntakeResponse = z.infer<typeof inboxIntakeResponseSchema>;
export type InboxIssueCode = z.infer<typeof inboxIssueCodeSchema>;
export type InboxRoutingAutoPolicy = z.infer<
  typeof inboxRoutingAutoPolicySchema
>;
export type InboxRoutingDestination = z.infer<
  typeof inboxRoutingDestinationSchema
>;
export type InboxRoutingTarget = z.infer<typeof inboxRoutingTargetSchema>;
export type InboxRoutingTargetListResponse = z.infer<
  typeof inboxRoutingTargetListResponseSchema
>;
export type InboxSettings = z.infer<typeof inboxSettingsSchema>;
export type IssueInboxChannelCredentialResponse = z.infer<
  typeof issueInboxChannelCredentialResponseSchema
>;
export type InboxUploadResponse = z.infer<typeof inboxUploadResponseSchema>;
export type ProviderIssue = z.infer<typeof providerIssueSchema>;
export type ProviderReason = z.infer<typeof providerReasonSchema>;
export type PutInboxRoutingTargetRequest = z.infer<
  typeof putInboxRoutingTargetRequestSchema
>;
export type UpdateInboxChannelRequest = z.infer<
  typeof updateInboxChannelRequestSchema
>;
export type UpdateInboxHintsRequest = z.input<
  typeof updateInboxHintsRequestSchema
>;
export type UpdateInboxSettingsRequest = z.infer<
  typeof updateInboxSettingsRequestSchema
>;
