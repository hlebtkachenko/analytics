// @vitest-environment node

import {
  inboxChannelKinds,
  inboxDecidedByKinds,
  inboxEventKinds,
  inboxEventReasons,
  inboxItemStatuses,
  inboxPayloadKinds,
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
  issueInboxChannelCredentialResponseSchema,
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
