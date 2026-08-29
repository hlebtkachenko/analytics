import { describe, expect, it } from 'vitest';

import { SubjectRateLimiter } from './subject-rate-limiter.js';

describe('SubjectRateLimiter', () => {
  it('tracks independent fixed windows and enforces the exact threshold', () => {
    const limiter = new SubjectRateLimiter({
      limit: 2,
      maxEntries: 2,
      windowMs: 10_000,
    });

    expect(limiter.check('first', 1_000)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
    expect(limiter.check('second', 1_000)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
    expect(limiter.check('first', 2_000)).toMatchObject({
      allowed: true,
      remaining: 0,
    });
    expect(limiter.check('first', 3_000)).toEqual({
      allowed: false,
      reason: 'limit',
      retryAfterSeconds: 8,
    });
  });

  it('resets and removes expired subjects before admitting new ones', () => {
    const limiter = new SubjectRateLimiter({
      limit: 1,
      maxEntries: 1,
      windowMs: 1_000,
    });

    limiter.check('expired', 1_000);
    expect(limiter.check('new', 2_000)).toMatchObject({ allowed: true });
    expect(limiter.size).toBe(1);
  });

  it('fails closed at capacity without evicting an active subject', () => {
    const limiter = new SubjectRateLimiter({
      limit: 2,
      maxEntries: 1,
      windowMs: 10_000,
    });

    limiter.check('active', 1_000);
    expect(limiter.check('new', 2_000)).toEqual({
      allowed: false,
      reason: 'capacity',
      retryAfterSeconds: 9,
    });
    expect(limiter.check('active', 2_000)).toMatchObject({
      allowed: true,
      remaining: 0,
    });
  });
});
