import 'server-only';
import { cache } from 'react';

import { createAdminClient } from '@/lib/supabase/admin';

// Public-site reader for the ONE thing the marketing layout needs to know
// about call-me-now: whether to mount the floating widget at all.
//
// Why not call console-calls.ts's consoleCallMeNowEnabled() directly from
// the layout: this runs on EVERY anonymous marketing page render, and that
// function is a bare per-call DB round trip (correct for the API route, which
// must never serve a stale flag when it is about to place a real PSTN call).
// A marketing page has the opposite trade-off — a few seconds of staleness on
// a widget's visibility costs nothing, an extra DB round trip per visitor
// costs real latency. So this mirrors admin-config.ts's proven two-layer
// shape exactly: a module-level TTL cache (survives across requests in this
// process) plus React `cache()` (dedupes within a single request).
//
// SERVICE-ROLE client for the same reason getCookieConsentPublicConfig uses
// one: this runs for anonymous visitors with no session, and app_settings is
// admin-only under RLS. Nothing read here is a secret — it is one boolean.
//
// FAILS CLOSED (unlike the consent config, which fails open to baseline):
// on any read error the widget stays hidden. A hidden widget is invisible to
// the visitor; a widget shown while the backend is unhealthy would collect a
// phone number and an SMS OTP and then refuse — the "empty promise" failure
// mode this project has already had to fix once (NO_AGENT_LINE_HE promising
// a callback that no row was ever written for).
//
// NOTE this is only the MOUNT gate. It is not an authorization gate and is
// deliberately not the only check: /api/call-me-now/verify re-reads the flag
// itself (uncached) alongside consent, availability, caps and the routing-rule
// id before anything dials. Someone POSTing the API directly with the widget
// hidden still gets refused there.
const CACHE_TTL_MS = 20_000;
let processCache: { value: boolean; at: number } | null = null;

export const getCallMeNowWidgetEnabled = cache(async (): Promise<boolean> => {
  const now = Date.now();
  if (processCache && now - processCache.at < CACHE_TTL_MS) return processCache.value;

  let enabled = false;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('app_settings')
      .select('console_call_me_now_enabled, voximplant_call_me_now_rule_id')
      .eq('id', true)
      .maybeSingle();
    // BOTH conditions, not just the flag: without a bound routing rule the
    // verify route refuses structurally (its /^\d+$/ guard), so showing the
    // widget then would again be a form that always fails. The two pieces of
    // config that make the feature real are the same two that make it
    // visible.
    if (!error && data) {
      enabled =
        data.console_call_me_now_enabled === true &&
        /^\d+$/.test(String(data.voximplant_call_me_now_rule_id ?? ''));
    }
  } catch {
    enabled = false;
  }

  processCache = { value: enabled, at: now };
  return enabled;
});
