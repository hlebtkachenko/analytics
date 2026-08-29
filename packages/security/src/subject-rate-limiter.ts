import { z } from 'zod';

const limiterOptionsSchema = z
  .object({
    limit: z.number().int().positive(),
    maxEntries: z.number().int().positive(),
    windowMs: z.number().int().positive(),
  })
  .strict();

export type RateLimitDecision =
  | Readonly<{
      allowed: true;
      remaining: number;
      resetAt: number;
    }>
  | Readonly<{
      allowed: false;
      reason: 'capacity' | 'limit';
      retryAfterSeconds: number;
    }>;

interface SubjectWindow {
  count: number;
  resetAt: number;
}

export class SubjectRateLimiter {
  private readonly entries = new Map<string, SubjectWindow>();
  private readonly limit: number;
  private readonly maxEntries: number;
  private readonly windowMs: number;

  constructor(options: {
    limit: number;
    maxEntries: number;
    windowMs: number;
  }) {
    const configuration = limiterOptionsSchema.parse(options);
    this.limit = configuration.limit;
    this.maxEntries = configuration.maxEntries;
    this.windowMs = configuration.windowMs;
  }

  check(subject: string, now = Date.now()): RateLimitDecision {
    this.prune(now);

    const existing = this.entries.get(subject);

    if (existing !== undefined) {
      if (existing.count >= this.limit) {
        return {
          allowed: false,
          reason: 'limit',
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((existing.resetAt - now) / 1000),
          ),
        };
      }

      existing.count += 1;
      return {
        allowed: true,
        remaining: this.limit - existing.count,
        resetAt: existing.resetAt,
      };
    }

    if (this.entries.size >= this.maxEntries) {
      let earliestReset = Number.POSITIVE_INFINITY;
      for (const entry of this.entries.values()) {
        earliestReset = Math.min(earliestReset, entry.resetAt);
      }

      return {
        allowed: false,
        reason: 'capacity',
        retryAfterSeconds: Math.max(1, Math.ceil((earliestReset - now) / 1000)),
      };
    }

    const resetAt = now + this.windowMs;
    this.entries.set(subject, { count: 1, resetAt });
    return {
      allowed: true,
      remaining: this.limit - 1,
      resetAt,
    };
  }

  get size(): number {
    return this.entries.size;
  }

  get maximum(): number {
    return this.limit;
  }

  private prune(now: number): void {
    for (const [subject, entry] of this.entries) {
      if (entry.resetAt <= now) {
        this.entries.delete(subject);
      }
    }
  }
}
