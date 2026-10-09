import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';

// Library-backed, per-process rate limiting and client-IP extraction.
//
// IMPORTANT: the counter state lives in RateLimiterMemory and is therefore
// PER-PROCESS. Under pm2 cluster mode (or any multi-instance deployment) each
// worker keeps its own counts, so the effective limit is multiplied by the
// number of instances and resets on restart/redeploy. This is acceptable as a
// first line of defense against accidental floods, but a shared store
// (Postgres or Redis) is the production upgrade for accurate, durable limits.

export interface RateLimitOptions {
  /** Maximum number of allowed requests within the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  /** Whether this request is permitted. */
  allowed: boolean;
  /** Requests remaining in the current window (never negative). */
  remaining: number;
  /** Epoch milliseconds at which the current window resets. */
  resetAt: number;
}

const limiters = new Map<string, RateLimiterMemory>();

/**
 * Extract the client IP from a header getter.
 *
 * Pure by design: callers pass a getter so this is trivially testable and free
 * of any Next.js coupling. Pass a BOUND getter — `Headers.get` is `this`-aware
 * and throws if extracted unbound, so use
 *   `const h = await headers(); getClientIp((name) => h.get(name));`
 * (or `h.get.bind(h)`), not `getClientIp((await headers()).get)`. Prefers the first
 * comma-separated value of `x-forwarded-for`, falls back to `x-real-ip`, then
 * to the sentinel `'unknown'`. (Next 15 removed `NextRequest.ip`/`geo`, so the
 * client IP must come from the proxy headers nginx forwards.)
 */
export function getClientIp(get: (name: string) => string | null): string {
  const forwardedFor = get('x-forwarded-for');
  if (forwardedFor) {
    // `x-forwarded-for` is a comma-separated chain; the first entry is the
    // original client. Guard against empty/whitespace-only segments.
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) {
      return first;
    }
  }

  const realIp = get('x-real-ip')?.trim();
  if (realIp) {
    return realIp;
  }

  return 'unknown';
}

/**
 * Fixed-window rate limiter.
 *
 * Counts requests per `key` within a window of `windowMs`. The first request in
 * a fresh window opens it; subsequent requests increment the count until the
 * window expires, after which it resets. Returns whether the request is allowed
 * along with the remaining quota and the reset time.
 */
export async function rateLimit(
  key: string,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const { limit, windowMs } = opts;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    !Number.isFinite(windowMs) ||
    windowMs <= 0
  ) {
    throw new RangeError('Invalid rate-limit policy');
  }
  // Policies are static call-site configuration, never request input.
  const policy = `${limit}:${windowMs}`;
  let limiter = limiters.get(policy);
  if (!limiter) {
    limiter = new RateLimiterMemory({
      points: limit,
      duration: windowMs / 1000,
      keyPrefix: policy,
    });
    limiters.set(policy, limiter);
  }
  const now = Date.now();
  let result: RateLimiterRes;
  let allowed = true;
  try {
    result = await limiter.consume(key);
  } catch (error) {
    // Only a quota rejection is a denied request; unexpected errors propagate.
    if (!(error instanceof RateLimiterRes)) throw error;
    result = error;
    allowed = false;
  }
  return {
    allowed,
    remaining: result.remainingPoints,
    resetAt: now + result.msBeforeNext,
  };
}

/** Clear counters and their expiry timers between tests. */
export function __resetRateLimitStateForTests(): void {
  for (const limiter of limiters.values()) {
    for (const entry of limiter.dump().storage) void limiter.delete(entry.key);
  }
  limiters.clear();
}
