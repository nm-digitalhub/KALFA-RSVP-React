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

describe('consentSignals — Consent Mode v2 mapping (revision 5: split by purpose)', () => {
  it('both granted: all four signals granted', () => {
    expect(consentSignals(true, true)).toEqual({
      analytics_storage: 'granted',
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
    });
  });

  it('analytics only: measurement granted, ad signals stay denied (marketing purpose not consented)', () => {
    expect(consentSignals(true, false)).toEqual({
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    });
  });

  it('marketing only: ad signals granted independently of analytics_storage', () => {
    expect(consentSignals(false, true)).toEqual({
      analytics_storage: 'denied',
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
    });
  });

  it('neither granted: all four denied', () => {
    expect(consentSignals(false, false)).toEqual({
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

describe('cookie-consent config invariants for marketing (revision 5 — Google Ads link)', () => {
  const categories = cookieConsentConfig.categories!;

  it('marketing category exists, is OPT-IN (disabled by default) and revocable', () => {
    expect(categories.marketing).toBeDefined();
    expect(categories.marketing.enabled).toBeFalsy();
    expect(categories.marketing.readOnly).toBeFalsy();
  });

  it('marketing is independent of analytics — granting one does not enable the other', () => {
    expect(categories.analytics.enabled).toBeFalsy();
    expect(categories.marketing.enabled).toBeFalsy();
  });

  it('revoke wipes Google Ads click-linking cookies via autoClear (_gcl*/_gac*)', () => {
    const patterns = (categories.marketing.autoClear?.cookies ?? []).map((c) => c.name);
    expect(patterns.length).toBeGreaterThan(0);
    const matches = (cookie: string) =>
      patterns.some((p) => (p instanceof RegExp ? p.test(cookie) : p === cookie));
    expect(matches('_gcl_au')).toBe(true);
    expect(matches('_gac_UA-XXXX')).toBe(true);
    expect(matches('_ga')).toBe(false);
  });

  it('adding marketing bumped the consent revision to >= 5 so returning visitors are re-asked', () => {
    expect(CONSENT_REVISION).toBeGreaterThanOrEqual(5);
  });

  it('the Hebrew UI surfaces the marketing choice as a category distinct from analytics', () => {
    const he = cookieConsentConfig.language.translations.he;
    if (!he || typeof he !== 'object') throw new Error('expected inline translation object');
    const sections = he.preferencesModal?.sections ?? [];
    const marketingSection = sections.find((s) => s.linkedCategory === 'marketing');
    expect(marketingSection).toBeDefined();
    expect(marketingSection?.description).toContain('Google Ads');
  });
});
