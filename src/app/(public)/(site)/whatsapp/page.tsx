import type { TFunction } from 'i18next';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, ListChecks, MessageCircle, ShieldCheck } from 'lucide-react';
import { Trans } from 'react-i18next/TransWithoutContext';

import { siteCta } from '@/components/site/cta';
import { getUser } from '@/lib/auth/dal';
import { buildFaqJsonLd, faqJsonLdScript } from '@/lib/faq/json-ld';
import { getT } from '@/i18n.server';
import { pageOpenGraph } from '@/lib/seo/open-graph';

// Public page for the WhatsApp channel — the one channel term with measurable
// and RISING search demand ("אישורי הגעה בוואטסאפ").
//
// TRUTHFULNESS RULE, same as src/lib/marketing/event-types.ts: only shipped
// behaviour. KALFA sends invitations and reminders through the official
// WhatsApp Business platform using pre-approved message templates, each guest
// answers from their own private link (or a template button), replies are
// recorded automatically, and a guest list can be imported from WhatsApp
// contacts. Nothing here promises free-form bulk messaging, marketing blasts,
// or delivery guarantees — Meta gates all three.

// Title and description are declared once and reused for the Open Graph
// block — the share preview and the search snippet must not drift apart.
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('public');
  const pageTitle = t('site.whatsapp.meta.title', 'אישורי הגעה בוואטסאפ');
  const pageDescription = t(
    'site.whatsapp.meta.description',
    'שליחת הזמנות ותזכורות לאישורי הגעה בוואטסאפ דרך הפלטפורמה הרשמית: הודעה אישית לכל מוזמן, תשובה בלחיצה ומעקב אוטומטי אחר התגובות.',
  );
  return {
    title: pageTitle,
    description: pageDescription,
    // Nested metadata objects are REPLACED, not merged: a page that sets no
    // openGraph inherits the root layout's wholesale, so its share preview
    // would show the site-wide blurb instead of this page's.
    openGraph: pageOpenGraph(pageTitle, pageDescription, '/whatsapp'),
    alternates: { canonical: '/whatsapp' },
  };
}

const points = (t: TFunction<'public'>): { title: string; d: string }[] => [
  {
    title: t('site.whatsapp.points.items.reach.title', 'ההודעה מגיעה לאן שכבר מסתכלים'),
    d: t('site.whatsapp.points.items.reach.body', 'מוזמן לא תמיד פותח מייל ולא תמיד עונה לטלפון לא מוכר. וואטסאפ הוא הערוץ שכמעט כולם בודקים באותו יום.'),
  },
  {
    title: t('site.whatsapp.points.items.personal.title', 'הודעה אישית, לא הודעה קבוצתית'),
    d: t('site.whatsapp.points.items.personal.body', 'כל מוזמן מקבל הודעה משלו עם הפרטים שלו. אין קבוצה, אין רשימת תפוצה שכולם רואים, ואף אחד לא נחשף לרשימת המוזמנים.'),
  },
  {
    title: t('site.whatsapp.points.items.autoRecorded.title', 'התשובה נרשמת מעצמה'),
    d: t('site.whatsapp.points.items.autoRecorded.body', 'המוזמן עונה מתוך ההודעה או מהקישור האישי שלו, והסטטוס מתעדכן ברשימה בלי שמישהו יקליד אותו ידנית.'),
  },
  {
    title: t('site.whatsapp.points.items.remindersOnly.title', 'תזכורת רק לממתינים'),
    d: t('site.whatsapp.points.items.remindersOnly.body', 'התזכורת האוטומטית מדלגת על מי שכבר השיב. זה ההבדל בין תזכורת מועילה לבין הטרדה.'),
  },
];

const faqItems = (t: TFunction<'public'>) => [
  {
    q: t('site.whatsapp.faq.items.howToSend.question', 'איך שולחים אישורי הגעה בוואטסאפ?'),
    a: t('site.whatsapp.faq.items.howToSend.answer', 'מייבאים את רשימת המוזמנים, והמערכת שולחת לכל מספר הודעה אישית דרך הפלטפורמה העסקית הרשמית של וואטסאפ. אין צורך לשלוח מהטלפון הפרטי ואין צורך לפתוח קבוצה.'),
  },
  {
    q: t('site.whatsapp.faq.items.anyText.question', 'האם אפשר לשלוח כל טקסט שרוצים?'),
    a: t('site.whatsapp.faq.items.anyText.answer', 'לא. וואטסאפ מאשרת מראש את מבנה ההודעות שנשלחות ביוזמת העסק, והמערכת שולחת רק תבניות מאושרות. הפרטים האישיים — שם, תאריך ומקום — משתנים בכל הודעה.'),
  },
  {
    q: t('site.whatsapp.faq.items.noWhatsapp.question', 'מה קורה אם למוזמן אין וואטסאפ?'),
    a: t('site.whatsapp.faq.items.noWhatsapp.answer', 'הוא פשוט לא יקבל בערוץ הזה. הקישור האישי שלו ממשיך לעבוד בכל דרך אחרת, ואפשר גם לנהל מוזמן בלי מספר טלפון כלל.'),
  },
  {
    q: t('site.whatsapp.faq.items.guestsSeeEachOther.question', 'המוזמנים רואים אחד את השני?'),
    a: t('site.whatsapp.faq.items.guestsSeeEachOther.answer', 'לא. כל הודעה נשלחת בנפרד, וכל מוזמן רואה רק את הפרטים שלו — לא את רשימת המוזמנים ולא את תשובות האחרים.'),
  },
];

