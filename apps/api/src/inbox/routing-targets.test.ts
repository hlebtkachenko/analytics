import { describe, expect, it } from 'vitest';

import { DOCUMENT_KINDS } from '../documents/contract.js';
import { DETECTED_TYPES } from './contract.js';
import {
  ROUTING_TARGET_DEFAULTS,
  routingTargetFor,
} from './routing-targets.js';

describe('routing target defaults', () => {
  it('covers every detected type and never auto-routes', () => {
    expect(Object.keys(ROUTING_TARGET_DEFAULTS).sort()).toEqual(
      [...DETECTED_TYPES].sort(),
    );

    for (const target of Object.values(ROUTING_TARGET_DEFAULTS)) {
      expect(target.auto).toBe('never');
      if (target.documentKind !== null) {
        expect(target.destination).toBe('documents');
        expect(DOCUMENT_KINDS).toContain(target.documentKind);
      }
    }
  });

  it('answers a hint the sniff cannot name with the unknown default', () => {
    expect(routingTargetFor('payroll_sheet')).toEqual(
      ROUTING_TARGET_DEFAULTS.unknown,
    );
    expect(routingTargetFor(null)).toEqual(ROUTING_TARGET_DEFAULTS.unknown);
    expect(routingTargetFor('isdoc_invoice').documentKind).toBe(
      'received_invoice',
    );
  });
});
