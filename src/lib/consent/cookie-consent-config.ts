import type * as CookieConsent from 'vanilla-cookieconsent';

// Central cookie-consent configuration for KALFA.
// See docs/consent/cookie-consent.md for the full rationale and how to extend it.
//
// Three categories: strictly-necessary (always on), OPT-IN analytics, and
// OPT-IN marketing — each independently toggled, each off by default. GA4 via
// the consent-gated component src/components/consent/google-analytics-gated.tsx
// (mounted only on marketing-site + customer-app surfaces — never on guest
// token routes) loads NOTHING until `analytics` is granted; the Consent Mode
// v2 ad signals it sends alongside the tag reflect `marketing` independently
// (see analytics-gate.ts). On revoke, each category's autoClear wipes its own
// cookies.
//
// REVISION 2 (2026-07-27): analytics category added — the previous "essential
// only" consent is stale, so every returning visitor is re-asked.
// REVISION 3 (2026-07-27, same day): Google Signals enabled on the property —
// the analytics category now also covers cross-device association via
// signed-in Google accounts and demographics/interests reporting, so the
// category description changed materially and everyone is re-asked again.
// REVISION 4 (2026-07-27, same day): the compliance review surfaced that
// customer-area page addresses already carry internal UUIDs (page_location),
// and purchase now carries a billed-plan LABEL — the category description
// changed to disclose both, so everyone is re-asked. Explicit UUID event
// params were implemented then HELD before deploy (minimization — no
// consumer exists); event_type is deliberately NOT sent (sensitive).
// REVISION 5 (2026-07-27, same day): the owner linked a Google Ads account
// (8060256907) to this GA4 property for remarketing + ads conversions — a
// purpose distinct from measurement. Per the Privacy Protection Law's
// purpose-limitation regime (s.8(b)/s.2(9)) and the Privacy Protection
// Authority's consent guidance (consent for one purpose does not authorize
// another), a NEW opt-in `marketing` category was added, off by default and
// independent of `analytics`. Consent Mode v2's ad signals (ad_storage,
// ad_user_data, ad_personalization) moved OFF `analytics` and onto
// `marketing` exclusively — see analytics-gate.ts for the full mapping and
// the documented Google Signals consequence (Signals now needs BOTH grants).
// Category descriptions changed materially, so everyone is re-asked again.
// This category ships DARK: it exists in code/policy but the owner has not
// yet enabled remarketing/audiences in GA4/Ads, so granting it currently has
// no observable third-party effect beyond the (harmless, unread) signal push.
//
// ADMIN CONTROL (2026-07-27, see plans/cookie-consent-admin-control.md):
// /admin/cookie-consent lets an admin disable the WHOLE mechanism, or either
// opt-in category, at runtime — app_settings-backed (src/lib/data/admin/
// cookie-consent.ts for the admin screen, src/lib/consent/admin-config.ts for
// the public read used by every layout). CONSENT_REVISION here is the CODE
// baseline; the EFFECTIVE revision sent to visitors is
// CONSENT_REVISION + admin.revisionBump (an admin-only, monotonically
// increasing counter). Every admin toggle bumps it automatically in the same
// DB write — this is a correctness requirement, not a convenience: verified
// against the installed vanilla-cookieconsent 3.1.0 source that omitting a
// category from the built config alone does not erase it from an
// already-valid stored consent cookie (see plan §2.2). Legal/UI text stays
// fully static here by design (plan §7) — the admin controls availability
// and the revision number only, never the wording.
export const CONSENT_REVISION = 5;

// What an admin may control from /admin/cookie-consent. `revisionBump` is
// summed with CONSENT_REVISION — see the comment block above.
export interface CookieConsentAdminConfig {
  enabled: boolean;
  analyticsEnabled: boolean;
  marketingEnabled: boolean;
  revisionBump: number;
}

// Exactly today's shipped behavior (before this admin control existed) — the
// fallback used when the DB is unreachable (src/lib/consent/admin-config.ts)
// and the default row a fresh migration produces.
export const BASELINE_ADMIN_CONFIG: CookieConsentAdminConfig = {
  enabled: true,
  analyticsEnabled: true,
  marketingEnabled: true,
  revisionBump: 0,
};

