import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { connection } from 'next/server';

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
// Cached by Next (docs: api-reference/directives/use-cache), not by hand: a `'use cache'` function with an explicit
// lifetime and a tag.
//   - `minutes` (revalidate after 1 minute, expire after 1 hour): long enough to be part of a prerendered page, and it
//     bounds how long a change made OUTSIDE the admin screen (SQL, a migration) can go unseen.
//   - the tag is expired by every admin action that changes the config (updateTag, read-your-own-writes), so a change
//     made in /admin/cookie-consent is seen by the very next request.
export const COOKIE_CONSENT_CONFIG_TAG = 'cookie-consent-config';

// Throws instead of returning the baseline on a failed read, because a cached function stores what it RETURNS: a
// baseline returned from here would be served as the config for the whole lifetime. A throw stores nothing (the
// default handler's set() discards an errored entry — next/dist/server/lib/cache-handlers/default.js, 16.4.5).
async function readCookieConsentConfig(): Promise<CookieConsentAdminConfig> {
  'use cache';
  cacheLife('minutes');
  cacheTag(COOKIE_CONSENT_CONFIG_TAG);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('app_settings')
    .select(
      'cookie_consent_enabled, cookie_consent_analytics_enabled, cookie_consent_marketing_enabled, cookie_consent_revision_bump',
    )
    .eq('id', true)
    .maybeSingle();
  if (error || !data) throw new Error('cookie-consent config could not be read');

  return {
    enabled: data.cookie_consent_enabled !== false,
    analyticsEnabled: data.cookie_consent_analytics_enabled !== false,
    marketingEnabled: data.cookie_consent_marketing_enabled !== false,
    revisionBump:
      typeof data.cookie_consent_revision_bump === 'number' ? data.cookie_consent_revision_bump : 0,
  };
}

export async function getCookieConsentPublicConfig(): Promise<CookieConsentAdminConfig> {
  try {
    return await readCookieConsentConfig();
  } catch {
    // The baseline of a failed read belongs to THIS request only. connection() keeps it out of any prerendered
    // page, so a database hiccup during a build or a revalidation is never frozen into a page; the next request
    // reads again.
    await connection();
    return BASELINE_ADMIN_CONFIG;
  }
}
