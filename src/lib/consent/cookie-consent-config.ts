import type * as CookieConsent from 'vanilla-cookieconsent';

// Central cookie-consent configuration for KALFA.
// See docs/consent/cookie-consent.md for the full rationale and how to extend it.
//
// Two categories: strictly-necessary (always on) and OPT-IN analytics (GA4 via
// the consent-gated component src/components/consent/google-analytics-gated.tsx,
// mounted only on marketing + customer-app surfaces — never on guest token
// routes). Analytics loads NOTHING until the visitor grants the category; on
// revoke, autoClear wipes the _ga* cookies.
//
// REVISION 2 (2026-07-27): analytics category added — the previous "essential
// only" consent is stale, so every returning visitor is re-asked.
// REVISION 3 (2026-07-27, same day): Google Signals enabled on the property —
// the analytics category now also covers cross-device association via
// signed-in Google accounts and demographics/interests reporting, so the
// category description changed materially and everyone is re-asked again.
export const CONSENT_REVISION = 3;

export const cookieConsentConfig: CookieConsent.CookieConsentConfig = {
  revision: CONSENT_REVISION,

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

  categories: {
    // Covers every cookie KALFA itself sets: Supabase auth/session (sb-*),
    // active_org tenant scoping, the version-skew reload guard, the sidebar
    // UI-state cookie, and the SUMIT payment script loaded on checkout. All are
    // required for the service to work and therefore cannot be disabled.
    necessary: {
      enabled: true,
      readOnly: true,
    },
    // Google Analytics 4 — opt-in only. The tracker itself is rendered by
    // GoogleAnalyticsGated strictly after this category is granted, so the
    // autoClear below is the cleanup path for a LATER revoke.
    analytics: {
      enabled: false,
      autoClear: {
        cookies: [{ name: /^_ga/ }],
      },
    },
  },

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
            'אנחנו משתמשים בעוגיות חיוניות הנדרשות להתחברות, לאבטחה ולתפעול השירות, ובנוסף — רק אם תאשרו — באנליטיקה (Google Analytics) שעוזרת לנו להבין את השימוש באתר ולשפר אותו.',
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
          sections: [
            {
              description:
                'עוגיות חיוניות נדרשות לתפקוד הבסיסי ואינן ניתנות לכיבוי; אנליטיקה פועלת רק בהסכמתכם, וניתן לשנות את הבחירה כאן בכל עת. למידע מלא ראו <a href="/cookies">מדיניות העוגיות</a>.',
            },
            {
              title: 'עוגיות חיוניות',
              description:
                'עוגיות אימות וזיהוי (Supabase), בחירת הארגון הפעיל, שמירת מצב סרגל הצד, ושמירת יציבות גרסה. ללא עוגיות אלה השירות אינו יכול לפעול.',
              linkedCategory: 'necessary',
            },
            {
              title: 'אנליטיקה (Google Analytics)',
              description:
                'מדידת שימוש — אילו עמודים נצפים וכיצד משתמשים באתר — לצורך שיפורו, כולל Google Signals: קישור ביקורים חוצה-מכשירים עבור משתמשים המחוברים לחשבון Google שהפעילו התאמה אישית של מודעות, ונתוני דמוגרפיה ותחומי עניין מצרפיים. נטענת רק לאחר אישורכם, לא בדפי אישורי-ההגעה של אורחים, וביטול ההסכמה מוחק את עוגיות המדידה (_ga*).',
              linkedCategory: 'analytics',
            },
            {
              title: 'מידע נוסף',
              description:
                'לשאלות בנוגע לעוגיות ולפרטיות ראו <a href="/cookies">מדיניות העוגיות</a> ו־<a href="/privacy">מדיניות הפרטיות</a>.',
            },
          ],
        },
      },
    },
  },
};
