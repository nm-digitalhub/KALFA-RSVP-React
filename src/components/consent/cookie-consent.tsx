'use client';

import { useEffect } from 'react';
import * as CookieConsent from 'vanilla-cookieconsent';

import {
  buildCookieConsentConfig,
  type CookieConsentAdminConfig,
} from '@/lib/consent/cookie-consent-config';

// vanilla-cookieconsent keeps a single global instance and injects its own DOM
// into <body>. Guard against React StrictMode's double-effect (and HMR) so we
// only initialise once per page load.
let initialised = false;

// Global cookie-consent notice. Renders nothing itself (the library owns its
// DOM), so it is SSR-safe and cannot cause a hydration mismatch. The
// stylesheet is loaded via a DYNAMIC import inside the effect, awaited before
// run(): a static import anywhere in the layout's client graph gets hoisted
// into the render-blocking initial CSS (measured — the entry-CSS hash stayed
// identical with a static import even behind an ssr:false dynamic component),
// while a runtime import() becomes an async chunk injected as a non-blocking
// <link>, and the .then ordering guarantees the banner never shows unstyled.
// The custom theming in globals.css targets `#cc-main` (ID specificity), which
// beats the library's `:root`/class defaults in the cascade regardless of
// stylesheet load order. Mounted via cookie-consent-lazy.tsx in
// src/app/layout.tsx so it covers the public site, auth, customer, and admin
// areas alike.
//
// `adminConfig` comes from src/lib/consent/admin-config.ts (app_settings-backed,
// see plans/cookie-consent-admin-control.md). Master kill switch: when
// `adminConfig.enabled` is false, `CookieConsent.run()` is skipped ENTIRELY —
// verified fail-safe against the installed vanilla-cookieconsent 3.1.0 source
// (dist/cookieconsent.esm.js): the internal "no valid consent" flag defaults
// to true and is only ever cleared inside run(), so acceptedCategory() then
// returns false for every category, forever, for this page load — regardless
// of any consent cookie already stored in the browser (plan §2.1). This is
// what makes GoogleAnalyticsGated fail-safe when the mechanism is disabled.
export function CookieConsentBanner({
  adminConfig,
}: {
  adminConfig: CookieConsentAdminConfig;
}) {
  useEffect(() => {
    if (initialised) return;
    initialised = true;
    if (!adminConfig.enabled) return;
    void import('vanilla-cookieconsent/dist/cookieconsent.css').then(() =>
      CookieConsent.run(buildCookieConsentConfig(adminConfig)),
    );
  }, [adminConfig]);

  return null;
}
