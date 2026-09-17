// @vitest-environment node

import {
  inboxChannelKinds,
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
  createInboxChannelRequestSchema,
  inboxChannelKindSchema,
  inboxChannelSchema,
  inboxDecidedByKindSchema,
  inboxEventKindSchema,
  inboxEventReasonSchema,
  inboxItemStatusSchema,
  inboxPayloadKindSchema,
  inboxRoutingAutoPolicySchema,
  inboxRoutingDestinationSchema,
  inboxRoutingPartnerPolicySchema,
  inboxRoutingTargetSchema,
  inboxSettingsSchema,
  issueInboxChannelCredentialResponseSchema,
  putInboxRoutingTargetRequestSchema,
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
  ])('mirrors the database %s', (_name, schema, expected) => {
    expect(schema.options).toEqual([...expected]);
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
  updatedAt: null,
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
