import type { Metadata } from 'next';
import Link from 'next/link';
import { Info, Route, ShieldCheck, Wallet, type LucideIcon } from 'lucide-react';

import { getPublishedFaqItems } from '@/lib/data/faq';
import { getPublicBusinessFacts } from '@/lib/data/public-business-facts';
import { buildFaqJsonLd, faqJsonLdScript } from '@/lib/faq/json-ld';
import {
  buildFaqPageModel,
  flattenFaqEntries,
  type FaqCategory,
} from '@/lib/faq/page-model';

export const metadata: Metadata = {
  title: 'שאלות נפוצות',
  alternates: { canonical: '/faq' },
};

// Content is DB-backed (admin-editable, /admin/faq) and gate-aware (the price
// card and pricing tokens read app_settings.base_overage_pricing_enabled at
// render time) — render per-request, same reasoning as /contact and /terms.
export const dynamic = 'force-dynamic';

// Presentational only (icon + short eyebrow label above each section's H2,
// spec §4) — not business content, so it lives here rather than in
// src/lib/faq/page-model.ts alongside the real section titles.
const SECTION_EYEBROW: Record<FaqCategory, { icon: LucideIcon; label: string }> = {
  about: { icon: Info, label: 'אודות' },
  pricing: { icon: Wallet, label: 'תמחור' },
  how_it_works: { icon: Route, label: 'תהליך העבודה' },
  legal_support: { icon: ShieldCheck, label: 'משפטי ותמיכה' },
};

// Public FAQ page (beta.kalfa.me/faq). Hebrew, RTL. Every question below the
// price card is a genuinely PUBLIC, admin-managed row (RLS `faq_items_public_read`,
// published-only) — no auth, no session required. All 14 questions render
// fully expanded (no accordion): this is a public marketing/AI-search page,
// and hiding an answer behind a click interaction is exactly what the SEO/GEO
// plan warns against for FAQ content (answer-first, extractable by AI search).
export default async function FaqPage() {
  // No getAppOrigin() call here — unlike the home page's Organization/WebSite
  // JSON-LD (which embeds absolute @id URLs), a FAQPage schema needs no site
  // origin at all (see src/lib/faq/json-ld.ts).
  // (The signed-in user is read by the (site) layout's SiteHeader now — this
  // page has no user-dependent content of its own.)
  const [items, facts] = await Promise.all([getPublishedFaqItems(), getPublicBusinessFacts()]);
  const model = buildFaqPageModel(items, facts);
  const jsonLd = buildFaqJsonLd(flattenFaqEntries(model));

  return (
    <div className="bg-background">
      <script
        type="application/ld+json"
        // Same `<` escape as the home page's JSON-LD — load-bearing here since
        // every answer below is admin-editable text (src/lib/faq/json-ld.ts).
        dangerouslySetInnerHTML={{ __html: faqJsonLdScript(jsonLd) }}
      />

      {/* Header: the shared SiteHeader from the (site) layout (24.8). */}
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-12">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">שאלות נפוצות</h1>
          <p className="mt-2 max-w-prose text-lg text-muted-foreground">
            כל מה שצריך לדעת על KALFA — מה זה, איך זה עובד, כמה זה עולה ומה קורה אם רוצים לבטל.
          </p>
        </div>

        {/* Price card — always visible, before any question, never inside an
            accordion (compliance requirement: the ₪200 activation fee must be
            the first thing a reader sees, not something they opt into
            revealing). Text is code-owned (buildBusinessFacts().summary_he),
            never re-typed here. */}
        <div className="mt-8 rounded-xl border border-primary/30 bg-indigo-50 p-6">
          <h2 className="text-xl font-bold text-indigo-900">{model.priceCard.question}</h2>
          <p className="mt-2 leading-relaxed text-indigo-950/90">{model.priceCard.answer}</p>
        </div>

        {model.sections.length > 0 ? (
          <>
            <nav aria-label="קטגוריות שאלות" className="mt-8 flex flex-wrap gap-2">
              {model.sections.map((section) => (
                <a
                  key={section.category}
                  href={`#section-${section.category}`}
                  className="rounded-full border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:border-primary hover:text-foreground"
                >
                  {section.title}
                </a>
              ))}
            </nav>

            {model.sections.map((section, index) => {
              const { icon: Icon, label } = SECTION_EYEBROW[section.category];
              return (
                <section
                  key={section.category}
                  id={`section-${section.category}`}
                  className={`py-12 sm:py-14 ${index > 0 ? 'border-t border-border' : 'mt-2'}`}
                >
                  <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-primary">
                    <Icon className="size-4" aria-hidden />
                    {label}
                  </span>
                  <h2 className="mt-2 text-xl font-bold sm:text-2xl">{section.title}</h2>

                  <div className="mt-6 space-y-8 sm:space-y-10">
                    {section.entries.map((entry, entryIndex) => (
                      <div
                        key={`${section.category}-${entryIndex}`}
                        className="border-b border-border pb-6 last:border-b-0 last:pb-0"
                      >
                        <h3 className="text-lg font-bold">{entry.question}</h3>
                        <p className="mt-2 max-w-prose text-base leading-relaxed text-muted-foreground">
                          {entry.answer}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </>
        ) : (
          // Only reached if the pricing section's code-owned entries were
          // ever removed (they aren't, by construction) AND every DB row is
          // unpublished — kept as a defensive floor, not the expected state.
          <p className="mt-10 text-muted-foreground">
            לשאלות נוספות אפשר{' '}
            <Link href="/contact" className="font-semibold text-primary hover:underline">
              ליצור קשר
            </Link>
            .
          </p>
        )}

        <p className="mt-12 border-t border-border pt-8 text-muted-foreground">
          לא מצאתם תשובה?{' '}
          <Link href="/contact" className="font-semibold text-primary hover:underline">
            צרו קשר
          </Link>{' '}
          ונחזור אליכם.
        </p>
      </main>
    </div>
  );
}
