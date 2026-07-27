'use client';

import { useEffect, useState } from 'react';
import { GoogleAnalytics } from '@next/third-parties/google';
import * as CookieConsent from 'vanilla-cookieconsent';

import { consentSignals, shouldLoadAnalytics } from '@/lib/consent/analytics-gate';

// Consent-gated Google Analytics — the repo convention documented in
// cookie-consent-config.ts: the tracker renders ONLY after the visitor grants
// the `analytics` category, so not a single Google request leaves the browser
// before consent. Mounted ONLY on measured surfaces ((public)/(site) marketing
// pages and the customer app) — never on the guest token routes (/r /g /ty
// /join), which sit outside those layouts by design: guests gave no consent
// and their tokenized URLs must not reach a third party.
//
// Consent Mode v2: on top of the hard load-gate, the tag receives EXPLICIT
// consent signals (analytics_storage + the three ad signals — required for
// Google Signals, which the revision-3 category text discloses). The default
// is queued into the dataLayer BEFORE the GA script initializes; a revoke
// pushes a live `consent update` (all denied) to the already-loaded tag, and
// the category's autoClear wipes the _ga* cookies.
//
// vanilla-cookieconsent v3 dispatches `cc:onConsent` (initial choice, or an
// existing stored consent on load) and `cc:onChange` (preference updates) on
// window.

function pushConsent(command: 'default' | 'update', granted: boolean): void {
  type DataLayerWindow = Window & { dataLayer?: unknown[] };
  const w = window as DataLayerWindow;
  w.dataLayer = w.dataLayer || [];
  // gtag consent commands must be pushed as an `arguments` object, so a plain
  // array does not work here — this mirrors Google's own snippet.
  function gtag(..._args: unknown[]) {
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer!.push(arguments);
  }
  gtag('consent', command, consentSignals(granted));
}

export function GoogleAnalyticsGated() {
  const gaId = process.env.NEXT_PUBLIC_GA_ID;
  const [granted, setGranted] = useState(false);

  useEffect(() => {
    let current: boolean | null = null;
    let defaultPushed = false;
    const sync = () => {
      const next = CookieConsent.acceptedCategory('analytics');
      if (next === current) return;
      const first = current === null;
      current = next;
      if (next) {
        // The first consent command ever must be `default`, queued BEFORE the
        // GA script mounts and processes config; later flips are `update`s.
        pushConsent(defaultPushed ? 'update' : 'default', true);
        defaultPushed = true;
      } else if (!first) {
        // Revoke on an already-loaded tag: live update to all-denied.
        pushConsent('update', false);
        defaultPushed = true;
      }
      setGranted(next);
    };
    sync();
    window.addEventListener('cc:onConsent', sync);
    window.addEventListener('cc:onChange', sync);
    return () => {
      window.removeEventListener('cc:onConsent', sync);
      window.removeEventListener('cc:onChange', sync);
    };
  }, []);

  if (!shouldLoadAnalytics(gaId, granted)) return null;
  // gaId is non-empty here by the guard above. Rendered at most once per page
  // tree (one gate per layout group); @next/third-parties additionally dedupes
  // the underlying script tag by id across remounts.
  return <GoogleAnalytics gaId={gaId as string} />;
}
