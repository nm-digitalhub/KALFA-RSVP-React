import Link from 'next/link';

import { getUser } from '@/lib/auth/dal';
import {
  Activity,
  AlarmClock,
  ArrowLeft,
  Armchair,
  Building2,
  CalendarPlus,
  ChartColumnBig,
  CheckCheck,
  CircleCheck,
  CircleQuestionMark,
  Clock,
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
  { n: '05', icon: Armchair, t: 'ניהול שולחנות והושבה', d: 'שיבוץ אורחים לשולחנות בקלות, לפי קבוצות והעדפות.' },
  { n: '06', icon: MessageCircle, t: 'תקשורת מסודרת', d: 'עדכונים ופניות לאורחים בערוץ אחד ברור.' },
  { n: '07', icon: ChartColumnBig, t: 'דוחות וסיכומים', d: 'סיכום מספרים ברור למארגן — לפני האירוע ואחריו.', iconAnim: 'k-ico-bars' },
];

const STEPS: { n: string; icon: LucideIcon; t: string; d: string }[] = [
  { n: '1', icon: CalendarPlus, t: 'יוצרים אירוע', d: 'שם, תאריך ומקום — והאירוע מוכן לניהול.' },
  { n: '2', icon: UserPlus, t: 'מוסיפים אורחים', d: 'ידנית או בייבוא רשימה קיימת, עם קבוצות ומלווים.' },
  { n: '3', icon: Send, t: 'שולחים הזמנות', d: 'הזמנה אישית לכל אורח, בערוץ הנוח לכם.' },
  { n: '4', icon: MessageSquareReply, t: 'עוקבים אחרי תגובות', d: 'כל אישור נרשם בזמן אמת, עם תזכורת לממתינים.' },
  { n: '5', icon: Armchair, t: 'מנהלים הושבה ועדכונים', d: 'שיבוץ שולחנות ועדכונים שוטפים לאורחים.' },
  { n: '6', icon: PartyPopper, t: 'מגיעים לאירוע מסודר', d: 'עם תמונת מצב ברורה של מי שמגיע.' },
];

const TRUST: { icon: LucideIcon; t: string; d: string }[] = [
  { icon: ShieldCheck, t: 'פרטיות ואבטחה', d: 'רשימת האורחים והנתונים שלכם שמורים ופרטיים — שלכם בלבד.' },
  { icon: LayoutGrid, t: 'סדר במקום בלבול', d: 'מקור אמת אחד לכל המידע, בלי גרסאות סותרות.' },
  { icon: HandHeart, t: 'נוחות שימוש', d: 'ממשק בהיר בעברית, בלי עקומת למידה ובלי ז׳רגון טכני.' },
  { icon: Gauge, t: 'שליטה מלאה', d: 'אתם רואים הכול ומחליטים הכול — בכל רגע נתון.' },
];

const AUDIENCES: { icon: LucideIcon; t: string }[] = [
  { icon: Heart, t: 'חתונות' },
  { icon: Star, t: 'בר/בת מצווה' },
  { icon: House, t: 'אירועים משפחתיים' },
  { icon: Presentation, t: 'כנסים' },
  { icon: Building2, t: 'אירועי חברה' },
  { icon: Gift, t: 'אירועים פרטיים' },
];

const PREVIEW_GUESTS = [
  { n: 'משפחת לוי', m: '4 אורחים', label: 'אישרו', cls: 'bg-emerald-50 text-emerald-700' },
  { n: 'יואב כהן', m: '2 אורחים', label: 'ממתין', cls: 'bg-amber-50 text-amber-700' },
  { n: 'נועה אבני', m: '1 אורח', label: 'לא מגיע', cls: 'bg-rose-50 text-rose-700' },
];

const FOOTER_COLS = [
  { title: 'מוצר', links: ['יכולות', 'איך זה עובד', 'אבטחה'] },
  { title: 'אירועים', links: ['חתונות', 'בר/בת מצווה', 'כנסים', 'אירועי חברה'] },
  { title: 'חברה', links: ['אודות', 'יצירת קשר', 'תמיכה'] },
];

function Eyebrow({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-primary">
      <Icon className="size-4" />
      {children}
    </span>
  );
}

