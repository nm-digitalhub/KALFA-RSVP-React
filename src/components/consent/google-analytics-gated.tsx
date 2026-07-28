'use client';

import { Suspense, useEffect, useState } from 'react';
import Script from 'next/script';
import * as CookieConsent from 'vanilla-cookieconsent';

import {
  consentSignals,
  shouldLoadAnalytics,
  type ConsentSignals,
} from '@/lib/consent/analytics-gate';
import { PageViewTracker } from './page-view-tracker';

// Consent-gated Google Analytics — the repo convention documented in
// cookie-consent-config.ts: the tracker renders ONLY after the visitor grants
// the `analytics` category, so not a single Google request leaves the browser
// before consent. Mounted ONLY on measured surfaces ((public)/(site) marketing
// pages and the customer app) — never on the guest token routes (/r /g /ty
// /join), which sit outside those layouts by design: guests gave no consent
// and their tokenized URLs must not reach a third party.
//
// The tag is loaded with the official gtag.js snippet DIRECTLY (not
// @next/third-parties) so it can be configured with send_page_view:false —
// page_view events are sent exclusively by PageViewTracker with normalized
// URLs (internal UUIDs replaced by placeholders; see
// plans/ga4-url-normalization.md). The stream's history-based enhanced
// measurement must be OFF to prevent double counting.
//
// Consent Mode v2: on top of the hard load-gate (which stays keyed to
// `analytics` only — the GA4 tag is the measurement tool, so it loads/exists
// solely on the measurement-purpose grant), the tag receives EXPLICIT
// consent signals SPLIT across two categories (revision 5): analytics_storage
// reflects `analytics`; the three ad signals (required by Google Ads
// remarketing/conversions AND by Google Signals) reflect `marketing`
// independently. See analytics-gate.ts for the full purpose-limitation
// rationale and the Google Signals consequence. The default is queued into
// the dataLayer BEFORE the GA script initializes; any later change to EITHER
// category pushes a live `consent update` to the already-loaded tag, and
// each category's autoClear wipes its own cookies on revoke.
//
// A `marketing`-only grant (analytics declined) has no observable effect:
// the tag never loads without `analytics`, so the pushed signals are never
// read by anything — fail-closed by construction, not a special case.
//
// vanilla-cookieconsent v3 dispatches `cc:onConsent` (initial choice, or an
// existing stored consent on load) and `cc:onChange` (preference updates) on
// window.
//
// `mechanismEnabled` (app_settings.cookie_consent_enabled via
// src/lib/consent/admin-config.ts) is belt-and-suspenders: when the admin
// disables the whole consent mechanism, src/components/consent/cookie-consent.tsx
// never calls CookieConsent.run(), which ALREADY makes acceptedCategory()
// return false forever (verified against the installed library source — see
// that file's comment and plans/cookie-consent-admin-control.md §2.1). The
// explicit check below just makes the invariant visible in this file too and
// skips wiring the listeners at all when disabled.

function pushConsent(command: 'default' | 'update', signals: ConsentSignals): void {
  type DataLayerWindow = Window & { dataLayer?: unknown[] };
  const w = window as DataLayerWindow;
  w.dataLayer = w.dataLayer || [];
  // gtag consent commands must be pushed as an `arguments` object, so a plain
  // array does not work here — this mirrors Google's own snippet.
  function gtag(..._args: unknown[]) {
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer!.push(arguments);
  }
  gtag('consent', command, signals);
}

// Defense-in-depth: the measurement id is interpolated into an inline script,
// so it must look like a measurement id — anything else renders nothing.
const GA_ID_SHAPE = /^[A-Za-z0-9-]+$/;

export function GoogleAnalyticsGated({ mechanismEnabled }: { mechanismEnabled: boolean }) {
  const gaId = process.env.NEXT_PUBLIC_GA_ID;
  const [analyticsGranted, setAnalyticsGranted] = useState(false);

  useEffect(() => {
    if (!mechanismEnabled) return;
    let currentAnalytics: boolean | null = null;
    let currentMarketing: boolean | null = null;
    let defaultPushed = false;
    const sync = () => {
      const nextAnalytics = CookieConsent.acceptedCategory('analytics');
      const nextMarketing = CookieConsent.acceptedCategory('marketing');
      if (nextAnalytics === currentAnalytics && nextMarketing === currentMarketing) return;
      const first = currentAnalytics === null;
      currentAnalytics = nextAnalytics;
      currentMarketing = nextMarketing;
      if (nextAnalytics) {
        // The first consent command ever must be `default`, queued BEFORE the
        // GA script mounts and processes config; later flips (including a
        // marketing-only toggle while analytics stays granted) are `update`s.
        pushConsent(defaultPushed ? 'update' : 'default', consentSignals(nextAnalytics, nextMarketing));
        defaultPushed = true;
      } else if (!first && defaultPushed) {
        // Analytics revoked after being granted: live update to all-denied
        // (marketing alone, without analytics, was never observable — see
        // the comment above pushConsent).
        pushConsent('update', consentSignals(false, false));
      }
      setAnalyticsGranted(nextAnalytics);
    };
    sync();
    window.addEventListener('cc:onConsent', sync);
    window.addEventListener('cc:onChange', sync);
    return () => {
      window.removeEventListener('cc:onConsent', sync);
      window.removeEventListener('cc:onChange', sync);
    };
  }, [mechanismEnabled]);

  if (!mechanismEnabled) return null;
  if (!shouldLoadAnalytics(gaId, analyticsGranted)) return null;
  if (!GA_ID_SHAPE.test(gaId as string)) return null;
  // Rendered at most once per page tree (one gate per layout group);
  // next/script additionally dedupes by id across remounts. gtag.js processes
  // the dataLayer as a queue, so the consent default pushed above and any
  // queued business events are honored regardless of script arrival time.
  // Suspense: useSearchParams inside PageViewTracker requires a boundary on
  // statically-rendered pages (e.g. /auth/signup/success).
  return (
    <>
      <Script id="ga-gtag-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${gaId}', { send_page_view: false });`}
      </Script>
      <Script
        id="ga-gtag-src"
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId as string)}`}
        strategy="afterInteractive"
      />
      <Suspense fallback={null}>
        <PageViewTracker />
      </Suspense>
    </>
  );
}
