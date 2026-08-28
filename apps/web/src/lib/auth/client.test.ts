import { describe, expect, it } from 'vitest';

import { authClient } from './client.js';

describe('authClient', () => {
  it('can initialize during server rendering with a same-origin path', () => {
    expect(authClient).toBeDefined();
  });
});
