import { describe, expect, it } from 'vitest';

import { DOCUMENT_KINDS } from '../documents/contract.js';
import {
  DETECTED_TYPES,
  inboxRoutingTargetSchema,
  putInboxRoutingTargetRequestSchema,
} from './contract.js';
import {
  ROUTING_TARGET_DEFAULTS,
  routingTargetFor,
  type RoutingTarget,
} from './routing-targets.js';

const override: RoutingTarget = {
  auto: 'above_threshold',
  autoThreshold: 0.9,
  defaultAssigneeId: 'user_2',
  defaultLegalEntityId: '4a2b7c1e-9f5d-4c3a-8b21-6e0f7d5a4c39',
  destination: 'documents',
  documentKind: 'contract',
  partnerPolicy: 'match_only',
  requiredFields: ['documentDate', 'legalEntityId'],
};

describe('routing target defaults', () => {
  it('covers every detected type and never auto-routes', () => {
    expect(Object.keys(ROUTING_TARGET_DEFAULTS).sort()).toEqual(
      [...DETECTED_TYPES].sort(),
    );

    for (const target of Object.values(ROUTING_TARGET_DEFAULTS)) {
      expect(target).toMatchObject({
        auto: 'never',
        autoThreshold: null,
        defaultAssigneeId: null,
        defaultLegalEntityId: null,
        partnerPolicy: 'match_only',
        requiredFields: [],
      });
      expect(target.documentKind !== null).toBe(
        target.destination === 'documents',
      );
      if (target.documentKind !== null) {
        expect(DOCUMENT_KINDS).toContain(target.documentKind);
      }
    }
  });

  it('answers a hint the sniff cannot name with the unknown default', () => {
    expect(routingTargetFor('payroll_sheet')).toEqual({
      ...ROUTING_TARGET_DEFAULTS.unknown,
      detectedType: 'unknown',
      source: 'platform',
    });
    expect(routingTargetFor(null).detectedType).toBe('unknown');
    expect(routingTargetFor('isdoc_invoice')).toMatchObject({
      documentKind: 'received_invoice',
      source: 'platform',
    });
  });

  it('merges one organization row over the constant and leaves every other type alone', () => {
    const overrides = { pdf: override };

    expect(routingTargetFor('pdf', overrides)).toEqual({
      ...override,
      detectedType: 'pdf',
      source: 'organization',
    });
    expect(routingTargetFor('text', overrides)).toEqual({
      ...ROUTING_TARGET_DEFAULTS.text,
      detectedType: 'text',
      source: 'platform',
    });
    // A hint outside the list never picks up the pdf row: it resolves to unknown first.
    expect(routingTargetFor('pdf_scan', overrides).source).toBe('platform');
    expect(
      DETECTED_TYPES.map((type) => routingTargetFor(type, overrides)).every(
        (target) => inboxRoutingTargetSchema.safeParse(target).success,
      ),
    ).toBe(true);
  });
});

describe('putInboxRoutingTargetRequestSchema', () => {
  it('accepts a full target and refuses a partial one', () => {
    expect(putInboxRoutingTargetRequestSchema.safeParse(override).success).toBe(
      true,
    );
    const partial: Partial<RoutingTarget> = { ...override };
    delete partial.requiredFields;
    expect(putInboxRoutingTargetRequestSchema.safeParse(partial).success).toBe(
      false,
    );
  });

  it('requires a threshold for above_threshold and a kind exactly for documents', () => {
    expect(
      putInboxRoutingTargetRequestSchema.safeParse({
        ...override,
        autoThreshold: null,
      }).success,
    ).toBe(false);
    expect(
      putInboxRoutingTargetRequestSchema.safeParse({
        ...override,
        auto: 'never',
        autoThreshold: null,
      }).success,
    ).toBe(true);
    expect(
      putInboxRoutingTargetRequestSchema.safeParse({
        ...override,
        destination: 'datasets',
      }).success,
    ).toBe(false);
    expect(
      putInboxRoutingTargetRequestSchema.safeParse({
        ...override,
        destination: 'discard',
        documentKind: null,
      }).success,
    ).toBe(true);
    expect(
      putInboxRoutingTargetRequestSchema.safeParse({
        ...override,
        destination: null,
        documentKind: null,
      }).success,
    ).toBe(false);
  });

  it('caps the required fields at thirty-two identifiers', () => {
    const fields = Array.from({ length: 33 }, (_, index) => `field_${index}`);
    expect(
      putInboxRoutingTargetRequestSchema.safeParse({
        ...override,
        requiredFields: fields,
      }).success,
    ).toBe(false);
    expect(
      putInboxRoutingTargetRequestSchema.safeParse({
        ...override,
        requiredFields: fields.slice(0, 32),
      }).success,
    ).toBe(true);
    expect(
      putInboxRoutingTargetRequestSchema.safeParse({
        ...override,
        requiredFields: ['not a field'],
      }).success,
    ).toBe(false);
  });
});
