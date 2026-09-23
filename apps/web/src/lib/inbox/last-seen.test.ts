import { describe, expect, it } from 'vitest';

import { inboxLastSeenKey, isNewSince } from './last-seen.ts';

describe('inboxLastSeenKey', () => {
  it('namespaces the baseline by organization', () => {
    expect(inboxLastSeenKey('org_1')).toBe('bap.inbox.lastSeen.org_1');
  });
});

describe('isNewSince', () => {
  it('marks nothing when no baseline is stored yet', () => {
    expect(isNewSince(null, '2026-09-21T10:00:00.000Z')).toBe(false);
  });

  it('marks an item received after the baseline', () => {
    expect(
      isNewSince('2026-09-21T09:00:00.000Z', '2026-09-21T10:00:00.000Z'),
    ).toBe(true);
  });

  it('leaves an item received before or at the baseline unmarked', () => {
    expect(
      isNewSince('2026-09-21T10:00:00.000Z', '2026-09-21T09:00:00.000Z'),
    ).toBe(false);
    expect(
      isNewSince('2026-09-21T10:00:00.000Z', '2026-09-21T10:00:00.000Z'),
    ).toBe(false);
  });

  it('treats an unparseable value as not new', () => {
    expect(isNewSince('not-a-date', '2026-09-21T10:00:00.000Z')).toBe(false);
    expect(isNewSince('2026-09-21T10:00:00.000Z', 'not-a-date')).toBe(false);
  });
});
