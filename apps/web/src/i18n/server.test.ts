import { describe, expect, it } from 'vitest';

import { translate } from './server.js';

describe('translations', () => {
  it('returns shipped auth copy', async () => {
    await expect(translate('auth.signIn')).resolves.toBe('Sign in');
  });

  it('fails on a missing key', async () => {
    await expect(translate('auth.missing')).rejects.toThrow(
      'Missing translation',
    );
  });
});
