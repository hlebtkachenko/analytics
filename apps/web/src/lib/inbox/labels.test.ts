import { describe, expect, it } from 'vitest';

import { inboxTabQuery, inboxTabs, isInboxTab } from './labels.ts';

describe('inbox tabs', () => {
  it('maps each tab to its status filter and hides snoozed items on To review only', () => {
    expect(inboxTabQuery('toReview').toString()).toBe(
      'status=needs_review%2Creceived%2Cprocessing%2Cfailed&snoozed=exclude',
    );
    expect(inboxTabQuery('filed').toString()).toBe('status=routed');
    expect(inboxTabQuery('discarded').toString()).toBe('status=discarded');
    expect(inboxTabQuery('all').toString()).toBe('');
  });

  it('accepts only a known tab from the URL', () => {
    expect(inboxTabs.every((tab) => isInboxTab(tab))).toBe(true);
    expect(isInboxTab('routed')).toBe(false);
    expect(isInboxTab(null)).toBe(false);
  });
});
