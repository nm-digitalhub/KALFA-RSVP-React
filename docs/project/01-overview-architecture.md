# KALFA Event Magic — מבט-על על המוצר והארכיטקטורה

> מסמך זה נכתב מתוך קריאת הקוד בפועל (repo: `/var/www/vhosts/kalfa.me/beta`), נכון ל-2026-07-02.
> כל מזהה טכני (נתיבים, טבלאות, חבילות, קוד) נשמר באנגלית.

## 1. מה המוצר

KALFA היא פלטפורמת RSVP מסוג B2C, במודל **פר-אירוע** (לא מנוי מתמשך): לקוח יוצר אירוע פרטי, מייבא מוזמנים, שולח אליהם הודעות, אוסף אישורי הגעה וצופה בדוחות. הממשק הוא **עברית-תחילה ו-RTL**, עם כוונה עתידית לתמיכה באנגלית וצרפתית.

היכולות הקיימות בקוד (מאומתות מול `src/app` ו-`src/lib`):

| יכולת | היכן בקוד |
|---|---|
| ניהול אירועים (יצירה, עריכה, מודל מצבי lifecycle) | `src/app/(customer)/app/events`, `src/lib/data/events.ts` |
| ניהול מוזמנים כולל ייבוא CSV | `src/app/(customer)/app/events/[id]/guests`, `src/lib/csv.ts`, `src/lib/data/guests.ts` |
| RSVP ציבורי מבוסס טוקן פר-מוזמן | `src/app/(public)/r/[token]`, `src/lib/data/rsvp.ts` |
| קמפיין הודעות/טלפוניה פר-אירוע (WhatsApp ‏← תזכורות ← שיחה) | `src/app/(customer)/app/events/[id]/campaign`, `src/lib/data/outreach-engine.ts`, `worker/main.ts` |
| חיוב לפי תוצאה (per reached contact) דרך SUMIT — J5 hold / J4 | `src/lib/sumit/*`, `src/lib/data/billing.ts`, `src/lib/data/close-charge.ts` |
| הסכם חתום דיגיטלית + PDF | `src/lib/agreements/*` (‏`signature_pad`, ‏`puppeteer`) |
| הזמנות ותשלומים של הלקוח | `src/app/(customer)/app/orders`, `src/lib/data/orders.ts`, `src/lib/data/payments.ts` |
| ריבוי-ארגונים (organizations) עם תפקידים והרשאות מונחי-נתונים | `src/lib/data/orgs.ts`, `src/lib/permissions.ts`, `src/app/(customer)/app/team` |
| קונסולת אדמין מלאה | `src/app/(admin)/admin/*`, `src/lib/data/admin/*` |
| Webhook נכנס מ-WhatsApp‏ (persist-then-process) | `src/app/api/webhooks/whatsapp`, `src/lib/data/webhook-processing.ts` |
| OTP ב-SMS (ספק ExtrA) ודוא"ל עסקי (SMTP) | `src/lib/sms/sender.ts`, `src/lib/data/otp.ts`, `src/lib/email/sender.ts` |

עקרון עסקי מרכזי (נאכף גם כהנחיית פרויקט): מחירים, ערוצים, מסלולים ומדיניות הם **נתוני אדמין ב-DB** הנקראים בצד השרת — לעולם לא hardcoded בקוד או ב-UI.

## 2. סטאק טכנולוגי

הגרסאות במדויק מתוך `package.json` (‏`package.json` הוא מקור האמת):

### Dependencies

