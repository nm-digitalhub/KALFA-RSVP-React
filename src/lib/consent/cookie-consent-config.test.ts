import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BASELINE_ADMIN_CONFIG,
  CONSENT_REVISION,
  buildCookieConsentConfig,
} from './cookie-consent-config';

describe('buildCookieConsentConfig', () => {
  it('baseline: all three categories present, base revision', () => {
    const cfg = buildCookieConsentConfig(BASELINE_ADMIN_CONFIG);
    expect(Object.keys(cfg.categories)).toEqual(['necessary', 'analytics', 'marketing']);
    expect(cfg.revision).toBe(CONSENT_REVISION);
  });

  it('analytics disabled: category AND its preferences section disappear', () => {
    const cfg = buildCookieConsentConfig({ ...BASELINE_ADMIN_CONFIG, analyticsEnabled: false });
    expect(cfg.categories.analytics).toBeUndefined();
    expect(cfg.categories.marketing).toBeDefined();
    const he = cfg.language.translations.he;
    if (!he || typeof he !== 'object') throw new Error('expected inline translation object');
    const sections = he.preferencesModal?.sections ?? [];
    expect(sections.some((s) => s.linkedCategory === 'analytics')).toBe(false);
    expect(sections.some((s) => s.linkedCategory === 'marketing')).toBe(true);
  });

  it('marketing disabled: symmetric to analytics', () => {
    const cfg = buildCookieConsentConfig({ ...BASELINE_ADMIN_CONFIG, marketingEnabled: false });
    expect(cfg.categories.marketing).toBeUndefined();
    expect(cfg.categories.analytics).toBeDefined();
    const he = cfg.language.translations.he;
    if (!he || typeof he !== 'object') throw new Error('expected inline translation object');
    const sections = he.preferencesModal?.sections ?? [];
    expect(sections.some((s) => s.linkedCategory === 'marketing')).toBe(false);
  });

  it('both disabled: only necessary remains, offered categories drop to one', () => {
    const cfg = buildCookieConsentConfig({
      enabled: true,
      analyticsEnabled: false,
      marketingEnabled: false,
      revisionBump: 0,
    });
    expect(Object.keys(cfg.categories)).toEqual(['necessary']);
  });

  it('necessary is never omittable regardless of admin flags', () => {
    const cfg = buildCookieConsentConfig({
      enabled: true,
      analyticsEnabled: false,
      marketingEnabled: false,
      revisionBump: 0,
    });
    expect(cfg.categories.necessary).toEqual({ enabled: true, readOnly: true });
  });

  it('revision = CONSENT_REVISION + admin bump', () => {
    const cfg = buildCookieConsentConfig({ ...BASELINE_ADMIN_CONFIG, revisionBump: 3 });
    expect(cfg.revision).toBe(CONSENT_REVISION + 3);
  });

  it('the intro and "more info" sections are always present regardless of category state', () => {
    const cfg = buildCookieConsentConfig({
      enabled: true,
      analyticsEnabled: false,
      marketingEnabled: false,
      revisionBump: 0,
    });
    const he = cfg.language.translations.he;
    if (!he || typeof he !== 'object') throw new Error('expected inline translation object');
    const sections = he.preferencesModal?.sections ?? [];
    expect(sections.some((s) => s.linkedCategory === 'necessary')).toBe(true);
    expect(sections.some((s) => s.title === 'מידע נוסף')).toBe(true);
  });
});

describe('consent box aria-modal', () => {
  afterEach(() => vi.unstubAllGlobals());

  // disablePageInteraction:false → the page stays usable, so the consent box
  // must not claim aria-modal; the preferences modal keeps it (really modal).
  it('strips aria-modal from the consent box only, never from the preferences modal', () => {
    const removeAttribute = vi.fn();
    const querySelector = vi.fn(() => ({ removeAttribute }));
    vi.stubGlobal('document', { querySelector });
    const cfg = buildCookieConsentConfig(BASELINE_ADMIN_CONFIG);
    expect(cfg.disablePageInteraction).toBe(false);

    cfg.onModalShow?.({ modalName: 'preferencesModal' });
    expect(querySelector).not.toHaveBeenCalled();

    cfg.onModalShow?.({ modalName: 'consentModal' });
    expect(querySelector).toHaveBeenCalledWith('#cc-main .cm');
    expect(removeAttribute).toHaveBeenCalledWith('aria-modal');
  });
});
