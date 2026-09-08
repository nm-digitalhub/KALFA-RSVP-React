import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, Download, ListChecks, TriangleAlert } from 'lucide-react';

import { siteCta } from '@/components/site/cta';
import { getUser } from '@/lib/auth/dal';
import { buildFaqJsonLd, faqJsonLdScript } from '@/lib/faq/json-ld';
import {
  TEMPLATE_HEADER,
  TEMPLATE_SAMPLE_ROWS,
} from '@/lib/guests/import-template';
import { pageOpenGraph } from '@/lib/seo/open-graph';

// Public landing page for the downloadable guest-list template.
//
// The columns and sample rows below are rendered FROM the template module, not
// retyped — the page a visitor reads and the file they download can therefore
// never disagree about the format. The file itself is served by
// src/app/guest-list-template.csv/route.ts; see its header for why it is a
// BOM-prefixed CSV and not .xlsx, and why it lives at a dot-suffixed route
// (the same shape as src/app/llms.txt/route.ts).

// Title and description are declared once and reused for the Open Graph
// block — the share preview and the search snippet must not drift apart.
const TITLE = 'רשימת מוזמנים לחתונה — תבנית לאקסל להורדה';
const DESCRIPTION =
  'תבנית מוכנה לניהול רשימת מוזמנים לחתונה או לכל אירוע: נפתחת באקסל ובגוגל שיטס, עם עמודות לשם, טלפון, כמות וקבוצה — והורדה חינם.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  // Nested metadata objects are REPLACED, not merged: a page that sets no
  // openGraph inherits the root layout's wholesale, so its share preview
  // would show the site-wide blurb instead of this page's.
  openGraph: pageOpenGraph(TITLE, DESCRIPTION),
  alternates: { canonical: '/guest-list-template' },
};

const MISTAKES: { t: string; d: string }[] = [
  {
    t: 'שורה לכל אדם במקום לכל הזמנה',
    d: 'משפחה אחת היא הזמנה אחת עם כמות, לא ארבע שורות נפרדות. פיצול לאנשים מנפח את הרשימה ומקשה לספור כמה הזמנות באמת נשלחו.',
  },
  {
    t: 'טלפונים בפורמטים מעורבים',
    d: '‎050-1234567‎, ‎+972501234567‎ ו‑‎0501234567‎ הם אותו מספר בשלוש צורות. עמודה אחידה חוסכת כפילויות שמתגלות רק אחרי השליחה.',
  },
  {
    t: 'אקסל הופך מספר טלפון למספר',
    d: 'האפס בהתחלה נעלם ו‑0501234567 הופך ל‑501234567. הגדרת העמודה כטקסט לפני ההדבקה פותרת את זה.',
  },
  {
    t: 'אין עמודת קבוצה',
    d: 'בלי חלוקה לקבוצות אי אפשר לדעת איזה חלק מהרשימה מפגר בתשובות, ותזכורת נשלחת לכולם במקום למי שצריך.',
  },
];

const FAQ = [
  {
    q: 'האם התבנית נפתחת באקסל?',
    a: 'כן. הקובץ הוא CSV בקידוד UTF-8 עם סימן BOM, שזה מה שגורם לאקסל להציג עברית כמו שצריך. הוא נפתח גם בגוגל שיטס ובנומברס בלי המרה.',
  },
  {
    q: 'למה שורה אחת לכל הזמנה ולא לכל אדם?',
    a: 'כי ההזמנה היא היחידה שנשלחת. משפחת כהן מקבלת הזמנה אחת שמכסה ארבעה אנשים — עמודת הכמות אומרת כמה, וכך מספר ההזמנות ומספר האורחים נשארים שני מספרים נפרדים וברורים.',
  },
  {
    q: 'אפשר לייבא את הקובץ הזה ל-KALFA?',
    a: 'כן. זו בדיוק אותה תבנית שמופיעה במסך ייבוא המוזמנים במערכת, עם אותן עמודות — אפשר למלא אותה עכשיו ולייבא אותה בהמשך בלי לשנות דבר.',
  },
  {
    q: 'מה קורה כשהרשימה גדלה?',
    a: 'גיליון עובד מצוין לבנייה הראשונית של הרשימה. הוא מפסיק לעבוד כשצריך לשלוח הזמנה אישית לכל שורה, לעקוב מי ענה ולשלוח תזכורת רק לממתינים — עדכון ידני של מאות שורות הוא מקור הטעויות העיקרי.',
  },
];

