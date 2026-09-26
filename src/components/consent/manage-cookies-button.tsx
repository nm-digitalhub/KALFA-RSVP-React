'use client';

import * as CookieConsent from 'vanilla-cookieconsent';

import { cn } from '@/lib/utils';

// Re-opens the cookie preferences modal from anywhere the user should be able to
// review their choice (footer, privacy page, cookie policy). Uses the library's
// official API rather than a data-attribute so it works regardless of markup.
//
// `enabled` is the admin master switch (getCookieConsentPublicConfig().enabled),
// passed by the server component that renders the button. When the mechanism
// is off, CookieConsent.run() never executes (cookie-consent.tsx), so
// showPreferences() would be a dead click — the button renders nothing
// instead. A server-sourced prop, not a client "has run" check, so SSR and
// hydration agree and the control never pops in late.
export function ManageCookiesButton({
  enabled,
  className,
  children,
}: {
  enabled: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  if (!enabled) return null;
  return (
    <button
      type="button"
      onClick={() => CookieConsent.showPreferences()}
      className={cn('cursor-pointer underline-offset-4 hover:underline', className)}
    >
      {children ?? 'ניהול עוגיות'}
    </button>
  );
}
