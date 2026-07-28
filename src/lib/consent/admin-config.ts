import 'server-only';
import { cache } from 'react';

import { createAdminClient } from '@/lib/supabase/admin';
import { BASELINE_ADMIN_CONFIG, type CookieConsentAdminConfig } from './cookie-consent-config';

// Public-facing reader of the admin-managed cookie-consent config
// (app_settings singleton). Consumed by src/app/layout.tsx (master switch —
// whether CookieConsent.run() is called at all) and every layout that mounts
// GoogleAnalyticsGated. Read via the SERVICE-ROLE client because this runs
// for ANONYMOUS visitors who have no session (app_settings RLS is
// admin-only — see app_settings_admin_all). Nothing read here is a secret or
// a per-visitor consent choice (that stays local-only, see
// docs/consent/cookie-consent.md).
//
// FAIL-OPEN TO BASELINE, not fail-closed: on any read error we resolve to
// BASELINE_ADMIN_CONFIG (mechanism ON, both categories offered, no extra
// revision bump) — exactly today's shipped behavior. A transient DB hiccup
// must not silently blank out the consent notice for a first-time visitor;
// GoogleAnalyticsGated still requires an actual category grant via the
// rendered banner either way, so this fallback never causes untracked
// measurement. Contrast with src/lib/data/alerts-config.ts, which fails to
// fully-DISABLED — right for an operational nice-to-have (Slack alerts), not
// for a legally-required consent mechanism whose absence has its own
// consequences. See plans/cookie-consent-admin-control.md §6.1.
//
// Two cache layers: a module-level TTL cache (mirrors alerts-config.ts,
// survives across requests within this process) PLUS React's `cache()`
// (dedupes the DB round trip WITHIN one request — root layout and the
// (site)/customer-app layouts that mount GoogleAnalyticsGated all call this).
const CACHE_TTL_MS = 20_000;
let processCache: { value: CookieConsentAdminConfig; at: number } | null = null;

export const getCookieConsentPublicConfig = cache(
  async (): Promise<CookieConsentAdminConfig> => {
    const now = Date.now();
    if (processCache && now - processCache.at < CACHE_TTL_MS) return processCache.value;

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from('app_settings')
        .select(
          'cookie_consent_enabled, cookie_consent_analytics_enabled, cookie_consent_marketing_enabled, cookie_consent_revision_bump',
        )
        .eq('id', true)
        .maybeSingle();
      if (error || !data) return BASELINE_ADMIN_CONFIG; // do NOT cache a failure — allow recovery

      const row = data;
      const value: CookieConsentAdminConfig = {
        enabled: row.cookie_consent_enabled !== false,
        analyticsEnabled: row.cookie_consent_analytics_enabled !== false,
        marketingEnabled: row.cookie_consent_marketing_enabled !== false,
        revisionBump:
          typeof row.cookie_consent_revision_bump === 'number'
            ? row.cookie_consent_revision_bump
            : 0,
      };
      processCache = { value, at: now };
      return value;
    } catch {
      return BASELINE_ADMIN_CONFIG;
    }
  },
);

/** Test-only: clear the in-process cache so each test starts clean. */
export function __resetCookieConsentPublicConfigCacheForTests(): void {
  processCache = null;
}
