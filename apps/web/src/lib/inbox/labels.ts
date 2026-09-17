import type { StatusTagType } from '../documents/labels.ts';
import type {
  InboxDiscardReason,
  InboxItemStatus,
  InboxRoutingAutoPolicy,
  InboxRoutingDestination,
} from './contract.ts';

// One translation key per contract value, so no page invents its own wording.
export const inboxStatusLabelKeys: Readonly<Record<InboxItemStatus, string>> = {
  discarded: 'inbox.statusDiscarded',
  failed: 'inbox.statusFailed',
  needs_review: 'inbox.statusNeedsReview',
  processing: 'inbox.statusProcessing',
  received: 'inbox.statusReceived',
  routed: 'inbox.statusRouted',
};

export const inboxStatusTagTypes: Readonly<
  Record<InboxItemStatus, StatusTagType | 'red'>
> = {
  discarded: 'cool-gray',
  failed: 'red',
  needs_review: 'blue',
  processing: 'gray',
  received: 'gray',
  routed: 'green',
};

export const inboxDiscardReasonLabelKeys: Readonly<
  Record<InboxDiscardReason, string>
> = {
  duplicate: 'inbox.discardReasonDuplicate',
  irrelevant: 'inbox.discardReasonIrrelevant',
  not_ours: 'inbox.discardReasonNotOurs',
  spam: 'inbox.discardReasonSpam',
};

export const inboxRoutingDestinationLabelKeys: Readonly<
  Record<InboxRoutingDestination, string>
> = {
  datasets: 'inboxSettings.destinationDatasets',
  discard: 'inboxSettings.destinationDiscard',
  documents: 'inboxSettings.destinationDocuments',
};

// The platform default for some detected types names no destination yet.
export const inboxRoutingDestinationNoneLabelKey =
  'inboxSettings.destinationNone';

export const inboxRoutingAutoLabelKeys: Readonly<
  Record<InboxRoutingAutoPolicy, string>
> = {
  above_threshold: 'inboxSettings.autoAboveThreshold',
  always: 'inboxSettings.autoAlways',
  never: 'inboxSettings.autoNever',
};

export const inboxDecidedByLabelKeys: Readonly<Record<string, string>> = {
  hint: 'inbox.decidedByHint',
  provider: 'inbox.decidedByProvider',
  rule: 'inbox.decidedByRule',
  target_default: 'inbox.decidedByTargetDefault',
  user: 'inbox.decidedByUser',
};

// The status sets behind each quick filter; the open view hides what is already settled.
export const inboxStatusFilters = {
  all: ['received', 'processing', 'needs_review', 'failed'],
  discarded: ['discarded'],
  needs_review: ['needs_review'],
  routed: ['routed'],
  unprocessed: ['received', 'processing', 'failed'],
} as const satisfies Record<string, readonly InboxItemStatus[]>;

export type InboxStatusFilter = keyof typeof inboxStatusFilters;

export const inboxStatusFilterLabelKeys: Readonly<
  Record<InboxStatusFilter, string>
> = {
  all: 'inbox.filterAll',
  discarded: 'inbox.filterDiscarded',
  needs_review: 'inbox.filterNeedsReview',
  routed: 'inbox.filterRouted',
  unprocessed: 'inbox.filterUnprocessed',
};
