import Image from 'next/image';
import Link from 'next/link';
import { MailQuestionMark } from 'lucide-react';

import { BackLink } from './not-found-back-link';

// Root not-found for unknown public routes. Deliberately on-brand rather than
// a generic error page (owner spec 2026-08-25): "לא ברשימת המוזמנים" turns a
// dead link into a small moment that reads like the rest of an RSVP product,
// not a framework default.
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center bg-background px-6 pb-16 pt-10 text-center">
      <Link href="/" className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
        <Image src="/icons/icon.svg" alt="" width={32} height={32} className="rounded-lg" />
        KALFA
      </Link>

      {/* Giant pale "404", deliberately overlapped by the card below — NOT
          via position:absolute (an earlier version did that with a `top`
          offset disconnected from the card's actual height, which hid all
          but a sliver at the very top; caught live 2026-08-25, screenshot
          showed unrecognizable fragments instead of "404"). Plain normal-flow
          CSS instead: a negative bottom margin pulls the card up over the
          watermark's lower third. No z-index needed — a later sibling
          already paints over an earlier one where negative margins make them
          overlap.

          The mask-image gradient (owner request 2026-08-25: "should the
          hidden part fade instead of being cut off?") fades the watermark's
          OWN opacity to zero right where the card covers it, so the edge
          reads as a dissolve instead of a hard line — deliberately NOT card
          transparency, which would let "404" show through behind the card's
          real text/buttons and risk contrast (WCAG 1.4.3). This only touches
          the decorative element, never the card's content.

          aria-hidden since it's decorative. */}
      <span
        aria-hidden="true"
        className="pointer-events-none -mb-10 mt-2 select-none text-[7rem] font-black leading-none text-primary/15 sm:-mb-12 sm:text-[9rem]"
        style={{
          WebkitMaskImage: 'linear-gradient(to bottom, black 55%, transparent 100%)',
          maskImage: 'linear-gradient(to bottom, black 55%, transparent 100%)',
        }}
      >
        404
      </span>

      <div className="mt-2 flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-border bg-card px-6 py-10 shadow-sm">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
          <MailQuestionMark className="size-6 text-primary" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-bold">אופס, הדף הזה לא ברשימת המוזמנים</h1>
        <p className="text-muted-foreground">
          ייתכן שהקישור שגוי, שהדף הוסר או שההזמנה כבר אינה זמינה.
        </p>
        <Link
          href="/"
          className="inline-block w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 sm:w-auto sm:px-6"
        >
          חזרה לדף הבית
        </Link>
        <BackLink />
        <Link href="/contact" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          צריכים עזרה? צרו איתנו קשר
        </Link>
      </div>

      <nav className="mt-8 flex items-center gap-4 text-sm text-muted-foreground">
        <Link href="/faq" className="hover:underline">
          שאלות נפוצות
        </Link>
        <span aria-hidden="true">·</span>
        <Link href="/contact" className="hover:underline">
          יצירת קשר
        </Link>
        <span aria-hidden="true">·</span>
        <Link href="/privacy" className="hover:underline">
          פרטיות
        </Link>
      </nav>
    </main>
  );
}
