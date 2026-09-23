// @vitest-environment node

import {
  inboxChannelKinds,
  inboxCorrectionFields,
  inboxCorrectionSources,
  inboxDecidedByKinds,
  inboxEventKinds,
  inboxEventReasons,
  inboxItemStatuses,
  inboxPayloadKinds,
  inboxRoutingAutoPolicies,
  inboxRoutingDestinations,
  inboxRoutingPartnerPolicies,
} from '@bap/db';
import { describe, expect, it } from 'vitest';

import {
  bulkInboxItemsRequestSchema,
  correctionReasonsSchema,
  createInboxChannelRequestSchema,
  createInboxRuleRequestSchema,
  inboxChannelKindSchema,
  inboxChannelSchema,
  inboxCorrectionFieldSchema,
  inboxCorrectionSourceSchema,
  inboxDecidedByKindSchema,
  inboxEventKindSchema,
  inboxEventReasonSchema,
  inboxIssueCodeSchema,
  inboxItemCountsSchema,
  inboxItemDetailSchema,
  inboxItemListEntrySchema,
  inboxItemListQuerySchema,
  inboxItemListResponseSchema,
  inboxItemStatusSchema,
  inboxPayloadKindSchema,
  inboxRoutingAutoPolicySchema,
  inboxRoutingDestinationSchema,
  inboxRoutingPartnerPolicySchema,
  inboxRouteConflictSchema,
  inboxRoutingTargetSchema,
  inboxRuleSchema,
  inboxSettingsSchema,
  issueInboxChannelCredentialResponseSchema,
  providerStepSchema,
  putInboxRoutingTargetRequestSchema,
  putInboxRuleOrderRequestSchema,
  routeInboxItemToDocumentRequestSchema,
  updateInboxRuleRequestSchema,
  updateInboxSettingsRequestSchema,
} from './contract.ts';

// The web mirror is hand-written, so every vocabulary is pinned to the database constants it copies.
describe('inbox contract enums', () => {
  it.each([
    ['channel kinds', inboxChannelKindSchema, inboxChannelKinds],
    ['payload kinds', inboxPayloadKindSchema, inboxPayloadKinds],
    ['item statuses', inboxItemStatusSchema, inboxItemStatuses],
    ['decided-by kinds', inboxDecidedByKindSchema, inboxDecidedByKinds],
    ['event kinds', inboxEventKindSchema, inboxEventKinds],
    ['event reasons', inboxEventReasonSchema, inboxEventReasons],
    [
      'routing destinations',
      inboxRoutingDestinationSchema,
      inboxRoutingDestinations,
    ],
    [
      'partner policies',
      inboxRoutingPartnerPolicySchema,
      inboxRoutingPartnerPolicies,
    ],
    ['auto policies', inboxRoutingAutoPolicySchema, inboxRoutingAutoPolicies],
    ['correction fields', inboxCorrectionFieldSchema, inboxCorrectionFields],
    ['correction sources', inboxCorrectionSourceSchema, inboxCorrectionSources],
  ])('mirrors the database %s', (_name, schema, expected) => {
    expect(schema.options).toEqual([...expected]);
  });

  it('names the automation reason and the rule provider step', () => {
    expect(inboxEventReasonSchema.options).toContain('rule_author_unavailable');
    expect(providerStepSchema.options).toContain('rule');
  });

  it('names the attached event and the probable duplicate issue', () => {
    expect(inboxEventKindSchema.options).toContain('attached');
    expect(inboxIssueCodeSchema.options).toContain('duplicate_probable');
    expect(inboxEventReasonSchema.options).not.toContain('duplicate_probable');
  });
});

const channel = {
  createdAt: '2026-09-17T08:00:00.000Z',
  credentials: [],
  emailAddress: null,
  enabled: true,
  hintKind: null,
  id: '00000000-0000-4000-8000-000000000060',
  itemCount: 0,
  kind: 'api',
  legalEntityId: null,
  name: 'Placeholder push',
  updatedAt: '2026-09-17T08:00:00.000Z',
};
const address = `in-${'a'.repeat(32)}@in.bap.localhost`;

