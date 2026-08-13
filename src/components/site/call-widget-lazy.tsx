'use client';

import dynamic from 'next/dynamic';

// Client wrapper whose sole job is the ssr:false dynamic import of the call
// widget — same shape and same reason as CookieConsentBannerLazy
// (src/components/consent/cookie-consent-lazy.tsx): the widget imports
// @voximplant/websdk indirectly (via widget-client.ts's dynamic import
// inside startWidgetCall), which needs window/WebRTC and must never be
// pulled into a server render or a Server Component's bundle.
export const CallWidgetLazy = dynamic(
  () => import('./call-widget').then((m) => m.CallWidget),
  { ssr: false },
);
