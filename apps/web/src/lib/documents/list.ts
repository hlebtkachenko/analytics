import type { DocumentStatus } from './contract.ts';

// Each list tab maps to a status filter and a count in the list response.
export type DocumentTab = 'all' | 'archived' | 'needsReview' | 'verified';

export const documentTabs: readonly DocumentTab[] = [
  'all',
  'needsReview',
  'verified',
  'archived',
];

// All names no status, keeping the contract default that hides superseded versions.
export const documentTabStatuses: Readonly<
  Record<DocumentTab, readonly DocumentStatus[] | undefined>
> = {
  all: undefined,
  archived: ['archived'],
  needsReview: ['needs_review'],
  verified: ['verified'],
};

// The counts key each tab reads from the list response.
export type DocumentCountKey =
  'all' | 'archived' | 'needsReview' | 'verified' | 'withIssues';

export const documentTabCountKeys: Readonly<
  Record<DocumentTab, DocumentCountKey>
> = {
  all: 'all',
  archived: 'archived',
  needsReview: 'needsReview',
  verified: 'verified',
};

export const documentTabLabelKeys: Readonly<Record<DocumentTab, string>> = {
  all: 'documents.list.tabAll',
  archived: 'documents.list.tabArchived',
  needsReview: 'documents.list.tabNeedsReview',
  verified: 'documents.list.tabVerified',
};

export function isDocumentTab(value: string | null): value is DocumentTab {
  return value !== null && (documentTabs as readonly string[]).includes(value);
}

// Chosen entities are a URL CSV of ids; empty means every entity in scope.
export function storedEntities(value: string | null): string[] {
  return value === null || value.length === 0 ? [] : value.split(',');
}
