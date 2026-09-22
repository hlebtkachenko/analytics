import type { DocumentKind } from '../documents/contract.js';
import { DETECTED_TYPES } from './contract.js';

export const ROUTING_AUTO_MODES = [
  'never',
  'above_threshold',
  'always',
] as const;

export interface RoutingTarget {
  auto: (typeof ROUTING_AUTO_MODES)[number];
  destination: 'documents' | 'datasets' | null;
  documentKind: DocumentKind | null;
}

// The platform default for every type: nothing auto-routes until an organization opts in, which arrives in Phase 1.
export const ROUTING_TARGET_DEFAULTS: Readonly<
  Record<(typeof DETECTED_TYPES)[number], RoutingTarget>
> = {
  camt_statement: {
    auto: 'never',
    destination: 'documents',
    documentKind: 'bank_statement',
  },
  gpc_statement: {
    auto: 'never',
    destination: 'documents',
    documentKind: 'bank_statement',
  },
  image: { auto: 'never', destination: 'documents', documentKind: 'other' },
  isdoc_invoice: {
    auto: 'never',
    destination: 'documents',
    documentKind: 'received_invoice',
  },
  money_s3_export: { auto: 'never', destination: null, documentKind: null },
  pdf: { auto: 'never', destination: 'documents', documentKind: 'other' },
  pohoda_export: { auto: 'never', destination: null, documentKind: null },
  tabular: { auto: 'never', destination: 'datasets', documentKind: null },
  text: { auto: 'never', destination: 'documents', documentKind: 'other' },
  unknown: { auto: 'never', destination: null, documentKind: null },
};

export function routingTargetFor(detectedType: string | null): RoutingTarget {
  const known = DETECTED_TYPES.find((type) => type === detectedType);
  return ROUTING_TARGET_DEFAULTS[known ?? 'unknown'];
}
