import Link from 'next/link';
import { ArrowLeft, CalendarClock, CircleCheck, ListChecks, Sparkles } from 'lucide-react';

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

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-primary">
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
        <section className="mx-auto max-w-6xl px-6 py-10 sm:py-16">
          <Eyebrow>{content.eyebrow}</Eyebrow>
          <h1 className="mt-4 max-w-3xl text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            {content.h1}
          </h1>
          <p className="mt-5 max-w-prose text-lg text-muted-foreground">{content.lede}</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href={startHref}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 font-semibold text-primary-foreground transition hover:opacity-90"
            >
              {startLabel}
              <ArrowLeft className="size-5" aria-hidden />
            </Link>
            <Link
              href="/guest-list-template"
              className="inline-flex items-center gap-2 rounded-md border border-border px-6 py-3 font-semibold transition hover:bg-[#f9fafb]"
            >
              תבנית רשימת מוזמנים
            </Link>
          </div>
        </section>

        {/* What makes this event type different */}
        <section className="border-y border-border bg-[#f9fafb]">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <h2 className="max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
              {content.challengesTitle}
            </h2>
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {content.challenges.map(({ t, d }) => (
                <div key={t} className="rounded-xl border border-border bg-background p-6">
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
              <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
                {content.timingTitle}
              </h2>
              <p className="mt-3 text-lg text-muted-foreground">
                המלצה מעשית — לא כלל ברזל. אפשר להתאים לכל אירוע.
              </p>
            </div>
            <ol className="grid gap-3">
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
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              שאלות שחוזרות על עצמן
            </h2>
            <div className="mt-8 space-y-8">
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
          <div className="overflow-hidden rounded-3xl bg-primary px-8 py-14 text-center">
            <h2 className="text-3xl font-extrabold leading-tight tracking-tight text-primary-foreground sm:text-4xl">
              {content.h1} — במקום אחד
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-primary-foreground/90">
              רשימה מסודרת, תזכורות אוטומטיות ותמונת מצב שמתעדכנת מעצמה.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Link
                href={startHref}
                className="inline-flex items-center gap-2 rounded-md bg-[#0b0f1a] px-7 py-3.5 font-semibold text-white transition hover:opacity-90"
              >
                {startLabel}
                <ArrowLeft className="size-5" aria-hidden />
              </Link>
              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-md border border-white/40 bg-white/15 px-7 py-3.5 font-semibold text-primary-foreground transition hover:bg-white/25"
              >
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
