import { ZodError } from 'zod';
import { describe, expect, it } from 'vitest';

import { providerOutputSchema } from '../contract.js';
import { manualProvider } from './manual.js';

const ENTITY_ID = '4a2b7c1e-9f5d-4c3a-8b21-6e0f7d5a4c39';

describe('manualProvider', () => {
  it('returns the validated draft with full confidence and a manual reason', () => {
    const { document, output } = manualProvider({
      documentDate: '2026-09-14',
      kind: 'contract',
      legalEntityId: ENTITY_ID,
      title: 'Placeholder contract',
    });

    expect(document.currencyCode).toBe('CZK');
    expect(providerOutputSchema.parse(output)).toEqual(output);
    expect(output).toMatchObject({
      confidence: 1,
      detectedType: 'contract',
      issues: [],
      legalEntityId: ENTITY_ID,
      reasons: [{ step: 'manual', weight: 1 }],
    });
    expect(output.fieldConfidences).toEqual({
      currencyCode: 1,
      documentDate: 1,
      kind: 1,
      legalEntityId: 1,
      title: 1,
    });
  });

  it('refuses a draft outside the documents create contract', () => {
    expect(() =>
      manualProvider({
        documentDate: '2026-09-14',
        kind: 'issued_invoice',
        legalEntityId: ENTITY_ID,
        title: 'Missing invoice content',
      }),
    ).toThrow(ZodError);
  });
});