export default async function WhatsappRsvpPage() {
  const { t, i18n } = await getT('public');
  const user = await getUser();
  const startHref = user ? '/app/events/new' : '/auth/signup';
  const startLabel = user ? t('site.whatsapp.cta.newEvent', 'אירוע חדש') : t('site.whatsapp.cta.createEvent', 'צרו אירוע חדש');

  const faq = faqItems(t);
  const jsonLd = buildFaqJsonLd(faq.map((f) => ({ question: f.q, answer: f.a })));

  return (
    <div className="bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: faqJsonLdScript(jsonLd) }}
      />

      <main>
        {/* Hero: same treatment as the homepage — primary-tinted radial wash and
            fluid `text-title` (see docs/design/public-pages-tailwind-v4-upgrade.md). */}
        <section className="relative isolate mx-auto max-w-6xl px-6 py-10 before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:bg-radial-[at_top_end] before:from-primary/10 before:via-transparent before:to-transparent sm:py-16">
          <div>
            <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-primary transition-[opacity,translate] duration-700 ease-k-out motion-safe:starting:translate-y-3">
              <MessageCircle className="size-4" aria-hidden />
              {t('site.whatsapp.hero.eyebrow', 'ערוץ השליחה')}
            </span>
            <h1 className="mt-4 max-w-3xl text-balance text-title font-extrabold tracking-tight transition-[opacity,translate] duration-700 ease-k-out motion-safe:starting:translate-y-3 k-delay-100">
              {t('site.whatsapp.hero.title', 'אישורי הגעה בוואטסאפ')}
            </h1>
            <p className="mt-5 max-w-prose text-pretty text-lg text-muted-foreground transition-[opacity,translate] duration-700 ease-k-out motion-safe:starting:translate-y-3 k-delay-200">
              {t('site.whatsapp.hero.subtitle', 'הזמנה אישית לכל מוזמן דרך הפלטפורמה העסקית הרשמית של וואטסאפ — לא קבוצה, לא רשימת תפוצה, ולא שליחה ידנית מהטלפון שלכם.')}
            </p>
            <div className="mt-7 flex flex-wrap gap-3 transition-[opacity,translate] duration-700 ease-k-out motion-safe:starting:translate-y-3 k-delay-300">
              <Link
                href={startHref}
                className={siteCta()}
              >
                {startLabel}
                <ArrowLeft className="size-5" aria-hidden />
              </Link>
              <Link
                href="/guest-list-template"
                className={siteCta({ variant: 'outline' })}
              >
                {t('site.whatsapp.cta.template', 'תבנית רשימת מוזמנים')}
              </Link>
            </div>
          </div>
        </section>

        <section className="border-y border-border bg-[#f9fafb]">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <h2 className="max-w-2xl text-balance text-display font-bold tracking-tight">
              {t('site.whatsapp.points.title', 'למה דווקא בערוץ הזה')}
            </h2>
            <div className="k-reveal-group mt-10 grid gap-4 sm:grid-cols-2">
              {points(t).map(({ title, d }) => (
                <div key={title} className="k-card rounded-xl border border-border bg-background p-6 hover:shadow-md">
                  <h3 className="text-lg font-bold">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* The limits, stated plainly. A page that only sells the channel and
            hides Meta's rules produces disappointed users on day one. */}
        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="k-reveal rounded-2xl bg-[#0b0f1a] p-8 text-white inset-ring-1 inset-ring-white/10 sm:p-10">
            <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-indigo-300">
              <ShieldCheck className="size-4" aria-hidden />
              {t('site.whatsapp.limits.eyebrow', 'מה שחשוב לדעת מראש')}
            </span>
            <h2 className="mt-3 text-2xl font-extrabold tracking-tight sm:text-3xl">
              {t('site.whatsapp.limits.title', 'וואטסאפ היא פלטפורמה עם כללים, ואנחנו עובדים לפיהם')}
            </h2>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {[
                t('site.whatsapp.limits.items.approvedTemplate', 'הודעה שנשלחת ביוזמת העסק חייבת להיות בתבנית שאושרה מראש על ידי וואטסאפ.'),
                t('site.whatsapp.limits.items.eventOnly', 'ההודעות הן לאירוע ולמוזמן הספציפי — לא דיוור פרסומי.'),
                t('site.whatsapp.limits.items.stopRequest', 'מוזמן שמבקש להפסיק לקבל הודעות מפסיק לקבל אותן.'),
                t('site.whatsapp.limits.items.noGuarantee', 'מסירה תלויה בוואטסאפ עצמה, ולכן היא לא מובטחת לכל מספר.'),
              ].map((line) => (
                <li
                  key={line}
                  className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm leading-relaxed text-white/80"
                >
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="border-t border-border bg-[#f9fafb]">
          <div className="mx-auto max-w-3xl px-6 py-16">
            <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-primary">
              <ListChecks className="size-4" aria-hidden />
              {t('site.whatsapp.faq.eyebrow', 'שאלות נפוצות')}
            </span>
            <h2 className="mt-3 text-balance text-display font-bold tracking-tight">
              {t('site.whatsapp.faq.title', 'שליחה בוואטסאפ: שאלות שחוזרות')}
            </h2>
            <div className="k-reveal-group mt-8 space-y-8">
              {faq.map((f) => (
                <div key={f.q} className="border-b border-border pb-6 last:border-b-0 last:pb-0">
                  <h3 className="text-lg font-bold">{f.q}</h3>
                  <p className="mt-2 max-w-prose text-base leading-relaxed text-muted-foreground">
                    {f.a}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-10 text-muted-foreground">
              <Trans
                t={t}
                i18n={i18n}
                i18nKey="site.whatsapp.faq.moreLink"
                defaults="על המחיר ועל שאר הערוצים — <faq>בעמוד השאלות הנפוצות</faq>."
                components={{ faq: <Link href="/faq" className="font-semibold text-primary hover:underline" /> }}
              />
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
