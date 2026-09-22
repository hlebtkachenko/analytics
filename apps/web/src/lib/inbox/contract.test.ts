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
  inboxChannelKindSchema,
  inboxDecidedByKindSchema,
  inboxEventKindSchema,
  inboxEventReasonSchema,
  inboxItemStatusSchema,
  inboxPayloadKindSchema,
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
