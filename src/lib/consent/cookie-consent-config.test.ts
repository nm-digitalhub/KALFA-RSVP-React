import { createHash } from 'node:crypto';

import type * as CookieConsent from 'vanilla-cookieconsent';
import { afterEach, describe, expect, it, vi } from 'vitest';

import enText from '@/locales/en/cookieConsent.json';
import frText from '@/locales/fr/cookieConsent.json';
import heText from '@/locales/he/cookieConsent.json';

import {
  BASELINE_ADMIN_CONFIG,
  CONSENT_REVISION,
  buildCookieConsentConfig,
} from './cookie-consent-config';

// The Hebrew exactly as it stood in cookie-consent-config.ts before it moved to src/locales/he/cookieConsent.json. These
// lines were copied from that code, not retyped, so a slip in the JSON fails the test below.
const INTRO_SECTION = {
  description:
    'עוגיות חיוניות נדרשות לתפקוד הבסיסי ואינן ניתנות לכיבוי; אנליטיקה ושיווק פועלים רק בהסכמתכם, בנפרד זה מזה, וניתן לשנות את הבחירה כאן בכל עת. למידע מלא ראו <a href="/cookies">מדיניות העוגיות</a>.',
};

const NECESSARY_SECTION = {
  title: 'עוגיות חיוניות',
  description:
    'עוגיות אימות וזיהוי (Supabase), בחירת הארגון הפעיל, שמירת מצב סרגל הצד, ושמירת יציבות גרסה. ללא עוגיות אלה השירות אינו יכול לפעול.',
  linkedCategory: 'necessary' as const,
};

const ANALYTICS_SECTION = {
  title: 'אנליטיקה (Google Analytics)',
  description:
    'מדידת שימוש — אילו עמודים נצפים וכיצד משתמשים באתר — לצורך שיפורו. Google Signals (קישור ביקורים חוצה-מכשירים ונתוני דמוגרפיה ותחומי עניין מצרפיים) מופעל ברמת הנכס, אך פועל בפועל רק עבור מבקרים שאישרו גם את קטגוריית "שיווק ורימרקטינג" להלן — אישור האנליטיקה בלבד אינו מפעיל אותו. המדידה עשויה לכלול מזהים פנימיים אקראיים של המערכת (כגון מזהה אירוע או קמפיין בכתובות עמודים באזור האישי); המזהים אינם כוללים כשלעצמם את שם האירוע או את זהות בעליו. נטענת רק לאחר אישורכם, לא בדפי אישורי-ההגעה של אורחים, וביטול ההסכמה מוחק את עוגיות המדידה (_ga*).',
  linkedCategory: 'analytics' as const,
};

const MARKETING_SECTION = {
  title: 'שיווק ורימרקטינג (Google Ads)',
  description:
    'חשבון Google Ads שלנו מקושר לנכס האנליטיקה. באישורכם, אנו משתפים עם Google Ads קהלים המבוססים על ביקורכם באתר (רימרקטינג), לצורך הצגת מודעות מותאמות באתרים אחרים ומדידת המרות ממודעות; אישור זה, יחד עם אישור האנליטיקה, גם מפעיל בפועל את Google Signals (ר\' לעיל). כבויה כברירת מחדל ונפרדת מהאנליטיקה — ניתן לאשר אחת בלי השנייה. ביטול ההסכמה מוחק את עוגיות/מזהי הפרסום. את העדפות המודעות בחשבון Google ניתן לנהל דרך מרכז המודעות שלי.',
  linkedCategory: 'marketing' as const,
};

const MORE_INFO_SECTION = {
  title: 'מידע נוסף',
  description:
    'לשאלות בנוגע לעוגיות ולפרטיות ראו <a href="/cookies">מדיניות העוגיות</a> ו־<a href="/privacy">מדיניות הפרטיות</a>.',
};

const HEBREW_BEFORE_THE_MOVE = {
  consentModal: {
    title: 'עוגיות באתר',
    description:
      'אנחנו משתמשים בעוגיות חיוניות הנדרשות להתחברות, לאבטחה ולתפעול השירות, ובנוסף — רק אם תאשרו, כל קטגוריה בנפרד — באנליטיקה (Google Analytics) שעוזרת לנו להבין את השימוש באתר ולשפר אותו, ובשיווק/רימרקטינג (Google Ads) המציג לכם מודעות מותאמות באתרים אחרים.',
    acceptAllBtn: 'אישור הכול',
    acceptNecessaryBtn: 'רק חיוניות',
    showPreferencesBtn: 'פרטים',
    footer:
      '<a href="/cookies">מדיניות עוגיות</a> · <a href="/privacy">מדיניות פרטיות</a>',
  },
  preferencesModal: {
    title: 'העדפות עוגיות',
    acceptAllBtn: 'אישור הכול',
    acceptNecessaryBtn: 'רק חיוניות',
    savePreferencesBtn: 'שמירה',
    closeIconLabel: 'סגירה',
    sections: [INTRO_SECTION, NECESSARY_SECTION, ANALYTICS_SECTION, MARKETING_SECTION, MORE_INFO_SECTION],
  },
};

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