| חבילה | גרסה | תפקיד |
|---|---|---|
| `next` | `16.2.9` (pinned) | App Router; שימו לב — Next 16, כולל שינוי `middleware`‏←`proxy` |
| `react` / `react-dom` | `19.2.7` (pinned) | React 19, Server Components |
| `@supabase/supabase-js` | `^2.108.2` | קליינט Supabase (DB + Auth) |
| `@supabase/ssr` | `^0.12.0` | סשן מבוסס cookies בצד שרת |
| `zod` | `^4.4.3` | ולידציית קלט בגבולות השרת (Zod 4) |
| `@base-ui/react` | `^1.6.0` | פרימיטיבי UI headless (בסיס לרכיבי shadcn) |
| `shadcn` | `^4.11.0` | registry/סגנון רכיבים (style: `base-nova`) + `shadcn/tailwind.css` |
| `lucide-react` | `^1.21.0` | אייקונים |
| `tailwind-merge` / `clsx` / `class-variance-authority` | `^3.6.0` / `^2.1.1` / `^0.7.1` | הרכבת classes (`cn()` ב-`src/lib/utils.ts`) |
| `tw-animate-css` | `^1.4.0` | אנימציות Tailwind |
| `react-hook-form` + `@hookform/resolvers` | `^7.80.0` / `^5.4.0` | טפסים בצד לקוח |
| `recharts` | `^3.8.0` | גרפים (רכיב `chart.tsx`) |
| `pg-boss` | `^12.21.2` | תור עבודות Postgres (תהליך worker נפרד) |
| `whatsapp-api-js` | `^6.2.1` | WhatsApp Cloud API (שליחה + webhook) |
| `nodemailer` | `^9.0.1` | SMTP לדוא"ל עסקי |
| `puppeteer` | `^25.2.1` | רינדור PDF של ההסכם החתום (עברית BiDi); מוגדר `serverExternalPackages` |
| `@cantoo/pdf-lib` | `^2.7.1` | מניפולציית PDF |
| `signature_pad` | `^5.1.3` | לכידת חתימה בדפדפן |
| `libphonenumber-js` | `^1.13.7` | נרמול טלפונים ל-E.164 (ברירת מחדל region ‏IL) |
| `@zxcvbn-ts/core` + `@zxcvbn-ts/language-common` | `^4.1.2` | חוזק סיסמה |
| `server-only` | `^0.0.1` | אכיפת קוד שרת-בלבד בזמן build |

### DevDependencies

| חבילה | גרסה | תפקיד |
|---|---|---|
| `typescript` | `^5` | ‏strict mode, ‏alias ‏`@/* → ./src/*` |
| `tailwindcss` + `@tailwindcss/postcss` | `^4` | Tailwind CSS v4 (‏CSS-first, ללא tailwind.config) |
| `vitest` | `^4.1.9` | בדיקות יחידה |
| `eslint` + `eslint-config-next` | `^9` / `16.2.9` | linting (flat config, ‏`eslint.config.mjs`) |
| `esbuild` | `^0.28.1` | bundling של ה-worker ל-`dist/worker.cjs` |
| `supabase` (CLI) | `^2.107.0` | מיגרציות, יצירת types |

Node: ‏`24`‏ (מתוך `.node-version`).

### סקריפטים עיקריים (`package.json → scripts`)

| סקריפט | פקודה | הערות |
|---|---|---|
| `dev` | `next dev` | |
| `build` | `NEXT_DIST_DIR=.next-verify next build --webpack` | **‏`--webpack` בכוונה** — build של Turbopack שובר את `/_not-found`; בנוסף בונה לספרייה מבודדת `.next-verify` כדי לא לדרוס את `.next` החי שמוגש ע"י pm2 |
| `build:prod` | `next build --webpack` | build לספריית `.next` הרגילה |
| `deploy` | build ל-`.next-stage` ← החלפה אטומית של `.next` ← ‏`pm2 restart kalfa-beta` ← ‏`worker:build` ← ‏`pm2 restart kalfa-worker` | ה-deploy *הוא* ה-build; אין להריץ `npm run build` לפניו |
| `worker:build` | `esbuild worker/main.ts --bundle ... --outfile=dist/worker.cjs` | ‏`server-only`/`next/headers`/`next/cache` מוחלפים ב-stub ריק (`worker/empty.js`) |
| `test` / `test:watch` | `vitest run` / `vitest` | |
| `lint` | `eslint` | |
| `pm2:*`, `worker:*` | תפעול שני תהליכי pm2‏: `kalfa-beta` (אפליקציה, פורט 3002) ו-`kalfa-worker` | |

