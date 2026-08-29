import { DATABASE_MIGRATION_COMPATIBILITY } from '@bap/db/access';
import { describe, expect, it, vi } from 'vitest';

import { checkReadiness } from './readiness';

describe('checkReadiness', () => {
  it('requires the exact reviewed migration compatibility identifier', async () => {
    const compatible = {
      query: vi.fn().mockResolvedValue({
        rows: [{ version: DATABASE_MIGRATION_COMPATIBILITY }],
      }),
    };
    const outdated = {
      query: vi.fn().mockResolvedValue({ rows: [{ version: 'outdated' }] }),
    };

    await expect(checkReadiness(compatible as never)).resolves.toBe(true);
    await expect(checkReadiness(outdated as never)).resolves.toBe(false);
  });
});