// Category + section definitions — text UNCHANGED from the previous static
// config, just extracted so buildCookieConsentConfig() can include/omit them
// by key based on admin availability flags.
const ANALYTICS_CATEGORY: CookieConsent.Category = {
  // Google Analytics 4 — opt-in only. The tracker itself is rendered by
  // GoogleAnalyticsGated strictly after this category is granted, so the
  // autoClear below is the cleanup path for a LATER revoke. Covers
  // measurement + Google Signals ONLY when `marketing` is also granted
  // (Signals needs the ad signals — see analytics-gate.ts).
  enabled: false,
  autoClear: {
    cookies: [{ name: /^_ga/ }],
  },
};

const MARKETING_CATEGORY: CookieConsent.Category = {
  // Google Ads remarketing/conversions — opt-in only, independent of
  // `analytics`. Controls ONLY the Consent Mode v2 ad signals
  // (ad_storage/ad_user_data/ad_personalization) sent alongside the GA4 tag;
  // it does not gate the tag's load (that stays on `analytics`), so granting
  // this alone without `analytics` has no observable effect. autoClear wipes
  // Google's ad-click-linking cookies set once ad_storage is granted.
  enabled: false,
  autoClear: {
    cookies: [{ name: /^_gcl/ }, { name: /^_gac/ }],
  },
};

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

// Builds the config actually passed to CookieConsent.run(). Text stays fully
// static (compile-time constants above) — only WHICH categories/sections are
// included, and the revision number, depend on admin input (plan §7: no
// admin-editable legal text, by design).
export function buildCookieConsentConfig(
  admin: CookieConsentAdminConfig,
): CookieConsent.CookieConsentConfig {
  const categories: CookieConsent.CookieConsentConfig['categories'] = {
    // Covers every cookie KALFA itself sets: Supabase auth/session (sb-*),
    // active_org tenant scoping, the version-skew reload guard, the sidebar
    // UI-state cookie, and the SUMIT payment script loaded on checkout. All
    // are required for the service to work and therefore cannot be disabled
    // — never gated by an admin flag.
    necessary: {
      enabled: true,
      readOnly: true,
    },
  };
  if (admin.analyticsEnabled) categories.analytics = ANALYTICS_CATEGORY;
  if (admin.marketingEnabled) categories.marketing = MARKETING_CATEGORY;

  const sections = [
    INTRO_SECTION,
    NECESSARY_SECTION,
    ...(admin.analyticsEnabled ? [ANALYTICS_SECTION] : []),
    ...(admin.marketingEnabled ? [MARKETING_SECTION] : []),
    MORE_INFO_SECTION,
  ];

  return {
    revision: CONSENT_REVISION + admin.revisionBump,

    // Non-blocking notice: never lock the page. Public RSVP pages (/r, /g, /ty)
    // must stay fully usable while the notice is visible.
    disablePageInteraction: false,

    cookie: {
      name: 'kalfa_cookie_consent',
      path: '/',
      sameSite: 'Lax',
      expiresAfterDays: 182,
      // Explicit: `secure` must be off on http://localhost, otherwise the browser
      // drops the cookie and the notice reappears on every load in development.
      secure: process.env.NODE_ENV === 'production',
    },

    guiOptions: {
      consentModal: { layout: 'box', position: 'bottom center' },
      preferencesModal: { layout: 'box' },
    },

    categories,

    language: {
      default: 'he',
      // RTL layout is driven by this option, NOT by the DOM `dir`: vanilla-cookieconsent
      // adds its `.cc--rtl` class (which mirrors the modal chrome — close button,
      // toggles, expand arrows, button spacing) only when the active language is
      // listed here. Inheriting dir="rtl" from <html> flips text but not the chrome.
      rtl: 'he',
      translations: {
        he: {
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
            sections,
          },
        },
      },
    },
  };
}

// Back-compat static export for anything importing the constant shape
// directly (tests, mainly). Baseline rendering — everything on, no bump.
export const cookieConsentConfig: CookieConsent.CookieConsentConfig =
  buildCookieConsentConfig(BASELINE_ADMIN_CONFIG);