## 3. מבנה הריפו (top-level)

| נתיב | תוכן |
|---|---|
| `src/` | כל קוד האפליקציה (App Router, רכיבים, מודולי דומיין, בדיקות) |
| `worker/` | תהליך ה-outreach הארוך-חיים: `main.ts` (pg-boss worker) ו-`empty.js` (stub ל-esbuild) |
| `supabase/` | ‏`config.toml`, ‏46 מיגרציות תחת `migrations/`, ו-runbooks תפעוליים תחת `runbooks/` |
| `docs/` | תיעוד פרויקט: ארכיטקטורה וסכימה, runbook ל-webhooks, תיעוד SUMIT/WhatsApp, ותת-ספרייה `project/` (סדרת מסמכים זו) |
| `plans/` | מסמכי spec ותוכניות עבודה (audit, billing, lifecycle, outreach ועוד) — מסמכי עבודה, לא מקור אמת; בקונפליקט מול קוד — הקוד גובר |
| `scripts/` | סקריפטים תפעוליים (`kalfa-preflight.sh`, `kalfa-worktree-snapshot.sh`) |
| `ops-evidence/` | פלטי אימות/preflight תפעוליים (לא קוד) |
| `dist/` | פלט ה-worker המקומפל (`worker.cjs`) |
| קבצי שורש | `next.config.ts`, `tsconfig.json`, `vitest.config.ts`, `components.json`, `eslint.config.mjs`, `postcss.config.mjs`, `CLAUDE.md`, `AGENTS.md`, `README.md`, `.env.example` |

הערה: קיימים בשורש גם קבצי עזר היסטוריים (`swagger.json` — תיעוד SUMIT API, ‏`read.md`, ‏`index.html`) שאינם חלק מזרימת הריצה.

## 4. מבנה ה-App Router‏ (`src/app`)

ארבע קבוצות route (‏route groups) + ‏`auth` + ‏`api`. העץ בפועל:

```text
src/app/
├── layout.tsx            # root: <html lang="he" dir="rtl">, פונט Heebo (hebrew+latin)
├── globals.css           # Tailwind 4 (@import "tailwindcss"), tokens ב-oklch, dark variant
├── global-error.tsx
├── not-found.tsx
│
├── (public)/             # דפים ציבוריים — ללא התחברות
│   ├── page.tsx          # דף הבית השיווקי
│   ├── terms/  privacy/  # מסמכים משפטיים (_legal.tsx משותף)
│   ├── r/[token]/        # RSVP ציבורי פר-מוזמן (page + actions + rsvp-form)
│   └── join/[token]/     # קבלת הזמנה לארגון (org invitation)
│
├── auth/                 # login / signup (+success) / callback / logout
│
├── (customer)/app/       # אזור הלקוח המחובר (prefix /app)
│   ├── layout.tsx        # אוכף requireUser + עוטף ב-AppShell (RTL DirectionProvider)
│   ├── page.tsx          # dashboard
│   ├── events/           # new, [id] (פרטי אירוע)
│   │   └── [id]/guests/  # רשימה, new, import (CSV), [guestId]
│   │   └── [id]/campaign/[campaignId]/   # קמפיין: agreement, approve, payment
│   ├── orders/           # [id], [id]/pay
│   ├── settings/  team/  # הגדרות משתמש; ניהול חברי ארגון
│   └── admin-access/     # מעבר מאומת לקונסולת האדמין
│
├── (admin)/admin/        # קונסולת אדמין (prefix /admin) — requireAdmin ב-layout
│   ├── activity/ agreement/ callbacks/ channels/ company/
│   ├── contacts/ orders/ settings/ sumit-test/ templates/
│   ├── packages/ ([id], new)  users/ ([id])  webhooks/
│
└── api/                  # Route Handlers (מכוסה בפירוט במסמך נפרד)
    ├── admin/orders/[id]/reconcile/   admin/sumit-test/
    ├── campaigns/[id]/{authorize, close-charge, whatsapp-send}/
    ├── orders/[id]/pay/
    └── webhooks/whatsapp/             # GET verify + POST intake (persist-then-process)
```

