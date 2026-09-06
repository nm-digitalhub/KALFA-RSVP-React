import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, ListChecks, MessageCircle, ShieldCheck } from 'lucide-react';

import { getUser } from '@/lib/auth/dal';
import { buildFaqJsonLd, faqJsonLdScript } from '@/lib/faq/json-ld';

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

export const metadata: Metadata = {
  title: 'אישורי הגעה בוואטסאפ',
  description:
    'שליחת הזמנות ותזכורות לאישורי הגעה בוואטסאפ דרך הפלטפורמה הרשמית: הודעה אישית לכל מוזמן, תשובה בלחיצה ומעקב אוטומטי אחר התגובות.',
  alternates: { canonical: '/whatsapp' },
};

const POINTS: { t: string; d: string }[] = [
  {
    t: 'ההודעה מגיעה לאן שכבר מסתכלים',
    d: 'מוזמן לא תמיד פותח מייל ולא תמיד עונה לטלפון לא מוכר. וואטסאפ הוא הערוץ שכמעט כולם בודקים באותו יום.',
  },
  {
    t: 'הודעה אישית, לא הודעה קבוצתית',
    d: 'כל מוזמן מקבל הודעה משלו עם הפרטים שלו. אין קבוצה, אין רשימת תפוצה שכולם רואים, ואף אחד לא נחשף לרשימת המוזמנים.',
  },
  {
    t: 'התשובה נרשמת מעצמה',
    d: 'המוזמן עונה מתוך ההודעה או מהקישור האישי שלו, והסטטוס מתעדכן ברשימה בלי שמישהו יקליד אותו ידנית.',
  },
  {
    t: 'תזכורת רק לממתינים',
    d: 'התזכורת האוטומטית מדלגת על מי שכבר השיב. זה ההבדל בין תזכורת מועילה לבין הטרדה.',
  },
];

const FAQ = [
  {
    q: 'איך שולחים אישורי הגעה בוואטסאפ?',
    a: 'מייבאים את רשימת המוזמנים, והמערכת שולחת לכל מספר הודעה אישית דרך הפלטפורמה העסקית הרשמית של וואטסאפ. אין צורך לשלוח מהטלפון הפרטי ואין צורך לפתוח קבוצה.',
  },
  {
    q: 'האם אפשר לשלוח כל טקסט שרוצים?',
    a: 'לא. וואטסאפ מאשרת מראש את מבנה ההודעות שנשלחות ביוזמת העסק, והמערכת שולחת רק תבניות מאושרות. הפרטים האישיים — שם, תאריך ומקום — משתנים בכל הודעה.',
  },
  {
    q: 'מה קורה אם למוזמן אין וואטסאפ?',
    a: 'הוא פשוט לא יקבל בערוץ הזה. הקישור האישי שלו ממשיך לעבוד בכל דרך אחרת, ואפשר גם לנהל מוזמן בלי מספר טלפון כלל.',
  },
  {
    q: 'המוזמנים רואים אחד את השני?',
    a: 'לא. כל הודעה נשלחת בנפרד, וכל מוזמן רואה רק את הפרטים שלו — לא את רשימת המוזמנים ולא את תשובות האחרים.',
  },
];

export default async function WhatsappRsvpPage() {
  const user = await getUser();
  const startHref = user ? '/app/events/new' : '/auth/signup';
  const startLabel = user ? 'אירוע חדש' : 'צרו אירוע חדש';

  const jsonLd = buildFaqJsonLd(FAQ.map((f) => ({ question: f.q, answer: f.a })));

  return (
    <div className="bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: faqJsonLdScript(jsonLd) }}
      />

      <main>
        <section className="mx-auto max-w-6xl px-6 py-10 sm:py-16">
          <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-primary">
            <MessageCircle className="size-4" aria-hidden />
            ערוץ השליחה
          </span>
          <h1 className="mt-4 max-w-3xl text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            אישורי הגעה בוואטסאפ
          </h1>
          <p className="mt-5 max-w-prose text-lg text-muted-foreground">
            הזמנה אישית לכל מוזמן דרך הפלטפורמה העסקית הרשמית של וואטסאפ — לא קבוצה, לא רשימת תפוצה,
            ולא שליחה ידנית מהטלפון שלכם.
          </p>
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

        <section className="border-y border-border bg-[#f9fafb]">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <h2 className="max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
              למה דווקא בערוץ הזה
            </h2>
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {POINTS.map(({ t, d }) => (
                <div key={t} className="rounded-xl border border-border bg-background p-6">
                  <h3 className="text-lg font-bold">{t}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* The limits, stated plainly. A page that only sells the channel and
            hides Meta's rules produces disappointed users on day one. */}
        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="rounded-2xl bg-[#0b0f1a] p-8 text-white sm:p-10">
            <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-indigo-300">
              <ShieldCheck className="size-4" aria-hidden />
              מה שחשוב לדעת מראש
            </span>
            <h2 className="mt-3 text-2xl font-extrabold tracking-tight sm:text-3xl">
              וואטסאפ היא פלטפורמה עם כללים, ואנחנו עובדים לפיהם
            </h2>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {[
                'הודעה שנשלחת ביוזמת העסק חייבת להיות בתבנית שאושרה מראש על ידי וואטסאפ.',
                'ההודעות הן לאירוע ולמוזמן הספציפי — לא דיוור פרסומי.',
                'מוזמן שמבקש להפסיק לקבל הודעות מפסיק לקבל אותן.',
                'מסירה תלויה בוואטסאפ עצמה, ולכן היא לא מובטחת לכל מספר.',
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
              שאלות נפוצות
            </span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              שליחה בוואטסאפ — שאלות שחוזרות
            </h2>
            <div className="mt-8 space-y-8">
              {FAQ.map((f) => (
                <div key={f.q} className="border-b border-border pb-6 last:border-b-0 last:pb-0">
                  <h3 className="text-lg font-bold">{f.q}</h3>
                  <p className="mt-2 max-w-prose text-base leading-relaxed text-muted-foreground">
                    {f.a}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-10 text-muted-foreground">
              על המחיר ועל שאר הערוצים —{' '}
              <Link href="/faq" className="font-semibold text-primary hover:underline">
                בעמוד השאלות הנפוצות
              </Link>
              .
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
