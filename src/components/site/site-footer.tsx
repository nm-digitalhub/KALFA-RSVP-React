import Link from 'next/link';

import { ManageCookiesButton } from '@/components/consent/manage-cookies-button';

// Shared footer for the public MARKETING pages — mounted once in
// src/app/(public)/(site)/layout.tsx (a nested layout: it wraps every page of
// the `(site)` route group via `children` and is not re-rendered on
// navigation), so /faq, /contact, /privacy, /terms and /cookies get the same
// legal links + the cookie-management control the homepage had, and the guest
// token surfaces (/r /g /ty /join, outside the group) never do.
//
// Single tier ON PURPOSE (footer review 2026-08-24): the previous homepage
// footer stacked three "marketing" columns of non-clickable placeholder text
// (no /about, no /support, no event-type pages exist) above the only row that
// worked, duplicating "יצירת קשר" and repeating the CTA banner's slogan. A
// multi-column footer earns its place only once there are real destinations
// to fill it — until then the header nav already covers the in-page anchors.
//
// Every link is a real route (sitemap.ts is the same six-page list). Links
// are text-sm with vertical padding so the touch target is ≥44px on mobile.

export const FOOTER_LINKS: readonly { href: string; label: string }[] = [
  { href: '/faq', label: 'שאלות נפוצות' },
  { href: '/contact', label: 'יצירת קשר' },
  { href: '/privacy', label: 'מדיניות פרטיות' },
  { href: '/terms', label: 'תקנון' },
  { href: '/cookies', label: 'מדיניות עוגיות' },
];

const LINK_CLASS = 'inline-flex items-center py-2 text-white/60 hover:text-white';

export function SiteFooter({
  widgetClearance = false,
}: {
  // True when the floating "call me now" widget is mounted (fixed bottom-4
  // end-4, ~56px tall incl. margin): adds bottom padding on small screens so
  // the last footer row is never hidden under the button.
  widgetClearance?: boolean;
}) {
  const year = new Date().getFullYear();
  return (
    <footer className="bg-[#0b0f1a] text-white/60">
      <div className={`mx-auto max-w-6xl px-6 pt-10 ${widgetClearance ? 'pb-24 sm:pb-10' : 'pb-10'}`}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
          <Link href="/" className="text-xl font-extrabold text-white hover:text-white">
            KALFA
          </Link>
          <p className="max-w-md text-sm leading-relaxed">
            ניהול אישורי הגעה לאירועים פרטיים ועסקיים — במקום אחד.
          </p>
        </div>
        <nav
          className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-0 border-t border-white/10 pt-3 text-sm"
          aria-label="משפטי ותמיכה"
        >
          {FOOTER_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={LINK_CLASS}>
              {l.label}
            </Link>
          ))}
          <ManageCookiesButton className={LINK_CLASS}>ניהול עוגיות</ManageCookiesButton>
        </nav>
        <p className="mt-3 text-xs">© {year} KALFA · כל הזכויות שמורות</p>
      </div>
    </footer>
  );
}