סדרי גודל: ‏41 קבצי `page.tsx`, ‏10 קבצי `route.ts`, ‏17 קבצי `actions.ts` (‏Server Actions צמודי-route), ושלושה `layout.tsx` (root, customer, admin).

הערת אי-התאמה קטנה: ה-"Preferred structure" ב-`CLAUDE.md` מצייר את `r/[token]` כספרייה עצמאית תחת `src/app/`; בקוד בפועל היא יושבת בתוך קבוצת `(public)` — ‏`src/app/(public)/r/[token]`. ה-URL הציבורי זהה (`/r/<token>`), כי route groups אינם משפיעים על הנתיב.

## 5. קונבנציות רינדור

- **Server Components כברירת מחדל.** דפים ו-layouts עוסקים בקומפוזיציה וטעינת נתונים; לוגיקה עסקית יושבת ב-`src/lib/`.
- **`"use client"` רק היכן שנדרש** — ‏57 קבצים בסך הכול, מרוכזים ב: רכיבי `src/components/ui/*` (פרימיטיבים אינטראקטיביים), ‏shells‏ (`app-shell.tsx`, `admin-shell.tsx`), וטפסים אינטראקטיביים (ייבוא מוזמנים, טופס RSVP, חתימת הסכם, תשלום). כמעט כל `src/lib` מסומן `import 'server-only'`.
- **`src/proxy.ts`** — ב-Next 16 הקובץ `middleware` שונה ל-`proxy` (ריצה ב-Node runtime). האחריות שלו מוגבלת בכוונה לשניים בלבד:
  1. רענון סשן Supabase דרך `@supabase/ssr` — עם `supabase.auth.getUser()` (ולא `getSession()`), כדי לאמת את הטוקן מול שרת ה-Auth ולכתוב cookies מעודכנים.
  2. redirect אופטימי: משתמש לא מחובר שניגש ל-`/app` או `/admin` מופנה ל-`/auth/login?redirectTo=...`; משתמש מחובר שניגש לדפי auth מופנה ל-`/app`.

  ההרשאה האמיתית נאכפת **קרוב לנתונים** (‏`src/lib/auth/dal.ts` ושכבת הנתונים) — ה-proxy אינו קו הגנה יחיד. ‏`config.matcher` מדלג על נכסים סטטיים ותמונות.
- **`next.config.ts`**: ‏`distDir` נשלט ע"י `NEXT_DIST_DIR` (בידוד builds מה-`.next` החי); ‏`serverExternalPackages: ['puppeteer']`; ו-headers ייעודיים ל-`/r/:token*` — ‏`Cache-Control: no-store`, ‏`Referrer-Policy: no-referrer`, ‏`X-Robots-Tag: noindex` (הטוקן נמצא בנתיב ואסור שידלוף).

## 6. מערכת העיצוב

- **Tailwind CSS 4** בגישת CSS-first: אין `tailwind.config`; ‏`src/app/globals.css` פותח ב-`@import "tailwindcss"` + ‏`@import "tw-animate-css"` + ‏`@import "shadcn/tailwind.css"`, עם design tokens כ-CSS variables בפורמט `oklch` ו-`@custom-variant dark`.
- **רכיבי shadcn מעל `@base-ui/react`** (לא Radix): ‏`components.json` מגדיר `style: "base-nova"`, ‏`rsc: true`, ‏`iconLibrary: "lucide"`, ‏**`rtl: true`**. הרכיבים חיים ב-`src/components/ui/` — ‏16 רכיבים (accordion, button, card, chart, collapsible, dropdown-menu, input, scroll-area, select, separator, sheet, sidebar, skeleton, switch, tabs, tooltip).
- **עברית-תחילה ו-RTL**: ה-root layout מגדיר `<html lang="he" dir="rtl">` עם פונט **Heebo** (subsets ‏hebrew+latin) שמזין את `--font-sans`.
- **חובת `DirectionProvider`**: ‏Base UI מתעלם מ-`dir` של ה-DOM וברירת המחדל שלו LTR, ולכן רכיבים portaled (תפריטים, sheets, ‏tooltips) חייבים לרוץ בתוך `<DirectionProvider direction="rtl">`. שני ה-shells — ‏`src/components/app-shell.tsx` (לקוח) ו-`src/components/admin-shell.tsx` (אדמין) — עוטפים בו את כל התוכן; רכיב חדש עם portal חייב לשבת תחת אחד מהם או לעטוף בעצמו.
- רכיבים משותפים נוספים: `src/components/forms.tsx` (תבניות טפסים + ‏`FormState`), ‏`org-switcher.tsx`, ‏`password-input.tsx`; ‏hook יחיד — `src/hooks/use-mobile.ts`.

