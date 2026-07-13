// Dependency-free, in-memory rate limiting and client-IP extraction.
//
// IMPORTANT: the counter state lives in a module-level Map and is therefore
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

interface WindowState {
  count: number;
  resetAt: number;
}

const windows = new Map<string, WindowState>();

/**
 * Extract the client IP from a header getter.
 *
 * Pure by design: callers pass a getter so this is trivially testable and free
 * of any Next.js coupling. Pass a BOUND getter — `Headers.get` is `this`-aware
 * and throws if extracted unbound, so use
 *   `const h = await headers(); getClientIp((name) => h.get(name));`
 * (or `h.get.bind(h)`), not `getClientIp((await headers()).get)`. Prefers the first
 * comma-separated value of `x-forwarded-for`, falls back to `x-real-ip`, then
 * to the sentinel `'unknown'`. (Next 16 removed `NextRequest.ip`/`geo`, so the
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
export function rateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const { limit, windowMs } = opts;
  const now = Date.now();

  pruneExpired(now);

  const existing = windows.get(key);

  // No window yet, or the previous window has expired: start a fresh one.
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    windows.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: Math.max(0, limit - 1), resetAt };
  }

  // Within an active window.
  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
  };
}

/**
 * Opportunistically drop expired entries so the Map does not grow unbounded
 * as new keys (e.g. distinct client IPs) are seen over time.
 */
function pruneExpired(now: number): void {
  for (const [key, state] of windows) {
    if (state.resetAt <= now) {
      windows.delete(key);
    }
  }
}

/**
 * Test-only: clear all rate-limit windows so a test suite starts from a clean
 * slate (the window Map is module-level and otherwise persists across tests).
 */
export function __resetRateLimitStateForTests(): void {
  windows.clear();
}
