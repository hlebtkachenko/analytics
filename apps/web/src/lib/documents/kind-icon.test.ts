import { describe, expect, it } from 'vitest';

import { Document, Receipt } from '@bap/design-system/icons';

import { documentKindSchema } from './contract.ts';
import { DOCUMENT_KIND_ICONS, documentKindIcon } from './kind-icon.ts';

describe('documentKindIcon', () => {
  it('maps every document kind to an icon', () => {
    for (const kind of documentKindSchema.options) {
      expect(DOCUMENT_KIND_ICONS[kind]).toBeDefined();
    }
  });

  it('maps issued_invoice to Receipt', () => {
    expect(documentKindIcon('issued_invoice')).toBe(Receipt);
  });

  it('falls back to Document for an unknown kind', () => {
    expect(documentKindIcon('unknown' as never)).toBe(Document);
  });
});
