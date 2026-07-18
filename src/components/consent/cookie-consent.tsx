'use client';

import { useEffect } from 'react';
import * as CookieConsent from 'vanilla-cookieconsent';

import { cookieConsentConfig } from '@/lib/consent/cookie-consent-config';

// vanilla-cookieconsent keeps a single global instance and injects its own DOM
// into <body>. Guard against React StrictMode's double-effect (and HMR) so we
// only initialise once per page load.
let initialised = false;

// Global cookie-consent notice. Renders nothing itself (the library owns its
// DOM), so it is SSR-safe and cannot cause a hydration mismatch. The stylesheet
// is imported once in the root layout. Mounted in src/app/layout.tsx so it
// covers the public site, auth, customer, and admin areas alike.
export function CookieConsentBanner() {
  useEffect(() => {
    if (initialised) return;
    initialised = true;
    void CookieConsent.run(cookieConsentConfig);
  }, []);

  return null;
}
