'use client';

import dynamic from 'next/dynamic';

// Client wrapper whose sole job is the code-split dynamic import of the
// call-me-now widget — same shape as CookieConsentBannerLazy
// (src/components/consent/cookie-consent-lazy.tsx) and the superseded
// CallWidgetLazy (call-widget-lazy.tsx). No window-only/SDK import lives
// inside call-me-now-widget.tsx (it is plain fetch() calls, unlike the
// WebRTC widget it replaces), so ssr:false is not REQUIRED the way it was
// there — kept anyway for the same reason every other floating site widget
// in this project is lazy: it is below-the-fold, interaction-only chrome
// that should never grow the initial page bundle.
export const CallMeNowWidgetLazy = dynamic(
  () => import('./call-me-now-widget').then((m) => m.CallMeNowWidget),
  { ssr: false },
);
