import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  integer,
  index,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const authSchema = pgSchema('auth');
export const appSchema = pgSchema('app');

export const users = authSchema.table(
  'user',
  {
    banned: boolean('banned').notNull().default(false),
    banExpires: timestamp('ban_expires', { withTimezone: true }),
    banReason: text('ban_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    id: text('id').primaryKey(),
    image: text('image'),
    name: text('name').notNull(),
    role: text('role').notNull().default('user'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('user_email_key').on(table.email)],
);

export const sessions = authSchema.table(
  'session',
  {
    activeOrganizationId: text('active_organization_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    id: text('id').primaryKey(),
    impersonatedBy: text('impersonated_by'),
    ipAddress: text('ip_address'),
    token: text('token').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('session_user_id_idx').on(table.userId),
    uniqueIndex('session_token_key').on(table.token),
  ],
);

export const accounts = authSchema.table(
  'account',
  {
    accessToken: text('access_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      withTimezone: true,
    }),
    accountId: text('account_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    id: text('id').primaryKey(),
    idToken: text('id_token'),
    password: text('password'),
    providerId: text('provider_id').notNull(),
    refreshToken: text('refresh_token'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
      withTimezone: true,
    }),
    scope: text('scope'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('account_user_id_idx').on(table.userId),
    uniqueIndex('account_provider_id_account_id_key').on(
      table.providerId,
      table.accountId,
    ),
  ],
);

export const verifications = authSchema.table(
  'verification',
  {
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    value: text('value').notNull(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
);

export const organizations = authSchema.table(
  'organization',
  {
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    id: text('id').primaryKey(),
    logo: text('logo'),
    metadata: text('metadata'),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
  },
  (table) => [uniqueIndex('organization_slug_key').on(table.slug)],
);

export const members = authSchema.table(
  'member',
  {
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    status: text('status').notNull().default('active'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('member_user_id_idx').on(table.userId),
    uniqueIndex('member_organization_user_key').on(
      table.organizationId,
      table.userId,
    ),
  ],
);

export const invitations = authSchema.table(
  'invitation',
  {
    email: text('email').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    id: text('id').primaryKey(),
    inviterId: text('inviter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    role: text('role'),
    status: text('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('invitation_organization_id_idx').on(table.organizationId)],
);

export const jwks = authSchema.table('jwks', {
  alg: text('alg'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  crv: text('crv'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  id: text('id').primaryKey(),
  privateKey: text('private_key').notNull(),
  publicKey: text('public_key').notNull(),
});

export const rateLimits = authSchema.table(
  'rate_limit',
  {
    count: integer('count').notNull(),
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
  },
  (table) => [uniqueIndex('rate_limit_key_key').on(table.key)],
);

export const blobScanStatuses = [
  'not_scanned',
  'clean',
  'infected',
  'failed',
] as const;
export type BlobScanStatus = (typeof blobScanStatuses)[number];

export const inboxChannelKinds = [
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
] as const;
export type InboxChannelKind = (typeof inboxChannelKinds)[number];

// The kinds that have a principal of their own (ADR 0016); a manual upload has no channel row.
export const inboxChannelKindsForChannels = ['email', 'api'] as const;
export type InboxChannelKindForChannels =
  (typeof inboxChannelKindsForChannels)[number];

export const inboxChannelCredentialKinds = [
  'api_token',
  'email_address',
] as const;
export type InboxChannelCredentialKind =
  (typeof inboxChannelCredentialKinds)[number];

export const inboxPayloadKinds = [
  'file',
  'email',
  'structured',
  'text',
] as const;
export type InboxPayloadKind = (typeof inboxPayloadKinds)[number];

export const inboxItemStatuses = [
  'received',
  'processing',
  'needs_review',
  'routed',
  'discarded',
  'failed',
] as const;
export type InboxItemStatus = (typeof inboxItemStatuses)[number];

export const inboxDecidedByKinds = [
  'hint',
  'rule',
  'target_default',
  'provider',
  'user',
] as const;
export type InboxDecidedByKind = (typeof inboxDecidedByKinds)[number];

export const inboxEventKinds = [
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
  'attached',
] as const;
export type InboxEventKind = (typeof inboxEventKinds)[number];

export const inboxDiscardReasons = [
  'irrelevant',
  'duplicate',
  'not_ours',
  'spam',
] as const;
export type InboxDiscardReason = (typeof inboxDiscardReasons)[number];

export const inboxUnprocessableReasons = [
  'unsupported_type',
  'password_protected',
  'encrypted',
  'empty',
  'unreadable',
  'decorative_image',
  'too_large',
  'policy_rejected',
] as const;
export type InboxUnprocessableReason =
  (typeof inboxUnprocessableReasons)[number];

// The reaper's reason: a processing item whose handler died before its last attempt finished.
export const inboxMaintenanceReasons = ['stalled'] as const;
export type InboxMaintenanceReason = (typeof inboxMaintenanceReasons)[number];

// The automation's reason: the rule author is no longer a verified owner or admin, so the route was skipped.
export const inboxAutomationReasons = ['rule_author_unavailable'] as const;
export type InboxAutomationReason = (typeof inboxAutomationReasons)[number];

export const inboxEventReasons = [
  ...inboxDiscardReasons,
  ...inboxUnprocessableReasons,
  ...inboxMaintenanceReasons,
  ...inboxAutomationReasons,
] as const;
export type InboxEventReason = (typeof inboxEventReasons)[number];

// The register's kinds, mirrored from document_kind_check; app.document itself has no Drizzle definition yet.
export const documentKinds = [
  'issued_invoice',
  'received_invoice',
  'credit_note',
  'advance_request',
  'receipt',
  'bank_statement',
  'contract',
  'agreement',
  'hr_document',
  'payroll',
  'tax_filing',
  'other',
] as const;
export type DocumentKind = (typeof documentKinds)[number];

// The invoice line categories, mirrored from invoice_line_category_check and partner_default_line_category_check;
// app.invoice_line and app.partner have no Drizzle definition yet.
export const invoiceLineCategories = [
  'goods',
  'material',
  'services',
  'labour',
  'transport',
  'asset',
  'other',
] as const;
export type InvoiceLineCategory = (typeof invoiceLineCategories)[number];

// The draft fields the route form edits, so a correction names one of them.
export const inboxCorrectionFields = [
  'kind',
  'legal_entity_id',
  'partner_id',
  'document_date',
  'title',
  'reference',
  'currency_code',
] as const;
export type InboxCorrectionField = (typeof inboxCorrectionFields)[number];

// Where a suggested value came from, in precedence order.
export const inboxCorrectionSources = [
  'hint',
  'rule',
  'target_default',
  'provider',
] as const;
export type InboxCorrectionSource = (typeof inboxCorrectionSources)[number];

function sqlList(values: readonly string[]) {
  return sql.raw(values.map((value) => `'${value}'`).join(', '));
}

const organizationSlot = {
  organizationId: text('organization_id').notNull(),
};

// Content addressed per organization: the same bytes uploaded twice by one tenant are one row.
export const blobs = appSchema.table(
  'blob',
  {
    ...organizationSlot,
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text('created_by').notNull(),
    id: uuid('id').primaryKey().defaultRandom(),
    mediaType: text('media_type').notNull(),
    originalFilename: text('original_filename'),
    scanStatus: text('scan_status', { enum: blobScanStatuses })
      .notNull()
      .default('not_scanned'),
    sha256: text('sha256').notNull(),
    storageKey: text('storage_key').notNull(),
  },
  (table) => [
    check('blob_sha256_check', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    check('blob_byte_size_check', sql`${table.byteSize} > 0`),
    check(
      'blob_scan_status_check',
      sql`${table.scanStatus} in (${sqlList(blobScanStatuses)})`,
    ),
    unique('blob_organization_sha256_key').on(
      table.organizationId,
      table.sha256,
    ),
    unique('blob_id_organization_key').on(table.id, table.organizationId),
    index('blob_organization_idx').on(table.organizationId, table.createdAt),
  ],
);

// One row per push or pull source of an organization; soft deleted, never removed while items point at it.
export const inboxChannels = appSchema.table(
  'inbox_channel',
  {
    ...organizationSlot,
    config: jsonb('config').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text('created_by').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    emailAddress: text('email_address'),
    enabled: boolean('enabled').notNull().default(true),
    hintKind: text('hint_kind'),
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind', { enum: inboxChannelKindsForChannels }).notNull(),
    lastError: text('last_error'),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    legalEntityId: uuid('legal_entity_id'),
    name: text('name').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'inbox_channel_kind_check',
      sql`${table.kind} in (${sqlList(inboxChannelKindsForChannels)})`,
    ),
    check(
      'inbox_channel_deleted_disabled_check',
      sql`${table.deletedAt} is null or not ${table.enabled}`,
    ),
    unique('inbox_channel_id_organization_key').on(
      table.id,
      table.organizationId,
    ),
    index('inbox_channel_organization_idx').on(
      table.organizationId,
      table.kind,
    ),
    // The intake domain is shared by every organization, so the address is unique across the platform.
    uniqueIndex('inbox_channel_email_address_key')
      .on(table.emailAddress)
      .where(sql`${table.emailAddress} is not null`),
  ],
);

// One envelope per arrival: what came in, how sure the platform is about it, and where it went.
export const inboxItems = appSchema.table(
  'inbox_item',
  {
    ...organizationSlot,
    assigneeId: text('assignee_id'),
    channelId: uuid('channel_id'),
    channelKind: text('channel_kind', { enum: inboxChannelKinds }).notNull(),
    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text('created_by').notNull(),
    datasetId: uuid('dataset_id'),
    decidedByKind: text('decided_by_kind', { enum: inboxDecidedByKinds }),
    decidedByRuleId: uuid('decided_by_rule_id'),
    decidedByUserId: text('decided_by_user_id'),
    detectedType: text('detected_type'),
    documentId: uuid('document_id'),
    duplicateOfItemId: uuid('duplicate_of_item_id'),
    externalId: text('external_id'),
    hintKind: text('hint_kind'),
    hintLegalEntityId: uuid('hint_legal_entity_id'),
    hintLinkDocumentId: uuid('hint_link_document_id'),
    hintPartnerId: uuid('hint_partner_id'),
    hintText: text('hint_text'),
    id: uuid('id').primaryKey().defaultRandom(),
    legalEntityId: uuid('legal_entity_id'),
    origin: text('origin'),
    parentItemId: uuid('parent_item_id'),
    partnerId: uuid('partner_id'),
    payloadKind: text('payload_kind', { enum: inboxPayloadKinds }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    routedAt: timestamp('routed_at', { withTimezone: true }),
    sender: text('sender'),
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
    status: text('status', { enum: inboxItemStatuses })
      .notNull()
      .default('received'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'inbox_item_channel_kind_check',
      sql`${table.channelKind} in (${sqlList(inboxChannelKinds)})`,
    ),
    check(
      'inbox_item_payload_kind_check',
      sql`${table.payloadKind} in (${sqlList(inboxPayloadKinds)})`,
    ),
    check(
      'inbox_item_status_check',
      sql`${table.status} in (${sqlList(inboxItemStatuses)})`,
    ),
    check(
      'inbox_item_confidence_check',
      sql`${table.confidence} is null or (${table.confidence} >= 0 and ${table.confidence} <= 1)`,
    ),
    check(
      'inbox_item_decided_by_kind_check',
      sql`${table.decidedByKind} is null or ${table.decidedByKind} in (${sqlList(inboxDecidedByKinds)})`,
    ),
    check(
      'inbox_item_one_destination_check',
      sql`(${table.documentId} is not null)::integer + (${table.datasetId} is not null)::integer + (${table.partnerId} is not null)::integer <= 1`,
    ),
    check(
      'inbox_item_routed_check',
      sql`${table.status} <> 'routed' or (${table.documentId} is not null or ${table.datasetId} is not null or ${table.partnerId} is not null)`,
    ),
    check(
      'inbox_item_channel_check',
      sql`(${table.channelKind} = 'upload') = (${table.channelId} is null)`,
    ),
    check(
      'inbox_item_sender_check',
      sql`${table.sender} is null or length(${table.sender}) between 1 and 320`,
    ),
    unique('inbox_item_id_organization_key').on(table.id, table.organizationId),
    foreignKey({
      columns: [table.channelId, table.organizationId],
      foreignColumns: [inboxChannels.id, inboxChannels.organizationId],
      name: 'inbox_item_channel_fkey',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.parentItemId, table.organizationId],
      foreignColumns: [table.id, table.organizationId],
      name: 'inbox_item_parent_fkey',
    }),
    foreignKey({
      columns: [table.duplicateOfItemId, table.organizationId],
      foreignColumns: [table.id, table.organizationId],
      name: 'inbox_item_duplicate_of_fkey',
    }),
    index('inbox_item_list_idx').on(
      table.organizationId,
      table.status,
      table.receivedAt,
      table.id,
    ),
    uniqueIndex('inbox_item_channel_external_id_key')
      .on(table.organizationId, table.channelId, table.externalId)
      .where(
        sql`${table.externalId} is not null and ${table.channelId} is not null`,
      ),
  ],
);

// The files behind an item, in order; a page range narrows a multi document scan.
export const inboxItemFiles = appSchema.table(
  'inbox_item_file',
  {
    ...organizationSlot,
    blobId: uuid('blob_id').notNull(),
    itemId: uuid('item_id').notNull(),
    pageFrom: integer('page_from'),
    pageTo: integer('page_to'),
    position: integer('position').notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.itemId, table.position],
      name: 'inbox_item_file_pkey',
    }),
    check('inbox_item_file_position_check', sql`${table.position} >= 1`),
    foreignKey({
      columns: [table.itemId, table.organizationId],
      foreignColumns: [inboxItems.id, inboxItems.organizationId],
      name: 'inbox_item_file_item_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.blobId, table.organizationId],
      foreignColumns: [blobs.id, blobs.organizationId],
      name: 'inbox_item_file_blob_fkey',
    }).onDelete('restrict'),
    index('inbox_item_file_organization_idx').on(
      table.organizationId,
      table.itemId,
    ),
  ],
);

// One row per provider run: the draft, per field confidences, ordered reasons and issues.
export const inboxItemExtractions = appSchema.table(
  'inbox_item_extraction',
  {
    ...organizationSlot,
    confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text('created_by').notNull(),
    detectedType: text('detected_type'),
    draft: jsonb('draft').notNull().default({}),
    fieldConfidences: jsonb('field_confidences').notNull().default({}),
    id: uuid('id').primaryKey().defaultRandom(),
    issues: jsonb('issues').notNull().default([]),
    itemId: uuid('item_id').notNull(),
    legalEntityId: uuid('legal_entity_id'),
    provider: text('provider').notNull(),
    providerVersion: text('provider_version').notNull(),
    reasons: jsonb('reasons').notNull().default([]),
  },
  (table) => [
    check(
      'inbox_item_extraction_confidence_check',
      sql`${table.confidence} >= 0 and ${table.confidence} <= 1`,
    ),
    foreignKey({
      columns: [table.itemId, table.organizationId],
      foreignColumns: [inboxItems.id, inboxItems.organizationId],
      name: 'inbox_item_extraction_item_fkey',
    }).onDelete('cascade'),
    index('inbox_item_extraction_item_idx').on(
      table.organizationId,
      table.itemId,
      table.createdAt,
    ),
  ],
);

// Append only history of what happened to an item; ids, kinds and reasons only, never content.
export const inboxEvents = appSchema.table(
  'inbox_event',
  {
    ...organizationSlot,
    actorUserId: text('actor_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    id: uuid('id').primaryKey().defaultRandom(),
    itemId: uuid('item_id').notNull(),
    kind: text('kind', { enum: inboxEventKinds }).notNull(),
    reason: text('reason', { enum: inboxEventReasons }),
  },
  (table) => [
    check(
      'inbox_event_kind_check',
      sql`${table.kind} in (${sqlList(inboxEventKinds)})`,
    ),
    check(
      'inbox_event_reason_check',
      sql`${table.reason} is null or ${table.reason} in (${sqlList(inboxEventReasons)})`,
    ),
    foreignKey({
      columns: [table.itemId, table.organizationId],
      foreignColumns: [inboxItems.id, inboxItems.organizationId],
      name: 'inbox_event_item_fkey',
    }).onDelete('cascade'),
    index('inbox_event_item_idx').on(
      table.organizationId,
      table.itemId,
      table.createdAt,
    ),
  ],
);

// The originals behind a registered document, in order. app.document itself has no Drizzle definition yet.
export const documentFiles = appSchema.table(
  'document_file',
  {
    ...organizationSlot,
    blobId: uuid('blob_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text('created_by').notNull(),
    documentId: uuid('document_id').notNull(),
    pageFrom: integer('page_from'),
    pageTo: integer('page_to'),
    position: integer('position').notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.documentId, table.position],
      name: 'document_file_pkey',
    }),
    check('document_file_position_check', sql`${table.position} >= 1`),
    foreignKey({
      columns: [table.blobId, table.organizationId],
      foreignColumns: [blobs.id, blobs.organizationId],
      name: 'document_file_blob_fkey',
    }).onDelete('restrict'),
    index('document_file_organization_idx').on(
      table.organizationId,
      table.documentId,
    ),
  ],
);

export const inboxRoutingDestinations = [
  'documents',
  'datasets',
  'discard',
] as const;
export type InboxRoutingDestination = (typeof inboxRoutingDestinations)[number];

export const inboxRoutingPartnerPolicies = ['match_only'] as const;
export type InboxRoutingPartnerPolicy =
  (typeof inboxRoutingPartnerPolicies)[number];

export const inboxRoutingAutoPolicies = [
  'never',
  'above_threshold',
  'always',
] as const;
export type InboxRoutingAutoPolicy = (typeof inboxRoutingAutoPolicies)[number];

// An organization override of the platform routing default for one detected type; absent means the platform default.
export const inboxRoutingTargets = appSchema.table(
  'inbox_routing_target',
  {
    ...organizationSlot,
    auto: text('auto', { enum: inboxRoutingAutoPolicies })
      .notNull()
      .default('never'),
    autoThreshold: numeric('auto_threshold', { precision: 3, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text('created_by')
      .notNull()
      .default(sql`current_setting('bap.user_id', true)`),
    defaultAssigneeId: text('default_assignee_id'),
    defaultLegalEntityId: uuid('default_legal_entity_id'),
    destination: text('destination', {
      enum: inboxRoutingDestinations,
    }).notNull(),
    detectedType: text('detected_type').notNull(),
    documentKind: text('document_kind'),
    id: uuid('id').primaryKey().defaultRandom(),
    partnerPolicy: text('partner_policy', {
      enum: inboxRoutingPartnerPolicies,
    })
      .notNull()
      .default('match_only'),
    requiredFields: text('required_fields').array().notNull().default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: text('updated_by')
      .notNull()
      .default(sql`current_setting('bap.user_id', true)`),
  },
  (table) => [
    check(
      'inbox_routing_target_detected_type_check',
      sql`${table.detectedType} ~ '^[a-z][a-z0-9_]{0,63}$'`,
    ),
    check(
      'inbox_routing_target_destination_check',
      sql`${table.destination} in (${sqlList(inboxRoutingDestinations)})`,
    ),
    check(
      'inbox_routing_target_document_kind_check',
      sql`(${table.destination} = 'documents') = (${table.documentKind} is not null)`,
    ),
    check(
      'inbox_routing_target_partner_policy_check',
      sql`${table.partnerPolicy} in (${sqlList(inboxRoutingPartnerPolicies)})`,
    ),
    check(
      'inbox_routing_target_auto_check',
      sql`${table.auto} in (${sqlList(inboxRoutingAutoPolicies)})`,
    ),
    check(
      'inbox_routing_target_auto_threshold_check',
      sql`${table.autoThreshold} is null or (${table.autoThreshold} >= 0 and ${table.autoThreshold} <= 1)`,
    ),
    check(
      'inbox_routing_target_auto_threshold_required_check',
      sql`${table.auto} <> 'above_threshold' or ${table.autoThreshold} is not null`,
    ),
    check(
      'inbox_routing_target_required_fields_check',
      sql`array_position(${table.requiredFields}, null) is null and cardinality(${table.requiredFields}) <= 32`,
    ),
    unique('inbox_routing_target_organization_detected_type_key').on(
      table.organizationId,
      table.detectedType,
    ),
    index('inbox_routing_target_default_legal_entity_idx')
      .on(table.defaultLegalEntityId)
      .where(sql`${table.defaultLegalEntityId} is not null`),
  ],
);

// One optional row per organization; null means the platform value, which is also the cap.
export const organizationInboxSettings = appSchema.table(
  'organization_inbox_setting',
  {
    blobQuotaBytes: bigint('blob_quota_bytes', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text('created_by')
      .notNull()
      .default(sql`current_setting('bap.user_id', true)`),
    organizationId: text('organization_id').primaryKey(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'organization_inbox_setting_blob_quota_bytes_check',
      sql`${table.blobQuotaBytes} is null or ${table.blobQuotaBytes} > 0`,
    ),
  ],
);

// One routing rule of an organization: closed conditions, closed actions, run as its author; soft deleted only.
export const inboxRules = appSchema.table(
  'inbox_rule',
  {
    ...organizationSlot,
    autoRoute: boolean('auto_route').notNull().default(false),
    channelId: uuid('channel_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text('created_by')
      .notNull()
      .default(sql`current_setting('bap.user_id', true)`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    detectedType: text('detected_type'),
    discardReason: text('discard_reason', { enum: inboxDiscardReasons }),
    enabled: boolean('enabled').notNull().default(true),
    id: uuid('id').primaryKey().defaultRandom(),
    keyword: text('keyword'),
    name: text('name').notNull(),
    priority: integer('priority'),
    senderPattern: text('sender_pattern'),
    setAssigneeId: text('set_assignee_id'),
    setDocumentKind: text('set_document_kind', { enum: documentKinds }),
    setLegalEntityId: uuid('set_legal_entity_id'),
    setPartnerId: uuid('set_partner_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'inbox_rule_name_check',
      sql`length(${table.name}) between 1 and 120`,
    ),
    check(
      'inbox_rule_priority_deleted_check',
      sql`(${table.deletedAt} is null) = (${table.priority} is not null)`,
    ),
    check(
      'inbox_rule_sender_pattern_check',
      sql`${table.senderPattern} is null or (${table.senderPattern} ~ '^(@|[^@[:space:]]+@)[^@[:space:]]+$' and ${table.senderPattern} = lower(${table.senderPattern}) and length(${table.senderPattern}) <= 320)`,
    ),
    check(
      'inbox_rule_keyword_check',
      sql`${table.keyword} is null or length(${table.keyword}) between 1 and 120`,
    ),
    check(
      'inbox_rule_detected_type_check',
      sql`${table.detectedType} is null or ${table.detectedType} ~ '^[a-z][a-z0-9_]{0,63}$'`,
    ),
    check(
      'inbox_rule_condition_check',
      sql`${table.channelId} is not null or ${table.senderPattern} is not null or ${table.keyword} is not null or ${table.detectedType} is not null`,
    ),
    check(
      'inbox_rule_set_document_kind_check',
      sql`${table.setDocumentKind} is null or ${table.setDocumentKind} in (${sqlList(documentKinds)})`,
    ),
    check(
      'inbox_rule_discard_reason_check',
      sql`${table.discardReason} is null or ${table.discardReason} in (${sqlList(inboxDiscardReasons)})`,
    ),
    check(
      'inbox_rule_action_check',
      sql`${table.deletedAt} is not null or ${table.setLegalEntityId} is not null or ${table.setDocumentKind} is not null or ${table.setPartnerId} is not null or ${table.setAssigneeId} is not null or ${table.discardReason} is not null or ${table.autoRoute}`,
    ),
    check(
      'inbox_rule_discard_exclusive_check',
      sql`${table.discardReason} is null or (${table.setLegalEntityId} is null and ${table.setDocumentKind} is null and ${table.setPartnerId} is null and ${table.setAssigneeId} is null and not ${table.autoRoute})`,
    ),
    unique('inbox_rule_organization_priority_key').on(
      table.organizationId,
      table.priority,
    ),
    unique('inbox_rule_id_organization_key').on(table.id, table.organizationId),
    foreignKey({
      columns: [table.channelId, table.organizationId],
      foreignColumns: [inboxChannels.id, inboxChannels.organizationId],
      name: 'inbox_rule_channel_fkey',
    }).onDelete('restrict'),
    index('inbox_rule_organization_priority_idx')
      .on(table.organizationId, table.priority)
      .where(sql`${table.deletedAt} is null and ${table.enabled}`),
  ],
);

// A draft field a person changed away from the suggested value when routing one item; never updated or deleted.
export const inboxCorrections = appSchema.table(
  'inbox_correction',
  {
    ...organizationSlot,
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text('created_by')
      .notNull()
      .default(sql`current_setting('bap.user_id', true)`),
    field: text('field', { enum: inboxCorrectionFields }).notNull(),
    finalValue: text('final_value'),
    id: uuid('id').primaryKey().defaultRandom(),
    inboxItemId: uuid('inbox_item_id').notNull(),
    reason: text('reason'),
    source: text('source', { enum: inboxCorrectionSources }).notNull(),
    suggestedValue: text('suggested_value'),
  },
  (table) => [
    check(
      'inbox_correction_field_check',
      sql`${table.field} in (${sqlList(inboxCorrectionFields)})`,
    ),
    check(
      'inbox_correction_source_check',
      sql`${table.source} in (${sqlList(inboxCorrectionSources)})`,
    ),
    check(
      'inbox_correction_reason_check',
      sql`${table.reason} is null or length(${table.reason}) between 1 and 500`,
    ),
    foreignKey({
      columns: [table.inboxItemId, table.organizationId],
      foreignColumns: [inboxItems.id, inboxItems.organizationId],
      name: 'inbox_correction_item_fkey',
    }).onDelete('cascade'),
    index('inbox_correction_item_idx').on(
      table.organizationId,
      table.inboxItemId,
    ),
  ],
);

export type Blob = typeof blobs.$inferSelect;
export type NewBlob = typeof blobs.$inferInsert;
export type InboxChannel = typeof inboxChannels.$inferSelect;
export type NewInboxChannel = typeof inboxChannels.$inferInsert;
export type InboxItem = typeof inboxItems.$inferSelect;
export type NewInboxItem = typeof inboxItems.$inferInsert;
export type InboxItemFile = typeof inboxItemFiles.$inferSelect;
export type NewInboxItemFile = typeof inboxItemFiles.$inferInsert;
export type InboxItemExtraction = typeof inboxItemExtractions.$inferSelect;
export type NewInboxItemExtraction = typeof inboxItemExtractions.$inferInsert;
export type InboxEvent = typeof inboxEvents.$inferSelect;
export type NewInboxEvent = typeof inboxEvents.$inferInsert;
export type DocumentFile = typeof documentFiles.$inferSelect;
export type NewDocumentFile = typeof documentFiles.$inferInsert;
export type InboxRoutingTarget = typeof inboxRoutingTargets.$inferSelect;
export type NewInboxRoutingTarget = typeof inboxRoutingTargets.$inferInsert;
export type OrganizationInboxSetting =
  typeof organizationInboxSettings.$inferSelect;
export type NewOrganizationInboxSetting =
  typeof organizationInboxSettings.$inferInsert;
export type InboxRule = typeof inboxRules.$inferSelect;
export type NewInboxRule = typeof inboxRules.$inferInsert;
export type InboxCorrection = typeof inboxCorrections.$inferSelect;
export type NewInboxCorrection = typeof inboxCorrections.$inferInsert;

export const schema = {
  accounts,
  blobs,
  documentFiles,
  inboxChannels,
  inboxCorrections,
  inboxEvents,
  inboxItemExtractions,
  inboxItemFiles,
  inboxItems,
  inboxRoutingTargets,
  inboxRules,
  invitations,
  jwks,
  members,
  organizationInboxSettings,
  organizations,
  rateLimits,
  sessions,
  users,
  verifications,
};
