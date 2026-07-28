'use client';

import * as CookieConsent from 'vanilla-cookieconsent';

import type { GaActionEvent } from '@/lib/analytics/ga-event-contracts';

// Business-event sender. Pushes the gtag `event` command DIRECTLY into the
// dataLayer (Google's own documented queuing pattern) instead of going through
// sendGAEvent, which silently drops events fired before <GoogleAnalytics/>
// finishes mounting — exactly the race a post-redirect flag event would lose.
// Anything queued here is processed by gtag.js the moment it loads.
//
// Consent guard: without an `analytics` grant nothing is pushed at all — the
// tag itself is also hard-gated, so this is belt on top of braces.
export function sendBusinessEvent(event: GaActionEvent): void {
  if (typeof window === 'undefined') return;
  try {
    if (!CookieConsent.acceptedCategory('analytics')) return;
  } catch {
    return; // consent runtime not initialized — treat as no consent
  }
  type DataLayerWindow = Window & { dataLayer?: unknown[] };
  const w = window as DataLayerWindow;
  w.dataLayer = w.dataLayer || [];
  function gtag(..._args: unknown[]) {
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer!.push(arguments);
  }
  gtag('event', event.name, event.params ?? {});
}
