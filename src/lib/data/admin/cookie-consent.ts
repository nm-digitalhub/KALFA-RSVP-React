import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { CONSENT_REVISION } from '@/lib/consent/cookie-consent-config';

// Admin: cookie-consent mechanism control (app_settings singleton, admin-only
// RLS via app_settings_admin_all). Session client + requirePlatformPermission
// ('manage_settings') — same pattern as src/lib/data/admin/voximplant-channel.ts
// and src/lib/data/admin/alerts.ts. See plans/cookie-consent-admin-control.md.
//
// Every write here is a SINGLE-ROW UPDATE that sets the flag AND
// cookie_consent_revision_bump together, in the same statement (no RPC, no
// split writes — app_settings is a true singleton, nothing forces a split).
// The bump is mandatory whenever the value actually changes, not optional:
// verified against the installed vanilla-cookieconsent 3.1.0 source that
// omitting a category from the built config alone does not erase it from an
// already-valid stored consent cookie (plan §2.2) — so every REAL
// availability change must also force re-consent.
//
// NO-OP SAFE (found during the owner's live production test, 27.7): a toggle
// submitted with the value it already has must NOT write, NOT bump, and NOT
// force every visitor to re-consent for nothing. Each toggle function below
// filters its UPDATE with `.neq(column, value)`, so Postgres only applies
// the write when the column's CURRENT value differs — evaluated at the
// moment of the UPDATE against the live row, not against anything read
// earlier, so this stays correct even under a concurrent admin write
// (no lost updates, no double bumps). `.select()` reports whether any row
// was actually touched — an empty result is the no-op signal.
//
// Every REAL write also calls logActivity() — visible at /admin/activity, on
// top of the existing Slack security-audit alert emitted by the action layer
// (src/app/(admin)/admin/cookie-consent/actions.ts) — but a no-op does
// neither: an empty action must not log or alert as if something happened.
// `meta` never carries PII or secrets, only the flag values themselves
// (mirrors the existing admin.voice.* / admin.agreement.* conventions).

const SETTINGS_ID = true;

export type CookieConsentAdminView = {
  enabled: boolean;
  analyticsEnabled: boolean;
  marketingEnabled: boolean;
  revisionBump: number;
  effectiveRevision: number; // CONSENT_REVISION + revisionBump — display only
};

export async function getCookieConsentAdminView(): Promise<CookieConsentAdminView> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('app_settings')
    .select(
      'cookie_consent_enabled, cookie_consent_analytics_enabled, cookie_consent_marketing_enabled, cookie_consent_revision_bump',
    )
    .eq('id', SETTINGS_ID)
    .maybeSingle();
  if (error) throw new Error('טעינת הגדרות ההסכמה נכשלה');

  const revisionBump =
    typeof data?.cookie_consent_revision_bump === 'number' ? data.cookie_consent_revision_bump : 0;
  return {
    enabled: data?.cookie_consent_enabled !== false,
    analyticsEnabled: data?.cookie_consent_analytics_enabled !== false,
    marketingEnabled: data?.cookie_consent_marketing_enabled !== false,
    revisionBump,
    effectiveRevision: CONSENT_REVISION + revisionBump,
  };
}

async function readCurrentBump(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<number> {
  const { data } = await supabase
    .from('app_settings')
    .select('cookie_consent_revision_bump')
    .eq('id', SETTINGS_ID)
    .maybeSingle();
  return typeof data?.cookie_consent_revision_bump === 'number'
    ? data.cookie_consent_revision_bump
    : 0;
}

// What every toggle function reports, so the action layer can decide whether
// to show the "already in this state" notice and skip the audit/alert.
export type ToggleOutcome = { changed: boolean; revisionBump: number };

export async function updateCookieConsentEnabled(enabled: boolean): Promise<ToggleOutcome> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();
  const currentBump = await readCurrentBump(supabase);
  const nextBump = currentBump + 1;
  const { data, error } = await supabase
    .from('app_settings')
    .update({ cookie_consent_enabled: enabled, cookie_consent_revision_bump: nextBump })
    .eq('id', SETTINGS_ID)
    .neq('cookie_consent_enabled', enabled)
    .select('cookie_consent_revision_bump');
  if (error) throw new Error('עדכון מתג ההסכמה נכשל');
  const changed = (data?.length ?? 0) > 0;
  if (changed) {
    await logActivity({ action: 'admin.cookie_consent.master_toggled', meta: { enabled } });
  }
  return { changed, revisionBump: changed ? nextBump : currentBump };
}

export async function updateCookieConsentAnalyticsEnabled(
  enabled: boolean,
): Promise<ToggleOutcome> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();
  const currentBump = await readCurrentBump(supabase);
  const nextBump = currentBump + 1;
  const { data, error } = await supabase
    .from('app_settings')
    .update({
      cookie_consent_analytics_enabled: enabled,
      cookie_consent_revision_bump: nextBump,
    })
    .eq('id', SETTINGS_ID)
    .neq('cookie_consent_analytics_enabled', enabled)
    .select('cookie_consent_revision_bump');
  if (error) throw new Error('עדכון קטגוריית האנליטיקה נכשל');
  const changed = (data?.length ?? 0) > 0;
  if (changed) {
    await logActivity({
      action: 'admin.cookie_consent.category_toggled',
      meta: { category: 'analytics', enabled },
    });
  }
  return { changed, revisionBump: changed ? nextBump : currentBump };
}

export async function updateCookieConsentMarketingEnabled(
  enabled: boolean,
): Promise<ToggleOutcome> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();
  const currentBump = await readCurrentBump(supabase);
  const nextBump = currentBump + 1;
  const { data, error } = await supabase
    .from('app_settings')
    .update({
      cookie_consent_marketing_enabled: enabled,
      cookie_consent_revision_bump: nextBump,
    })
    .eq('id', SETTINGS_ID)
    .neq('cookie_consent_marketing_enabled', enabled)
    .select('cookie_consent_revision_bump');
  if (error) throw new Error('עדכון קטגוריית השיווק נכשל');
  const changed = (data?.length ?? 0) > 0;
  if (changed) {
    await logActivity({
      action: 'admin.cookie_consent.category_toggled',
      meta: { category: 'marketing', enabled },
    });
  }
  return { changed, revisionBump: changed ? nextBump : currentBump };
}

// Standalone "force re-consent" action — for cases with no boolean change
// (e.g. a future code-level text/revision bump the admin wants to mirror
// without waiting for a deploy). Every click is inherently a real, distinct
// action (there is no "already at this bump" state to compare against, since
// the bump always advances) — no no-op case applies here, unlike the toggles
// above. Still a single-row UPDATE.
export async function bumpCookieConsentRevision(): Promise<number> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();
  const nextBump = (await readCurrentBump(supabase)) + 1;
  const { error } = await supabase
    .from('app_settings')
    .update({ cookie_consent_revision_bump: nextBump })
    .eq('id', SETTINGS_ID);
  if (error) throw new Error('עדכון מספר הגרסה נכשל');
  await logActivity({
    action: 'admin.cookie_consent.revision_bumped',
    meta: { revisionBump: nextBump },
  });
  return nextBump;
}
