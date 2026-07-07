# תוכנית אינטגרציה — @c15t/nextjs (פלטפורמת ניהול הסכמות) לאפליקציית KALFA

**תאריך:** 2026-07-07
**סטטוס:** ניתוח סטטי + תוכנית בלבד. **לא בוצע כל שינוי קוד.**
**סוג:** Consent Management Platform מלאה — באנר ראשוני, דיאלוג העדפות מפורט, קטגוריות (חיוני/מדידה/שיווק), וקישור קבוע לשינוי ההחלטה בהמשך. לא "באנר עוגיות" בלבד.

---

## 0. תקציר מנהלים (המלצות מפתח)

- **מצב Backend מומלץ:** `offline` (אחסון מקומי בלבד: `cookie` + `localStorage`, אפס בקשות רשת, אפס תלות חיצונית). מסלול הגירה עתידי מוגדר ל‑self‑hosted `@c15t/backend` אם/כאשר יידרש audit trail — לא ל‑hosted `consent.io`.
- **היכן ה‑Provider מותקן:** קומפוננטת client חדשה יחידה (`src/components/consent/consent-manager.tsx`, עם `"use client"`) שעוטפת `ConsentManagerProvider` + הבאנר + הדיאלוג, ומורכבת ב‑`src/app/layout.tsx` בתוך ה‑`<body>` סביב `{children}`. זהו ה‑root layout היחיד שמשרת את כל הקבוצות (public / customer / admin) — אין `layout.tsx` נפרד לקבוצת `(public)`.
- **קטגוריות שנחוצות היום:** **`necessary` בלבד** — עוגיות ה‑auth של Supabase (`sb-*`, chunked). אין כיום אף עוגיית אנליטיקה/שיווק/מעקב באפליקציה. `measurement`/`marketing` יוגדרו אך יישארו ריקות עד שייווסף סקריפט מעקב אמיתי.
- **תאימות גרסאות:** `@c15t/nextjs@2.1.0` תומך רשמית ב‑Next 16 וב‑React 19 (ראו §1). הסטאק המקומי: Next `16.2.9`, React `19.2.7`.
- **נתיב הקובץ הזה:** `docs/c15t-consent-integration-plan-2026-07-07.md`.

---

## 1. מה c15t נותן + הארכיטקטורה הנבחרת

### 1.1 מה החבילה מספקת

