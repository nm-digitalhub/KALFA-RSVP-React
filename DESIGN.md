---
version: "alpha"
name: KALFA
description: "פלטפורמת RSVP לאירועים פרטיים — עברית-first, RTL, מינימליזם תכליתי: קנבס ניטרלי טהור עם מבטא אינדיגו יחיד המשומש בצמצום."
colors:
  primary: "#4f39f6"
  primaryForeground: "#fafafa"
  ink: "#0a0a0a"
  background: "#ffffff"
  surface: "#ffffff"
  sidebar: "#fafafa"
  muted: "#f5f5f5"
  mutedForeground: "#737373"
  secondaryForeground: "#171717"
  border: "#e5e5e5"
  success: "#007d38"
  warning: "#905d00"
  info: "#2563eb"
  destructive: "#d60000"
  chart-1: "#d4d4d4"
  chart-2: "#737373"
  chart-3: "#525252"
  chart-4: "#404040"
  chart-5: "#262626"
  # --- Marketing surface only (דף הבית / פוטר). Not CSS tokens — literal
  # values in src/app/(public)/(site)/page.tsx and site-footer.tsx. See
  # "Marketing surface" below; both are OPEN DECISIONS (align vs. keep).
  inverseSurface: "#0b0f1a"
  inverseForeground: "#ffffff"
  surfaceAlt: "#f9fafb"
typography:
  # --- App scale (customer/admin) ---
  h1:
    fontFamily: Heebo
    fontSize: 1.5rem
    fontWeight: 700
    lineHeight: 1.2
  h2:
    fontFamily: Heebo
    fontSize: 1.25rem
    fontWeight: 700
    lineHeight: 1.3
  h3:
    fontFamily: Heebo
    fontSize: 1.125rem
    fontWeight: 700
    lineHeight: 1.4
  body-md:
    fontFamily: Heebo
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: Heebo
    fontSize: 0.75rem
    fontWeight: 500
    lineHeight: 1.4
  # --- Marketing scale (דף הבית / FAQ / צור-קשר). Desktop values; mobile in
  # the comment. ---
  display-xl:
    # hero h1: text-4xl (2.25rem) on mobile → text-6xl from `sm`
    fontFamily: Heebo
    fontSize: 3.75rem
    fontWeight: 800
    lineHeight: 1.25
    letterSpacing: -0.025em
  display-lg:
    # section h2 / CTA band: text-3xl (1.875rem) on mobile → text-4xl from `sm`
    fontFamily: Heebo
    fontSize: 2.25rem
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: -0.025em
  body-lg:
    # lead paragraph under a display heading (text-lg text-muted-foreground)
    fontFamily: Heebo
    fontSize: 1.125rem
    fontWeight: 400
    lineHeight: 1.6
  eyebrow:
    # Eyebrow above headings: text-sm font-bold uppercase tracking-wide text-primary
    fontFamily: Heebo
    fontSize: 0.875rem
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: 0.025em
rounded:
  sm: 6px
  md: 8px
  lg: 10px
  xl: 14px
  # 2xl/3xl are derived tokens in globals.css (radius × 1.8 / 2.2) used only on
  # the marketing + guest-facing surfaces; 4xl (× 2.6) is the Badge's actual
  # radius — visually a pill at 20px height.
  2xl: 18px
  3xl: 22px
  4xl: 26px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  # marketing section rhythm (py-16) and the max content width there
  section: 64px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primaryForeground}"
    rounded: "{rounded.lg}"
    padding: "{spacing.sm}"
  button-secondary:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.secondaryForeground}"
    rounded: "{rounded.lg}"
    padding: "{spacing.sm}"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.ink}"
    borderColor: "{colors.border}"
    rounded: "{rounded.lg}"
    padding: "{spacing.sm}"
  button-destructive:
    # Rendered as a 10% destructive tint over the surface (not a solid fill),
    # so the token models destructive text on the page background.
    backgroundColor: "{colors.background}"
    textColor: "{colors.destructive}"
    rounded: "{rounded.lg}"
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.ink}"
    borderColor: "{colors.border}"
    rounded: "{rounded.lg}"
    padding: "{spacing.sm}"
  divider:
    # A hairline separator is a thin fill of the border color.
    backgroundColor: "{colors.border}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "{spacing.md}"
  sidebar:
    backgroundColor: "{colors.sidebar}"
    textColor: "{colors.ink}"
  header-sticky:
    # marketing header: 85% background + backdrop blur, hairline bottom border
    backgroundColor: "{colors.background}"
    textColor: "{colors.ink}"
    borderColor: "{colors.border}"
  badge:
    # default variant = `neutral`: hairline border, muted text, no fill
    backgroundColor: "{colors.background}"
    textColor: "{colors.mutedForeground}"
    borderColor: "{colors.border}"
    rounded: "{rounded.full}"
  badge-success:
    # bg-success/10 + border-success/20 tint over the surface
    backgroundColor: "{colors.background}"
    textColor: "{colors.success}"
    rounded: "{rounded.full}"
  badge-warning:
    backgroundColor: "{colors.background}"
    textColor: "{colors.warning}"
    rounded: "{rounded.full}"
  badge-info:
    backgroundColor: "{colors.background}"
    textColor: "{colors.info}"
    rounded: "{rounded.full}"
  badge-destructive:
    backgroundColor: "{colors.background}"
    textColor: "{colors.destructive}"
    rounded: "{rounded.full}"
  guest-card:
    # public guest pages (/r, /g, /ty): one narrow card, invite image on top
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    borderColor: "{colors.border}"
    rounded: "{rounded.2xl}"
  marketing-card:
    # feature / step cards on the landing page
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    borderColor: "{colors.border}"
    rounded: "{rounded.xl}"
    padding: "{spacing.lg}"
  marketing-inverse-panel:
    # dark "solution" card, trust section, footer, icon tiles (landing only)
    backgroundColor: "{colors.inverseSurface}"
    textColor: "{colors.inverseForeground}"
    rounded: "{rounded.2xl}"
  marketing-cta-band:
    # closing CTA band — the ONE place indigo is used as a container fill
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primaryForeground}"
    rounded: "{rounded.3xl}"
  chart-bar-1:
    backgroundColor: "{colors.chart-1}"
  chart-bar-2:
    backgroundColor: "{colors.chart-2}"
  chart-bar-3:
    backgroundColor: "{colors.chart-3}"
  chart-bar-4:
    backgroundColor: "{colors.chart-4}"
  chart-bar-5:
    backgroundColor: "{colors.chart-5}"