// The channel row mirrors the API: the address is required, plain, and shaped like an intake address.
describe('inbox channel contract', () => {
  it('requires emailAddress on a channel and bounds its shape', () => {
    expect(inboxChannelSchema.safeParse(channel).success).toBe(true);
    expect(
      inboxChannelSchema.safeParse({
        ...channel,
        emailAddress: address,
        kind: 'email',
      }).success,
    ).toBe(true);
    const withoutAddress: Partial<typeof channel> = { ...channel };
    delete withoutAddress.emailAddress;
    expect(inboxChannelSchema.safeParse(withoutAddress).success).toBe(false);
    expect(
      inboxChannelSchema.safeParse({ ...channel, emailAddress: 'x@y' }).success,
    ).toBe(false);
  });

  it('creates api and email channels and reads an address as an issued secret', () => {
    for (const kind of ['api', 'email']) {
      expect(
        createInboxChannelRequestSchema.safeParse({ kind, name: 'n' }).success,
      ).toBe(true);
    }
    expect(
      createInboxChannelRequestSchema.safeParse({ kind: 'upload', name: 'n' })
        .success,
    ).toBe(false);
    expect(
      issueInboxChannelCredentialResponseSchema.safeParse({
        credentialId: channel.id,
        displayPrefix: 'aaaaaaaa',
        secret: address,
      }).success,
    ).toBe(true);
  });
});

const target = {
  auto: 'never',
  autoThreshold: null,
  defaultAssigneeId: null,
  defaultLegalEntityId: null,
  destination: 'documents',
  detectedType: 'pdf',
  documentKind: 'other',
  partnerPolicy: 'match_only',
  requiredFields: [],
  source: 'platform',
};
const targetBody = {
  auto: target.auto,
  autoThreshold: target.autoThreshold,
  defaultAssigneeId: target.defaultAssigneeId,
  defaultLegalEntityId: target.defaultLegalEntityId,
  destination: target.destination,
  documentKind: target.documentKind,
  partnerPolicy: target.partnerPolicy,
  requiredFields: target.requiredFields,
};

// The row checks are mirrored so the browser refuses what the database would.
describe('inbox routing target contract', () => {
  it('accepts an effective target and a full PUT body', () => {
    expect(inboxRoutingTargetSchema.safeParse(target).success).toBe(true);
    expect(
      putInboxRoutingTargetRequestSchema.safeParse(targetBody).success,
    ).toBe(true);
    expect(
      putInboxRoutingTargetRequestSchema.safeParse({
        ...targetBody,
        destination: 'discard',
        documentKind: null,
      }).success,
    ).toBe(true);
  });

  it('accepts a null destination on read but requires one on write', () => {
    expect(
      inboxRoutingTargetSchema.safeParse({
        ...target,
        destination: null,
        documentKind: null,
      }).success,
    ).toBe(true);
    expect(
      putInboxRoutingTargetRequestSchema.safeParse({
        ...targetBody,
        destination: null,
        documentKind: null,
      }).success,
    ).toBe(false);
  });

  it('bounds a required field to the API token pattern', () => {
    expect(
      putInboxRoutingTargetRequestSchema.safeParse({
        ...targetBody,
        requiredFields: ['title', 'due_date2'],
      }).success,
    ).toBe(true);
    expect(
      putInboxRoutingTargetRequestSchema.safeParse({
        ...targetBody,
        requiredFields: ['2title'],
      }).success,
    ).toBe(false);
    expect(
      putInboxRoutingTargetRequestSchema.safeParse({
        ...targetBody,
        requiredFields: ['bad-name'],
      }).success,
    ).toBe(false);
  });

  it('ties the document kind to the documents destination', () => {
    expect(
      putInboxRoutingTargetRequestSchema.safeParse({
        ...targetBody,
        documentKind: null,
      }).success,
    ).toBe(false);
    expect(
      putInboxRoutingTargetRequestSchema.safeParse({
        ...targetBody,
        destination: 'datasets',
      }).success,
    ).toBe(false);
  });

  it('requires a threshold for above_threshold and bounds the required fields', () => {
    expect(
      putInboxRoutingTargetRequestSchema.safeParse({
        ...targetBody,
        auto: 'above_threshold',
      }).success,
    ).toBe(false);
    expect(
      putInboxRoutingTargetRequestSchema.safeParse({
        ...targetBody,
        auto: 'above_threshold',
        autoThreshold: 0.8,
      }).success,
    ).toBe(true);
    expect(
      putInboxRoutingTargetRequestSchema.safeParse({
        ...targetBody,
        requiredFields: Array.from(
          { length: 33 },
          (_, index) => `f${String(index)}`,
        ),
      }).success,
    ).toBe(false);
    expect(
      putInboxRoutingTargetRequestSchema.safeParse({
        ...targetBody,
        source: 'organization',
      }).success,
    ).toBe(false);
  });
});

