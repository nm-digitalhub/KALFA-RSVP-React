import type { TFunction } from 'i18next';
import type { Metadata } from 'next';
import { SiteLink as Link } from '@/components/site/site-link';
import { Info, Route, ShieldCheck, Wallet, type LucideIcon } from 'lucide-react';
import { Trans } from 'react-i18next/TransWithoutContext';

import { getPublishedFaqItems } from '@/lib/data/faq';
import { getPublicBusinessFacts } from '@/lib/data/public-business-facts';
import { buildFaqJsonLd, faqJsonLdScript } from '@/lib/faq/json-ld';
import { getT } from '@/i18n.server';
import {
  buildFaqPageModel,
  flattenFaqEntries,
  type FaqCategory,
} from '@/lib/faq/page-model';
import { pageOpenGraph } from '@/lib/seo/open-graph';

// Title and description are declared once and reused for the Open Graph
// block — the share preview and the search snippet must not drift apart.
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('public');
  const pageTitle = t('site.faq.meta.title', 'שאלות נפוצות');
  const pageDescription = t(
    'site.faq.meta.description',
    'תשובות על KALFA במקום אחד: מה המערכת עושה, איך מנהלים אירוע מההתחלה ועד הסוף, איך בנוי התמחור והחיוב, ומה קורה במקרה של ביטול.',
  );
  return {
    title: pageTitle,
    description: pageDescription,
    // Nested metadata objects are REPLACED, not merged: a page that sets no
    // openGraph inherits the root layout's wholesale, so its share preview
    // would show the site-wide blurb instead of this page's.
    openGraph: pageOpenGraph(pageTitle, pageDescription, '/faq'),
    alternates: { canonical: '/faq' },
  };
}

// Content is DB-backed (admin-editable, /admin/faq) and the price card and
// pricing tokens read the packages on sale at render time — render per-request,
// same reasoning as /contact and /terms.
export const dynamic = 'force-dynamic';

// Presentational only (icon + short eyebrow label above each section's H2)
// — not business content, so it lives here rather than in
// src/lib/faq/page-model.ts alongside the real section titles.
const sectionEyebrow = (t: TFunction<'public'>): Record<FaqCategory, { icon: LucideIcon; label: string }> => ({
  about: { icon: Info, label: t('site.faq.eyebrow.about', 'אודות') },
  pricing: { icon: Wallet, label: t('site.faq.eyebrow.pricing', 'תמחור') },
  how_it_works: { icon: Route, label: t('site.faq.eyebrow.howItWorks', 'תהליך העבודה') },
  legal_support: { icon: ShieldCheck, label: t('site.faq.eyebrow.legalSupport', 'משפטי ותמיכה') },
});

// Public FAQ page (beta.kalfa.me/faq). Hebrew, RTL. Every question below the
// price card (except the code-owned billing-unit one, see
// src/lib/faq/page-model.ts) is a genuinely PUBLIC, admin-managed row (RLS
// `faq_items_public_read`, published-only) — no auth, no session required. All 14 questions render
// fully expanded (no accordion): this is a public marketing/AI-search page,
// and hiding an answer behind a click interaction is exactly what the SEO/GEO
// plan warns against for FAQ content (answer-first, extractable by AI search).
export default async function FaqPage() {
  const { t, i18n } = await getT('public');
  // No getAppOrigin() call here — unlike the home page's Organization/WebSite
  // JSON-LD (which embeds absolute @id URLs), a FAQPage schema needs no site
  // origin at all (see src/lib/faq/json-ld.ts).
  // (The signed-in user is read by the (site) layout's SiteHeader now — this
  // page has no user-dependent content of its own.)
  const [items, facts] = await Promise.all([getPublishedFaqItems(), getPublicBusinessFacts()]);
  const model = buildFaqPageModel(items, facts);
  const jsonLd = buildFaqJsonLd(flattenFaqEntries(model));
  const eyebrows = sectionEyebrow(t);

  return (
    <div className="bg-background">
      <script
        type="application/ld+json"
        // Same `<` escape as the home page's JSON-LD — load-bearing here since
        // every answer below is admin-editable text (src/lib/faq/json-ld.ts).
        dangerouslySetInnerHTML={{ __html: faqJsonLdScript(jsonLd) }}
      />

      {/* Header: the shared SiteHeader from the (site) layout. */}
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-12">
        <div>
          <h1 className="text-balance text-display font-extrabold tracking-tight transition-[opacity,translate] duration-700 ease-k-out motion-safe:starting:translate-y-3">{t('site.faq.title', 'שאלות נפוצות')}</h1>
          <p className="mt-2 max-w-prose text-pretty text-lg text-muted-foreground transition-[opacity,translate] duration-700 ease-k-out motion-safe:starting:translate-y-3 k-delay-100">
            {t('site.faq.subtitle', 'כל מה שצריך לדעת על KALFA: מה זה, איך זה עובד, כמה זה עולה ומה קורה אם רוצים לבטל.')}
          </p>
        </div>

        {/* Price card — always visible, before any question, never inside an
            accordion: the price is the first thing a reader sees, not something
            they opt into revealing. Text is built from the packages on sale
            (buildBusinessFacts().summary_he), never re-typed here. */}
        <div className="mt-8 rounded-xl border border-primary/30 bg-indigo-50 p-6">
          <h2 className="text-xl font-bold text-indigo-900">{model.priceCard.question}</h2>
          <p className="mt-2 leading-relaxed text-indigo-950/90">{model.priceCard.answer}</p>
        </div>

        {model.sections.length > 0 ? (
          <>
            {/* Category chips: 44px touch target and the
                shared keyboard focus outline; the sections they jump to carry
                `scroll-mt-20` so the title lands below the 64px sticky
                header instead of under it. */}
            <nav aria-label={t('site.faq.categoriesAriaLabel', 'קטגוריות שאלות')} className="mt-8 flex flex-wrap gap-2">
              {model.sections.map((section) => (
                <a
                  key={section.category}
                  href={`#section-${section.category}`}
                  className="inline-flex min-h-11 items-center rounded-full border border-border px-4 py-1.5 text-sm font-medium text-muted-foreground transition hover:border-primary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {section.title}
                </a>
              ))}
            </nav>

            {model.sections.map((section, index) => {
              const { icon: Icon, label } = eyebrows[section.category];
              return (
                <section
                  key={section.category}
                  id={`section-${section.category}`}
                  className={`scroll-mt-20 py-12 sm:py-14 ${index > 0 ? 'border-t border-border' : 'mt-2'}`}
                >
                  <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-primary">
                    <Icon className="size-4" aria-hidden />
                    {label}
                  </span>
                  <h2 className="mt-2 text-xl font-bold sm:text-2xl">{section.title}</h2>

                  <div className="k-reveal-group mt-6 space-y-8 sm:space-y-10">
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
            <Trans
              t={t}
              i18n={i18n}
              i18nKey="site.faq.contactFallback"
              defaults="לשאלות נוספות אפשר <contact>ליצור קשר</contact>."
              components={{ contact: <Link href="/contact" className="font-semibold text-primary hover:underline" /> }}
            />
          </p>
        )}

        <p className="mt-12 border-t border-border pt-8 text-muted-foreground">
          <Trans
            t={t}
            i18n={i18n}
            i18nKey="site.faq.notFound"
            defaults="לא מצאתם תשובה? <contact>צרו קשר</contact> ונחזור אליכם."
            components={{ contact: <Link href="/contact" className="font-semibold text-primary hover:underline" /> }}
          />
        </p>
      </main>
    </div>
  );
}
