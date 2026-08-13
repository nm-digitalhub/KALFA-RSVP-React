import 'server-only';

import { getVoximplantConfig } from '@/lib/data/voximplant-config';
import { getAccountInfo } from '@/lib/voximplant/core';

// A per-process, short-TTL balance cache for the inbound gate-before-answer
// endpoint ONLY. Exists because that endpoint sits on the call-answer hot
// path (the caller is waiting on the response), so it must never await the
// Voximplant Management API inline and unbounded — but the account also has
// no PERSISTED balance column anywhere (voximplant-balance.ts's 30-minute
// runBalanceCheck() only Slack-alerts; it never writes a number to the DB),
// and that job runs in the pg-boss WORKER process, not this Next.js server —
// a module-level cache there is invisible here regardless.
//
// Tradeoff, made explicit: this DOES call the Management API inline
// occasionally (on a cold cache or after the TTL expires), but bounded by a
// short hard timeout so a slow/unreachable API can only ever cost the caller
// ~2.5s, and amortized by the TTL so a burst of inbound calls shares one
// fetch. A failed/timed-out refresh with NO prior cache is treated as
// "balance unknown" — fail-closed, refuse — consistent with the plan-wide
// rule that an unknown gate condition blocks rather than passes.
//
// Known limitation (flagged, not fixed here — would need a migration, out of
// scope for this delegation): a real persisted balance value (written by the
// existing 30-minute job or the B5 verified-pull) would let this become a
// pure DB read with zero inline Management-API risk. Left as an open item.

const CACHE_TTL_MS = 60_000;
const HARD_TIMEOUT_MS = 2_500;
// If a refresh fails, a cache this stale is still trusted rather than
// treated as unknown — a single missed refresh (API blip) must not flip
// every inbound call to fail-closed for a full TTL cycle. Beyond this, an
// unrefreshable cache is as good as no cache.
const STALE_GRACE_MS = 5 * 60_000;

interface CachedBalance {
  balanceUsd: number;
  minCallReserveUsd: number;
  fetchedAtMs: number;
}

let cache: CachedBalance | null = null;
// Coalesces concurrent refreshes (e.g. two inbound calls landing within the
// same cold-cache window) into one Management API call instead of two.
let inFlight: Promise<CachedBalance | null> | null = null;

async function fetchFresh(): Promise<CachedBalance | null> {
  const cfg = await getVoximplantConfig();
  if (!cfg) return null; // channel not configured — nothing to check against
  try {
    const info = await getAccountInfo(cfg.auth, HARD_TIMEOUT_MS);
    return {
      balanceUsd: info.result.balance,
      minCallReserveUsd: cfg.minCallReserve,
      fetchedAtMs: Date.now(),
    };
  } catch {
    return null; // transient — caller decides what a miss means
  }
}

export type BalanceReserveCheck =
  | { ok: true }
  | { ok: false; reason: 'below_reserve' | 'unknown' };

/**
 * Pre-answer balance-reserve check for the inbound gate. Never throws.
 * `nowMs` is injectable for tests.
 */
export async function checkInboundBalanceReserve(
  nowMs: number = Date.now(),
): Promise<BalanceReserveCheck> {
  const fresh = cache && nowMs - cache.fetchedAtMs < CACHE_TTL_MS;
  if (!fresh) {
    if (!inFlight) {
      inFlight = fetchFresh().finally(() => {
        inFlight = null;
      });
    }
    const result = await inFlight;
    if (result) {
      cache = result;
    } else if (!cache || nowMs - cache.fetchedAtMs > STALE_GRACE_MS) {
      // No usable cache at all (cold start, or stale past the grace window)
      // → fail closed.
      return { ok: false, reason: 'unknown' };
    }
    // else: refresh failed but the existing cache is within the grace
    // window — fall through and use it.
  }
  const current = cache;
  if (!current) return { ok: false, reason: 'unknown' };
  if (current.balanceUsd < current.minCallReserveUsd) {
    return { ok: false, reason: 'below_reserve' };
  }
  return { ok: true };
}

/** Test-only: reset module state between tests. */
export function __resetBalanceCacheForTests(): void {
  cache = null;
  inFlight = null;
}
