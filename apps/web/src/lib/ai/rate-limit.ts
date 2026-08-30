export type ChatRateLimitDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false; retryAfterSeconds: number }>;

export interface ChatRateLimitOptions {
  limit: number;
  maxEntries: number;
  windowMs: number;
}

interface SubjectWindow {
  count: number;
  resetAt: number;
}

// Mirrors SubjectRateLimiter in @bap/security, which apps/web must not import.
export class ChatRateLimiter {
  private readonly entries = new Map<string, SubjectWindow>();
  private readonly limit: number;
  private readonly maxEntries: number;
  private readonly windowMs: number;

  constructor(options: ChatRateLimitOptions) {
    this.limit = options.limit;
    this.maxEntries = options.maxEntries;
    this.windowMs = options.windowMs;
  }

  check(subject: string, now = Date.now()): ChatRateLimitDecision {
    this.prune(now);

    const existing = this.entries.get(subject);

    if (existing !== undefined) {
      if (existing.count >= this.limit) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((existing.resetAt - now) / 1000),
          ),
        };
      }

      existing.count += 1;
      return { allowed: true };
    }

    // A full table is a full table for everyone, so an unknown subject waits too.
    if (this.entries.size >= this.maxEntries) {
      let earliestReset = Number.POSITIVE_INFINITY;
      for (const entry of this.entries.values()) {
        earliestReset = Math.min(earliestReset, entry.resetAt);
      }

      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((earliestReset - now) / 1000)),
      };
    }

    this.entries.set(subject, { count: 1, resetAt: now + this.windowMs });
    return { allowed: true };
  }

  private prune(now: number): void {
    for (const [subject, entry] of this.entries) {
      if (entry.resetAt <= now) {
        this.entries.delete(subject);
      }
    }
  }
}
