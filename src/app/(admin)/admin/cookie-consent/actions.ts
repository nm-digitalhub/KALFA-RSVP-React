'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { zfd } from 'zod-form-data';

import {
  updateCookieConsentEnabled,
  updateCookieConsentAnalyticsEnabled,
  updateCookieConsentMarketingEnabled,
  bumpCookieConsentRevision,
  type ToggleOutcome,
} from '@/lib/data/admin/cookie-consent';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { COOKIE_CONSENT_CONFIG_TAG } from '@/lib/consent/admin-config';
import { actionClient, returnUserError } from '@/lib/safe-action';

// Broad, sitewide invalidation — deliberate exception to the usual narrow
// revalidatePath('/admin/...') convention used elsewhere in /admin, because
// the cookie-consent config is read by the ROOT layout and affects every
// route in the app. See plans/cookie-consent-admin-control.md §9. Skipped on
// a no-op toggle (below) — nothing changed, so there is nothing to refresh.
//
// updateTag expires the cached read of the config itself (getCookieConsentPublicConfig is a `'use cache'` function
// tagged with it), so the next request reads the new value instead of the cached one.
function revalidateEverywhere(): void {
  updateTag(COOKIE_CONSENT_CONFIG_TAG);
  revalidatePath('/', 'layout');
}

// Unchecked checkboxes are omitted from FormData — zfd.checkbox() reads that as false.
export const updateCookieConsentEnabledAction = actionClient
  .inputSchema(zfd.formData({ cookie_consent_enabled: zfd.checkbox() }))
  .stateAction(async ({ parsedInput: { cookie_consent_enabled: enabled } }) => {
    let outcome: ToggleOutcome;
    try {
      outcome = await updateCookieConsentEnabled(enabled);
    } catch (err) {
      unstable_rethrow(err);
      return returnUserError('עדכון מתג ההסכמה נכשל. נסו שוב.');
    }
    if (!outcome.changed) {
      // Submitting a value the switch already has must not write, bump, or
      // force everyone to re-consent for nothing — and must not log/alert as if
      // something happened.
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
  });

export const updateCookieConsentAnalyticsEnabledAction = actionClient
  .inputSchema(zfd.formData({ cookie_consent_analytics_enabled: zfd.checkbox() }))
  .stateAction(async ({ parsedInput: { cookie_consent_analytics_enabled: enabled } }) => {
    let outcome: ToggleOutcome;
    try {
      outcome = await updateCookieConsentAnalyticsEnabled(enabled);
    } catch (err) {
      unstable_rethrow(err);
      return returnUserError('עדכון קטגוריית האנליטיקה נכשל. נסו שוב.');
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
  });

export const updateCookieConsentMarketingEnabledAction = actionClient
  .inputSchema(zfd.formData({ cookie_consent_marketing_enabled: zfd.checkbox() }))
  .stateAction(async ({ parsedInput: { cookie_consent_marketing_enabled: enabled } }) => {
    let outcome: ToggleOutcome;
    try {
      outcome = await updateCookieConsentMarketingEnabled(enabled);
    } catch (err) {
      unstable_rethrow(err);
      return returnUserError('עדכון קטגוריית השיווק נכשל. נסו שוב.');
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
  });

// The form posts no fields; the empty schema keeps the (prevState, formData) signature useActionState passes.
export const bumpCookieConsentRevisionAction = actionClient
  .inputSchema(zfd.formData({}))
  .stateAction(async () => {
    try {
      const next = await bumpCookieConsentRevision();
      revalidateEverywhere();
      return { notice: `הוכרז revision חדש (${next}) — כל המשתמשים יתבקשו להסכים מחדש` };
    } catch (err) {
      unstable_rethrow(err);
      return returnUserError('עדכון מספר הגרסה נכשל. נסו שוב.');
    }
  });