describe('inbox settings contract', () => {
  it('reads the quota triple and writes a positive or null quota', () => {
    expect(
      inboxSettingsSchema.safeParse({
        blobQuotaBytes: null,
        platformQuotaBytes: 1_000,
        usedBytes: 0,
      }).success,
    ).toBe(true);
    expect(
      updateInboxSettingsRequestSchema.safeParse({ blobQuotaBytes: null })
        .success,
    ).toBe(true);
    expect(
      updateInboxSettingsRequestSchema.safeParse({ blobQuotaBytes: 0 }).success,
    ).toBe(false);
    expect(
      updateInboxSettingsRequestSchema.safeParse({ blobQuotaBytes: 1.5 })
        .success,
    ).toBe(false);
  });
});

const RULE_ID = '00000000-0000-4000-8000-000000000080';
const ENTITY_ID = '00000000-0000-4000-8000-000000000081';
const BLOB_ID = '00000000-0000-4000-8000-000000000082';

const rule = {
  autoRoute: false,
  channelId: null,
  createdAt: '2026-09-17T08:00:00.000Z',
  createdBy: 'user_1',
  detectedType: null,
  discardReason: null,
  enabled: true,
  id: RULE_ID,
  keyword: null,
  name: 'Supplier mail',
  paused: false,
  priority: 1,
  senderPattern: '@dodavatel.cz',
  setAssigneeId: null,
  setDocumentKind: 'received_invoice',
  setLegalEntityId: ENTITY_ID,
  setPartnerId: null,
  updatedAt: '2026-09-17T08:00:00.000Z',
};
const ruleBody = {
  applyToExisting: false,
  autoRoute: rule.autoRoute,
  channelId: rule.channelId,
  detectedType: rule.detectedType,
  discardReason: rule.discardReason,
  enabled: true,
  keyword: rule.keyword,
  name: rule.name,
  senderPattern: rule.senderPattern,
  setAssigneeId: rule.setAssigneeId,
  setDocumentKind: rule.setDocumentKind,
  setLegalEntityId: rule.setLegalEntityId,
  setPartnerId: rule.setPartnerId,
};

