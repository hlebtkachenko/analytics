import { describe, expect, it } from 'vitest';

import { resources } from '../../i18n/resources';
import {
  inboxRoutingDestinationLabelKeys,
  inboxRoutingDestinationNoneLabelKey,
  inboxTabQuery,
  inboxTabs,
  isInboxTab,
} from './labels.ts';

function translation(key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, segment) => (node as Record<string, unknown>)[segment],
      resources['en-US'].translation,
    );
}

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

describe('routing destination labels', () => {
  it('keep the words the item page routing sentence renders', () => {
    expect(
      Object.values(inboxRoutingDestinationLabelKeys).map(translation),
    ).toEqual(['Datasets', 'Discard', 'Documents']);
    expect(translation(inboxRoutingDestinationNoneLabelKey)).toBe(
      'No destination',
    );
  });
});
