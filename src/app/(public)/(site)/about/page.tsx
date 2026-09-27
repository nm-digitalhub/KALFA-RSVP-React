import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, Sparkles } from 'lucide-react';

import { siteCta } from '@/components/site/cta';
import { getUser } from '@/lib/auth/dal';
import { getCompanyLegal } from '@/lib/data/company';
import { buildBreadcrumbJsonLd, jsonLdScript } from '@/lib/seo/breadcrumb-json-ld';
import { pageOpenGraph } from '@/lib/seo/open-graph';
import { getAppOrigin } from '@/lib/url';

// Public "about" page — the trust/identity page search engines and AI answer
// engines look for (E-E-A-T), added 2026-09-27 (plans/seo-exposure-plan-2026-09-27.md).
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

const TITLE = 'אודות KALFA — מערכת ישראלית לאישורי הגעה';
const DESCRIPTION =
  'מי אנחנו ומה KALFA עושה: מערכת ישראלית בעברית לניהול אישורי הגעה לאירועים פרטיים — רשימת מוזמנים, הזמנות, תזכורות ומעקב תשובות.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: pageOpenGraph(TITLE, DESCRIPTION),
  alternates: { canonical: '/about' },
};

// Reads the company settings per request, like /terms and /privacy.
export const dynamic = 'force-dynamic';

const DOES: readonly { t: string; d: string }[] = [
  {
    t: 'רשימת מוזמנים אחת',
    d: 'קבוצות, מלווים, הערות וסטטוסים במקום אחד, עם ייבוא מקובץ או מוואטסאפ.',
  },
  {
    t: 'הזמנה אישית ותזכורות',
    d: 'פנייה אישית לכל מוזמן, ותזכורות אוטומטיות רק למי שעוד לא ענה.',
  },
  {
    t: 'תשובה דרך קישור פרטי',
    d: 'כל מוזמן עונה דרך קישור משלו ורואה רק את הפרטים שלו — לא את הרשימה ולא את תשובות האחרים.',
  },
  {
    t: 'תמונת מצב למארגן',
    d: 'מי אישר, מי ממתין וכמה מגיעים — מתעדכן עם כל תשובה.',
  },
];

const PRINCIPLES: readonly { t: string; d: string }[] = [
  {
    t: 'עברית קודם',
    d: 'הממשק, ההודעות ודפי התשובה נכתבו בעברית ומימין לשמאל מההתחלה — לא תורגמו.',
  },
  {
    t: 'בלי פניות בשבת ובחג',
    d: 'פנייה שמועדה נופל בשבת, בחג או בשעות הלילה מתוזמנת מחדש אוטומטית לחלון השליחה הבא.',
  },
  {
    t: 'הנתונים של האירוע שייכים לבעל האירוע',
    // Mirrors the owner-approved /faq answer on data ownership, not new wording.
    d: 'נתוני המוזמנים שייכים לבעל האירוע. KALFA מעבדת אותם בשמו ולא מוכרת מידע אישי לצד שלישי. הפירוט המלא נמצא במדיניות הפרטיות.',
  },
  {
    t: 'מחיר גלוי מראש',
    d: 'התמחור, מה כלול בו ומתי מתווסף חיוב מפורטים בשאלות הנפוצות ובתקנון — לפני שמתחייבים.',
  },
];

export default async function AboutPage() {
  const [user, origin] = await Promise.all([getUser(), getAppOrigin()]);
  const startHref = user ? '/app/events/new' : '/auth/signup';
  const startLabel = user ? 'אירוע חדש' : 'צרו אירוע חדש';

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
    name: TITLE,
    description: DESCRIPTION,
    inLanguage: 'he-IL',
    about: { '@id': `${origin}/#organization` },
  };
  const breadcrumb = buildBreadcrumbJsonLd(origin, 'אודות');

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
            אודות
          </span>
          <h1 className="mt-4 max-w-3xl text-balance text-title font-extrabold tracking-tight">
            אודות KALFA
          </h1>
          <p className="mt-5 max-w-prose text-pretty text-lg text-muted-foreground">
            KALFA היא מערכת ישראלית לניהול אישורי הגעה לאירועים פרטיים — חתונות, בר ובת מצווה,
            בריתות, אירועים משפחתיים ואירועי חברה. היא עושה דבר אחד: עוזרת לבעל האירוע לדעת מי
            מגיע, בלי גיליונות ובלי עשרות שיחות טלפון.
          </p>
        </section>

        <section className="border-y border-border bg-[#f9fafb]">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <h2 className="text-balance text-display font-bold tracking-tight">מה המערכת עושה</h2>
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {DOES.map(({ t, d }) => (
                <div key={t} className="rounded-xl border border-border bg-background p-6">
                  <h3 className="text-lg font-bold">{t}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{d}</p>
                </div>
              ))}
            </div>
            <p className="mt-8 max-w-prose text-muted-foreground">
              מה היא לא עושה: היא לא מנהלת את האולם, את הספקים או את התקציב, ולא שולחת פרסום
              המוני. ההודעות יוצאות רק אל המוזמנים של האירוע, ורק בנוגע אליו.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-6 py-16">
          <h2 className="text-balance text-display font-bold tracking-tight">איך אנחנו עובדים</h2>
          <div className="mt-8 space-y-8">
            {PRINCIPLES.map(({ t, d }) => (
              <div key={t}>
                <h3 className="text-xl font-bold">{t}</h3>
                <p className="mt-2 max-w-prose text-base leading-relaxed text-muted-foreground">{d}</p>
              </div>
            ))}
          </div>
          <p className="mt-10 text-muted-foreground">
            לפרטים:{' '}
            <Link href="/faq" className="font-semibold text-primary hover:underline">
              שאלות נפוצות
            </Link>
            {' · '}
            <Link href="/privacy" className="font-semibold text-primary hover:underline">
              מדיניות פרטיות
            </Link>
            {' · '}
            <Link href="/terms" className="font-semibold text-primary hover:underline">
              תקנון
            </Link>
          </p>
        </section>

        <section className="border-t border-border bg-[#f9fafb]">
          <div className="mx-auto max-w-3xl px-6 py-16">
            <h2 className="text-balance text-display font-bold tracking-tight">מי מפעיל את השירות</h2>
            {operatorName ? (
              <p className="mt-4 max-w-prose text-base leading-relaxed text-muted-foreground">
                השירות מופעל על ידי {operatorName}
                {operatorAddress ? `, ${operatorAddress}` : ''}. פרטי העסק המלאים מופיעים בתקנון.
              </p>
            ) : null}
            <p className="mt-4 max-w-prose text-base leading-relaxed text-muted-foreground">
              שאלה, בקשה או הערה?{' '}
              <Link href="/contact" className="font-semibold text-primary hover:underline">
                אפשר לפנות אלינו בעמוד יצירת הקשר
              </Link>
              , כולל בקשה לשיחה חוזרת.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16 text-center">
          <Link href={startHref} className={siteCta({ size: 'xl' })}>
            {startLabel}
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
        </section>
      </main>
    </div>
  );
}
