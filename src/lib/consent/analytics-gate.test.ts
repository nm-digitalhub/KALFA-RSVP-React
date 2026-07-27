import { describe, expect, it } from 'vitest';

import { consentSignals, shouldLoadAnalytics } from './analytics-gate';
import { CONSENT_REVISION, cookieConsentConfig } from './cookie-consent-config';

describe('shouldLoadAnalytics', () => {
  it('loads only when BOTH a measurement id exists AND consent was granted', () => {
    expect(shouldLoadAnalytics('G-RLPZB7QP55', true)).toBe(true);
  });

  it('never loads without consent, even with an id', () => {
    expect(shouldLoadAnalytics('G-RLPZB7QP55', false)).toBe(false);
  });

  it('never loads without a measurement id (missing/empty/blank)', () => {
    expect(shouldLoadAnalytics(undefined, true)).toBe(false);
    expect(shouldLoadAnalytics('', true)).toBe(false);
    expect(shouldLoadAnalytics('   ', true)).toBe(false);
  });

  it('revoked consent unloads regardless of id', () => {
    expect(shouldLoadAnalytics(undefined, false)).toBe(false);
  });
});

describe('consentSignals — Consent Mode v2 mapping', () => {
  it('grant covers all four signals (Signals requires the ad signals)', () => {
    expect(consentSignals(true)).toEqual({
      analytics_storage: 'granted',
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
    });
  });

  it('revoke denies all four', () => {
    expect(consentSignals(false)).toEqual({
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    });
  });
});

describe('cookie-consent config invariants for analytics', () => {
  const categories = cookieConsentConfig.categories!;

  it('analytics category exists, is OPT-IN (disabled by default) and revocable', () => {
    expect(categories.analytics).toBeDefined();
    expect(categories.analytics.enabled).toBeFalsy();
    expect(categories.analytics.readOnly).toBeFalsy();
  });

  it('necessary stays always-on and locked', () => {
    expect(categories.necessary.enabled).toBe(true);
    expect(categories.necessary.readOnly).toBe(true);
  });

  it('revoke wipes GA cookies via autoClear (_ga and _ga_<stream>)', () => {
    const patterns = (categories.analytics.autoClear?.cookies ?? []).map((c) => c.name);
    expect(patterns.length).toBeGreaterThan(0);
    const matches = (cookie: string) =>
      patterns.some((p) => (p instanceof RegExp ? p.test(cookie) : p === cookie));
    expect(matches('_ga')).toBe(true);
    expect(matches('_ga_RLPZB7QP55')).toBe(true);
    expect(matches('sb-access-token')).toBe(false);
  });

  it('adding analytics bumped the consent revision so returning visitors are re-asked', () => {
    expect(CONSENT_REVISION).toBeGreaterThanOrEqual(2);
    expect(cookieConsentConfig.revision).toBe(CONSENT_REVISION);
  });

  it('the Hebrew UI actually surfaces the analytics choice (toggle + honest text)', () => {
    const he = cookieConsentConfig.language.translations.he;
    if (!he || typeof he !== 'object') throw new Error('expected inline translation object');
    const sections = he.preferencesModal?.sections ?? [];
    expect(sections.some((s) => s.linkedCategory === 'analytics')).toBe(true);
    expect(he.consentModal?.acceptNecessaryBtn).toBeTruthy();
    expect(he.consentModal?.description).not.toContain('איננו משתמשים בעוגיות מעקב');
  });
});
