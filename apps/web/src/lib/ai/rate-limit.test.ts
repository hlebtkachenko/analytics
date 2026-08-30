import { describe, expect, it } from 'vitest';

import { ChatRateLimiter } from './rate-limit.ts';

const options = { limit: 2, maxEntries: 2, windowMs: 60_000 };

describe('ChatRateLimiter', () => {
  it('refuses a subject past the limit and reopens after the window', () => {
    const limiter = new ChatRateLimiter(options);

    expect(limiter.check('user_1', 1_000).allowed).toBe(true);
    expect(limiter.check('user_1', 1_500).allowed).toBe(true);

    const refused = limiter.check('user_1', 2_000);

    expect(refused).toEqual({ allowed: false, retryAfterSeconds: 59 });
    expect(limiter.check('user_1', 61_001).allowed).toBe(true);
  });

  it('refuses an unknown subject while the table is full', () => {
    const limiter = new ChatRateLimiter(options);

    expect(limiter.check('user_1', 1_000).allowed).toBe(true);
    expect(limiter.check('user_2', 1_000).allowed).toBe(true);

    expect(limiter.check('user_3', 1_000)).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
  });
});