const leaves = (value: unknown, path = ''): [string, unknown][] =>
  typeof value === 'object' && value !== null
    ? Object.entries(value).flatMap(([key, child]) => leaves(child, path ? `${path}.${key}` : key))
    : [[path, value]];

// The text, not the file: a rewrite that only changes indentation or key order keeps the hash.
const wordingHash = (text: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(leaves(text).sort(([a], [b]) => (a < b ? -1 : 1))))
    .digest('hex');

describe('the wording in src/locales/<language>/cookieConsent.json', () => {
  // Every consent revision pinned to the SHA-256 of the wording it was shown with, per language. Changing the text without a
  // new revision (and a new line here) fails this test, also after a locize-download. Old lines stay: a stored consent must
  // stay traceable to the text it was given for.
  const REVISION_HASHES: Record<number, Record<string, string>> = {
    5: {
      he: 'ad47f24aebbe7c719ff3e2bb87feaed94bff727a892b29d1a72df29a6f37759c',
      en: '569ac9ad1e93d320901b377f408501150f22a82e6b7c3e6a948c25fadc944bb5',
      fr: 'b2755a599babbac58a74a69a8d90063ab59920c89b7a27356662fcd867d78fdf',
    },
  };

  it('renders exactly what the code held before the move', () => {
    const cfg = buildCookieConsentConfig(BASELINE_ADMIN_CONFIG);
    expect(cfg.language.translations.he).toStrictEqual(HEBREW_BEFORE_THE_MOVE);
  });

  it.each([
    ['he', heText],
    ['en', enText],
    ['fr', frText],
  ])('the current revision is pinned to the current %s text', (language, text) => {
    expect(REVISION_HASHES[CONSENT_REVISION]?.[language]).toBe(wordingHash(text));
  });

  it('a change of indentation or key order keeps the hash, a change of text does not', () => {
    const { consentModal, ...rest } = enText;
    expect(wordingHash({ ...rest, consentModal })).toBe(wordingHash(enText));
    expect(wordingHash({ ...enText, consentModal: { ...consentModal, title: 'Changed' } })).not.toBe(wordingHash(enText));
  });
});

describe('the banner in other languages', () => {
  type Loader = () => Promise<CookieConsent.Translation>;
  const LANGUAGES = [
    ['en', enText],
    ['fr', frText],
  ] as const;

  const loaderOf = (config: ReturnType<typeof buildCookieConsentConfig>, language: string) =>
    config.language.translations[language] as Loader;

  it('takes the language from <html lang>, with Hebrew as the fallback and the only RTL language', () => {
    const { language } = buildCookieConsentConfig(BASELINE_ADMIN_CONFIG);
    expect(language.autoDetect).toBe('document');
    expect(language.default).toBe('he');
    expect(language.rtl).toBe('he');
  });

  it.each(LANGUAGES)('%s has every key of the Hebrew file, none of them empty', (_language, text) => {
    const keys = (file: unknown) => leaves(file).map(([key]) => key);
    expect(keys(text)).toEqual(keys(heText));
    expect(leaves(text).filter(([, value]) => typeof value !== 'string' || !value.trim())).toEqual([]);
  });

  it.each(LANGUAGES)('%s loads its own text and links to its own pages', async (language, text) => {
    const translation = await loaderOf(buildCookieConsentConfig(BASELINE_ADMIN_CONFIG), language)();
    expect(translation.consentModal?.title).toBe(text.consentModal.title);
    expect(translation.consentModal?.title).not.toBe(heText.consentModal.title);
    expect(translation.consentModal?.footer).toContain(`href="/${language}/cookies"`);
    expect(translation.consentModal?.footer).toContain(`href="/${language}/privacy"`);
    expect(JSON.stringify(translation)).not.toContain('{{');
  });

  it.each(LANGUAGES)('%s follows the admin flags like Hebrew does', async (language) => {
    const config = buildCookieConsentConfig({ ...BASELINE_ADMIN_CONFIG, analyticsEnabled: false });
    const sections = (await loaderOf(config, language)()).preferencesModal?.sections ?? [];
    expect(sections.map((section) => section.linkedCategory)).toEqual([undefined, 'necessary', 'marketing', undefined]);
  });

  it('falls back to the Hebrew text when a language fails to load', async () => {
    vi.resetModules();
    vi.doMock('@/locales/en/cookieConsent.json', () => {
      throw new Error('chunk failed');
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fresh = await import('./cookie-consent-config');

    const config = fresh.buildCookieConsentConfig(fresh.BASELINE_ADMIN_CONFIG);
    const translation = await loaderOf(config, 'en')();

    expect(translation).toStrictEqual(config.language.translations.he);
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
    vi.doUnmock('@/locales/en/cookieConsent.json');
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
