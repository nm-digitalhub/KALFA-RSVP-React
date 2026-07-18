'use client';

import * as CookieConsent from 'vanilla-cookieconsent';

import { cn } from '@/lib/utils';

// Re-opens the cookie preferences modal from anywhere the user should be able to
// review their choice (footer, privacy page, cookie policy). Uses the library's
// official API rather than a data-attribute so it works regardless of markup.
export function ManageCookiesButton({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
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
