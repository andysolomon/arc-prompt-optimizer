import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { ServerEnv } from "@/lib/env";

export const RATE_LIMIT_RUNS = 10;
export const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export interface RateLimitResult {
  readonly success: boolean;
  readonly remaining: number;
  /** Epoch milliseconds when the window resets. */
  readonly reset: number;
}

export interface RateLimiter {
  limit(key: string): Promise<RateLimitResult>;
}

/** Sliding window kept in process memory. Per-instance only; used when no Upstash/KV credentials are set. */
export class MemoryRateLimiter implements RateLimiter {
  readonly #hits = new Map<string, number[]>();
  readonly #max: number;
  readonly #windowMs: number;
  readonly #now: () => number;

  constructor(max = RATE_LIMIT_RUNS, windowMs = RATE_LIMIT_WINDOW_MS, now: () => number = Date.now) {
    this.#max = max;
    this.#windowMs = windowMs;
    this.#now = now;
  }

  async limit(key: string): Promise<RateLimitResult> {
    const now = this.#now();
    const recent = (this.#hits.get(key) ?? []).filter((at) => now - at < this.#windowMs);
    if (recent.length >= this.#max) {
      this.#hits.set(key, recent);
      return { success: false, remaining: 0, reset: recent[0]! + this.#windowMs };
    }
    recent.push(now);
    this.#hits.set(key, recent);
    if (this.#hits.size > 10_000) this.#hits.clear();
    return { success: true, remaining: this.#max - recent.length, reset: recent[0]! + this.#windowMs };
  }
}

const cached = new Map<string, RateLimiter>();

export function rateLimiterFor(env: ServerEnv, scope: "optimize" | "categorize" = "optimize"): RateLimiter {
  const previous = cached.get(scope);
  if (previous) return previous;
  let limiter: RateLimiter;
  if (env.UPSTASH_REDIS_REST_URL !== undefined && env.UPSTASH_REDIS_REST_TOKEN !== undefined) {
    const upstash = new Ratelimit({
      redis: new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }),
      limiter: Ratelimit.slidingWindow(RATE_LIMIT_RUNS, "10 m"),
      prefix: `arc-prompt-optimizer:${scope}`,
      analytics: false,
    });
    limiter = {
      async limit(key) {
        const result = await upstash.limit(key);
        return { success: result.success, remaining: result.remaining, reset: result.reset };
      },
    };
  } else {
    limiter = new MemoryRateLimiter();
  }
  cached.set(scope, limiter);
  return limiter;
}

export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

export function rateLimitMessage(result: RateLimitResult, action = "runs"): string {
  const minutes = Math.max(1, Math.ceil((result.reset - Date.now()) / 60_000));
  return `Rate limit reached: ${RATE_LIMIT_RUNS} ${action} per 10 minutes per IP. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}