## 7. מודולי הדומיין תחת `src/lib/`

כל מודול שרת מסומן `import 'server-only'`. אחריות לפי ספרייה (מאומת מקריאת הקבצים):

| מודול | אחריות |
|---|---|
| `auth/` | ‏`dal.ts` — ‏Data Access Layer‏: `getUser` (מאומת מול שרת Auth), ‏`requireUser`, ‏`isAdmin`/`requireAdmin`, ממוזכר עם `cache()` של React; ‏`signup-helpers.ts` |
| `data/` | ליבת הלוגיקה העסקית, קובץ פר-דומיין: events, guests, rsvp, campaigns, contacts, orders, payments, billing, close-charge, outreach(-engine/-config), interactions, message-templates, agreements(-doc/-config), webhooks + webhook-processing, otp, orgs, profiles, user-settings, activity, company, event-date. כל שאילתה עוברת דרך גבול הבעלות (owner/org) |
| `data/admin/` | שכבת נתונים לקונסולת האדמין: users, orders, packages, channels, contacts, callbacks, agreements, dashboard, activity, settings, webhook-inbox, labels, shared |
| `supabase/` | ארבעה קליינטים מופרדים: `client.ts` (דפדפן), `server.ts` (cookie-based SSR), `admin.ts` (service-role, שרת-בלבד), `env.ts` (קריאת env), ‏`types.ts` (types שנוצרו מהסכימה החיה) |
| `validation/` | סכימות Zod פר-דומיין (schemas, guests, rsvp, campaigns, admin) + ‏`result.ts` (אובייקטי תוצאה typed) |
| `permissions.ts` | הרשאות דקות בתוך ארגון — עטיפה ל-RPC ‏`has_org_permission(_org_id, _resource, _action)`‏; הקטלוג מונחה-נתונים ב-DB, ללא union קשיח בקוד |
| `sumit/` | אינטגרציית סליקה SUMIT‏: authorize (J5 hold), capture, charge, raw-charge, safe-preview (עיקור payload לפני לוג) |
| `whatsapp/` | ‏`client.ts` (שליחה דרך whatsapp-api-js) + ‏`inbound.ts` (פירוק הודעות נכנסות) |
| `sms/` | ‏`sender.ts` — אבסטרקציית ספק SMS; אדפטר ExtrA ‏(exm.co.il) ל-OTP, קונפיג מ-`app_settings` |
| `email/` | ‏`sender.ts` (SMTP דרך nodemailer, קונפיג אדמין ב-DB) + ‏`templates.ts` |
| `outreach/` | ‏`schedule.ts` — מתמטיקת לוח-הזמנים הטהורה של מסע ההודעות (ללא I/O, נגזר מ-`event_date`) |
| `queue/` | ‏`queues.ts` — שמות תורי pg-boss וקונפיג retry (קבועים בלבד; ה-worker הוא היחיד שמריץ `work()`) |
| `agreements/` | ‏`template.ts` (תוכן ההסכם) + ‏`pdf.ts` (רינדור PDF בעברית BiDi עם puppeteer) |
| `security/` | ‏`rate-limit.ts` — הגבלת קצב in-memory פר-process + חילוץ IP (קו הגנה ראשון; מתועד שהשדרוג הוא store משותף) |
| `storage/` | ‏`legal-docs.ts` — bucket פרטי `id-documents` (הסכם חתום, חתימה, צילום ת"ז); גישה רק דרך service-role ו-signed URLs קצרי-חיים |
| `csv.ts` | פרסר CSV עצמאי (RFC 4180 subset, ‏BOM, ‏CRLF) לייבוא מוזמנים |
| `phone.ts` | נרמול E.164 עם libphonenumber-js — מפתח הדדופ של "contact" במודל החיוב |
| `url.ts` | ‏`getAppUrl`/`getAppOrigin` — כתובות אבסולוטיות (מעדיף `APP_ORIGIN`, נסוג ל-`headers()`); אין להשתמש ב-fallback יחסי שקט |
| `constants.ts` | קבועים חוצי-דומיין וערכים tunable מ-env עם ברירת מחדל בטוחה |
| `utils.ts` | ‏`cn()` ‏(clsx + tailwind-merge) |
| `password-strength.ts` | חוזק סיסמה עם zxcvbn-ts |

### תהליך ה-worker‏ (`worker/main.ts`)

תהליך Node ארוך-חיים ונפרד (pm2 ‏`kalfa-worker`) שמריץ pg-boss: הוא הבעלים הבלעדי של `work()`/`schedule()` — שכבת ה-web לא נוגעת ב-pg-boss. מניע את מסע ההודעות (WhatsApp ← המתנה ← תזכורות ← הסלמה לשיחה ← עצירה ב-reach מחויב) ומעבד את `webhook_inbox` במודל persist-then-process. טוען `.env.local` בעצמו, ומקומפל עם esbuild כאשר `server-only`/`next/headers`/`next/cache` מוחלפים ב-stub. כבוי-כברירת-מחדל עד שדגל `outreach_enabled` דולק (fail-closed).

## 8. שכבת Supabase והנתונים

### קליינטים מופרדים (`src/lib/supabase/`)

| קובץ | הקשר | הרשאות |
|---|---|---|
| `client.ts` | דפדפן | anon key; כפוף במלואו ל-RLS |
| `server.ts` | Server Components / Actions / Route Handlers | סשן cookie-based דרך `@supabase/ssr`; פועל בזהות המשתמש המחובר |
| `admin.ts` | שרת-בלבד (`createAdminClient`) | service-role; עוקף RLS — לשימוש רק היכן שהוזם צורך מפורש (worker, storage פרטי, webhooks) |
| `env.ts` | שניהם | קריאה בטוחה של משתני env ציבוריים |
| `types.ts` | שניהם | types שנוצרים מהסכימה **החיה**: `supabase gen types typescript --linked --schema public` |

עקרון עבודה: הסכימה החיה (פרויקט Supabase מקושר) היא מקור האמת; ‏`types.ts` מיוצר ממנה ולא נערך ידנית. שאילתות בשכבת `src/lib/data/` מסננות **גם** לפי בעלות (`owner_id`/org) בנוסף ל-RLS — הגנה כפולה מכוונת.

### מיגרציות ו-runbooks‏ (`supabase/`)

- ‏46 קובצי מיגרציה תחת `supabase/migrations/`, בשתי קונבנציות שמות שהצטברו היסטורית: חותמת מלאה `YYYYMMDDHHMMSS_<name>.sql` (למשל `20260630223635_event_lifecycle_state_model.sql`) וגם `YYYYMMDDNNNN_<name>.sql` מוקדמות יותר (למשל `202606240001_settings_and_sumit_payments.sql`).
- ‏`supabase/runbooks/` — נהלי הפעלה חד-פעמיים מתועדים (למשל `org_multitenancy_phase1.md`, ‏`event_lifecycle_s0_preflight.md`).
- ‏`supabase/config.toml` — קונפיגורציית ה-CLI של הפרויקט המקושר.
- שינויי סכימה עוברים דרך מיגרציות בלבד, עם התחשבות באינדקסים, בעלות, RLS ו-rollback (הנחיית פרויקט מחייבת).

### תיעוד ואודיט

פעולות משמעותיות (הגשות RSVP, עריכת מוזמנים, פעולות קמפיין, שינויי מצב תשלום, פעולות אדמין) מתועדות דרך `logActivity` ‏(`src/lib/data/activity.ts`) — בלי לשמור מידע אישי מיותר ובלי להפיל את הפעולה העסקית אם התיעוד נכשל.

## 9. טופולוגיית ריצה ופריסה

שני תהליכי pm2 קבועים על השרת:

| תהליך | פקודה | תפקיד |
|---|---|---|
| `kalfa-beta` | `next start` על פורט `3002`, מאחורי reverse proxy | אפליקציית ה-web (מגיש את `.next`) |
| `kalfa-worker` | `node dist/worker.cjs` | תהליך ה-outreach וה-webhook processing (pg-boss) |

זרימת בקשה טיפוסית:

```text
Browser
  → reverse proxy (nginx) → pm2 kalfa-beta (next start :3002)
    → src/proxy.ts            # רענון סשן + redirect אופטימי
      → layout.tsx            # requireUser / requireAdmin (DAL)
        → page.tsx (RSC) או Server Action / Route Handler
          → src/lib/validation (Zod)  → src/lib/data (בעלות + לוגיקה)
            → Supabase (RLS)  [+ logActivity]
```

עבודות אסינכרוניות (שליחות WhatsApp, תזכורות, עיבוד webhooks) לא רצות בתהליך ה-web: ה-web רק כותב שורות (למשל ל-`webhook_inbox`) או נתוני קמפיין, וה-worker מושך ומבצע דרך תורי pg-boss (`src/lib/queue/queues.ts`).

### בידוד builds ופריסה אטומית

שלוש ספריות build נפרדות כדי שבנייה לעולם לא תדרוס את מה שמוגש כרגע:

- ‏`.next` — הספרייה **החיה** ש-`next start` (pm2) מגיש; ‏`next start` רץ בלי `NEXT_DIST_DIR`.
- ‏`.next-verify` — יעד `npm run build` (אימות בלבד).
- ‏`.next-stage` — יעד ה-build של `npm run deploy`, שמוחלף אטומית ל-`.next` ואז `pm2 restart`.

דריסת `.next` החי באמצע build היא שגורמת לשגיאות "Failed to find Server Action" ו-chunks שבורים — לכן ה-deploy הוא ה-build, ואין להריץ `npm run build` לפניו.

## 10. בדיקות

- **vitest 4** (‏`vitest.config.ts`): סביבת `node`, ‏`include: ['src/**/*.test.ts']`, ‏alias ‏`@ → ./src`. הבחירה המכוונת: רוב הלוגיקה הניתנת לבדיקה היא צד-שרת (סכימות Zod, סינון בעלות, עזרי auth); בדיקות רכיבים ב-jsdom יתווספו רק בעת הצורך.
- **קונבנציה**: קובץ בדיקה צמוד לקובץ הנבדק — ‏`foo.ts` ↔ ‏`foo.test.ts` באותה ספרייה (לא ספריית `__tests__` נפרדת).
- **היקף בפועל**: ‏52 קבצי `*.test.ts` (כולם תחת `src/`; ל-`worker/` אין בדיקות ישירות — הלוגיקה שלו יושבת ב-`src/lib` הנבדק), כ-160 בלוקי `describe` וכ-600 מקרי בדיקה.
- **תשתית mock**: ‏`src/test/supabase-mock.ts` — mock משותף לקליינט Supabase.
- הרצה: `npm run test` (או `npm run test:watch`). שערי האימות המלאים לפני סיום משימה: `npm run lint`, ‏`npx tsc --noEmit`, ‏`npm run build`.

## 11. עקרונות ארכיטקטוניים מחייבים

עקרונות אלה מוגדרים ב-`CLAUDE.md` ומאומתים כאן מול הקוד:

1. **הרשאה בצד השרת, קרוב לנתונים.** כל דף מוגן, Server Action ו-Route Handler מאמתים זהות ובעלות בשרת. ה-DAL ‏(`src/lib/auth/dal.ts`) משתמש ב-`getUser()` המאומת; ‏redirect ב-proxy הוא אופטימי בלבד ואינו הגנה.
2. **מודל הרשאות דו-שכבתי.** ‏RLS ב-Postgres מבטיח בידוד-דייר (שורות של הארגון שלך בלבד); ה"פועל" (מותר לערוך מוזמנים? לנהל חברים?) נאכף בשכבת השרת דרך מקור אמת יחיד ב-DB — ‏`has_org_permission()` (ראו `src/lib/permissions.ts`). RLS הוא שכבת הגנה נוספת, לא תחליף להרשאה בשרת.
3. **אין fetch מוסמך מהדפדפן.** רכיבי דפדפן לא ניגשים לנתונים עסקיים מוסמכים; קליינט service-role ‏(`createAdminClient`) הוא שרת-בלבד, ומפתחות רגישים לעולם אינם `NEXT_PUBLIC_*`.
4. **Zod בגבולות.** כל קלט חיצוני עובר ולידציה ב-`src/lib/validation/*` בכניסה ל-Server Action / Route Handler; תוצאות מוחזרות כאובייקטי result typed (‏`validation/result.ts`), בלי `any` על נתוני אפליקציה.
5. **RSVP ציבורי כמשטח רגיש.** טוקן אטום פר-מוזמן, ולידציה בשרת, headers מונעי-cache/דליפת-referrer/אינדוקס (ב-`next.config.ts`), הגבלת קצב (`src/lib/security/rate-limit.ts`), ושגיאות גנריות שאינן חושפות מידע.
6. **בלי סודות ובלי PII בלוגים.** ‏payloads של ספקים עוברים עיקור לפני תיעוד (למשל `src/lib/sumit/safe-preview.ts`); מסמכים משפטיים נשמרים ב-bucket פרטי עם signed URLs בלבד.
7. **שימוש חוזר לפני יצירה.** לחבר לוגיקה חדשה אל המודולים הקיימים (rate-limit, ‏forms.tsx, ‏FormState, ‏logActivity, ולידציה פר-דומיין) — לא ליצור קבצים מקבילים.

### משתני סביבה מרכזיים (שמות בלבד, ללא ערכים)

מתוך `.env.example`: ‏`NEXT_PUBLIC_SUPABASE_URL`, ‏`NEXT_PUBLIC_SUPABASE_ANON_KEY` (ציבוריים); ‏`SUPABASE_SERVICE_ROLE_KEY` (שרת-בלבד, לעולם לא `NEXT_PUBLIC_*`); ‏`APP_ORIGIN` (מקור הכתובות האבסולוטיות); ‏`SUMIT_API_KEY` (שרת-בלבד) לצד `NEXT_PUBLIC_SUMIT_COMPANY_ID` ו-`NEXT_PUBLIC_SUMIT_API_PUBLIC_KEY` (טוקניזציה בדפדפן). בנוסף: ‏`NEXT_DIST_DIR` (בידוד ספריית build, נקבע ע"י הסקריפטים); ול-worker — ‏`SUPABASE_DB_HOST`, ‏`SUPABASE_DB_PORT`, ‏`SUPABASE_DB_NAME`, ‏`SUPABASE_DB_USER`, ‏`SUPABASE_DB_PASSWORD` (חיבור Postgres ישיר של pg-boss, דרך ה-session pooler).

---

*מסמך זה הוא חלק מסדרת `docs/project/`. פירוט ה-API routes, סכימת ה-DB וזרימות התשלום מכוסים במסמכים ייעודיים (`docs/routes-webhooks.md`, `docs/schema-and-architecture.md`, `docs/sumit-payments-implementation.md`).*
