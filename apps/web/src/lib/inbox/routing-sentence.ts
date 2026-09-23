import type { TFunction } from 'i18next';

import { isInvoiceKind } from '../documents/contract.ts';
import { documentKindLabelKeys } from '../documents/labels.ts';
import { INBOX_DETECTED_TYPES } from './contract.ts';
import type { InboxDetectedType, InboxRoutingTarget } from './contract.ts';

// Entity names are undefined until the list has loaded, so a pending read never names a hidden entity.
export type RoutingSentenceContext = Readonly<{
  entityNames: ReadonlyMap<string, string> | undefined;
  locale: string;
}>;

const prefix = 'inboxRules.defaults';

function knownType(detectedType: string): InboxDetectedType {
  return (
    INBOX_DETECTED_TYPES.find((type) => type === detectedType) ?? 'unknown'
  );
}

// The subject of a sentence: "A PDF" to open it, "a PDF" inside another sentence.
export function routingSubject(
  detectedType: string,
  position: 'mid' | 'start',
  t: TFunction,
): string {
  const group = position === 'start' ? 'subjectStart' : 'subject';
  return t(`${prefix}.${group}.${knownType(detectedType)}`);
}

function destinationClause(
  target: InboxRoutingTarget,
  context: RoutingSentenceContext,
  t: TFunction,
): string {
  const subject = routingSubject(target.detectedType, 'start', t);
  const destination =
    target.destination === 'documents'
      ? target.documentKind === null
        ? t(`${prefix}.goesToDocumentsAnyKind`, { subject })
        : t(`${prefix}.goesToDocuments`, {
            kind: t(documentKindLabelKeys[target.documentKind]),
            subject,
          })
      : target.destination === 'datasets'
        ? t(`${prefix}.goesToDatasets`, { subject })
        : t(`${prefix}.isDiscarded`, { subject });
  if (
    target.defaultLegalEntityId === null ||
    context.entityNames === undefined
  ) {
    return destination;
  }
  const entity = context.entityNames.get(target.defaultLegalEntityId);
  return (
    destination +
    (entity === undefined
      ? t(`${prefix}.forHiddenEntity`)
      : t(`${prefix}.forEntity`, { entity }))
  );
}

// Mirrors the destination and invoice-kind conditions of the worker's auto-route decision.
function confirmationClause(
  target: InboxRoutingTarget,
  locale: string,
  t: TFunction,
): string {
  // Only above threshold reads a threshold, and without one the worker never asks, the same as never.
  const threshold =
    target.auto === 'above_threshold' ? target.autoThreshold : null;
  if (target.auto !== 'always' && threshold === null) {
    return t(`${prefix}.confirmEvery`);
  }
  if (target.destination !== 'documents') {
    return t(`${prefix}.confirmDocumentsOnly`);
  }
  if (target.documentKind !== null && isInvoiceKind(target.documentKind)) {
    return t(`${prefix}.confirmInvoiceChecks`);
  }
  // Past the first check only always is left without a threshold.
  if (threshold === null) {
    return t(`${prefix}.confirmNone`);
  }
  const percent = new Intl.NumberFormat(locale, { style: 'percent' }).format(
    threshold,
  );
  return t(`${prefix}.confirmAboveThreshold`, { percent });
}

// One sentence per routing target, joined from whole translated clauses; required fields and the assignee stay out.
export function routingTargetSentence(
  target: InboxRoutingTarget,
  context: RoutingSentenceContext,
  t: TFunction,
): string {
  if (target.destination === null) {
    return `${t(`${prefix}.waits`, {
      subject: routingSubject(target.detectedType, 'start', t),
    })}.`;
  }
  return `${[
    destinationClause(target, context, t),
    confirmationClause(target, context.locale, t),
  ].join('; ')}.`;
}