`@c15t/nextjs` היא CMP מלאה ל‑Next.js (App Router + Pages Router). היא כוללת (מקור: [library rules ב‑Context7 `/c15t/c15t`](https://github.com/c15t/c15t), ו‑[docs/frameworks/next](https://c15t.com/docs)):

- **`ConsentManagerProvider`** — ה‑context המרכזי; מקבל `options` (mode, i18n, theme, scripts, overrides).
- **`ConsentBanner`** (מכונה גם `CookieBanner` בחלק מהגרסאות) — הבאנר הראשוני שנפתח למבקר חדש; כפתורי "קבל הכל / דחה הכל / התאמה אישית". Props רלוונטיים: `title`, `description`, `acceptButtonText`, `rejectButtonText`, `customizeButtonText`, `primaryButton`, `layout`, `direction`, `trapFocus`, `scrollLock`, `disableAnimation`, `hideBranding`, `noStyle` (מקור: [components/consent-banner](https://c15t.com/docs/frameworks/next/components/consent-banner)).
- **`ConsentDialog`** (מכונה גם `ConsentManagerDialog`) — הדיאלוג המפורט לניהול קטגוריות בנפרד; ניתן לפתיחה תכנותית או דרך כפתור "התאמה אישית" של הבאנר.
- **`useConsentManager()` hook** — מחזיר בין היתר `setActiveUI('dialog' | 'none')`, `has(category)`, `consentTypes`, `consentCategories`, `selectedConsents`, `consents`, `setSelectedConsent`, `saveConsents('all' | 'necessary' | 'custom')` (מקור: [components/consent-dialog](https://github.com/c15t/c15t/blob/main/docs/frameworks/next/components/consent-dialog.mdx) ו‑[headless](https://github.com/c15t/c15t/blob/main/docs/frameworks/next/headless.mdx)).
- **`useTranslations()` hook** ו‑`@c15t/translations` — קופי מתורגם, deep‑merge עם ברירות המחדל.
- **קטגוריות הסכמה מובנות:** `necessary` (תמיד נדרשת), `measurement` (אנליטיקה), `marketing` (פרסום), `functional` (אופציונלי) — מקור: library rules.
- **טעינת סקריפטים מותנית** דרך `scripts` ב‑options + בדיקת `has('measurement')` לפני טעינת אנליטיקה — רלוונטי רק כשיתווסף מעקב.

### 1.2 שלושת מצבי ה‑Backend — השוואה

| היבט | `offline` | self‑hosted (`@c15t/backend`) | hosted (`consent.io` / `*.c15t.dev`) |
|---|---|---|---|
| בקשות רשת חיצוניות | **אין** | לשרת שלנו בלבד | לספק חיצוני (c15t.dev) |
| היכן נשמרת ההסכמה | `cookie` + `localStorage` בדפדפן | ה‑DB שלנו + מקומי | ה‑DB של הספק + מקומי |
| audit trail / cross‑device | לא | כן | כן |
| תלות תפעולית / route חדש | אין | route + backend + טבלאות | פרוקסי `/api/c15t/:path*` |
| שינויי CSP | אין | הוספת ה‑origin העצמי | התרת `*.c15t.dev` (או פרוקסי) |
| העברת מידע לצד ג׳ (שיקול תיקון 13) | אין | אין | **יש** |

מקורות: [concepts/client-modes](https://c15t.com/docs/frameworks/next/concepts/client-modes); [components/consent-manager-provider](https://github.com/c15t/c15t/blob/main/docs/frameworks/next/components/consent-manager-provider.mdx); library rules ("Offline mode is only for development or simple implementations", "For production, use consent.io (hosted) or self-hosted @c15t/backend").

מאפייני `offline` (מקור: [client-modes](https://c15t.com/docs/frameworks/next/concepts/client-modes)):
- **אפס בקשות רשת** — פועל כולו בצד הלקוח.
- ההסכמה נשמרת ב‑`localStorage` **וגם** ב‑cookie (הנגיש גם ל‑server).
- **אין זיהוי גיאוגרפי אוטומטי**; ברירת המחדל היא סמכות GDPR אלא אם מוגדר אחרת (`overrides.country`). כלומר הבאנר יוצג לכל המבקרים — מתאים לנורמת "באנר לכולם" בישראל.
- מגבלות: אין audit trail בצד שרת, אין סנכרון בין‑מכשירים, וניקוי אחסון הדפדפן מאפס את ההסכמה.

### 1.3 ההמלצה ל‑KALFA: `offline` (עם מסלול הגירה מוגדר)

**נמק:**
1. **פרטיות תחילה + תיקון 13.** מצב `offline` אינו שולח את רשומת ההסכמה לצד שלישי כלשהו. בהתחשב בכך שכתובת IP ומזהים מקוונים נחשבים "מידע אישי" תחת תיקון 13 (כפי שכבר מתועד ב‑`src/app/(public)/privacy/page.tsx:42-45`), הימנעות מהעברת נתונים ל‑`c15t.dev` היא הבחירה הזהירה.
2. **המצב בפועל היום מצדיק זאת.** לאפליקציה **אין** כיום עוגיות שאינן חיוניות (§3). הערך הראייתי של רשומת הסכמה הוא כרגע נמוך, ולכן audit trail בצד שרת אינו נדרש עדיין.
3. **אפס עלות תפעולית ואבטחתית.** אין route חדש, אין טבלאות, אין CSP חדש, אין secret. תואם למדיניות "השינוי הקטן והקוהרנטי ביותר".
4. **הבאנר מוצג לכולם** (ברירת מחדל GDPR ללא גיאו) — תואם לנורמת ההסכמה בישראל.

**מסלול הגירה עתידי:** אם/כאשר KALFA תוסיף אנליטיקה/שיווק **ותידרש** רשומת הסכמה בת‑הוכחה (accountability לפי תיקון 13) — לעבור ל‑**self‑hosted `@c15t/backend`** (הנתונים נשארים בתשתית של KALFA, למשל Supabase), **ולא** ל‑hosted `consent.io`, כדי להימנע מהעברת מידע אישי לצד ג׳ ומשיקולי העברה חוצת‑גבולות.

---

## 2. שלבי אינטגרציה מדויקים לאפליקציה הזו

### 2.1 התקנה

```bash
npm i @c15t/nextjs
```

(`@c15t/nextjs@2.1.0` מושך פנימית את `@c15t/react`, `@c15t/translations`, `c15t` באותה גרסה — מקור: [registry.npmjs.org/@c15t/nextjs/latest](https://registry.npmjs.org/@c15t/nextjs/latest).)

> **אימות אחרי התקנה (חובה, עקרון "always verify"):** שמות ה‑exports השתנו בין גרסאות (`ConsentBanner`/`ConsentDialog` מול `CookieBanner`/`ConsentManagerDialog`). לאמת מול 2.1.0 המותקן:
> ```bash
> node -e "console.log(Object.keys(require('@c15t/nextjs')))"
> ```
> ולהשתמש בשמות המדויקים שיוחזרו.

> `@c15t/cli generate` **אינו** מומלץ כאן — הוא מוסיף קבצים/env אוטומטית ומתאים ל‑hosted; באינטגרציה ידנית ב‑`offline` נשלוט מדויק על נקודות ההרכבה.

### 2.2 קומפוננטת ה‑wrapper (client boundary)

קובץ חדש: **`src/components/consent/consent-manager.tsx`**

```tsx
'use client';

import type { ReactNode } from 'react';
import { ConsentManagerProvider, ConsentBanner, ConsentDialog } from '@c15t/nextjs';
// ^ לאמת את שמות ה-exports אחרי ההתקנה (§2.1)

export function ConsentManager({ children }: { children: ReactNode }) {
  return (
    <ConsentManagerProvider
      options={{
        mode: 'offline',
        // הבאנר מוצג לכל המבקרים; ברירת המחדל היא GDPR ללא זיהוי גיאו.
        i18n: { locale: 'he', messages: { he: heMessages /* §2.4 */ } },
        theme: { /* §2.4 — slots/צבעים מותאמים ל-tokens */ },
        // בעתיד בלבד: scripts: [{ ... category: 'measurement' }]
      }}
    >
      <ConsentBanner />
      <ConsentDialog />
      {children}
    </ConsentManagerProvider>
  );
}
```

**חשוב לגבי גבול ה‑client/server:** `"use client"` בקובץ הזה הופך את ה‑*Provider* לקומפוננטת client, אבל `{children}` מועברים **כ‑props מבחוץ** מתוך ה‑root layout (שהוא Server Component). לכן העצים תחת `{children}` — כל דפי RSC של האפליקציה — **נשארים Server Components** ואינם נדחפים ל‑client. זהו הדפוס הרשמי (מקור: [policy-packs / hosted provider example](https://github.com/c15t/c15t/blob/main/docs/frameworks/next/policy-packs.mdx)).

### 2.3 נקודת ההרכבה המדויקת ב‑root layout

קובץ: **`src/app/layout.tsx`** (כרגע שורות 22‑28). ה‑`<html dir="rtl" lang="he">` וה‑`<body>` כבר קיימים. ההרכבה:

```tsx
// src/app/layout.tsx (המחשה — לא ליישם עכשיו)
import { ConsentManager } from '@/components/consent/consent-manager';
// ...
      <body className="min-h-full bg-background text-foreground antialiased">
        <ConsentManager>
          {children}
        </ConsentManager>
      </body>
```

**קיום‑יחד עם ה‑DirectionProvider הקיים:** באפליקציה **אין** DirectionProvider גלובלי אחד. ה‑`DirectionProvider` של Base UI מיושם **פר‑קומפוננטה מפורטלת** (למשל `src/components/ui/dropdown-menu.tsx`, `sheet.tsx`, `select.tsx`, `tooltip.tsx` — כולם `@base-ui/react`). מכאן שני דברים:
1. אין התנגשות — ה‑`ConsentManagerProvider` עצמאי לחלוטין ואינו נכנס למסלול ה‑Base UI.
2. **ה‑DirectionProvider של Base UI אינו שולט על ה‑RTL של c15t** — ל‑c15t מנגנון כיווניות משלו (`useTextDirection()` / prop `direction`). ראו סיכון §5.2.

### 2.4 עברית + RTL (theming ותרגומים)

- **תרגומים:** התיעוד מראה שתרגומים מותאמים עושים **deep‑merge** עם ברירות המחדל דרך `options.i18n = { locale, messages }` (מקור: [internationalization.mdx](https://github.com/c15t/c15t/blob/main/docs/frameworks/next/internationalization.mdx)). לא אומת שקיים locale עברי מובנה ב‑`@c15t/translations` 2.1.0 — לכן **להגדיר מפורשות** `locale: 'he'` ולספק חבילת הודעות עברית (לפחות `cookieBanner.title/description`, `common.acceptAll/rejectAll/customize/save`, וכותרות/תיאורי הקטגוריות). קופי מוצע לניסוח (טיוטה, לאישור עו״ד):
  - `cookieBanner.title`: "אנחנו מכבדים את הפרטיות שלך"
  - `cookieBanner.description`: "אנו משתמשים בעוגיות חיוניות לתפעול השירות. עוגיות שאינן חיוניות ייאספו רק בהסכמתך."
  - `common`: קבל הכל / דחה הכל / התאמה אישית / שמירה.
- **Theming:** להתאים ל‑design tokens הקיימים (`src/app/globals.css`: `--background`, `--foreground`, `--primary`, `--border`, `--card`, `--radius: 0.625rem`, גופן Heebo). c15t חושפת `theme.colors` + `theme.slots` (מחלקות Tailwind על אלמנטים פנימיים כמו `consentBannerCard`, `consentBannerFooter`, `consentBannerTitle`) + `theme.consentActions` (מקור: [components/consent-banner](https://c15t.com/docs/frameworks/next/components/consent-banner)). כך הבאנר נראה חלק מהמערכת ולא "ווידג'ט זר".
- **RTL:** לוודא ידנית לאחר הרכבה (§5.2). אפשרויות אם לא נתפס אוטומטית: prop `direction` על הבאנר, ומחלקות RTL דרך `theme.slots` (Tailwind logical properties — כמו שכבר נהוג בקוד, למשל `ps-5` ב‑privacy page).

### 2.5 הטריגר הקבוע ל"שינוי הסכמה"

קומפוננטת client קטנה שמפעילה `setActiveUI('dialog')` (מקור: [components/consent-dialog](https://github.com/c15t/c15t/blob/main/docs/frameworks/next/components/consent-dialog.mdx)):

```tsx
'use client';
import { useConsentManager } from '@c15t/nextjs';
export function ManageConsentButton() {
  const { setActiveUI } = useConsentManager();
  return (
    <button type="button" onClick={() => setActiveUI('dialog')}
      className="text-sm text-white/60 hover:text-white">
      ניהול עוגיות
    </button>
  );
}
```

**שתי נקודות עגינה מומלצות (חייבות להיות בתוך עץ ה‑`ConsentManagerProvider` — כלומר כל דבר תחת ה‑root layout כשיר):**
1. **פוטר דף הבית** — `src/app/(public)/page.tsx`. הקישורים ב‑`FOOTER_COLS` (שורות 108‑112) הם כיום `<span>` טקסט בלבד (שורות 464‑466, לא קישורים אמיתיים). מקום טבעי להוסיף בו את "ניהול עוגיות" (ולצדו קישורי `/privacy` ו‑`/terms` אמיתיים שכרגע חסרים בפוטר).
2. **עמוד מדיניות הפרטיות** — `src/app/(public)/privacy/page.tsx`, סעיף 10 "עוגיות (Cookies)" (שורות 102‑108) שכבר מדבר על opt‑in לעוגיות לא‑חיוניות. הוספת הכפתור שם היא ה‑UX המצופה ("שנה את בחירת העוגיות שלך"). שים לב: העמוד הוא Server Component — הכפתור `ManageConsentButton` (client) משובץ כאי‑client בתוכו, תקין.

---

## 3. מיפוי קטגוריות הסכמה לעוגיות שהאפליקציה באמת מגדירה

| קטגוריה c15t | האם נחוצה היום | עוגיות/סקריפטים בפועל | הערה |
|---|---|---|---|
| `necessary` (תמיד פעילה) | **כן** | עוגיות ה‑auth של Supabase (`sb-*-auth-token`, מפוצלות/chunked) מ‑`@supabase/ssr` (`src/lib/supabase/`) | חיוניות להתחברות וזיהוי — פטורות מהסכמה. כבר מתועד ב‑privacy §10. |
| `measurement` (אנליטיקה) | **לא** (עתידי) | — אין — | להצהיר כקטגוריה אך להשאיר ריקה עד שייווסף GA4/PostHog וכד׳; אז לגדר בטעינה ב‑`has('measurement')`. |
| `marketing` (פרסום) | **לא** (עתידי) | — אין — | כנ"ל; רלוונטי רק אם יתווסף Meta Pixel / Google Ads. |
| `functional` | **לא** | — אין — | להשמיט עד שיהיה שימוש אמיתי. |

**אימות שבוצע:** חיפוש `consent|cookie-banner|c15t` בקוד החזיר רק לוגיקת **הסכמת דיוור לקמפיינים** (WhatsApp/מייל — `src/lib/validation/campaigns.ts`, `src/lib/data/outreach.ts`, `campaign-actions.ts`) — זו הסכמת §30א ברמת איש‑קשר, **לא** עוגיות דפדפן, ואינה קשורה ל‑CMP הזה. אין כיום קוד באנר עוגיות. `next.config.ts` (שורות 77‑88) מגדיר headers רק ל‑`/r/:token*` ואינו מגדיר עוגיות מעקב. מסקנה: **הקטגוריה היחידה עם עוגיות אמיתיות היום היא `necessary`.**

> המשמעות: אין להמציא קטגוריות שאין להן שימוש. מיישמים את התשתית עכשיו, אך מצהירים על `measurement`/`marketing` רק כ"מוכנות" — ומפעילים גִדוּר סקריפטים בפועל רק כשייווסף מעקב. (עולה בקנה אחד עם עקרון "אין עובדות עסקיות מקודדות" ו"שינוי מינימלי".)

---

## 4. התאמה לדין הישראלי (טיוטה — לאישור עו״ד)

- **חוק הגנת הפרטיות, התשמ״א‑1981, ותיקון 13** (בתוקף מ‑2025): מרחיב את הגדרת "מידע אישי" לכלול **כתובת IP ומזהים מקוונים** — ולכן עוגיות מעקב/פרופיילינג הן עיבוד מידע אישי. כבר משתקף ב‑`privacy/page.tsx:42-45, :26-28`.
- **נורמת הסכמת עוגיות בישראל (הרשות להגנת הפרטיות):** לעוגיות **חיוניות** לתפעול — אין צורך בהסכמה. לעוגיות **שאינן חיוניות** (אנליטיקה/שיווק) — נדרשת **הסכמה מדעת מסוג opt‑in** (הסכמה פוזיטיבית לפני ההפעלה, לא ברירת מחדל "מסומן"). ניסוח זה כבר קיים ב‑`privacy/page.tsx:102-108` (סעיף 10).
- **כיצד c15t עומדת בזה:** מודל `opt‑in` (ברירת המחדל של c15t תחת סמכות GDPR) — הבאנר מציג "קבל / דחה / התאמה אישית", הקטגוריות הלא‑חיוניות **כבויות כברירת מחדל**, וסקריפטי מעקב אינם נטענים עד `has(category)===true`. זה מיישר בדיוק לדרישת ה‑opt‑in הישראלית. `necessary` נשארת פעילה תמיד — תואם לפטור העוגיות החיוניות.
- **שקיפות/יידוע:** להצליב את קופי הבאנר עם עמוד `/privacy` הקיים (LegalShell ב‑`_legal.tsx`), ולהוסיף בפוטר קישור אמיתי ל‑`/privacy` (כרגע חסר).
- **מגבלת התוכנית:** כל הקופי המשפטי הוא **טיוטה** — עמודי `/privacy` ו‑`/terms` כבר נושאים באנר "ממתין לאישור עו״ד" (`_legal.tsx:39`). ניסוח הבאנר והדיאלוג יעברו אותו אישור.

> להעמקה ניתן להריץ את מיומנויות `israeli-privacy-shield` / `israeli-ecommerce-compliance` (cookie‑consent Israel) בעת גיבוש הקופי הסופי.

---

## 5. סיכונים ושיקולים

### 5.1 Server Components / hydration
הבאנר והדיאלוג הם client‑only ומופיעים רק **אחרי** ה‑hydration. סיכון ל"הבהוב"/כניסה מאוחרת של הבאנר בטעינה ראשונה. הקלה: `disableAnimation` בעת הצורך, ובדיקה שאין layout‑shift. עצם ה‑Provider אינו הופך את שאר האפליקציה ל‑client (§2.2) — אין רגרסיית ביצועים ב‑RSC.

### 5.2 RTL וה‑Base UI DirectionProvider (הסיכון המרכזי לאימות)
c15t **אינה** בנויה על `@base-ui/react`. לכן ה‑`DirectionProvider` שהאפליקציה משתמשת בו פר‑קומפוננטה (memory: "Base UI defaults to LTR and ignores DOM dir") **אינו** משפיע על הבאנר/דיאלוג של c15t. ל‑c15t כיווניות עצמאית (`useTextDirection()` / prop `direction`). **חובה לאמת ידנית** שהבאנר והדיאלוג מוצגים RTL תקין (יישור טקסט, סדר כפתורים, ריווח לוגי). אם לא — לכפות `direction` ולהוסיף מחלקות RTL דרך `theme.slots`. זה הפריט מספר 1 לבדיקה חזותית בדפדפן.

### 5.3 CSP / רשת / עוגיות
- ב‑`offline` **אין** בקשות רשת חיצוניות ואין צורך בשינויי CSP — יתרון מרכזי. (`next.config.ts` כרגע אינו מגדיר CSP בכלל; רק headers ל‑`/r/:token*`.)
- העוגייה שנכתבת היא first‑party, לא‑חיונית לפי הגדרה, ואינה מפריעה לעוגיות ה‑Supabase.
- אם בעתיד עוברים ל‑hosted/self‑hosted — יידרש להתיר את ה‑origin ב‑CSP (או פרוקסי `/api/c15t/:path*`), ולהוסיף route handler. לא רלוונטי ב‑`offline`.

### 5.4 גודל Bundle
נוסף `@c15t/react` + `@c15t/translations` + `c15t` ל‑client bundle. c15t מתוארת כ"lightweight" (library rules) אך יש למדוד את ההשפעה על ה‑JS הראשוני (הבאנר טעון בכל עמוד דרך ה‑root layout). לשקול `dynamic import`/lazy אם המדידה תדרוש.

### 5.5 תאימות גרסאות
`@c15t/nextjs@2.1.0` peerDependencies: `next: ^16 || ^15 || ^14 || ^13`, `react/react-dom: ... || ^19` (מקור: [registry.npmjs.org/@c15t/nextjs/latest](https://registry.npmjs.org/@c15t/nextjs/latest)). הסטאק (Next `16.2.9`, React `19.2.7`, מ‑`package.json`) **בתוך הטווח הנתמך**. עדיין לאמת בפועל `npm run build` — Next 16 חדש יחסית וזו הזדמנות ל‑regression.

### 5.6 שמות exports לא יציבים בין גרסאות
`ConsentBanner`/`ConsentDialog` מול `CookieBanner`/`ConsentManagerDialog` — לאמת מול 2.1.0 המותקן (§2.1) לפני כתיבת ה‑imports.

### 5.7 קוהרנטיות תוכן משפטי
קופי הבאנר חייב להתיישר עם `/privacy` §10 ולעבור אישור עו״ד יחד עם שאר הטיוטות.

---

## 6. המלצות מדורגות (לפי סדר, לא ליישום כעת)

| # | צעד | קבצים שיושפעו |
|---|---|---|
| 1 | **אימות תאימות + התקנה.** `npm i @c15t/nextjs`, ואז `node -e "..."` לאימות שמות exports; `npm run build` לוודא אין רגרסיה עם Next 16. | `package.json`, `package-lock.json` |
| 2 | **קומפוננטת wrapper (`offline`).** יצירת ה‑Provider + הבאנר + הדיאלוג בקובץ client יחיד. | *חדש:* `src/components/consent/consent-manager.tsx` |
| 3 | **הרכבה ב‑root layout.** עטיפת `{children}` ב‑`<ConsentManager>` בתוך ה‑`<body>`. | `src/app/layout.tsx` (סביב שורות 24‑26) |
| 4 | **תרגומי עברית + theming ל‑tokens.** חבילת `he` ב‑`i18n.messages`, `theme.colors/slots` שמתאימים ל‑`globals.css`. | `src/components/consent/consent-manager.tsx` (+ אולי `src/lib/consent/he.ts` להודעות) |
| 5 | **אימות RTL בדפדפן.** בדיקה חזותית של הבאנר/דיאלוג RTL; תיקון עם `direction`/`theme.slots` אם צריך. (הסיכון המרכזי — §5.2.) | `src/components/consent/consent-manager.tsx` |
| 6 | **טריגר "ניהול עוגיות" קבוע.** קומפוננטת client קטנה עם `setActiveUI('dialog')`, בפוטר דף הבית + בעמוד הפרטיות. | *חדש:* `src/components/consent/manage-consent-button.tsx`; `src/app/(public)/page.tsx` (פוטר, שורות ~443‑469 + `FOOTER_COLS`); `src/app/(public)/privacy/page.tsx` (סעיף 10, שורות 102‑108) |
| 7 | **מיפוי קטגוריות = `necessary` בלבד + הצהרת `measurement`/`marketing` ריקות.** ללא גִדוּר סקריפטים בפועל (אין מה לגדר היום). | `src/components/consent/consent-manager.tsx` |
| 8 | **סנכרון תוכן משפטי.** יישור קופי הבאנר עם `/privacy` §10 + הוספת קישור `/privacy` אמיתי לפוטר; שליחה לאישור עו״ד. | `src/app/(public)/privacy/page.tsx`, `src/app/(public)/page.tsx` |
| 9 | **(עתידי, מותנה) הגירה ל‑self‑hosted.** רק אם ייווסף מעקב וידרש audit trail: `@c15t/backend` + route handler + CSP. **לא** `consent.io`. | *חדש:* `src/app/api/c15t/[...all]/route.ts`, `next.config.ts` (CSP), `src/lib/c15t.ts` |

---

## נספח — אסמכתאות

**תיעוד c15t (Part A):**
- ConsentBanner: https://c15t.com/docs/frameworks/next/components/consent-banner
- ConsentDialog / `useConsentManager` / `setActiveUI`: https://github.com/c15t/c15t/blob/main/docs/frameworks/next/components/consent-dialog.mdx
- Client modes (offline/hosted/self‑hosted): https://c15t.com/docs/frameworks/next/concepts/client-modes
- ConsentManagerProvider modes: https://github.com/c15t/c15t/blob/main/docs/frameworks/next/components/consent-manager-provider.mdx
- i18n / translations (deep‑merge): https://github.com/c15t/c15t/blob/main/docs/frameworks/next/internationalization.mdx
- Headless hooks (`useConsentManager`, `useTranslations`): https://github.com/c15t/c15t/blob/main/docs/frameworks/next/headless.mdx
- Self‑host quickstart (route handler): https://github.com/c15t/c15t/blob/main/docs/self-host/quickstart.mdx
- גרסה + peerDependencies: https://registry.npmjs.org/@c15t/nextjs/latest (v2.1.0)
- Library rules (קטגוריות, מצבים): Context7 `/c15t/c15t`

**קבצים בקוד (Part B):**
- `src/app/layout.tsx:22-28` — root layout יחיד, `<html dir="rtl" lang="he">`, `<body>{children}</body>`
- `src/components/ui/dropdown-menu.tsx:4` — Base UI (`@base-ui/react`), DirectionProvider פר‑קומפוננטה
- `src/app/(public)/privacy/page.tsx:102-108` — סעיף 10 עוגיות (opt‑in); `:42-45` — IP/מזהים = מידע אישי (תיקון 13)
- `src/app/(public)/terms/page.tsx` — תקנון (טיוטה)
- `src/app/(public)/_legal.tsx:39` — באנר "ממתין לאישור עו״ד"
- `src/app/(public)/page.tsx:108-112, 443-469` — פוטר דף הבית (`FOOTER_COLS`, כרגע `<span>` לא קישורים; אין קישור `/privacy`)
- `next.config.ts:77-88` — headers ל‑`/r/:token*` בלבד; אין CSP
- `package.json` — Next `16.2.9`, React `19.2.7`, `@base-ui/react ^1.6.0`, `tailwindcss ^4`; **@c15t לא מותקן**
- `src/app/globals.css:8-44` — design tokens (`--primary`, `--background`, `--border`, `--radius: 0.625rem`), גופן Heebo
- הסכמת דיוור קמפיינים (לא עוגיות): `src/lib/validation/campaigns.ts`, `src/lib/data/outreach.ts`, `src/app/(customer)/app/events/[id]/campaign/campaign-actions.ts`
