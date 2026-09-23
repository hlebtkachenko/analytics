import type { StatusSeverity } from '../../components/status-indicator.tsx';

import type {
  InboxBulkAction,
  InboxBulkRefusalCode,
  InboxConfidenceBand,
  InboxCorrectionField,
  InboxCorrectionSource,
  InboxDiscardReason,
  InboxIssueCode,
  InboxItemListEntry,
  InboxItemStatus,
  InboxRoutingAutoPolicy,
  InboxRoutingDestination,
} from './contract.ts';
import {
  INBOX_TO_REVIEW_STATUSES,
  inboxChannelKindSchema,
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

// The status indicator severity this column renders, the same indicator documents use.
export const inboxStatusSeverity: Readonly<
  Record<InboxItemStatus, StatusSeverity>
> = {
  discarded: 'neutral',
  failed: 'error',
  needs_review: 'warning',
  processing: 'neutral',
  received: 'neutral',
  routed: 'success',
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

export const inboxCorrectionFieldLabelKeys: Readonly<
  Record<InboxCorrectionField, string>
> = {
  currency_code: 'inbox.draftCurrency',
  document_date: 'inbox.draftDate',
  kind: 'inbox.draftKind',
  legal_entity_id: 'inbox.draftEntity',
  partner_id: 'inbox.draftPartner',
  reference: 'inbox.draftReference',
  title: 'inbox.draftTitleField',
};

export const inboxCorrectionSourceLabelKeys: Readonly<
  Record<InboxCorrectionSource, string>
> = {
  hint: 'inbox.decidedByHint',
  provider: 'inbox.decidedByProvider',
  rule: 'inbox.decidedByRule',
  target_default: 'inbox.decidedByTargetDefault',
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

export const inboxConfidenceBandLabelKeys: Readonly<
  Record<InboxConfidenceBand, string>
> = {
  high: 'inbox.confidenceHigh',
  low: 'inbox.confidenceLow',
  medium: 'inbox.confidenceMedium',
  unknown: 'inbox.confidenceUnknown',
};

export const inboxBulkActionLabelKeys: Readonly<
  Record<InboxBulkAction, string>
> = {
  approve: 'inbox.bulkApprove',
  assign: 'inbox.bulkAssign',
  discard: 'inbox.bulkDiscard',
  snooze: 'inbox.bulkSnooze',
};

export const inboxBulkRefusalCodeLabelKeys: Readonly<
  Record<InboxBulkRefusalCode, string>
> = {
  duplicate_probable: 'inbox.bulkRefusalDuplicateProbable',
  invalid: 'inbox.bulkRefusalInvalid',
  missing_required_field: 'inbox.bulkRefusalMissingRequiredField',
  not_found: 'inbox.bulkRefusalNotFound',
  not_open: 'inbox.bulkRefusalNotOpen',
  reference_conflict: 'inbox.bulkRefusalReferenceConflict',
};

// The state colour of a row: settled by a route or a discard, touched by a person, or untouched so far.
export type InboxItemState = 'discarded' | 'routed' | 'touched' | 'untouched';

export function inboxItemState(entry: InboxItemListEntry): InboxItemState {
  if (entry.status === 'routed' || entry.status === 'discarded') {
    return entry.status;
  }
  return entry.humanTouched ? 'touched' : 'untouched';
}

export const inboxItemStateLabelKeys: Readonly<Record<InboxItemState, string>> =
  {
    discarded: 'inbox.stateDiscarded',
    routed: 'inbox.stateRouted',
    touched: 'inbox.stateTouched',
    untouched: 'inbox.stateUntouched',
  };

export const inboxItemStateSeverity: Readonly<
  Record<InboxItemState, StatusSeverity>
> = {
  discarded: 'neutral',
  routed: 'success',
  touched: 'neutral',
  untouched: 'neutral',
};

// The four list tabs in display order; the item page walks the neighbours of the one the user came from.
export const inboxTabs = ['toReview', 'filed', 'discarded', 'all'] as const;
export type InboxTab = (typeof inboxTabs)[number];

export function isInboxTab(value: string | null): value is InboxTab {
  return value !== null && (inboxTabs as readonly string[]).includes(value);
}

// The list filter behind a tab: its status set, and To review also hides snoozed items; All names neither.
export function inboxTabQuery(tab: InboxTab): URLSearchParams {
  const query = new URLSearchParams();
  if (tab === 'toReview') {
    query.set('status', INBOX_TO_REVIEW_STATUSES.join(','));
    query.set('snoozed', 'exclude');
  } else if (tab === 'filed') {
    query.set('status', 'routed');
  } else if (tab === 'discarded') {
    query.set('status', 'discarded');
  }
  return query;
}

// The status word shown in the list, with a synthetic "snoozed" the enum has no code for.
export type InboxListStatusWord = InboxItemStatus | 'snoozed';

// The list uses "Filed" for routed and "Held" for received, distinct from the detail wording.
export const inboxListStatusLabelKeys: Readonly<
  Record<InboxListStatusWord, string>
> = {
  discarded: 'inbox.list.statusDiscarded',
  failed: 'inbox.list.statusFailed',
  needs_review: 'inbox.list.statusNeedsReview',
  processing: 'inbox.list.statusProcessing',
  received: 'inbox.list.statusHeld',
  routed: 'inbox.list.statusFiled',
  snoozed: 'inbox.list.statusSnoozed',
};

type InboxChannelKind = (typeof inboxChannelKindSchema.options)[number];

// One word per source, so a channel kind code never reaches the screen.
export const inboxSourceLabelKeys: Readonly<Record<InboxChannelKind, string>> =
  {
    api: 'inbox.list.sourceApi',
    bank_api: 'inbox.list.sourceBankApi',
    bank_file: 'inbox.list.sourceBankFile',
    drive: 'inbox.list.sourceDrive',
    email: 'inbox.list.sourceEmail',
    fakturoid: 'inbox.list.sourceFakturoid',
    idoklad: 'inbox.list.sourceIdoklad',
    isdoc: 'inbox.list.sourceIsdoc',
    isds: 'inbox.list.sourceIsds',
    mcp: 'inbox.list.sourceMcp',
    money_s3: 'inbox.list.sourceMoneyS3',
    pohoda: 'inbox.list.sourcePohoda',
    upload: 'inbox.list.sourceUpload',
  };

// One sentence per extraction issue code, so the item page never renders a raw code.
export const inboxIssueCodeLabelKeys: Readonly<Record<InboxIssueCode, string>> =
  {
    amount_mismatch: 'inbox.item.issueAmountMismatch',
    decorative_image: 'inbox.item.issueDecorativeImage',
    duplicate_exact: 'inbox.item.issueDuplicateExact',
    duplicate_probable: 'inbox.item.issueDuplicateProbable',
    empty: 'inbox.item.issueEmpty',
    encrypted: 'inbox.item.issueEncrypted',
    entity_conflict: 'inbox.item.issueEntityConflict',
    entity_unresolved: 'inbox.item.missingEntity',
    missing_required_field: 'inbox.item.issueMissingRequiredField',
    password_protected: 'inbox.item.issuePasswordProtected',
    policy_rejected: 'inbox.item.issuePolicyRejected',
    reference_conflict: 'inbox.item.issueReferenceConflict',
    too_large: 'inbox.item.issueTooLarge',
    unknown_partner: 'inbox.item.issueUnknownPartner',
    unreadable: 'inbox.item.issueUnreadable',
    unsupported_type: 'inbox.item.issueUnsupportedType',
    vat_mismatch: 'inbox.item.issueVatMismatch',
  };

// One sentence per event kind, resolved with the actor name in the activity list.
export const inboxEventKindLabelKeys: Readonly<Record<string, string>> = {
  assigned: 'inbox.activity.assigned',
  attached: 'inbox.activity.attached',
  classified: 'inbox.activity.classified',
  discarded: 'inbox.activity.discarded',
  extracted: 'inbox.activity.extracted',
  failed: 'inbox.activity.failed',
  hint_added: 'inbox.activity.hintAdded',
  received: 'inbox.activity.received',
  reopened: 'inbox.activity.reopened',
  restored: 'inbox.activity.restored',
  routed: 'inbox.activity.routedBy',
  rule_matched: 'inbox.activity.ruleMatched',
  scanned: 'inbox.activity.scanned',
  unrouted: 'inbox.activity.reopened',
};

// One word or sentence per event reason, so a reason code never reaches the screen.
export const inboxEventReasonLabelKeys: Readonly<Record<string, string>> = {
  decorative_image: 'inbox.item.reasonDecorativeImage',
  duplicate: 'inbox.discardReasonDuplicate',
  empty: 'inbox.item.reasonEmpty',
  encrypted: 'inbox.item.reasonEncrypted',
  irrelevant: 'inbox.discardReasonIrrelevant',
  not_ours: 'inbox.discardReasonNotOurs',
  password_protected: 'inbox.item.reasonPasswordProtected',
  policy_rejected: 'inbox.item.reasonPolicyRejected',
  rule_author_unavailable: 'inbox.item.reasonRuleAuthorUnavailable',
  spam: 'inbox.discardReasonSpam',
  stalled: 'inbox.item.reasonStalled',
  too_large: 'inbox.item.reasonTooLarge',
  unreadable: 'inbox.item.reasonUnreadable',
  unsupported_type: 'inbox.item.reasonUnsupportedType',
};