---

# מערכת העיצוב של KALFA

> מקור-האמת של שפת העיצוב. ה-YAML למעלה = טוקנים קריאים-למכונה (נגזרים מ-
> `src/app/globals.css`, OKLCH → hex מדויק; **כל 21 ערכי ה-hex אומתו מחדש ב-24.8.2026
> מול הקוד**). הפרוזה למטה מסבירה *למה* ואיך ליישם, בסדר הסקשנים הקנוני של מפרט
> DESIGN.md.
>
> **תחולה — שני משטחים, שתי מערכות-כללים:**
> 1. **האפליקציה** (`/app/**`, `/admin/**`, `/auth/**`, ודפי האורח `/r` `/g` `/ty`) —
>    הכללים המחמירים בסקשנים Colors → Do's and Don'ts. זה ברירת-המחדל לכל מסך חדש.
> 2. **המשטח השיווקי** (דף הבית, `/faq`, `/contact`, הפוטר) — מתועד כפי שהוא היום
>    בסקשן **Marketing surface**, עם רשימת סטיות פתוחות להכרעה. **אל תייבא את
>    כללי-הנחיתה לתוך האפליקציה.**

## Overview

KALFA היא פלטפורמת RSVP לאירועים פרטיים — **עברית-first ו-RTL** לכל אורך הממשק
(עם תשתית עתידית לאנגלית וצרפתית). האישיות: נקייה, ממוקדת ורגועה — "מינימליזם
תכליתי". **הקנבס ניטרלי לחלוטין** (לבן ואפורים חסרי-גוון), ומעליו **מבטא אינדיגו
יחיד** שנושא את כל האינטראקציה ומשומש **בצמצום**. הקהל הוא בעלי-אירוע פרטיים
המנהלים רשימות מוזמנים ודוחות; הממשק צריך להרגיש אמין ורגוע, וגם צפוף מספיק כדי
להראות הרבה נתונים בלי עומס.

