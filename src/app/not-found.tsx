import Image from 'next/image';
import Link from 'next/link';
import { MailQuestionMark } from 'lucide-react';

import { getT } from '@/i18n.server';
import { hrefInLanguage } from '@/lib/i18n/site-language';

import { BackLink } from './not-found-back-link';

// Root not-found for unknown public routes. Deliberately on-brand rather than
// a generic error page: "לא ברשימת המוזמנים" turns a dead link into a small
// moment that reads like the rest of an RSVP product, not a framework default.
//
// This renders under the root layout, outside the I18nProvider of
// (public)/layout.tsx, so the text comes from the server getT and links use
// hrefInLanguage directly: SiteLink and useT need that provider.
export default async function NotFound() {
  const { t, lng } = await getT('public');
  return (
    <main className="flex min-h-dvh flex-col items-center bg-background px-6 pb-16 pt-10 text-center">
      <Link href={hrefInLanguage('/', lng)} className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
        <Image src="/icons/icon.svg" alt="" width={32} height={32} className="rounded-lg" />
        KALFA
      </Link>

      {/* Giant pale "404", deliberately overlapped by the card below — NOT
          via position:absolute (a `top` offset disconnected from the card's
          actual height hides all but a sliver of the watermark at the very
          top, leaving unrecognizable fragments instead of "404"). Plain
          normal-flow CSS instead: a negative bottom margin pulls the card up
          over the watermark's lower third. No z-index needed — a later
          sibling already paints over an earlier one where negative margins
          make them overlap.

          The mask-image gradient fades the watermark's OWN opacity to zero
          right where the card covers it, so the edge reads as a dissolve
          instead of a hard line — deliberately NOT card
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
        <h1 className="text-xl font-bold">{t('site.notFound.title', 'אופס, הדף הזה לא ברשימת המוזמנים')}</h1>
        <p className="text-muted-foreground">
          {t('site.notFound.description', 'ייתכן שהקישור שגוי, שהדף הוסר או שההזמנה כבר אינה זמינה.')}
        </p>
        <Link
          href={hrefInLanguage('/', lng)}
          className="inline-block w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 sm:w-auto sm:px-6"
        >
          {t('site.notFound.home', 'חזרה לדף הבית')}
        </Link>
        <BackLink label={t('site.notFound.back', 'חזרה לעמוד הקודם')} />
        <Link href={hrefInLanguage('/contact', lng)} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          {t('site.notFound.help', 'צריכים עזרה? צרו איתנו קשר')}
        </Link>
      </div>

      <nav aria-label={t('site.notFound.navAriaLabel', 'קישורים שימושיים')} className="mt-8 flex items-center gap-4 text-sm text-muted-foreground">
        <Link href={hrefInLanguage('/faq', lng)} className="inline-flex min-h-11 items-center hover:underline">
          {t('site.notFound.faq', 'שאלות נפוצות')}
        </Link>
        <span aria-hidden="true">·</span>
        <Link href={hrefInLanguage('/contact', lng)} className="inline-flex min-h-11 items-center hover:underline">
          {t('site.notFound.contact', 'יצירת קשר')}
        </Link>
        <span aria-hidden="true">·</span>
        <Link href={hrefInLanguage('/privacy', lng)} className="inline-flex min-h-11 items-center hover:underline">
          {t('site.notFound.privacy', 'פרטיות')}
        </Link>
      </nav>
    </main>
  );
}
