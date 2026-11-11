import type { TFunction } from 'i18next';
import type { Metadata } from 'next';
import { SiteLink as Link } from '@/components/site/site-link';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { Trans } from 'react-i18next/TransWithoutContext';

import { siteCta } from '@/components/site/cta';
import { getUser } from '@/lib/auth/dal';
import { getCompanyLegal } from '@/lib/data/company';
import { getT } from '@/i18n.server';
import { buildBreadcrumbJsonLd, jsonLdScript } from '@/lib/seo/breadcrumb-json-ld';
import { pageOpenGraph } from '@/lib/seo/open-graph';
import { getAppOrigin } from '@/lib/url';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

// Public "about" page — the trust/identity page search engines and AI answer
// engines look for (E-E-A-T) (plans/seo-exposure-plan-2026-09-27.md).
//
// CONTENT RULES — read before editing:
// 1. Only shipped capabilities, the same truthfulness rule as
//    src/lib/marketing/event-types.ts. about-page.test.ts pins the forbidden
//    capability strings for this file too.
// 2. No invented story, team, customer counts, testimonials or statistics.
// 3. The operator's identity is read from the admin-managed company settings
//    (the same getCompanyLegal() reader the terms/privacy pages and the home
//    page's Organization JSON-LD use) — never typed here. An empty value is
//    omitted, never replaced with a placeholder.
// 4. Pricing is not restated here; it links to /faq, whose numbers come from
//    the live package row.

const aboutTitle = (t: TFunction<'public'>) => t('site.about.meta.title', 'אודות KALFA — מערכת ישראלית לאישורי הגעה');

// Not translated yet: it says the system is in Hebrew, and the owner decides that wording for en and fr first.
const DESCRIPTION =
  'מי אנחנו ומה KALFA עושה: מערכת ישראלית בעברית לניהול אישורי הגעה לאירועים פרטיים — רשימת מוזמנים, הזמנות, תזכורות ומעקב תשובות.';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('public');
  const pageTitle = aboutTitle(t);
  return {
    title: pageTitle,
    description: DESCRIPTION,
    openGraph: pageOpenGraph(pageTitle, DESCRIPTION, '/about'),
    alternates: { canonical: '/about' },
  };
}

// Reads the company settings per request, like /terms and /privacy.

const doesItems = (t: TFunction<'public'>): readonly { title: string; d: string }[] => [
  {
    title: t('site.about.does.items.guestList.title', 'רשימת מוזמנים אחת'),
    d: t('site.about.does.items.guestList.body', 'קבוצות, מלווים, הערות וסטטוסים במקום אחד, עם ייבוא מקובץ או מוואטסאפ.'),
  },
  {
    title: t('site.about.does.items.personalInvite.title', 'הזמנה אישית ותזכורות'),
    d: t('site.about.does.items.personalInvite.body', 'פנייה אישית לכל מוזמן, ותזכורות אוטומטיות רק למי שעוד לא ענה.'),
  },
  {
    title: t('site.about.does.items.privateLink.title', 'תשובה דרך קישור פרטי'),
    d: t('site.about.does.items.privateLink.body', 'כל מוזמן עונה דרך קישור משלו ורואה רק את הפרטים שלו — לא את הרשימה ולא את תשובות האחרים.'),
  },
  {
    title: t('site.about.does.items.snapshot.title', 'תמונת מצב למארגן'),
    d: t('site.about.does.items.snapshot.body', 'מי אישר, מי ממתין וכמה מגיעים — מתעדכן עם כל תשובה.'),
  },
];

const principles = (t: TFunction<'public'>): readonly { title: string; d: string }[] => [
  {
    title: t('site.about.principles.items.hebrewFirst.title', 'עברית קודם'),
    // Not translated yet: it says the text was not translated, and the owner decides that wording for en and fr first.
    d: 'הממשק, ההודעות ודפי התשובה נכתבו בעברית ומימין לשמאל מההתחלה — לא תורגמו.',
  },
  {
    title: t('site.about.principles.items.noShabbat.title', 'בלי פניות בשבת ובחג'),
    d: t('site.about.principles.items.noShabbat.body', 'פנייה שמועדה נופל בשבת, בחג או בשעות הלילה מתוזמנת מחדש אוטומטית לחלון השליחה הבא.'),
  },
  {
    title: t('site.about.principles.items.dataOwnership.title', 'הנתונים של האירוע שייכים לבעל האירוע'),
    // Mirrors the owner-approved /faq answer on data ownership, not new wording.
    d: t('site.about.principles.items.dataOwnership.body', 'נתוני המוזמנים שייכים לבעל האירוע. KALFA מעבדת אותם בשמו ולא מוכרת מידע אישי לצד שלישי. הפירוט המלא נמצא במדיניות הפרטיות.'),
  },
  {
    title: t('site.about.principles.items.openPrice.title', 'מחיר גלוי מראש'),
    d: t('site.about.principles.items.openPrice.body', 'התמחור, מה כלול בו ומתי מתווסף חיוב מפורטים בשאלות הנפוצות ובתקנון — לפני שמתחייבים.'),
  },
];

