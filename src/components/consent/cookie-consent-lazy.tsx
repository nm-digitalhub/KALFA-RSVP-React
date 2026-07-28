'use client';

import dynamic from 'next/dynamic';

// Client wrapper whose sole job is the ssr:false dynamic import of the banner.
// Both constraints come from the installed lazy-loading guide
// (node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md): `ssr: false`
// is an error in Server Components, and a dynamic import made FROM a Server
// Component does not code-split at all — so this wrapper is the only shape
// that actually moves vanilla-cookieconsent's JS+CSS out of the
// render-blocking path. The banner initialises in a client effect and renders
// nothing itself, so skipping SSR changes nothing visible.
export const CookieConsentBannerLazy = dynamic(
  () => import('./cookie-consent').then((m) => m.CookieConsentBanner),
  { ssr: false },
);
