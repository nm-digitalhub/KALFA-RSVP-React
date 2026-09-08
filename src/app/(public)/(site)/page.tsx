import Link from 'next/link';

import { HeroParallax, ParallaxLayer } from '@/components/motion/hero-parallax';
import { TiltCard } from '@/components/motion/tilt-card';
import { siteCta } from '@/components/site/cta';
import { getUser } from '@/lib/auth/dal';
import { getCompanyLegal, toE164Israel } from '@/lib/data/company';
import { getAppOrigin } from '@/lib/url';
import {
  Activity,
  AlarmClock,
  ArrowLeft,
  Building2,
  CalendarPlus,
  ChartColumnBig,
  CheckCheck,
  CircleCheck,
  CircleQuestionMark,
  Clock,
  FileUp,
  Gauge,
  Gift,
  HandHeart,
  Heart,
  House,
  Layers,
  LayoutGrid,
  ListX,
  Lock,
  MessageCircle,
  MessageSquareReply,
  MessagesSquare,
  PartyPopper,
  Presentation,
  Play,
  Route,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  TriangleAlert,
  UserPlus,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';

// Public landing page — implemented from the KALFA Claude Design "Home" output.
// RTL Hebrew, indigo brand, Heebo (inherited from the root layout).

// Canonical is declared per (site) page (not inherited from the root layout) so
// app/admin/auth segments never accidentally inherit a canonical of '/'.
export const metadata = {
  alternates: { canonical: '/' },
};

const PROBLEMS: { icon: LucideIcon; t: string; d: string }[] = [
  { icon: ListX, t: 'מעקב ידני אחרי אורחים', d: 'גיליונות, פתקים ורשימות שמתעדכנות לאט ומלאות טעויות.' },
  { icon: MessagesSquare, t: 'הודעות מפוזרות', d: 'תשובות שמגיעות בוואטסאפ, בטלפון ובמייל — וקשה לאחד אותן.' },
  { icon: CircleQuestionMark, t: 'חוסר ודאות מי מגיע', d: 'אי אפשר לדעת בזמן אמת כמה אורחים באמת יגיעו.' },
  { icon: AlarmClock, t: 'עומס לפני האירוע', d: 'הרגעים הכי לחוצים מתבזבזים על תיאומים במקום על האירוע.' },
];

const SOLUTIONS = [
  'אורחים והזמנות במקום אחד',
  'אישורי הגעה ותזכורות אוטומטיות',
  'סטטוסים ועדכונים בזמן אמת',
  'תמונת מצב ברורה בכל רגע',
];

const FEATURES: {
  n: string;
  icon: LucideIcon;
  t: string;
  d: string;
  anim?: string; // animates the icon container (pulse)
  iconAnim?: string; // animates inside the icon svg (bars)
}[] = [
  { n: '01', icon: Users, t: 'ניהול רשימת אורחים', d: 'רשימה מסודרת אחת — קבוצות, מלווים והערות, תמיד מעודכנת.' },
  { n: '02', icon: Send, t: 'שליחת הזמנות ותזכורות', d: 'הזמנות אישיות ותזכורות אוטומטיות למי שעוד לא השיב.' },
  { n: '03', icon: CircleCheck, t: 'מעקב אחר אישורי הגעה', d: 'כל תגובה נרשמת מיד — מי מגיע, מי לא, וכמה מלווים.' },
  { n: '04', icon: Activity, t: 'סטטוס אירוע בזמן אמת', d: 'תמונת מצב חיה של היענות, אישורים והתקדמות.', anim: 'k-ico-pulse' },
  { n: '05', icon: FileUp, t: 'ייבוא מוזמנים מהיר', d: 'ייבוא רשימה קיימת מקובץ או מוואטסאפ — בלי הקלדה ידנית.' },
  { n: '06', icon: MessageCircle, t: 'תקשורת מסודרת', d: 'עדכונים ופניות לאורחים בערוץ אחד ברור.' },
  { n: '07', icon: ChartColumnBig, t: 'דוחות וסיכומים', d: 'סיכום מספרים ברור למארגן — לפני האירוע ואחריו.', iconAnim: 'k-ico-bars' },
];

const STEPS: { n: string; icon: LucideIcon; t: string; d: string }[] = [
  { n: '1', icon: CalendarPlus, t: 'יוצרים אירוע', d: 'שם, תאריך ומקום — והאירוע מוכן לניהול.' },
  { n: '2', icon: UserPlus, t: 'מוסיפים אורחים', d: 'ידנית או בייבוא רשימה קיימת, עם קבוצות ומלווים.' },
  { n: '3', icon: Send, t: 'שולחים הזמנות', d: 'הזמנה אישית לכל אורח, בערוץ הנוח לכם.' },
  { n: '4', icon: MessageSquareReply, t: 'עוקבים אחרי תגובות', d: 'כל אישור נרשם בזמן אמת, עם תזכורת לממתינים.' },
  { n: '5', icon: MessageCircle, t: 'שולחים עדכונים ותזכורות', d: 'תזכורות אוטומטיות לממתינים ועדכונים שוטפים לאורחים.' },
  { n: '6', icon: PartyPopper, t: 'מגיעים לאירוע מסודר', d: 'עם תמונת מצב ברורה של מי שמגיע.' },
];

const TRUST: { icon: LucideIcon; t: string; d: string }[] = [
  { icon: ShieldCheck, t: 'פרטיות ואבטחה', d: 'רשימת האורחים והנתונים שלכם שמורים ופרטיים — שלכם בלבד.' },
  { icon: LayoutGrid, t: 'סדר במקום בלבול', d: 'מקור אמת אחד לכל המידע, בלי גרסאות סותרות.' },
  { icon: HandHeart, t: 'נוחות שימוש', d: 'ממשק בהיר בעברית, בלי עקומת למידה ובלי ז׳רגון טכני.' },
  { icon: Gauge, t: 'שליטה מלאה', d: 'אתם רואים הכול ומחליטים הכול — בכל רגע נתון.' },
];

// The four entries with an `href` are the strongest internal links on the
// site: they sit on the highest-authority page, in the section a visitor
// already scans for their own kind of event. The two without one have no page
// of their own yet — they stay plain, never a link to a near-duplicate page
// (the reason the old footer's placeholder columns were removed).
// 'ברית' replaced the vaguer 'אירועים פרטיים' here: it is a real, distinct
// event type with its own page and its own search demand.
const AUDIENCES: { icon: LucideIcon; t: string; href?: string }[] = [
  { icon: Heart, t: 'חתונות', href: '/wedding' },
  { icon: Star, t: 'בר/בת מצווה', href: '/bar-mitzva' },
  { icon: Gift, t: 'ברית', href: '/brit' },
  { icon: Presentation, t: 'כנסים', href: '/event' },
  { icon: House, t: 'אירועים משפחתיים' },
  { icon: Building2, t: 'אירועי חברה' },
];

const PREVIEW_GUESTS = [
  { n: 'משפחת לוי', m: '4 אורחים', label: 'אישרו', cls: 'bg-emerald-50 text-emerald-700' },
  { n: 'יואב כהן', m: '2 אורחים', label: 'ממתין', cls: 'bg-amber-50 text-amber-700' },
  { n: 'נועה אבני', m: '1 אורח', label: 'לא מגיע', cls: 'bg-rose-50 text-rose-700' },
];

function Eyebrow({
  icon: Icon,
  className,
  children,
}: {
  icon: LucideIcon;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-primary${className ? ` ${className}` : ''}`}
    >
      <Icon className="size-4" />
      {children}
    </span>
  );
}

export default async function HomePage() {
  // Recognise a signed-in visitor (verified server-side; null when anonymous)
  // so the landing points returning users to their dashboard, not to sign-up.
  // (getUser is React-cache()d — the (site) layout's SiteHeader already made
  // this call for the same request.)
  const user = await getUser();
  const startHref = user ? '/app' : '/auth/signup';
  const startLabel = user ? 'לאזור האישי' : 'צרו אירוע חדש';

  // Structured data (Organization / WebSite / SoftwareApplication) for search
  // and AI answer engines. Company details come from the admin-managed
  // app_settings (same reader the legal pages use) — never hardcoded; on a
  // read failure the optional fields are simply omitted (the page must not
  // break over JSON-LD).
  const origin = await getAppOrigin();
  let orgLegalName = '';
  let orgPhone = '';
  let orgEmail = '';
  let orgAddress = '';
  let orgInstagram = '';
  try {
    const company = await getCompanyLegal();
    orgLegalName = company.name.trim();
    orgPhone = toE164Israel(company.contactPhone);
    orgEmail = company.contactEmail.trim();
    orgAddress = company.address.trim();
    orgInstagram = company.instagramUrl.trim();
  } catch {
    // omit optional org fields
  }
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${origin}/#organization`,
        name: 'KALFA',
        ...(orgLegalName ? { legalName: orgLegalName } : {}),
        url: `${origin}/`,
        logo: `${origin}/icons/icon.svg`,
        // Entity identity: the same organization on other platforms. Google
        // uses it for the Knowledge Graph and for linking a Search Console
        // platform property (Instagram) to this verified site. Admin-managed
        // (/admin/company) and omitted when unset — never a placeholder.
        ...(orgInstagram ? { sameAs: [orgInstagram] } : {}),
        ...(orgPhone || orgEmail
          ? {
              contactPoint: {
                '@type': 'ContactPoint',
                ...(orgPhone ? { telephone: orgPhone } : {}),
                ...(orgEmail ? { email: orgEmail } : {}),
                contactType: 'customer support',
                availableLanguage: ['he'],
              },
            }
          : {}),
        // The same address disclosed in the signed agreement (§14ג) —
        // admin-managed via /admin/company, never invented here. Only
        // `streetAddress` is set: the DB stores one free-text field (no
        // separate locality/postal-code columns), and guessing a split would
        // risk publishing a wrong structured address, which is worse than
        // omitting it. `addressCountry` is a safe structural fact (this is an
        // Israeli business throughout the app), not admin-sourced data.
        ...(orgAddress
          ? {
              address: {
                '@type': 'PostalAddress',
                streetAddress: orgAddress,
                addressCountry: 'IL',
              },
            }
          : {}),
      },
      {
        '@type': 'WebSite',
        '@id': `${origin}/#website`,
        name: 'KALFA',
        url: `${origin}/`,
        inLanguage: 'he',
        publisher: { '@id': `${origin}/#organization` },
      },
      {
        '@type': 'SoftwareApplication',
        name: 'KALFA',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        inLanguage: 'he',
        url: `${origin}/`,
        description:
          'מערכת לניהול אישורי הגעה לאירועים: ניהול רשימת מוזמנים ומלווים, שליחת הזמנות ותזכורות ומעקב תשובות בזמן אמת.',
      },
    ],
  };

  return (
    // `overflow-x-clip` (not `hidden`: clip creates no scroll container, so the
    // `view()` scroll timelines and the sticky header are unaffected): the hero
    // glow's `k-glow-drift` scales its `before:` layer to 1.08, and a transformed
    // absolute box DOES extend the page's scrollable overflow — 4% of the hero
    // width past the inline-end edge, i.e. a slowly growing horizontal scroll on
    // every viewport narrower than ~1244px. Clipping here (viewport width) hides
    // nothing visible; clipping the section itself would cut the blurred blob.
    <div className="overflow-x-clip bg-background">
      <script
        type="application/ld+json"
        // JSON.stringify output with `<` escaped — standard guard against
        // closing the script tag via DB-sourced strings.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      {/* Header: shared SiteHeader, mounted by the (site) layout for every
          marketing page (owner report 24.8 — the menu was homepage-only). */}
      <main>
        {/* Hero */}
        {/* py-10 on mobile (not the sections' py-16): the hero sits directly
            under the 64px sticky header, so 64px more padding pushed the first
            word ~128px down a 390px viewport (owner report 24.8). 40px keeps
            the same rhythm as /faq's first section; desktop unchanged. */}
        {/* `isolate` + the `before:` radial wash: a soft primary-tinted glow
            behind the hero copy (existing --primary token at 10%, fading to
            transparent — no new colour). Painted as a pseudo-element so it
            never affects layout and stays out of the DOM. Its 14s drift loop
            runs only for hover-capable fine pointers (`pointer-fine-hover:`,
            motion.css) — on phones/tablets the glow is static (battery).
            Entrance/reveal motion for this page lives in the motion layer
            (src/app/motion.css).
            JS islands (src/components/motion/*): HeroParallax/ParallaxLayer =
            scroll-linked depth (copy, mockup, glow blob at three speeds);
            TiltCard = pointer-following 3D tilt on the mockup and the feature
            cards — cursor on fine pointers, finger on touch (+ device tilt on
            the mockup, Android only), inert under reduced motion. */}
        <HeroParallax>
        <section className="relative isolate mx-auto max-w-6xl px-6 py-10 before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:bg-radial-[at_top_end] before:from-primary/10 before:via-transparent before:to-transparent motion-safe:pointer-fine-hover:before:animate-k-glow-drift sm:py-20">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <ParallaxLayer depth={-16}>
              <Eyebrow icon={Sparkles} className="transition-[opacity,translate] duration-700 ease-k-out motion-safe:starting:opacity-0 motion-safe:starting:translate-y-3">ניהול חכם לאירוע מושלם</Eyebrow>
              <h1 className="mt-4 text-balance text-hero font-extrabold tracking-tight transition-[opacity,translate] duration-700 ease-k-out motion-safe:starting:opacity-0 motion-safe:starting:translate-y-3 k-delay-100">
                אישורי הגעה,
                <br />
                <span className="text-primary">במקום אחד.</span>
              </h1>
              <p className="mt-5 max-w-prose text-pretty text-lg text-muted-foreground transition-[opacity,translate] duration-700 ease-k-out motion-safe:starting:opacity-0 motion-safe:starting:translate-y-3 k-delay-200">
                שלחו הזמנות, עקבו אחר התגובות בזמן אמת ונהלו את רשימת המוזמנים והמלווים — בלי גיליונות, בלי הודעות מפוזרות, בלי בלגן.
              </p>
              <div className="mt-7 flex flex-wrap gap-3 transition-[opacity,translate] duration-700 ease-k-out motion-safe:starting:opacity-0 motion-safe:starting:translate-y-3 k-delay-300">
                <Link href={startHref} className={siteCta()}>
                  {startLabel}
                  <ArrowLeft className="size-5" aria-hidden />
                </Link>
                <a href="#how" className={siteCta({ variant: 'outline' })}>
                  <Play className="size-4" aria-hidden />
                  צפו בהדגמה קצרה
                </a>
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-5 text-sm text-muted-foreground transition-[opacity,translate] duration-700 ease-k-out motion-safe:starting:opacity-0 motion-safe:starting:translate-y-3 k-delay-400">
                <span className="inline-flex items-center gap-2"><ShieldCheck className="size-4" aria-hidden /> פרטי ומאובטח</span>
                <span className="inline-flex items-center gap-2"><Clock className="size-4" aria-hidden /> מוכן תוך דקות</span>
              </div>
            </ParallaxLayer>

            {/* Dashboard preview. `@container/preview`: this card is ~half the
                row on lg and the full column on mobile, so its internals
                respond to the CARD's width, not the viewport — the stat
                numbers step down below ~22rem (a 320px phone) and the header
                row stacks below 20rem, where three tiles + a pill no longer
                fit on one line. */}
            {/* The entrance (`starting:` opacity/translate) lives on this
                layer, OUTSIDE TiltCard: TiltCard switches from its static
                <div> to the <Tilt> island once the pointer-fine media query
                resolves after hydration, which remounts its children — an
                entrance on the card itself would replay (fade in twice) on
                every desktop load. motion only writes `transform` here, so the
                CSS `translate`/`opacity` transition is untouched. */}
            {/* Touch (motion spec §10): below `lg` the card rests at -3° (same
                RTL sign as the desktop -6°, so `perspective-distant` is needed
                at every width — without a perspective a rotateY is an invisible
                squash); a finger drag tilts it, and on Android the device's own
                tilt drives it (`gyroscope`, decorative, in-view only — TiltCard
                never triggers the iOS permission dialog). */}
            <ParallaxLayer
              depth={-40}
              className="perspective-distant transition-[opacity,translate] duration-700 ease-k-out motion-safe:starting:opacity-0 motion-safe:starting:translate-y-4 k-delay-200"
            >
              <TiltCard
                restAngleY={-6}
                restAngleYNarrow={-3}
                fallbackClassName="-rotate-y-3 lg:-rotate-y-6"
                maxAngle={7}
                scale={1.02}
                gyroscope
              >
            <div className="@container/preview overflow-hidden rounded-2xl border border-border bg-background shadow-xl">
              <div className="flex flex-col gap-2 border-b border-border px-4 py-3 @[20rem]/preview:flex-row @[20rem]/preview:items-center @[20rem]/preview:justify-between">
                <div>
                  <div className="font-bold">חתונה · דנה ויואב</div>
                  <div className="text-xs text-muted-foreground">14.06.2026 · אולמי השרון</div>
                </div>
                <span className="w-fit rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">248 אישרו</span>
              </div>
              <div className="grid gap-4 p-4">
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { l: 'אישרו', v: '248', c: 'text-emerald-700' },
                    { l: 'ממתינים', v: '63', c: 'text-amber-700' },
                    { l: 'היענות', v: '82%', c: 'text-primary' },
                  ].map((s) => (
                    <div key={s.l} className="rounded-lg border border-border p-3 text-center">
                      <div className={`text-xl font-extrabold tabular-nums @[22rem]/preview:text-2xl ${s.c}`}>{s.v}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{s.l}</div>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="mb-2 flex justify-between text-xs font-medium text-muted-foreground">
                    <span>תמונת מצב</span>
                    <span>340 מוזמנים</span>
                  </div>
                  <div className="flex h-3 overflow-hidden rounded-full bg-border">
                    <div className="bg-emerald-500" style={{ width: '73%' }} />
                    <div className="bg-amber-400" style={{ width: '18%' }} />
                    <div className="bg-rose-400" style={{ width: '9%' }} />
                  </div>
                </div>
                <div className="grid gap-1">
                  {PREVIEW_GUESTS.map((g) => (
                    <div key={g.n} className="flex items-center gap-3 border-t border-border py-2">
                      <span className="grid size-8 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                        {g.n[0]}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold">{g.n}</div>
                        <div className="text-xs text-muted-foreground">{g.m}</div>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${g.cls}`}>{g.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
              </TiltCard>
            </ParallaxLayer>
          </div>
          {/* Third depth layer: a soft blob of the primary token that LAGS the
              scroll (background), behind the static `before:` wash. */}
          <ParallaxLayer
            depth={48}
            decorative
            className="pointer-events-none absolute end-0 top-1/3 -z-10 size-72 rounded-full bg-primary/10 blur-3xl"
          />
        </section>
        </HeroParallax>

        {/* Problem / Solution */}
        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div>
              <Eyebrow icon={TriangleAlert}>המצב היום</Eyebrow>
              <h2 className="mt-4 text-balance text-display font-bold tracking-tight">
                ניהול אירוע לא צריך להרגיש כמו עבודה במשרה מלאה
              </h2>
              <p className="mt-3 text-pretty text-lg text-muted-foreground">
                בעלי אירועים נתקלים שוב ושוב באותן בעיות — והן מתנקזות ללחץ מיותר.
              </p>
              <div className="k-reveal-group mt-6 grid gap-4">
                {PROBLEMS.map(({ icon: Icon, t, d }) => (
                  <div key={t} className="flex items-start gap-4">
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[#f3f4f6] text-foreground">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <div>
                      <div className="font-bold">{t}</div>
                      <div className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{d}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="k-reveal rounded-2xl bg-[#0b0f1a] p-7 text-white inset-ring-1 inset-ring-white/10">
              <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-indigo-300">
                <CheckCheck className="size-4" aria-hidden /> הפתרון
              </span>
              <h3 className="mt-3 text-balance text-2xl font-extrabold tracking-tight">KALFA מרכזת את הכול במקום אחד</h3>
              <p className="mt-2 text-pretty leading-relaxed text-white/70">
                אורחים, הזמנות, אישורי הגעה, תזכורות, סטטוסים ועדכונים — מערכת אחת מסודרת שנותנת לכם שליטה מלאה.
              </p>
              <div className="mt-6 grid gap-2.5">
                {SOLUTIONS.map((s) => (
                  <div key={s} className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3.5 py-3">
                    <CircleCheck className="size-5 shrink-0 text-indigo-300" aria-hidden />
                    <span className="text-sm font-semibold">{s}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        {/* `scroll-mt-16` on every in-page anchor target: the header is
            sticky and 64px tall, so without it a nav click landed with the
            section title hidden under the header. */}
        <section id="features" className="scroll-mt-16 border-y border-border bg-[#f9fafb]">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <div className="k-reveal mx-auto mb-11 max-w-2xl text-center">
              <Eyebrow icon={Layers}>יכולות מרכזיות</Eyebrow>
              <h2 className="mt-3 text-balance text-display font-bold tracking-tight">כל מה שצריך כדי לנהל אישורי הגעה</h2>
              <p className="mt-2.5 text-pretty text-lg text-muted-foreground">שבע יכולות שעובדות יחד — מרשימת האורחים ועד הדוח הסופי.</p>
            </div>
            {/* `k-reveal-3d` (= k-reveal-group + a 6° stand-up on touch devices)
                and `k-press` (touch press-in on the card) — motion spec §10. */}
            <div className="k-reveal-3d grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ n, icon: Icon, t, d, anim, iconAnim }) => (
                <TiltCard key={n} maxAngle={5} scale={1.01} glare={false}>
                <div
                  className="k-card k-press rounded-xl border border-border bg-background p-6 hover:shadow-md"
                >
                  <div className="mb-4 flex items-center justify-between">
                    <span
                      className={`grid size-11 place-items-center rounded-lg bg-[#0b0f1a] text-white${anim ? ` ${anim}` : ''}`}
                    >
                      <Icon className={`size-5${iconAnim ? ` ${iconAnim}` : ''}`} />
                    </span>
                    <span className="text-xs text-muted-foreground">{n}</span>
                  </div>
                  <h3 className="text-lg font-bold">{t}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{d}</p>
                </div>
                </TiltCard>
              ))}
              <div className="flex flex-col justify-center gap-4 rounded-xl border border-indigo-100 bg-indigo-50 p-6">
                <h3 className="text-balance text-lg font-bold text-indigo-700">הכול מחובר. שום דבר לא הולך לאיבוד.</h3>
                <Link
                  href={user ? '/app/events/new' : '/auth/signup'}
                  className={siteCta({ size: 'md', className: 'w-fit' })}
                >
                  {user ? 'אירוע חדש' : 'התחילו עכשיו'}
                  <ArrowLeft className="size-4" aria-hidden />
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto max-w-6xl scroll-mt-16 px-6 py-16">
          <div className="k-reveal mx-auto mb-12 max-w-2xl text-center">
            <Eyebrow icon={Route}>איך זה עובד</Eyebrow>
            <h2 className="mt-3 text-balance text-display font-bold tracking-tight">שישה צעדים פשוטים, מהרעיון ועד האירוע</h2>
            <p className="mt-2.5 text-pretty text-lg text-muted-foreground">בלי הדרכות מסובכות. בונים אירוע ומתחילים לעבוד.</p>
          </div>
          <div className="k-reveal-3d grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {STEPS.map(({ n, icon: Icon, t, d }) => (
              <div key={n} className="k-card rounded-xl border border-border bg-background p-6 hover:shadow-md">
                <div className="mb-3.5 flex items-center gap-3.5">
                  <span className="grid size-8 place-items-center rounded-full bg-[#0b0f1a] text-sm font-semibold text-white">{n}</span>
                  <Icon className="size-5 text-primary" aria-hidden />
                </div>
                <h3 className="text-lg font-bold">{t}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Trust */}
        <section id="trust" className="scroll-mt-16 bg-[#0b0f1a]">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <div className="k-reveal mx-auto mb-11 max-w-2xl text-center">
              <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-indigo-300">
                <Lock className="size-4" aria-hidden /> אמון
              </span>
              <h2 className="mt-3 text-balance text-display font-bold tracking-tight text-white">נבנתה כדי להפחית לחץ — לא להוסיף אותו</h2>
              <p className="mt-2.5 text-pretty text-lg text-white/70">
                המטרה פשוטה: למנוע בלבול, לחסוך זמן ולתת למארגן האירוע שליטה מלאה ושקטה בתהליך.
              </p>
            </div>
            <div className="k-reveal-3d grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {TRUST.map(({ icon: Icon, t, d }) => (
                <div key={t} className="k-card rounded-xl border border-white/10 bg-white/5 p-6 hover:bg-white/10">
                  <Icon className="mb-3.5 size-6 text-indigo-300" aria-hidden />
                  <h3 className="font-bold text-white">{t}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-white/60">{d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Audiences */}
        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="grid items-center gap-10 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <Eyebrow icon={UsersRound}>למי זה מתאים</Eyebrow>
              <h2 className="mt-4 text-balance text-display font-bold tracking-tight">אירוע אחד או מאות — אותה שליטה</h2>
              <p className="mt-3 text-pretty text-lg text-muted-foreground">
                מאירוע משפחתי אינטימי ועד כנס חברה גדול — KALFA מתאימה את עצמה לגודל ולסגנון שלכם.
              </p>
            </div>
            {/* Tiles that are links get the shared focus outline (they had
                none) and `min-h-11`; the two non-link tiles keep the same box
                so the grid stays even. */}
            <div className="k-reveal-group grid grid-cols-2 gap-3 sm:grid-cols-3">
              {AUDIENCES.map(({ icon: Icon, t, href }) => {
                const body = (
                  <>
                    <Icon className="size-5 shrink-0 text-primary" aria-hidden />
                    <span className="text-sm font-semibold">{t}</span>
                  </>
                );
                const shell =
                  'k-card flex min-h-11 items-center gap-3 rounded-lg border border-border bg-background px-4 py-4 hover:border-primary hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
                return href ? (
                  <Link key={t} href={href} className={shell}>
                    {body}
                  </Link>
                ) : (
                  <div key={t} className={shell}>
                    {body}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="mx-auto max-w-6xl px-6 pb-16">
          {/* Closing banner: flat bg-primary + a radial highlight in the top
              start corner (white at 15%, the same white/15 the secondary
              button already uses) — depth without a second colour. */}
          <div className="k-reveal k-sheen relative isolate overflow-hidden rounded-3xl bg-primary px-8 py-14 text-center before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:bg-radial-[at_top_start] before:from-white/15 before:to-transparent sm:py-16">
            <h2 className="text-balance text-3xl font-extrabold leading-tight tracking-tight text-primary-foreground sm:text-5xl">
              פחות התעסקות, יותר שליטה.
              <br />
              אירוע מסודר יותר.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-pretty text-primary-foreground/90">
              התחילו לנהל את אישורי ההגעה לאירוע שלכם עוד היום — מסודר, ברור ובמקום אחד.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Link href={startHref} className={siteCta({ variant: 'dark', size: 'xl' })}>
                {startLabel}
                <ArrowLeft className="size-5" aria-hidden />
              </Link>
              <Link
                href={user ? '/app/events/new' : '/auth/login'}
                className={siteCta({ variant: 'onPrimary', size: 'xl' })}
              >
                {user ? 'אירוע חדש' : 'כניסה לחשבון'}
              </Link>
            </div>
          </div>
        </section>
      </main>
      {/* Footer: shared SiteFooter, mounted by the (site) layout for every
          marketing page (footer review 24.8 — the old 3-column placeholder
          block and the duplicated slogan were removed). */}
    </div>
  );
}