**החוק המרכזי לגוון:** האינדיגו הוא ה**מבטא הכרומטי היחיד**, ומופיע רק על
אלמנטים אינטראקטיביים (כפתורים, קישורים, מצב-פעיל, טבעת-פוקוס, והדגשת מספרי-
מפתח). **אין שום גוון סגול/לבנדר** ברקעים, בכרטיסים, בשורות או בכותרות —
המשטחים נשארים לבן / אפור-טהור.

**RTL הוא עיקרון-על:** פריסות, טפסים, טבלאות, ניווט, אייקונים, רווחים וקיטוע
מכבדים ימין-לשמאל. תמיד logical properties (`ms/me/ps/pe/start/end`), לעולם לא
`left`/`right` פיזיים. תפריטים/מגירות ש-portal-ים מחוץ ל-DOM (Base UI) מקבלים
כיוון מ-`DirectionProvider` בשורש — לא מ-`dir` על ה-DOM.

**סטאק:** shadcn (`style: base-nova`, `baseColor: neutral`, `rtl: true`) מעל
`@base-ui/react`, Tailwind v4, אייקוני `lucide`. פרימיטיבים מתווספים רק דרך
`npx shadcn add` — לא נכתבים ידנית.

## Colors

הפלטה מושתתת על ניטרלים בעלי ניגודיות גבוהה ומבטא אינדיגו יחיד.