export default async function AboutPage() {
  const { t, i18n } = await getT('public');
  const [user, origin] = await Promise.all([getUser(), getAppOrigin()]);
  const startHref = user ? '/app/events/new' : '/auth/signup';
  const startLabel = user ? t('site.about.cta.newEvent', 'אירוע חדש') : t('site.about.cta.createEvent', 'צרו אירוע חדש');

  // Identity is optional content: a settings read failure must not break the
  // page, it just drops the operator paragraph (same fail-soft rule as the
  // home page's Organization JSON-LD).
  let operatorName = '';
  let operatorAddress = '';
  try {
    const company = await getCompanyLegal();
    operatorName = company.name.trim();
    operatorAddress = company.address.trim();
  } catch {
    // omit the operator paragraph
  }

  // AboutPage pointing at the Organization node the home page already
  // publishes (same @id), so the two describe one entity rather than two.
  const aboutJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    url: `${origin}/about`,
    name: aboutTitle(t),
    description: DESCRIPTION,
    inLanguage: 'he-IL',
    about: { '@id': `${origin}/#organization` },
  };
  const breadcrumb = buildBreadcrumbJsonLd(origin, t('site.about.breadcrumb', 'אודות'));

  return (
    <div className="bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(aboutJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumb) }}
      />

      <main>
        <section className="relative isolate mx-auto max-w-6xl px-6 py-10 before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:bg-radial-[at_top_end] before:from-primary/10 before:via-transparent before:to-transparent sm:py-16">
          <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-primary">
            <Sparkles className="size-4" aria-hidden />
            {t('site.about.hero.eyebrow', 'אודות')}
          </span>
          <h1 className="mt-4 max-w-3xl text-balance text-title font-extrabold tracking-tight">
            {t('site.about.hero.title', 'אודות KALFA')}
          </h1>
          <p className="mt-5 max-w-prose text-pretty text-lg text-muted-foreground">
            {t('site.about.hero.intro', 'KALFA היא מערכת ישראלית לניהול אישורי הגעה לאירועים פרטיים: חתונות, בר ובת מצווה, בריתות, אירועים משפחתיים ואירועי חברה. היא עושה דבר אחד: עוזרת לבעל האירוע לדעת מי מגיע, בלי גיליונות ובלי עשרות שיחות טלפון.')}
          </p>
        </section>

        <section className="border-y border-border bg-[#f9fafb]">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <h2 className="text-balance text-display font-bold tracking-tight">{t('site.about.does.title', 'מה המערכת עושה')}</h2>
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {doesItems(t).map(({ title, d }) => (
                <div key={title} className="rounded-xl border border-border bg-background p-6">
                  <h3 className="text-lg font-bold">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{d}</p>
                </div>
              ))}
            </div>
            <p className="mt-8 max-w-prose text-muted-foreground">
              {t('site.about.does.limits', 'מה היא לא עושה: היא לא מנהלת את האולם, את הספקים או את התקציב, ולא שולחת פרסום המוני. ההודעות יוצאות רק אל המוזמנים של האירוע, ורק בנוגע אליו.')}
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-6 py-16">
          <h2 className="text-balance text-display font-bold tracking-tight">{t('site.about.principles.title', 'איך אנחנו עובדים')}</h2>
          <div className="mt-8 space-y-8">
            {principles(t).map(({ title, d }) => (
              <div key={title}>
                <h3 className="text-xl font-bold">{title}</h3>
                <p className="mt-2 max-w-prose text-base leading-relaxed text-muted-foreground">{d}</p>
              </div>
            ))}
          </div>
          <p className="mt-10 text-muted-foreground">
            <Trans
              t={t}
              i18n={i18n}
              i18nKey="site.about.moreLinks"
              defaults="לפרטים: <faq>שאלות נפוצות</faq> · <privacy>מדיניות פרטיות</privacy> · <terms>תקנון</terms>"
              components={{
                faq: <Link href="/faq" className="font-semibold text-primary hover:underline" />,
                privacy: <Link href="/privacy" className="font-semibold text-primary hover:underline" />,
                terms: <Link href="/terms" className="font-semibold text-primary hover:underline" />,
              }}
            />
          </p>
        </section>

        <section className="border-t border-border bg-[#f9fafb]">
          <div className="mx-auto max-w-3xl px-6 py-16">
            <h2 className="text-balance text-display font-bold tracking-tight">{t('site.about.operator.title', 'מי מפעיל את השירות')}</h2>
            {operatorName ? (
              <p className="mt-4 max-w-prose text-base leading-relaxed text-muted-foreground">
                {t('site.about.operator.body', 'השירות מופעל על ידי {{operator}}. פרטי העסק המלאים מופיעים בתקנון.', {
                  operator: operatorAddress ? `${operatorName}, ${operatorAddress}` : operatorName,
                })}
              </p>
            ) : null}
            <p className="mt-4 max-w-prose text-base leading-relaxed text-muted-foreground">
              <Trans
                t={t}
                i18n={i18n}
                i18nKey="site.about.operator.contact"
                defaults="שאלה, בקשה או הערה? <contact>אפשר לפנות אלינו בעמוד יצירת הקשר</contact>, כולל בקשה לשיחה חוזרת."
                components={{ contact: <Link href="/contact" className="font-semibold text-primary hover:underline" /> }}
              />
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16 text-center">
          <Link href={startHref} className={siteCta({ size: 'xl' })}>
            {startLabel}
            <ArrowLeft className="size-5 ltr:rotate-180" aria-hidden />
          </Link>
        </section>
      </main>
    </div>
  );
}