export default async function HomePage() {
  // Recognise a signed-in visitor (verified server-side; null when anonymous)
  // so the landing points returning users to their dashboard, not to sign-up.
  const user = await getUser();
  const startHref = user ? '/app' : '/auth/signup';
  const startLabel = user ? 'לאזור האישי' : 'צרו אירוע חדש';

  return (
    <div className="bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur-md backdrop-saturate-150">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="text-2xl font-extrabold tracking-tight">KALFA</Link>
          <nav className="hidden items-center gap-7 md:flex">
            <a href="#features" className="text-sm font-medium text-muted-foreground hover:text-foreground">יכולות</a>
            <a href="#how" className="text-sm font-medium text-muted-foreground hover:text-foreground">איך זה עובד</a>
            <a href="#trust" className="text-sm font-medium text-muted-foreground hover:text-foreground">אמון</a>
          </nav>
          <div className="flex items-center gap-3">
            {user ? (
              <>
                <span className="hidden max-w-40 truncate text-sm text-muted-foreground sm:inline">
                  {user.email}
                </span>
                <Link
                  href="/app"
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
                >
                  לאזור האישי
                  <ArrowLeft className="size-4" />
                </Link>
              </>
            ) : (
              <>
                <Link href="/auth/login" className="text-sm font-semibold hover:underline">כניסה</Link>
                <Link
                  href="/auth/signup"
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
                >
                  צרו אירוע
                  <ArrowLeft className="size-4" />
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <Eyebrow icon={Sparkles}>ניהול חכם לאירוע מושלם</Eyebrow>
              <h1 className="mt-4 text-4xl font-extrabold leading-tight tracking-tight sm:text-6xl">
                אישורי הגעה,
                <br />
                <span className="text-primary">במקום אחד.</span>
              </h1>
              <p className="mt-5 max-w-prose text-lg text-muted-foreground">
                שלחו הזמנות, עקבו אחר התגובות בזמן אמת ונהלו את רשימת האורחים וההושבה — בלי גיליונות, בלי הודעות מפוזרות, בלי בלגן.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link
                  href={startHref}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 font-semibold text-primary-foreground transition hover:opacity-90"
                >
                  {startLabel}
                  <ArrowLeft className="size-5" />
                </Link>
                <a
                  href="#how"
                  className="inline-flex items-center gap-2 rounded-md border border-border px-6 py-3 font-semibold transition hover:bg-[#f9fafb]"
                >
                  <Play className="size-4" />
                  צפו בהדגמה קצרה
                </a>
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-5 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-2"><ShieldCheck className="size-4" /> פרטי ומאובטח</span>
                <span className="inline-flex items-center gap-2"><Clock className="size-4" /> מוכן תוך דקות</span>
              </div>
            </div>

            {/* Dashboard preview */}
            <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-xl">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div>
                  <div className="font-bold">חתונה · דנה ויואב</div>
                  <div className="text-xs text-muted-foreground">14.06.2026 · אולמי השרון</div>
                </div>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">248 אישרו</span>
              </div>
              <div className="grid gap-4 p-4">
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { l: 'אישרו', v: '248', c: 'text-emerald-700' },
                    { l: 'ממתינים', v: '63', c: 'text-amber-700' },
                    { l: 'היענות', v: '82%', c: 'text-primary' },
                  ].map((s) => (
                    <div key={s.l} className="rounded-lg border border-border p-3 text-center">
                      <div className={`text-2xl font-extrabold ${s.c}`}>{s.v}</div>
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
          </div>
        </section>

        {/* Problem / Solution */}
        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div>
              <Eyebrow icon={TriangleAlert}>המצב היום</Eyebrow>
              <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
                ניהול אירוע לא צריך להרגיש כמו עבודה במשרה מלאה
              </h2>
              <p className="mt-3 text-lg text-muted-foreground">
                בעלי אירועים נתקלים שוב ושוב באותן בעיות — והן מתנקזות ללחץ מיותר.
              </p>
              <div className="mt-6 grid gap-4">
                {PROBLEMS.map(({ icon: Icon, t, d }) => (
                  <div key={t} className="flex items-start gap-4">
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[#f3f4f6] text-foreground">
                      <Icon className="size-5" />
                    </span>
                    <div>
                      <div className="font-bold">{t}</div>
                      <div className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{d}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl bg-[#0b0f1a] p-7 text-white">
              <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-indigo-300">
                <CheckCheck className="size-4" /> הפתרון
              </span>
              <h3 className="mt-3 text-2xl font-extrabold tracking-tight">KALFA מרכזת את הכול במקום אחד</h3>
              <p className="mt-2 leading-relaxed text-white/70">
                אורחים, הזמנות, אישורי הגעה, תזכורות, סטטוסים ועדכונים — מערכת אחת מסודרת שנותנת לכם שליטה מלאה.
              </p>
              <div className="mt-6 grid gap-2.5">
                {SOLUTIONS.map((s) => (
                  <div key={s} className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3.5 py-3">
                    <CircleCheck className="size-5 shrink-0 text-indigo-300" />
                    <span className="text-sm font-semibold">{s}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="border-y border-border bg-[#f9fafb]">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <div className="mx-auto mb-11 max-w-2xl text-center">
              <Eyebrow icon={Layers}>יכולות מרכזיות</Eyebrow>
              <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">כל מה שצריך כדי לנהל אישורי הגעה</h2>
              <p className="mt-2.5 text-lg text-muted-foreground">שבע יכולות שעובדות יחד — מרשימת האורחים ועד הדוח הסופי.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ n, icon: Icon, t, d, anim, iconAnim }) => (
                <div
                  key={n}
                  className="rounded-xl border border-border bg-background p-6 transition hover:-translate-y-1 hover:shadow-md"
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
              ))}
              <div className="flex flex-col justify-center gap-4 rounded-xl border border-indigo-100 bg-indigo-50 p-6">
                <h3 className="text-lg font-bold text-indigo-700">הכול מחובר. שום דבר לא הולך לאיבוד.</h3>
                <Link
                  href={user ? '/app/events/new' : '/auth/signup'}
                  className="inline-flex w-fit items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
                >
                  {user ? 'אירוע חדש' : 'התחילו עכשיו'}
                  <ArrowLeft className="size-4" />
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto max-w-6xl px-6 py-16">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <Eyebrow icon={Route}>איך זה עובד</Eyebrow>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">שישה צעדים פשוטים, מהרעיון ועד האירוע</h2>
            <p className="mt-2.5 text-lg text-muted-foreground">בלי הדרכות מסובכות. בונים אירוע ומתחילים לעבוד.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {STEPS.map(({ n, icon: Icon, t, d }) => (
              <div key={n} className="rounded-xl border border-border bg-background p-6 transition hover:-translate-y-1 hover:shadow-md">
                <div className="mb-3.5 flex items-center gap-3.5">
                  <span className="grid size-8 place-items-center rounded-full bg-[#0b0f1a] text-sm font-semibold text-white">{n}</span>
                  <Icon className="size-5 text-primary" />
                </div>
                <h3 className="text-lg font-bold">{t}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Trust */}
        <section id="trust" className="bg-[#0b0f1a]">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <div className="mx-auto mb-11 max-w-2xl text-center">
              <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-indigo-300">
                <Lock className="size-4" /> אמון
              </span>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">נבנתה כדי להפחית לחץ — לא להוסיף אותו</h2>
              <p className="mt-2.5 text-lg text-white/70">
                המטרה פשוטה: למנוע בלבול, לחסוך זמן ולתת למארגן האירוע שליטה מלאה ושקטה בתהליך.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {TRUST.map(({ icon: Icon, t, d }) => (
                <div key={t} className="rounded-xl border border-white/10 bg-white/5 p-6">
                  <Icon className="mb-3.5 size-6 text-indigo-300" />
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
              <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">אירוע אחד או מאות — אותה שליטה</h2>
              <p className="mt-3 text-lg text-muted-foreground">
                מאירוע משפחתי אינטימי ועד כנס חברה גדול — KALFA מתאימה את עצמה לגודל ולסגנון שלכם.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {AUDIENCES.map(({ icon: Icon, t }) => (
                <div
                  key={t}
                  className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-4 transition hover:-translate-y-1 hover:border-primary hover:shadow-sm"
                >
                  <Icon className="size-5 text-primary" />
                  <span className="text-sm font-semibold">{t}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="mx-auto max-w-6xl px-6 pb-16">
          <div className="overflow-hidden rounded-3xl bg-primary px-8 py-14 text-center sm:py-16">
            <h2 className="text-3xl font-extrabold leading-tight tracking-tight text-primary-foreground sm:text-5xl">
              פחות התעסקות, יותר שליטה.
              <br />
              אירוע מסודר יותר.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-primary-foreground/90">
              התחילו לנהל את אישורי ההגעה לאירוע שלכם עוד היום — מסודר, ברור ובמקום אחד.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Link
                href={startHref}
                className="inline-flex items-center gap-2 rounded-md bg-[#0b0f1a] px-7 py-3.5 font-semibold text-white transition hover:opacity-90"
              >
                {startLabel}
                <ArrowLeft className="size-5" />
              </Link>
              <Link
                href={user ? '/app/events/new' : '/auth/login'}
                className="inline-flex items-center rounded-md border border-white/40 bg-white/15 px-7 py-3.5 font-semibold text-primary-foreground transition hover:bg-white/25"
              >
                {user ? 'אירוע חדש' : 'כניסה לחשבון'}
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-[#0b0f1a] text-white/60">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div>
              <div className="mb-3.5 text-xl font-extrabold text-white">KALFA</div>
              <p className="max-w-xs text-sm leading-relaxed">
                ניהול אישורי הגעה לאירועים פרטיים ועסקיים — במקום אחד.
              </p>
            </div>
            {FOOTER_COLS.map((col) => (
              <div key={col.title}>
                <div className="mb-3.5 font-semibold text-white">{col.title}</div>
                <div className="grid gap-2.5">
                  {col.links.map((l) => (
                    <span key={l} className="text-sm text-white/60">{l}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap justify-between gap-3 border-t border-white/10 pt-5 text-xs">
            <span>© 2026 KALFA · כל הזכויות שמורות</span>
            <span>פחות התעסקות · יותר שליטה</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
