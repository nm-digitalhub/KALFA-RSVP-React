import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { LandingHeaderNav } from '@/components/landing-header-nav';
import { LandingMobileNav } from '@/components/landing-mobile-nav';
import { LandingUserMenu } from '@/components/landing-user-menu';
import { getUser } from '@/lib/auth/dal';
import { getProfile } from '@/lib/data/profiles';

// Shared header for the public MARKETING pages — mounted once in
// src/app/(public)/(site)/layout.tsx, the same nested-layout pattern as
// SiteFooter (owner report 2026-08-24: the menu existed only on the homepage;
// /faq and /contact had a bare "KALFA · לעמוד הבית" bar and the legal pages
// had no header at all).
//
// Server Component: reads the signed-in user (getUser is React-cache()d, so a
// page that also calls it costs no second round trip) to swap the auth CTAs
// for the account menu. Layouts do not re-render on client navigation
// (installed Next.js docs, layout.md "Caveats"); that is fine here because
// sign-in / sign-out always end in a redirect, i.e. a full navigation.
//
// The nav's in-page items are absolute (`/#features` …) so they work from
// every page — Next.js <Link> scrolls to the id after navigating
// (link.md "Scrolling to an id").

export async function SiteHeader() {
  const user = await getUser();
  // Full name for the account menu; same lookup and fallback rule as the
  // customer app shell (src/app/(customer)/app/layout.tsx).
  const profile = user ? await getProfile() : null;
  const userName = profile?.full_name?.trim() || undefined;

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur-md backdrop-saturate-150">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="text-2xl font-extrabold tracking-tight">
          KALFA
        </Link>
        {/* Desktop nav: shadcn NavigationMenu (flat links). Hidden below md,
            where the drawer (LandingMobileNav) carries the same five items. */}
        <LandingHeaderNav className="hidden md:flex" />
        <div className="flex items-center gap-3">
          {user ? (
            <LandingUserMenu userEmail={user.email} userName={userName} />
          ) : (
            // Hidden below md: these two live inside the mobile drawer
            // instead, so the mobile header stays logo + hamburger only.
            <div className="hidden items-center gap-3 md:flex">
              <Link href="/auth/login" className="text-sm font-semibold hover:underline">
                כניסה
              </Link>
              <Link
                href="/auth/signup"
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
              >
                צרו אירוע
                <ArrowLeft className="size-4" />
              </Link>
            </div>
          )}
          {/* Below md, the nav and the CTAs/auth links are hidden — this
              hamburger is the only way to reach them. */}
          <LandingMobileNav showAuthCta={!user} />
        </div>
      </div>
    </header>
  );
}