- **Primary — אינדיגו KALFA (#4f39f6):** המבטא הכרומטי היחיד. **רק** אלמנטים
  אינטראקטיביים: כפתורים ראשיים, קישורים, מצב-פעיל בניווט, טבעת-פוקוס, ומספרי-
  מפתח מודגשים. לרכז, לא לפזר. (זהו Tailwind v4 `indigo-600`; הערך `#4f46e5`
  שמופיע בהערות ישנות בקוד הוא ערך v3 — **לא** מה שמרונדר.)
- **Ink (#0a0a0a):** דיו כמעט-שחור לכותרות וטקסט ליבה.
- **Secondary-foreground (#171717):** טקסט/אייקון כהה על משטחי `muted`.
- **Background / Surface (#ffffff):** קנבס ומשטחים לבנים; כרטיסים על אותו לבן,
  מופרדים בקו-שיער ולא בצבע.
- **Sidebar (#fafafa):** אזור הניווט הקבוע, off-white — אפור טהור, **לא** לבנדר.
- **Muted (#f5f5f5) / Muted-foreground (#737373):** מילוי-משנה (hover, ראש-
  טבלה) וטקסט משני (מטא, תוויות, placeholder).
- **Border (#e5e5e5):** קווי-שיער — מסגרות, מפרידים, קלט.
- **Success (#007d38) / Warning (#905d00) / Info (#2563eb) / Destructive
  (#d60000):** טוקני סטטוס — אישרו / טרם השיבו / אינפורמטיבי / לא-מגיע·מחיקה.
- **Charts (#d4d4d4 · #737373 · #525252 · #404040 · #262626):** רמפת אפורים
  ל-data-viz בלבד. **חסרי-גוון בכוונה** — הגרפים לא צובעים באינדיגו.
- **Inverse surface (#0b0f1a) / Surface-alt (#f9fafb):** **משטח שיווקי בלבד** —
  ראו Marketing surface. לא טוקני CSS, לא לשימוש באפליקציה.

**חשוב — הניטרלים הם אפור טהור (0 כרומה):** לבן, `#fafafa`, `#f5f5f5`,
`#e5e5e5`, `#737373`. אסור לגוון אותם באינדיגו/לבנדר. הצבעים הסמנטיים מופיעים
כ-`text-<token>` על `bg-<token>/10` (tint שקוף 10%), לא כמילוי-מלא, וכוונו לעבור
WCAG AA (≥4.5:1) בהקשר הזה.

**מצב כהה — מוגדר, לא נגיש:** `globals.css` מגדיר סט `.dark` מלא (רקע `#0a0a0a`,
משטח/כרטיס `#171717`, primary מתהפך ל-`#e5e5e5`, טוקני סטטוס מוארים:
success `#45ba70` · warning `#f0ac27` · info `#6399ff` · destructive `#ff6467`),
אבל **אין מתג ערכת-נושא באפליקציה** (אין `next-themes`/ThemeProvider; ה-class
`.dark` לא מוצב על שום דבר). כל ממשק מתוכנן ל-light בלבד; ה-dark הוא הכנה
לעתיד, לא תכונה. (מפרט DESIGN.md אינו ממדל "modes", לכן ה-front-matter הוא light.)

## Typography

משפחה אחת: **Heebo** (Google Fonts, subsets עברית + לטינית, `display: swap`),
לכותרות ולגוף כאחד (`--font-heading = --font-sans`) — קול אחיד, נקי וקריא בעברית.

**סקאלת האפליקציה** (צפופה, לניהול נתונים):

- **h1 — כותרת עמוד:** Heebo 1.5rem / 700 (`text-2xl font-bold`).
- **h2 — כותרת משנה / מספרי-סטטיסטיקה:** 1.25rem / 700, לרוב המספר ב-`text-primary`.
- **h3 — כותרת כרטיס:** 1.125rem / 700 (`text-lg font-bold`).
- **body-md — גוף:** 0.875rem / 400 (`text-sm`), ברירת-המחדל בממשק הצפוף.
- **label — תווית / מטא:** 0.75rem / 500 ב-`text-muted-foreground`.

**סקאלת השיווק** (דף הבית / FAQ / צור-קשר; mobile → desktop):

- **display-xl — hero:** `text-4xl sm:text-6xl font-extrabold leading-tight tracking-tight`
  (2.25rem → 3.75rem / 800). מילת-המפתח האחרונה ב-`text-primary`.
- **display-lg — כותרת סקשן / רצועת CTA:** `text-3xl sm:text-4xl font-bold tracking-tight`
  (1.875rem → 2.25rem / 700; ה-CTA ב-`font-extrabold sm:text-5xl`).
- **body-lg — lead:** `text-lg text-muted-foreground` (1.125rem / 400), `max-w-prose`.
- **eyebrow:** `text-sm font-bold uppercase tracking-wide text-primary` עם אייקון
  `size-4` לפני הטקסט — מעל כל כותרת-סקשן.

מספרי טלפון תמיד ב-`dir="ltr"` בתוך זרימת RTL, כדי שלא יתהפכו.

## Layout

**אפליקציה:** סיידבר קבוע ב-inline-start (ימין ב-RTL) בדסקטופ, שנפתח כ-Sheet
(מגירה off-canvas) מתחת ל-`lg`. תוכן העמוד במרכז ברוחב מוגבל (`max-w-5xl`,
ריפוד `px-4` מובייל / `px-6` מ-`sm`). אזור התוכן מכיל את הגלישה האופקית שלו
(`overflow-x-clip`) כדי שילד רחב לא יזליג גלילה לכל הדף.

**דפי אורח (`/r` `/g` `/ty`):** עמודה אחת צרה (`max-w-md`, `px-4 py-12`,
`min-h-svh` ממורכז אנכית) — מותאם לטלפון של המוזמן; כרטיס אחד עם תמונת ההזמנה
בראשו.

**שיווק:** `max-w-6xl px-6`, סקשנים ב-`py-16` (hero `py-10 sm:py-20`; FAQ/צור-קשר
`max-w-3xl`). כותרת דביקה בגובה 64px (`sticky top-0 z-50`) עם `bg-background/85
backdrop-blur-md` וקו-שיער תחתון; ניווט דסקטופ על shadcn `NavigationMenu`,
מובייל = Sheet עם ה-wordmark בשורת-כותרת. גריד תכונות `sm:grid-cols-2 lg:grid-cols-3`.

קצב spacing על בסיס 4px (`xs 4 · sm 8 · md 16 · lg 24 · xl 32`). מרווח נדיב בין
בלוקים (`space-y-6`), הדוק בתוך שורה (`gap-1/2`). הרווח — לא הקווים — יוצר קיבוץ.
רספונסיביות mobile-first: בסיס עמודה-אחת שמתרחב ב-`sm 640 / md 768 / lg 1024`.

## Elevation & Depth

**האפליקציה שטוחה.** אין צללים כבדים — ההיררכיה נבנית מ-ניגודיות, רווח לבן, וקווי-
שיער. כרטיסים מופרדים בטבעת 1px ב-10% דיו (`ring-1 ring-foreground/10`) או
מסגרת `border`, לא בצל, ו**לא ברקע מגוון**. צל רך (`shadow-md`) שמור אך ורק
ל-overlays צפים (תפריטים, פופאוברים) שעוברים portal מעל התוכן, ול-widgets
הצפים של "התקשרו אליי" (`shadow-lg`, פינת המסך).

**חריגים מתועדים:** דפי האורח — `shadow-sm` יחיד על כרטיס ההזמנה; המשטח השיווקי —
ראו Marketing surface (`shadow-xl` על ה-mockup, `hover:shadow-md` + `-translate-y-1`
על כרטיסי תכונות).

## Shapes

סקאלת עיגול מ-`--radius` (0.625rem): `sm 6px · md 8px · lg 10px · xl 14px ·
full`. כפתורים וקלט = `lg` (10px). כרטיסים = `xl` (14px). שבבים/badges = גלולה
(בפועל `rounded-4xl` = 26px על גובה 20px — נראה כ-`full`). עקביות: לא לערבב פינות
חדות ומעוגלות באותו מסך.

מחוץ לאפליקציה: כרטיס-האורח (`/r` `/g` `/ty`) = `2xl` (18px); הנחיתה משתמשת גם
ב-`2xl` (mockup, פאנל כהה) ו-`3xl` (22px, רצועת CTA). כפתורי הנחיתה כתובים ידנית
ב-`rounded-md` (8px) — **לא** ה-`Button` של האפליקציה (10px); ראו סטיות פתוחות.

## Components

- **Buttons (`ui/button`):** ראשי = מילוי אינדיגו מלא (hover מתעמעם ל-80%); משני
  = אפור בהיר (`secondary`/`muted`) עם טקסט `#171717`; outline = רקע לבן + מסגרת
  `border`, hover `muted`; ghost = שקוף עם hover; link = טקסט אינדיגו עם קו-תחתון
  ב-hover; **הרס = tint** (`bg-destructive/10 text-destructive`, hover `/20`), לא
  אדום מלא. פוקוס = טבעת אינדיגו 3px (`ring-3 ring-ring/50`); שגיאה
  (`aria-invalid`) = מסגרת+טבעת הרס. לחיצה = שקיעה זעירה (`active:translate-y-px`).
  **גדלים:** `default` h-10 במובייל → h-8 מ-`md` · `lg` h-11 → h-9 · `sm` h-7 ·
  `xs` h-6 · `icon` 32px (`icon-xs` 24 / `icon-sm` 28 / `icon-lg` 36). אייקון בתוך
  כפתור = `size-4`.
- **Cards / Containers (`ui/card`):** `rounded-xl`, **רקע לבן טהור**, טבעת קו-שיער
  (`ring-1 ring-foreground/10`), בלי צל, בלי גוון. ריפוד פנימי `md` (16px; `size="sm"`
  = 12px). `CardHeader` הוא גריד שמפנה מקום ל-`CardAction` בקצה.
- **Inputs (`ui/input`):** `h-8` קבוע, `rounded-lg`, מסגרת `border-input` דקה, רקע
  שקוף; `text-base` במובייל (מונע זום ב-iOS) → `text-sm` מ-`md`; פוקוס = מסגרת
  אינדיגו + טבעת 3px; שגיאה = מסגרת+טבעת הרס; disabled = 50% שקיפות.
- **Chips / Badges (`ui/badge`):** גובה 20px, `text-xs font-medium`, `px-2`, גלולה.
  **ברירת-המחדל היא `neutral`** (מסגרת קו-שיער + `text-muted-foreground`, בלי מילוי).
  סטטוס = `success` / `warning` / `info` / `destructive`: `bg-<token>/10` +
  `border-<token>/20` + `text-<token>`. הווריאנטים `default` (מילוי אינדיגו מלא) ו-
  `secondary` קיימים מה-registry אך **לא לשימוש על שבב סטטוס** — אין אינדיגו על
  שבב לא-אינטראקטיבי.
- **Sidebar / Sheet / NavigationMenu / Dropdown / Tooltip:** shadcn מעל Base UI;
  overlays מקבלים `DirectionProvider`. פריט-פעיל בניווט = טקסט/אייקון אינדיגו על
  `sidebar-accent` (`#f5f5f5`), לא מילוי אינדיגו.
- **Lists / Tables:** מעל `lg` — טבלה מלאה; מתחת — כרטיסי-רשימה צפופים
  (שורה בת 2–3 שורות למוזמן), לעולם לא טבלה דחוסה במובייל. שורות על רקע לבן,
  מופרדות ב-`divider`.
- **Cookie banner (vanilla-cookieconsent):** ממופה לטוקנים דרך `#cc-main`
  (`--cc-bg: popover`, כפתור ראשי = primary, משני = muted, רדיוס = `--radius`),
  RTL דרך `language.rtl: 'he'` — נראה כחלק מהאפליקציה, לא כרכיב זר.
- **Guest card (`/r` `/g` `/ty`):** `rounded-2xl border border-border bg-card
  shadow-sm`, `overflow-hidden`, תמונת ההזמנה כבלוק עליון עם קו-שיער תחתון; כפתור
  ה-RSVP הראשי = מילוי אינדיגו; בחירה נבחרת בסטפר = `border-primary bg-primary`;
  הודעת-הצלחה = `border-primary/30 bg-primary/5` (ה-tint האינדיגו היחיד המותר
  מחוץ לאינטראקציה — משוב על פעולה שהאורח ביצע).

## Marketing surface (דף הבית · `/faq` · `/contact` · פוטר)

מתועד **כפי שהוא היום** (`src/app/(public)/(site)/**`, `src/components/site/**`),
כדי שמסך שיווקי חדש ייראה כמו דף הבית ולא כמו האפליקציה. הנחיתה קדמה לקובץ הזה
ו**לא יושרה** אליו; כל סעיף מסומן ✅ (תואם לכללי האפליקציה) או ⚠️ (סטייה — הכרעה
פתוחה: ליישר או לאשר רשמית).

- ✅ **כותרת דביקה:** `bg-background/85 backdrop-blur-md backdrop-saturate-150`,
  קו-שיער תחתון, wordmark + `NavigationMenu` + CTA אינדיגו קטן (`text-sm px-4 py-2`).
- ✅ **Hero:** שתי עמודות מ-`lg`; eyebrow → display-xl (מילה אחרונה באינדיגו) →
  lead → שני כפתורים (ראשי אינדיגו, משני outline) → שורת אמון ב-`text-sm
  text-muted-foreground`.
- ⚠️ **Mockup דשבורד בהירו:** `rounded-2xl border shadow-xl` — הצל הכבד היחיד
  במוצר. סטטיסטיקות בתוכו בצבעי Tailwind ליטרליים (`emerald-700` / `amber-700` /
  `emerald-500` / `amber-400` / `rose-400`, שבב `bg-emerald-50`) — **לא** טוקני
  success/warning/destructive.
- ⚠️ **פאנלים כהים (`#0b0f1a`):** כרטיס "הפתרון" (`rounded-2xl p-7`), סקשן האמון
  (מלא-רוחב), אריחי-אייקון של תכונות (`size-11 rounded-lg`), מספרי-שלב (`size-8
  rounded-full`), כפתור משני ברצועת ה-CTA, והפוטר (`text-white/60`, קישורים
  `text-white`, קו `border-white/10`). הערך הוא navy כמעט-שחור (כרומה זעירה) —
  לא `ink` `#0a0a0a`, ולא טוקן. Eyebrow על כהה = `text-indigo-300` (ליטרלי).
- ⚠️ **רקע סקשן מתחלף:** `#f9fafb` (`bg-[#f9fafb]`, `border-y`) לסקשן התכונות
  ול-hover של כפתור ה-outline — לא `muted` (`#f5f5f5`) ולא `sidebar` (`#fafafa`).
- ⚠️ **כרטיסי תכונה/שלב:** `rounded-xl border bg-background p-6` ✅, אבל `hover:
  -translate-y-1 hover:shadow-md` — אנימציית "הרמה" שאין באפליקציה.
- ⚠️ **רצועת CTA סוגרת:** `rounded-3xl bg-primary` מלא-אינדיגו עם display-lg לבן,
  כפתור לבן-שקוף (`border-white/40 bg-white/15`) וכפתור `#0b0f1a`. זו **הסתירה
  הישירה** ל-"אל תשתמש באינדיגו כמילוי קונטיינר" — מותרת כאן בלבד, פעם אחת בעמוד.
- ⚠️ **כפתורי נחיתה:** `<Link>`/`<a>` ידניים ב-`rounded-md` (8px) + `hover:opacity-90`
  — לא `buttonVariants` (10px, `hover:bg-primary/80`).
- ✅ **FAQ — כרטיס המחיר:** `bg-indigo-50 text-indigo-900 border-primary/30` —
  wash אינדיגו על קונטיינר לא-אינטראקטיבי (דרישת compliance: המחיר גלוי לפני
  כל שאלה). **הכרעת בעלים 24.8.2026: נשאר כפי שהוא** — "מעולה איך שזה נראה,
  שובר את האפור". חריג מאושר לכלל "אין לבנדר בכרטיסים" — למשטח השיווקי בלבד,
  לא ליישר ולא לייבא לאפליקציה.
- ✅ **אנימציות אייקונים:** `k-ico-pulse` (טבעת מתרחבת) ו-`k-ico-bars` (עמודות
  גרף), שתיהן כבויות תחת `prefers-reduced-motion`. ⚠️ צבע הטבעת `rgba(79,70,229)`
  = `#4f46e5` הישן, לא `#4f39f6`.
- ✅ **`/contact`:** `max-w-3xl`, סקשנים ב-`rounded-xl border p-6`, כותרת עם אייקון
  אינדיגו — תואם לאפליקציה.

## Email

תבניות המייל (`src/lib/email/templates.ts`) הן HTML inline נפרד: `Arial` (לא Heebo —
מיילים לא טוענים web-fonts באמינות), רקע `#f5f5f7`, כרטיס לבן `border-radius:10px`
עם מסגרת `#e3e3e8`, טקסט `#1a1a1a`, כפתור/קישור **`#4338ca`** (indigo-700 v3).
⚠️ הסגול במייל כהה מה-primary (`#4f39f6`) והמסגרת/רקע מגוונים קלות — off-brand;
לא יושר. פרויקט Stitch "KALFA — Emails & UI" קיים אך ריק ממסכים.

## Do's and Don'ts

- **עשה** לשמור את כל המשטחים (רקע, כרטיסים, שורות, סיידבר) **ניטרליים טהורים** —
  לבן או אפור חסר-גוון.
- **אל** תגוון שום רקע / כרטיס / שורה / כותרת / שבב באינדיגו או בלבנדר. **אין
  washes סגולים.** (שני חריגים מאושרים, שניהם במשטח השיווקי בלבד: רצועת ה-CTA
  בדף הבית, וכרטיס המחיר ב-`/faq` — הכרעת בעלים 24.8.2026; ראו Marketing surface.)
- **עשה** לשמור את האינדיגו לאלמנטים אינטראקטיביים בלבד: כפתורים ראשיים,
  קישורים, מצב-פעיל בניווט, טבעת-פוקוס, ומספרי-מפתח מודגשים.
- **אל** תשתמש באינדיגו כמילוי של קונטיינר לא-אינטראקטיבי או כרקע-עמוד.
- **אל** תשתמש במילוי-אדום מלא לפעולות הרס — השתמש ב-tint (`/10`).
- **אל** תשתמש בצבעי Tailwind ליטרליים (`emerald-*`, `amber-*`, `indigo-*`,
  `red-*`) או ב-hex בקוד האפליקציה — רק טוקנים (`success`/`warning`/`info`/
  `destructive`/`primary`).
- **עשה** לשמור ניגודיות WCAG AA (≥4.5:1) לטקסט רגיל, במיוחד לטוקני הסטטוס.
- **אל** תערבב פינות חדות ומעוגלות באותו view; היצמד לסקאלת ה-`rounded`.
- **עשה** להשתמש ב-`Button`/`buttonVariants`, `Badge`, `Card`, `Input` מ-`ui/` —
  **אל** תשכפל את מחרוזות ה-class שלהם ידנית.
- **עשה** להשתמש ב-logical properties (`ms/me/ps/pe/start/end`) לכיבוד RTL;
  **אל** תשתמש ב-`left`/`right` פיזיים.
- **עשה** להעדיף רווח לבן וקווי-שיער על צללים ליצירת עומק.
- **אל** תתכנן ל-dark mode — אין מתג; כל מסך נבדק ב-light בלבד.

## Open decisions & known drift (24.8.2026)

הכרעות בעלים שממתינות; עד אז — התיעוד למעלה משקף את הקיים.

1. **המשטח השיווקי:** ליישר לאפליקציה (להחליף `#0b0f1a` → `ink`, `#f9fafb` →
   `muted`, להסיר `shadow-xl`/`hover:shadow-md`, CTA-band → outline או tint,
   כפתורים → `buttonVariants`, סטטיסטיקות mockup → טוקנים) **או** לאשר את הסגנון
   השיווקי כפי שהוא ולהוסיף את `#0b0f1a`/`#f9fafb` כטוקני CSS אמיתיים.
   **הוכרע חלקית 24.8.2026:** כרטיס המחיר ב-`/faq` נשאר לבנדר (ראו Marketing
   surface) — שאר הסעיף עדיין פתוח.
2. **מיילים:** `#4338ca` → `#4f39f6`, מסגרת/רקע → אפור טהור.
3. **דריפט בקוד (תיקונים קטנים, לא תלויי-הכרעה):** הערת `#4f46e5` ב-`globals.css`
   (ערך v3 ישן); `k-ico-pulse` → `color-mix(in oklch, var(--primary), transparent …)`;
   `src/lib/password-strength.ts` משתמש ב-`bg-red-500`/`bg-green-400`/`bg-green-600`
   ליטרליים במקום `destructive`/`success`.
4. **Stitch:** הקובץ הזה הועלה ב-24.8.2026 לפרויקט "KALFA — Emails & UI"
   (`18047272338501750019`) ונוצרה ממנו מערכת-העיצוב **"KALFA"**
   (`assets/ffd8031b3bab44ec9b6ffecff929353f`, Heebo, `#4f39f6`) — לבחור אותה לכל
   מסך חדש. המערכות הישנות באותו פרויקט ("Kalfa Design System" ב-Assistant, "KALFA
   Editorial Identity", "Architectural Cyan"…) ו-"Kalfa RSVP" (Rubik, `#2563EB`) בפרויקט
   `2651155482082566846` **מיושנות** — ל-MCP אין מחיקה; לנקות ידנית ב-UI. הערה:
   Stitch גוזר `primary` Material משלו (`#3504e0`); ה-`#4f39f6` נשמר ב-`primary_container`
   / `overridePrimaryColor` / designMd.

<!-- מקורות (אומתו 24.8.2026): src/app/globals.css (:root + .dark, OKLCH → hex
מחושב) · components.json (base-nova, neutral, rtl) · src/components/ui/{button,card,
input,badge,sidebar}.tsx (shadcn מעל @base-ui/react + DirectionProvider) ·
src/app/layout.tsx (Heebo) · src/app/(public)/(site)/{page,faq/page,contact/page}.tsx
+ src/components/site/site-footer.tsx (משטח שיווקי) · src/app/(public)/{r,g,ty}/[token]
(דפי אורח) · src/lib/email/templates.ts. -->
