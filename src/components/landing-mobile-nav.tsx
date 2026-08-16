'use client';

import { useState } from 'react';
import Link from 'next/link';
import { DirectionProvider } from '@base-ui/react/direction-provider';
import { ArrowLeft, Menu } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

// Mobile nav drawer for the public landing header. The header's in-page nav
// (#features/#how/#trust), "שאלות נפוצות" and "יצירת קשר" are `hidden md:flex`
// — below that breakpoint this hamburger is the only way to reach them, so an anonymous
// visitor on a phone isn't stuck with only the footer link. Base UI's Dialog
// portal ignores the DOM `dir` attribute (same as the dropdown menu in
// landing-user-menu.tsx and the mobile sidebar sheet in app-shell.tsx), so it
// needs its own DirectionProvider.
//
// `open` is controlled (rather than left to the Sheet's own state) so nav
// clicks can close the drawer immediately instead of leaving it open behind
// the navigation/scroll.

const NAV_LINK_CLASS =
  'rounded-md px-2 py-2.5 text-base font-medium text-foreground hover:bg-muted';

export function LandingMobileNav({
  // Anonymous visitors also get כניסה/צרו אירוע inside the drawer — on mobile
  // those buttons are hidden from the header bar itself to avoid crowding
  // logo + CTAs + hamburger into one row (see the (public)/page.tsx header).
  // Logged-in visitors already have those account actions in the avatar menu.
  showAuthCta,
}: {
  showAuthCta: boolean;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <DirectionProvider direction="rtl">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          render={
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="תפריט">
              <Menu />
            </Button>
          }
        />
        <SheetContent side="right">
          <SheetHeader className="sr-only">
            <SheetTitle>ניווט</SheetTitle>
            <SheetDescription>תפריט ניווט לעמוד הבית</SheetDescription>
          </SheetHeader>
          <nav className="flex flex-col gap-1 px-4" aria-label="ניווט בעמוד">
            <a href="#features" onClick={close} className={NAV_LINK_CLASS}>
              יכולות
            </a>
            <a href="#how" onClick={close} className={NAV_LINK_CLASS}>
              איך זה עובד
            </a>
            <a href="#trust" onClick={close} className={NAV_LINK_CLASS}>
              אמון
            </a>
            <Link href="/faq" onClick={close} className={NAV_LINK_CLASS}>
              שאלות נפוצות
            </Link>
            <Link href="/contact" onClick={close} className={NAV_LINK_CLASS}>
              יצירת קשר
            </Link>
          </nav>
          {showAuthCta ? (
            <SheetFooter className="border-t border-border">
              <Link
                href="/auth/login"
                onClick={close}
                className="rounded-md px-2 py-2.5 text-center text-base font-semibold hover:bg-muted"
              >
                כניסה
              </Link>
              <Link
                href="/auth/signup"
                onClick={close}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-base font-semibold text-primary-foreground transition hover:opacity-90"
              >
                צרו אירוע
                <ArrowLeft className="size-4" />
              </Link>
            </SheetFooter>
          ) : null}
        </SheetContent>
      </Sheet>
    </DirectionProvider>
  );
}