// The row checks are mirrored so the browser refuses what the database would.
describe('inbox rule contract', () => {
  it('accepts a rule and a create body, lowercasing the sender pattern', () => {
    expect(inboxRuleSchema.safeParse(rule).success).toBe(true);
    const parsed = createInboxRuleRequestSchema.safeParse({
      ...ruleBody,
      senderPattern: 'Billing@Dodavatel.CZ',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.senderPattern).toBe('billing@dodavatel.cz');
  });

  it('requires one condition, one action, and keeps a discard rule alone', () => {
    expect(
      createInboxRuleRequestSchema.safeParse({
        ...ruleBody,
        senderPattern: null,
      }).success,
    ).toBe(false);
    expect(
      createInboxRuleRequestSchema.safeParse({
        ...ruleBody,
        setDocumentKind: null,
        setLegalEntityId: null,
      }).success,
    ).toBe(false);
    expect(
      createInboxRuleRequestSchema.safeParse({
        ...ruleBody,
        discardReason: 'spam',
      }).success,
    ).toBe(false);
    expect(
      createInboxRuleRequestSchema.safeParse({
        ...ruleBody,
        discardReason: 'spam',
        setDocumentKind: null,
        setLegalEntityId: null,
      }).success,
    ).toBe(true);
    expect(
      createInboxRuleRequestSchema.safeParse({
        ...ruleBody,
        senderPattern: 'not a pattern',
      }).success,
    ).toBe(false);
    expect(
      createInboxRuleRequestSchema.safeParse({
        ...ruleBody,
        senderPattern: null,
        keyword: 'Faktura',
      }).success,
    ).toBe(true);
  });

  it('patches any subset but never nothing, and orders distinct ids only', () => {
    expect(
      updateInboxRuleRequestSchema.safeParse({ enabled: false }).success,
    ).toBe(true);
    expect(updateInboxRuleRequestSchema.safeParse({}).success).toBe(false);
    expect(
      updateInboxRuleRequestSchema.safeParse({ applyToExisting: true }).success,
    ).toBe(false);
    expect(
      putInboxRuleOrderRequestSchema.safeParse({ ruleIds: [RULE_ID] }).success,
    ).toBe(true);
    expect(
      putInboxRuleOrderRequestSchema.safeParse({ ruleIds: [RULE_ID, RULE_ID] })
        .success,
    ).toBe(false);
    expect(
      putInboxRuleOrderRequestSchema.safeParse({ ruleIds: [] }).success,
    ).toBe(false);
  });
});

describe('inbox correction contract', () => {
  it('bounds the reasons to the correction fields and one line each', () => {
    expect(
      correctionReasonsSchema.safeParse({ kind: 'It is a contract.' }).success,
    ).toBe(true);
    expect(correctionReasonsSchema.safeParse({}).success).toBe(false);
    expect(correctionReasonsSchema.safeParse({ notes: 'x' }).success).toBe(
      false,
    );
    expect(
      correctionReasonsSchema.safeParse({ title: 'x'.repeat(501) }).success,
    ).toBe(false);
  });

  it('routes with optional reasons beside the draft', () => {
    const body = {
      document: {
        currencyCode: 'CZK',
        documentDate: '2026-09-01',
        kind: 'contract',
        legalEntityId: ENTITY_ID,
        title: 'Placeholder contract',
      },
      fileBlobIds: [BLOB_ID],
    };
    expect(routeInboxItemToDocumentRequestSchema.safeParse(body).success).toBe(
      true,
    );
    expect(
      routeInboxItemToDocumentRequestSchema.safeParse({
        ...body,
        correctionReasons: { legal_entity_id: 'Wrong entity.' },
      }).success,
    ).toBe(true);
    expect(
      routeInboxItemToDocumentRequestSchema.safeParse({
        ...body,
        correctionReasons: { legalEntityId: 'Wrong entity.' },
      }).success,
    ).toBe(false);
  });
});

// The two 409 bodies a route can answer, the bulk body, and the three list filters.
describe('inbox action contracts', () => {
  it('reads both route conflicts by code and nothing else', () => {
    expect(
      inboxRouteConflictSchema.safeParse({
        code: 'reference_conflict',
        documentId: ENTITY_ID,
      }).success,
    ).toBe(true);
    expect(
      inboxRouteConflictSchema.safeParse({
        candidates: [
          {
            documentDate: '2026-09-01',
            id: ENTITY_ID,
            reference: null,
            totalAmount: '10.0000',
          },
        ],
        code: 'duplicate_probable',
      }).success,
    ).toBe(true);
    expect(
      inboxRouteConflictSchema.safeParse({
        candidates: [],
        code: 'duplicate_probable',
      }).success,
    ).toBe(false);
    expect(
      inboxRouteConflictSchema.safeParse({ code: 'blob_quarantined' }).success,
    ).toBe(false);
  });

  it('routes with the version and acknowledgement ids beside the draft', () => {
    const parsed = routeInboxItemToDocumentRequestSchema.safeParse({
      acknowledgeDuplicateOf: ENTITY_ID,
      document: {
        currencyCode: 'CZK',
        documentDate: '2026-09-01',
        kind: 'contract',
        legalEntityId: ENTITY_ID,
        title: 'Placeholder contract',
      },
      fileBlobIds: [BLOB_ID],
      supersedesDocumentId: ENTITY_ID,
    });
    expect(parsed.success).toBe(true);
  });

  it('requires the field of the bulk action, refuses the others, and caps the ids', () => {
    const ids = [BLOB_ID];
    expect(
      bulkInboxItemsRequestSchema.safeParse({ action: 'approve', itemIds: ids })
        .success,
    ).toBe(true);
    expect(
      bulkInboxItemsRequestSchema.safeParse({
        action: 'discard',
        itemIds: ids,
        reason: 'spam',
      }).success,
    ).toBe(true);
    expect(
      bulkInboxItemsRequestSchema.safeParse({ action: 'discard', itemIds: ids })
        .success,
    ).toBe(false);
    expect(
      bulkInboxItemsRequestSchema.safeParse({
        action: 'approve',
        itemIds: ids,
        snoozedUntil: '2026-09-20T00:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      bulkInboxItemsRequestSchema.safeParse({
        action: 'approve',
        itemIds: [BLOB_ID, BLOB_ID],
      }).success,
    ).toBe(false);
    expect(
      bulkInboxItemsRequestSchema.safeParse({
        action: 'approve',
        itemIds: Array.from(
          { length: 101 },
          (_, index) =>
            `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        ),
      }).success,
    ).toBe(false);
  });

  it('filters the list by issue, assignee and confidence band', () => {
    const parsed = inboxItemListQuerySchema.safeParse({
      assigneeId: 'none',
      confidence: 'high',
      issue: 'reference_conflict',
    });
    expect(parsed.success).toBe(true);
    expect(
      inboxItemListQuerySchema.safeParse({ confidence: 'unknown' }).success,
    ).toBe(true);
    expect(
      inboxItemListQuerySchema.safeParse({ confidence: 'bogus' }).success,
    ).toBe(false);
  });

  it('drops future-snoozed items only for snoozed=exclude', () => {
    expect(
      inboxItemListQuerySchema.safeParse({ snoozed: 'exclude' }).success,
    ).toBe(true);
    expect(
      inboxItemListQuerySchema.safeParse({ snoozed: 'include' }).success,
    ).toBe(false);
  });
});

const ITEM_ID = '00000000-0000-4000-8000-000000000090';
const baseItem = {
  assigneeId: null,
  channelId: null,
  channelKind: 'upload',
  confidence: null,
  createdAt: '2026-09-20T08:00:00.000Z',
  datasetId: null,
  decidedByKind: null,
  decidedByRuleId: null,
  decidedByUserId: null,
  detectedType: null,
  documentId: null,
  duplicateOfItemId: null,
  hintKind: null,
  hintLegalEntityId: null,
  hintLinkDocumentId: null,
  hintPartnerId: null,
  hintText: null,
  humanTouched: false,
  id: ITEM_ID,
  legalEntityId: null,
  origin: null,
  partnerId: null,
  payloadKind: 'file',
  receivedAt: '2026-09-20T08:00:00.000Z',
  routedAt: null,
  snoozedUntil: null,
  status: 'needs_review',
  updatedAt: '2026-09-20T08:00:00.000Z',
};

// The additive list and detail fields the page lanes code against.
describe('inbox list counts, sender and deciding rule name', () => {
  it('carries the sender and the deciding rule name on a list entry', () => {
    expect(
      inboxItemListEntrySchema.safeParse({
        ...baseItem,
        decidedByRuleName: 'Fio statements',
        fileCount: 2,
        primaryFilename: 'statement.pdf',
        sender: 'billing@dodavatel.cz',
        senderAuthenticated: false,
      }).success,
    ).toBe(true);
    expect(
      inboxItemListEntrySchema.safeParse({
        ...baseItem,
        decidedByRuleName: null,
        fileCount: 1,
        primaryFilename: null,
        sender: null,
        senderAuthenticated: false,
      }).success,
    ).toBe(true);
  });

  it('requires the tab counts on the list response', () => {
    const counts = { all: 5, discarded: 1, filed: 2, toReview: 2 };
    expect(inboxItemCountsSchema.safeParse(counts).success).toBe(true);
    expect(
      inboxItemCountsSchema.safeParse({ ...counts, toReview: -1 }).success,
    ).toBe(false);
    expect(
      inboxItemListResponseSchema.safeParse({
        counts,
        items: [],
        page: 1,
        pageSize: 25,
        total: 0,
      }).success,
    ).toBe(true);
    expect(
      inboxItemListResponseSchema.safeParse({
        items: [],
        page: 1,
        pageSize: 25,
        total: 0,
      }).success,
    ).toBe(false);
  });

  it('carries the deciding rule name on the detail item', () => {
    const detail = {
      corrections: [],
      events: [],
      extraction: null,
      files: [],
      item: {
        ...baseItem,
        decidedByRuleName: 'Fio statements',
        sender: null,
        senderAuthenticated: false,
      },
      routingTarget: {
        auto: 'never',
        autoThreshold: null,
        defaultAssigneeId: null,
        defaultLegalEntityId: null,
        destination: 'documents',
        detectedType: 'pdf',
        documentKind: 'other',
        partnerPolicy: 'match_only',
        requiredFields: [],
        source: 'platform',
      },
    };
    expect(inboxItemDetailSchema.safeParse(detail).success).toBe(true);
    const withoutRuleName: Record<string, unknown> = { ...detail.item };
    delete withoutRuleName.decidedByRuleName;
    expect(
      inboxItemDetailSchema.safeParse({ ...detail, item: withoutRuleName })
        .success,
    ).toBe(false);
  });
});
