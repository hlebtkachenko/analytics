import { DETECTED_TYPES } from './contract.js';
import type {
  InboxRoutingTarget,
  InboxRoutingTargetFields,
} from './contract.js';

export type DetectedType = (typeof DETECTED_TYPES)[number];

export type RoutingTarget = InboxRoutingTargetFields;

// The organization rows keyed by detected type; a missing key means the platform default.
export type RoutingTargetOverrides = Partial<
  Record<DetectedType, RoutingTarget>
>;

const NO_AUTOMATION = {
  auto: 'never',
  autoThreshold: null,
  defaultAssigneeId: null,
  defaultLegalEntityId: null,
  partnerPolicy: 'match_only',
  requiredFields: [],
} as const satisfies Partial<RoutingTarget>;

// The platform default for every type: nothing auto-routes until an organization opts in through its own row.
export const ROUTING_TARGET_DEFAULTS: Readonly<
  Record<DetectedType, RoutingTarget>
> = {
  camt_statement: {
    ...NO_AUTOMATION,
    destination: 'documents',
    documentKind: 'bank_statement',
  },
  gpc_statement: {
    ...NO_AUTOMATION,
    destination: 'documents',
    documentKind: 'bank_statement',
  },
  image: { ...NO_AUTOMATION, destination: 'documents', documentKind: 'other' },
  isdoc_invoice: {
    ...NO_AUTOMATION,
    destination: 'documents',
    documentKind: 'received_invoice',
  },
  money_s3_export: { ...NO_AUTOMATION, destination: null, documentKind: null },
  pdf: { ...NO_AUTOMATION, destination: 'documents', documentKind: 'other' },
  pohoda_export: { ...NO_AUTOMATION, destination: null, documentKind: null },
  tabular: { ...NO_AUTOMATION, destination: 'datasets', documentKind: null },
  text: { ...NO_AUTOMATION, destination: 'documents', documentKind: 'other' },
  unknown: { ...NO_AUTOMATION, destination: null, documentKind: null },
};

export function knownDetectedType(detectedType: string | null): DetectedType {
  return DETECTED_TYPES.find((type) => type === detectedType) ?? 'unknown';
}

// The effective target: the organization row when present, else the platform constant; a foreign hint is unknown.
export function routingTargetFor(
  detectedType: string | null,
  overrides: RoutingTargetOverrides = {},
): InboxRoutingTarget {
  const known = knownDetectedType(detectedType);
  const override = overrides[known];

  return override === undefined
    ? {
        ...ROUTING_TARGET_DEFAULTS[known],
        detectedType: known,
        source: 'platform',
      }
    : { ...override, detectedType: known, source: 'organization' };
}
