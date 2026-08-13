import 'server-only';

import { getVoximplantConfig } from '@/lib/data/voximplant-config';
import { getAccountInfo } from '@/lib/voximplant/core';
import { normalizeAccountInfo } from '@/lib/validation/vox-payloads';

// Short-TTL, per-process cache for the ADMIN DASHBOARD's Voximplant balance
// tile (getVoiceBalanceTile in voice-ops.ts — shown on /admin/voice AND
// /admin/voice/platform). Investigated 13.8 while chasing a "destination
// stream closed early" render error: that specific error turned out to be
// page-agnostic React/Next streaming noise (confirmed against ops_errors —
// it also fired on /admin/campaigns; that page, admin/layout.tsx's softphone
// block, and console-calls.ts's flag readers were checked and are all plain
// DB reads with no Voximplant call), so it is NOT what this cache fixes.
// What IS a real defect, found in the same investigation: getVoiceBalanceTile()
// called the Voximplant Management API's GetAccountInfo LIVE, inline, on
// every render — including every background RSC prefetch the admin sidebar's
// <Link href="/admin/voice"> generates on EVERY OTHER admin page (Next
// prefetches sidebar links by default, and AdminShell mounts that sidebar
// across the whole /admin subtree). That made an external HTTP round trip —
// with a 10-second worst-case timeout — part of the render path for admin
// pages that have nothing to do with voice, for a number nobody was
// necessarily looking at.
//
// Same idiom as voximplant-balance-cache.ts's inbound-gate cache (module-level
// value + in-flight-promise coalescing + a short hard timeout + a stale-grace
// window), deliberately NOT sharing that module: this is a dashboard-display
// concern with a different consumer (an admin's browser, not the call-answer
// hot path) and a different shape (currency + callback echo, not just a
// reserve boolean) — keeping it separate avoids touching the
// call-safety-critical inbound gate.
//
// A slightly-stale balance is fine here — this is dashboard *display*, not a
// dial gate (the actual do-not-dial reserve check stays live via the inbound
// gate's own cache). HARD_TIMEOUT_MS reuses voximplant-balance-cache.ts's
// documented bound for a caller-waiting path rather than inventing a new one.

const CACHE_TTL_MS = 60_000;
const HARD_TIMEOUT_MS = 2_500;
// A refresh failure returns the existing cache rather than null (one missed
// tick must not flip the tile to "unavailable"), but only up to this age —
// past it, a stale number silently displayed as current is worse than an
// honest "unavailable", exactly as voximplant-balance-cache.ts's own
// STALE_GRACE_MS argues. Same value; no reason to diverge.
const STALE_GRACE_MS = 5 * 60_000;

export interface CachedAccountInfo {
  balance: number | null; // null = GetAccountInfo returned an unparseable balance
  currency: string | null;
  callbackUrl: string | null;
  fetchedAtMs: number;
}

let cache: CachedAccountInfo | null = null;
// Coalesces concurrent refreshes (several admins loading /admin/voice within
// the same cold-cache window) into one Management API call instead of many.
let inFlight: Promise<CachedAccountInfo | null> | null = null;

async function fetchFresh(): Promise<CachedAccountInfo | null> {
  const cfg = await getVoximplantConfig();
  if (!cfg) return null; // channel not configured — nothing to check against
  try {
    const info = normalizeAccountInfo(
      await getAccountInfo(cfg.auth, HARD_TIMEOUT_MS, { returnLiveBalance: true }),
    );
    return {
      balance: info.balance,
      currency: info.currency,
      callbackUrl: info.callbackUrl,
      fetchedAtMs: Date.now(),
    };
  } catch {
    return null; // transient — caller falls back to any existing cache below
  }
}

/**
 * Cached GetAccountInfo for the admin dashboard balance tile. Never throws —
 * resolves to null on a cold cache with no successful fetch, or once an
 * existing cache ages past the stale-grace window with no successful
 * refresh, exactly like the un-cached call's try/catch resolved to
 * 'unavailable' for the caller. A refresh failure within the grace window
 * returns the existing (slightly stale) cache instead. `nowMs` is injectable
 * for tests.
 */
export async function getCachedAccountInfo(
  nowMs: number = Date.now(),
): Promise<CachedAccountInfo | null> {
  const fresh = cache !== null && nowMs - cache.fetchedAtMs < CACHE_TTL_MS;
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
      // — read as 'unavailable' by the caller, same as before this cache existed.
      return null;
    }
    // else: refresh failed but the existing cache is within the grace
    // window — fall through and use it.
  }
  return cache;
}

/** Test-only: reset module state between tests. */
export function __resetVoiceBalanceCacheForTests(): void {
  cache = null;
  inFlight = null;
}
