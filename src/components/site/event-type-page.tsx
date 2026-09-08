import Link from 'next/link';
import { ArrowLeft, CalendarClock, CircleCheck, ListChecks, Sparkles } from 'lucide-react';

import { siteCta } from '@/components/site/cta';
import { getUser } from '@/lib/auth/dal';
import { buildFaqJsonLd, faqJsonLdScript } from '@/lib/faq/json-ld';
import type { EventTypeContent } from '@/lib/marketing/event-types';

// Shared layout for the four event-type marketing pages. The four page files
// (/wedding, /bar-mitzva, /brit, /event) are thin — they pick an entry from
// src/lib/marketing/event-types.ts and hand it here, so the DIFFERENCES
// between them live in the catalogue where they can be compared, and the
// markup exists once.
//
// Deliberately NOT a dynamic `[eventType]` segment: a dynamic segment at the
// site root would sit ahead of the `[...catchAll]` 404 handler for every
// unmatched path (Next sorts `[slug]` before `[...catchAll]` — see that
// file's header), swallowing real 404s. Four explicit routes cost four
// fifteen-line files and keep the 404 behaviour exactly as it is.
//
// Header and footer come from the (site) layout — this renders <main> only,
// same as every other page in the group.

function Eyebrow({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-primary${className ? ` ${className}` : ''}`}
    >
      <Sparkles className="size-4" aria-hidden />
      {children}
    </span>
  );
}

export async function EventTypePage({ content }: { content: EventTypeContent }) {
  // Returning visitors go to their dashboard rather than to sign-up. getUser
  // is React-cache()d and the (site) layout's SiteHeader already called it for
  // this request — no extra round trip.
  const user = await getUser();
  const startHref = user ? '/app/events/new' : '/auth/signup';
  const startLabel = user ? 'אירוע חדש' : 'צרו אירוע חדש';

  const jsonLd = buildFaqJsonLd(
    content.faq.map((f) => ({ question: f.q, answer: f.a })),
  );

  return (
    <div className="bg-background">
      {/* FAQPage structured data — the same builder and the same `<` escape the
          /faq page uses. Questions come from the catalogue that renders below,
          so the visible page and the structured data cannot diverge. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: faqJsonLdScript(jsonLd) }}
      />

      <main>
        {/* Hero — py-10 on mobile to match the home page's rhythm under the
            64px sticky header. */}
        {/* Same hero treatment as the homepage (src/app/(public)/(site)/page.tsx):
            primary-tinted radial wash behind the copy and fluid `text-title`
            instead of the 640px size jump. */}
        <section className="relative isolate mx-auto max-w-6xl px-6 py-10 before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:bg-radial-[at_top_end] before:from-primary/10 before:via-transparent before:to-transparent sm:py-16">
          <div>
            <Eyebrow className="transition-[opacity,translate] duration-700 ease-k-out motion-safe:starting:opacity-0 motion-safe:starting:translate-y-3">{content.eyebrow}</Eyebrow>
            <h1 className="mt-4 max-w-3xl text-balance text-title font-extrabold tracking-tight transition-[opacity,translate] duration-700 ease-k-out motion-safe:starting:opacity-0 motion-safe:starting:translate-y-3 k-delay-100">
              {content.h1}
            </h1>
            <p className="mt-5 max-w-prose text-pretty text-lg text-muted-foreground transition-[opacity,translate] duration-700 ease-k-out motion-safe:starting:opacity-0 motion-safe:starting:translate-y-3 k-delay-200">{content.lede}</p>
            <div className="mt-7 flex flex-wrap gap-3 transition-[opacity,translate] duration-700 ease-k-out motion-safe:starting:opacity-0 motion-safe:starting:translate-y-3 k-delay-300">
              <Link href={startHref} className={siteCta()}>
                {startLabel}
                <ArrowLeft className="size-5" aria-hidden />
              </Link>
              <Link href="/guest-list-template" className={siteCta({ variant: 'outline' })}>
                תבנית רשימת מוזמנים
              </Link>
            </div>
          </div>
        </section>

        {/* What makes this event type different */}
        <section className="border-y border-border bg-[#f9fafb]">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <h2 className="max-w-2xl text-balance text-display font-bold tracking-tight">
              {content.challengesTitle}
            </h2>
            <div className="k-reveal-group mt-10 grid gap-4 sm:grid-cols-2">
              {content.challenges.map(({ t, d }) => (
                <div key={t} className="k-card rounded-xl border border-border bg-background p-6 hover:shadow-md">
                  <h3 className="text-lg font-bold">{t}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Timing */}
        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-primary">
                <CalendarClock className="size-4" aria-hidden />
                לוח זמנים
              </span>
              <h2 className="mt-4 text-balance text-display font-bold tracking-tight">
                {content.timingTitle}
              </h2>
              <p className="mt-3 text-pretty text-lg text-muted-foreground">
                המלצה מעשית — לא כלל ברזל. אפשר להתאים לכל אירוע.
              </p>
            </div>
            <ol className="k-reveal-group grid gap-3">
              {content.timing.map((step, i) => (
                <li
                  key={step}
                  className="flex items-start gap-3.5 rounded-lg border border-border bg-background px-4 py-4"
                >
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#0b0f1a] text-xs font-semibold text-white">
                    {i + 1}
                  </span>
                  <span className="text-sm leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* FAQ — expanded, never behind an accordion: this is a public page
            meant to be extractable by search and AI answer engines, the same
            reasoning as /faq. */}
        <section className="border-t border-border bg-[#f9fafb]">
          <div className="mx-auto max-w-3xl px-6 py-16">
            <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-primary">
              <ListChecks className="size-4" aria-hidden />
              שאלות נפוצות
            </span>
            <h2 className="mt-3 text-balance text-display font-bold tracking-tight">
              שאלות שחוזרות על עצמן
            </h2>
            <div className="k-reveal-group mt-8 space-y-8">
              {content.faq.map((f) => (
                <div key={f.q} className="border-b border-border pb-6 last:border-b-0 last:pb-0">
                  <h3 className="text-lg font-bold">{f.q}</h3>
                  <p className="mt-2 max-w-prose text-base leading-relaxed text-muted-foreground">
                    {f.a}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-10 text-muted-foreground">
              שאלות נוספות על המערכת ועל המחיר —{' '}
              <Link href="/faq" className="font-semibold text-primary hover:underline">
                בעמוד השאלות הנפוצות
              </Link>
              .
            </p>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="k-reveal k-sheen relative isolate overflow-hidden rounded-3xl bg-primary px-8 py-14 text-center before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:bg-radial-[at_top_start] before:from-white/15 before:to-transparent">
            <h2 className="text-balance text-display font-extrabold tracking-tight text-primary-foreground">
              {content.h1} — במקום אחד
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-pretty text-primary-foreground/90">
              רשימה מסודרת, תזכורות אוטומטיות ותמונת מצב שמתעדכנת מעצמה.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Link href={startHref} className={siteCta({ variant: 'dark', size: 'xl' })}>
                {startLabel}
                <ArrowLeft className="size-5" aria-hidden />
              </Link>
              <Link href="/" className={siteCta({ variant: 'onPrimary', size: 'xl' })}>
                <CircleCheck className="size-5" aria-hidden />
                איך המערכת עובדת
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
