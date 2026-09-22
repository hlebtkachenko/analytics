import { inboxChannelKindsForChannels } from '@bap/db';

import {
  createDocumentBodyOpenApiSchema,
  DOCUMENT_KINDS,
} from '../documents/contract.js';
import {
  BLOB_SCAN_STATUSES,
  DETECTED_TYPES,
  INBOX_BULK_ACTIONS,
  INBOX_BULK_REFUSAL_CODES,
  INBOX_CHANNEL_KINDS,
  INBOX_CORRECTION_FIELDS,
  INBOX_CORRECTION_SOURCES,
  INBOX_DECIDED_BY_KINDS,
  INBOX_DISCARD_REASONS,
  INBOX_EVENT_KINDS,
  INBOX_EVENT_REASONS,
  INBOX_ISSUE_CODES,
  INBOX_ITEM_STATUSES,
  INBOX_PAYLOAD_KINDS,
  INBOX_ROUTING_AUTO_POLICIES,
  INBOX_ROUTING_DESTINATIONS,
  INBOX_ROUTING_PARTNER_POLICIES,
  INBOX_ROUTING_TARGET_SOURCES,
  MAX_INBOX_BULK_ITEMS,
  MAX_INBOX_CORRECTION_REASON_LENGTH,
  MAX_INBOX_FILES,
  MAX_INBOX_PAGE_SIZE,
  MAX_INBOX_RULE_KEYWORD_LENGTH,
  MAX_INBOX_RULE_NAME_LENGTH,
  MAX_REQUIRED_FIELDS,
  MEDIA_TYPE_PATTERN,
  PROVIDER_STEPS,
  SHA256_PATTERN,
  TOKEN_PATTERN,
} from './contract.js';

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
