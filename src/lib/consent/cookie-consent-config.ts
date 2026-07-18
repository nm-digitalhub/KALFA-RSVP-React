import type * as CookieConsent from 'vanilla-cookieconsent';

// Central cookie-consent configuration for KALFA.
// See docs/consent/cookie-consent.md for the full rationale and how to extend it.
//
// Today KALFA loads ZERO non-essential trackers (no analytics, no marketing, no
// third-party embeds), so only the strictly-necessary category is surfaced — an
// honest "essential cookies only" notice, not an empty opt-in theatre.
//
// To add analytics/marketing later: add the category + a preferences section
// here, list its cookies under `autoClear`, gate the tracker's <Script> on
// `CookieConsent.acceptedCategory(...)`, and bump CONSENT_REVISION to re-ask.
export const CONSENT_REVISION = 1;

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

  // Only the strictly-necessary category exists today. It covers every cookie
  // KALFA sets: Supabase auth/session (sb-*), active_org tenant scoping, the
  // version-skew reload guard, the sidebar UI-state cookie, and the SUMIT
  // payment script loaded on checkout. All are required for the service to work
  // and therefore cannot be disabled.
  categories: {
    necessary: {
      enabled: true,
      readOnly: true,
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
            'אנחנו משתמשים אך ורק בעוגיות חיוניות הנדרשות להתחברות, לאבטחה ולתפעול השירות. איננו משתמשים בעוגיות מעקב, אנליטיקה או שיווק.',
          acceptAllBtn: 'הבנתי',
          showPreferencesBtn: 'פרטים',
          footer:
            '<a href="/cookies">מדיניות עוגיות</a> · <a href="/privacy">מדיניות פרטיות</a>',
        },
        preferencesModal: {
          title: 'העדפות עוגיות',
          acceptAllBtn: 'הבנתי',
          savePreferencesBtn: 'שמירה',
          closeIconLabel: 'סגירה',
          sections: [
            {
              description:
                'האתר משתמש בעוגיות חיוניות בלבד. עוגיות אלה נדרשות לתפקוד הבסיסי — התחברות, אבטחה ושמירת מצב ממשק — ולכן אינן ניתנות לכיבוי. למידע מלא ראו <a href="/cookies">מדיניות העוגיות</a>.',
            },
            {
              title: 'עוגיות חיוניות',
              description:
                'עוגיות אימות וזיהוי (Supabase), בחירת הארגון הפעיל, שמירת מצב סרגל הצד, ושמירת יציבות גרסה. ללא עוגיות אלה השירות אינו יכול לפעול.',
              linkedCategory: 'necessary',
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
