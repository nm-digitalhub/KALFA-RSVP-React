'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';

import {
  updateCookieConsentEnabled,
  updateCookieConsentAnalyticsEnabled,
  updateCookieConsentMarketingEnabled,
  bumpCookieConsentRevision,
  type ToggleOutcome,
} from '@/lib/data/admin/cookie-consent';
import { sendSlackAlert } from '@/lib/alerts/slack';
import type { FormState } from '@/lib/validation/result';

// Broad, sitewide invalidation — deliberate exception to the usual narrow
// revalidatePath('/admin/...') convention used elsewhere in /admin, because
// the cookie-consent config is read by the ROOT layout and affects every
// route in the app. See plans/cookie-consent-admin-control.md §9. Skipped on
// a no-op toggle (below) — nothing changed, so there is nothing to refresh.
function revalidateEverywhere(): void {
  revalidatePath('/', 'layout');
}

export async function updateCookieConsentEnabledAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const enabled = formData.get('cookie_consent_enabled') === 'on';
  let outcome: ToggleOutcome;
  try {
    outcome = await updateCookieConsentEnabled(enabled);
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'עדכון מתג ההסכמה נכשל. נסו שוב.' };
  }
  if (!outcome.changed) {
    // Found in the owner's live test (27.7): submitting a value the switch
    // already has must not write, bump, or force everyone to re-consent for
    // nothing — and must not log/alert as if something happened.
    return { notice: 'לא בוצע שינוי — המתג כבר במצב זה' };
  }
  void sendSlackAlert({
    level: enabled ? 'info' : 'warn',
    category: 'security',
    source: 'cookie-consent-master-toggle',
    title: enabled
      ? 'Cookie-consent mechanism RE-ENABLED'
      : 'Cookie-consent mechanism DISABLED — GA and marketing signals stop loading sitewide',
    fields: { enabled: String(enabled) },
  });
  revalidateEverywhere();
  return {
    notice: enabled
      ? 'מנגנון ההסכמה הופעל'
      : 'מנגנון ההסכמה כובה — האנליטיקה והשיווק מפסיקים להיטען לכל האתר',
  };
}

export async function updateCookieConsentAnalyticsEnabledAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const enabled = formData.get('cookie_consent_analytics_enabled') === 'on';
  let outcome: ToggleOutcome;
  try {
    outcome = await updateCookieConsentAnalyticsEnabled(enabled);
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'עדכון קטגוריית האנליטיקה נכשל. נסו שוב.' };
  }
  if (!outcome.changed) {
    return { notice: 'לא בוצע שינוי — הקטגוריה כבר במצב זה' };
  }
  void sendSlackAlert({
    level: enabled ? 'info' : 'warn',
    category: 'security',
    source: 'cookie-consent-analytics-toggle',
    title: enabled
      ? 'Cookie-consent analytics category ENABLED'
      : 'Cookie-consent analytics category DISABLED',
    fields: { enabled: String(enabled) },
  });
  revalidateEverywhere();
  return { notice: enabled ? 'קטגוריית האנליטיקה הופעלה' : 'קטגוריית האנליטיקה כובתה' };
}

export async function updateCookieConsentMarketingEnabledAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const enabled = formData.get('cookie_consent_marketing_enabled') === 'on';
  let outcome: ToggleOutcome;
  try {
    outcome = await updateCookieConsentMarketingEnabled(enabled);
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'עדכון קטגוריית השיווק נכשל. נסו שוב.' };
  }
  if (!outcome.changed) {
    return { notice: 'לא בוצע שינוי — הקטגוריה כבר במצב זה' };
  }
  void sendSlackAlert({
    level: enabled ? 'info' : 'warn',
    category: 'security',
    source: 'cookie-consent-marketing-toggle',
    title: enabled
      ? 'Cookie-consent marketing category ENABLED'
      : 'Cookie-consent marketing category DISABLED',
    fields: { enabled: String(enabled) },
  });
  revalidateEverywhere();
  return { notice: enabled ? 'קטגוריית השיווק הופעלה' : 'קטגוריית השיווק כובתה' };
}

export async function bumpCookieConsentRevisionAction(
  _prev: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    const next = await bumpCookieConsentRevision();
    revalidateEverywhere();
    return { notice: `הוכרז revision חדש (${next}) — כל המשתמשים יתבקשו להסכים מחדש` };
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'עדכון מספר הגרסה נכשל. נסו שוב.' };
  }
}