export default async function GuestListTemplatePage() {
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
        {/* Hero: same treatment as the homepage — primary-tinted radial wash and
            fluid `text-title` (see docs/design/public-pages-tailwind-v4-upgrade.md). */}
        <section className="relative isolate mx-auto max-w-6xl px-6 py-10 before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:bg-radial-[at_top_end] before:from-primary/10 before:via-transparent before:to-transparent sm:py-16">
          <div>
            <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-primary transition-[opacity,translate] duration-700 ease-k-out motion-safe:starting:opacity-0 motion-safe:starting:translate-y-3">
              <Download className="size-4" aria-hidden />
              הורדה חינם
            </span>
            <h1 className="mt-4 max-w-3xl text-balance text-title font-extrabold tracking-tight transition-[opacity,translate] duration-700 ease-k-out motion-safe:starting:opacity-0 motion-safe:starting:translate-y-3 k-delay-100">
              תבנית רשימת מוזמנים
            </h1>
            <p className="mt-5 max-w-prose text-pretty text-lg text-muted-foreground transition-[opacity,translate] duration-700 ease-k-out motion-safe:starting:opacity-0 motion-safe:starting:translate-y-3 k-delay-200">
              קובץ מוכן עם העמודות הנכונות, שנפתח באקסל ובגוגל שיטס. אפשר להתחיל למלא אותו מיד — ואם
              בהמשך תרצו לנהל את האירוע ב‑KALFA, זו אותה תבנית שהמערכת מייבאת.
            </p>
            <div className="mt-7 flex flex-wrap gap-3 transition-[opacity,translate] duration-700 ease-k-out motion-safe:starting:opacity-0 motion-safe:starting:translate-y-3 k-delay-300">
              {/* A plain link, not a Client Component: the file is a real GET
                  response with Content-Disposition: attachment, so the browser
                  downloads it without any JavaScript. */}
              <a
                href="/guest-list-template.csv"
                className={siteCta()}
              >
                <Download className="size-5" aria-hidden />
                הורדת התבנית
              </a>
              <Link
                href={startHref}
                className={siteCta({ variant: 'outline' })}
              >
                {startLabel}
                <ArrowLeft className="size-5" aria-hidden />
              </Link>
            </div>
          </div>
        </section>

        {/* The format, rendered from the template module itself */}
        <section className="border-y border-border bg-[#f9fafb]">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <h2 className="text-balance text-display font-bold tracking-tight">מה יש בקובץ</h2>
            <p className="mt-3 max-w-prose text-lg text-muted-foreground">
              ארבע עמודות, ושורה אחת לכל <strong className="font-semibold text-foreground">הזמנה</strong> —
              לא לכל אדם.
            </p>
            {/* Wide content scrolls inside its own container so the page body
                never scrolls horizontally on a phone. */}
            <div className="mt-8 overflow-x-auto rounded-xl border border-border bg-background">
              <table className="w-full min-w-[32rem] border-collapse text-sm">
                <caption className="sr-only">מבנה תבנית רשימת המוזמנים</caption>
                <thead>
                  <tr className="border-b border-border bg-[#f9fafb]">
                    {TEMPLATE_HEADER.map((h) => (
                      <th key={h} scope="col" className="px-4 py-3 text-start font-bold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {TEMPLATE_SAMPLE_ROWS.map((row) => (
                    <tr key={row.join('|')} className="border-b border-border last:border-b-0">
                      {row.map((cell, i) => (
                        <td
                          key={`${TEMPLATE_HEADER[i]}`}
                          className="px-4 py-3 text-muted-foreground"
                        >
                          {cell === '' ? (
                            <span className="text-muted-foreground/60">—</span>
                          ) : (
                            cell
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 max-w-prose text-sm text-muted-foreground">
              שורת &quot;סבתא רחל&quot; בלי טלפון היא דוגמה מכוונת: אפשר לנהל גם מוזמן שאין לו מספר,
              הוא פשוט לא יקבל הודעה אוטומטית.
            </p>
          </div>
        </section>

        {/* Value content — the reason to link to this page */}
        <section className="mx-auto max-w-6xl px-6 py-16">
          <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-primary">
            <TriangleAlert className="size-4" aria-hidden />
            שווה לדעת
          </span>
          <h2 className="mt-3 text-balance text-display font-bold tracking-tight">
            ארבע טעויות שחוזרות כמעט בכל רשימה בגיליון
          </h2>
          <div className="k-reveal-group mt-10 grid gap-4 sm:grid-cols-2">
            {MISTAKES.map(({ t, d }) => (
              <div key={t} className="k-card rounded-xl border border-border bg-background p-6 hover:shadow-md">
                <h3 className="text-lg font-bold">{t}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-border bg-[#f9fafb]">
          <div className="mx-auto max-w-3xl px-6 py-16">
            <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-primary">
              <ListChecks className="size-4" aria-hidden />
              שאלות נפוצות
            </span>
            <h2 className="mt-3 text-balance text-display font-bold tracking-tight">על התבנית</h2>
            <div className="k-reveal-group mt-8 space-y-8">
              {FAQ.map((f) => (
                <div key={f.q} className="border-b border-border pb-6 last:border-b-0 last:pb-0">
                  <h3 className="text-lg font-bold">{f.q}</h3>
                  <p className="mt-2 max-w-prose text-base leading-relaxed text-muted-foreground">
                    {f.a}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="k-reveal k-sheen relative isolate overflow-hidden rounded-3xl bg-primary px-8 py-14 text-center before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:bg-radial-[at_top_start] before:from-white/15 before:to-transparent">
            <h2 className="text-balance text-display font-extrabold tracking-tight text-primary-foreground">
              הרשימה מוכנה. מה עם התשובות?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-pretty text-primary-foreground/90">
              ייבוא הקובץ הזה, הזמנה אישית לכל שורה, ותזכורת אוטומטית רק למי שטרם השיב.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Link
                href={startHref}
                className={siteCta({ variant: 'dark', size: 'xl' })}
              >
                {startLabel}
                <ArrowLeft className="size-5" aria-hidden />
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
