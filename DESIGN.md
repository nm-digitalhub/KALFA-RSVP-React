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
typography:
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
rounded:
  sm: 6px
  md: 8px
  lg: 10px
  xl: 14px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
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
  button-destructive:
    # Rendered as a 10% destructive tint over the surface (not a solid fill),
    # so the token models destructive text on the page background.
    backgroundColor: "{colors.background}"
    textColor: "{colors.destructive}"
    rounded: "{rounded.lg}"
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.ink}"
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
  badge:
    backgroundColor: "{colors.background}"
    textColor: "{colors.mutedForeground}"
    rounded: "{rounded.full}"
  badge-success:
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
> `src/app/globals.css`, OKLCH → hex מדויק, **אומתו 1:1 מול הפרוד beta.kalfa.me**).
> הפרוזה למטה מסבירה *למה* ואיך ליישם, בסדר הסקשנים הקנוני של מפרט DESIGN.md.

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
`left`/`right` פיזיים.

## Colors

הפלטה מושתתת על ניטרלים בעלי ניגודיות גבוהה ומבטא אינדיגו יחיד.

- **Primary — אינדיגו KALFA (#4f39f6):** המבטא הכרומטי היחיד. **רק** אלמנטים
  אינטראקטיביים: כפתורים ראשיים, קישורים, מצב-פעיל בניווט, טבעת-פוקוס, ומספרי-
  מפתח מודגשים. לרכז, לא לפזר.
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

**חשוב — הניטרלים הם אפור טהור (0 כרומה):** לבן, `#fafafa`, `#f5f5f5`,
`#e5e5e5`, `#737373`. אסור לגוון אותם באינדיגו/לבנדר. הצבעים הסמנטיים מופיעים
כ-`text-<token>` על `bg-<token>/10` (tint שקוף 10%), לא כמילוי-מלא, וכוונו לעבור
WCAG AA (≥4.5:1) בהקשר הזה.

**מצב כהה (`.dark`, פרוס):** רקע `#0a0a0a`, משטח/כרטיס `#171717`, ה-primary
מתהפך ל-`#e5e5e5`, וטוקני הסטטוס מוארים לניגודיות. (מפרט DESIGN.md אינו ממדל
"modes" בטוקנים, לכן ה-front-matter הוא light; ערכי ה-dark מתועדים כאן בפרוזה.)

## Typography

משפחה אחת: **Heebo** (Google Fonts, subsets עברית + לטינית), לכותרות ולגוף כאחד
(`--font-heading = --font-sans`) — קול אחיד, נקי וקריא בעברית.

- **h1 — כותרת עמוד:** Heebo 1.5rem / 700 (`text-2xl font-bold`).
- **h2 — כותרת משנה / מספרי-סטטיסטיקה:** 1.25rem / 700, לרוב המספר ב-`text-primary`.
- **body-md — גוף:** 0.875rem / 400 (`text-sm`), ברירת-המחדל בממשק הצפוף.
- **label — תווית / מטא:** 0.75rem / 500 ב-`text-muted-foreground`.

מספרי טלפון תמיד ב-`dir="ltr"` בתוך זרימת RTL, כדי שלא יתהפכו.

## Layout

מעטפת: סיידבר קבוע ב-inline-start (ימין ב-RTL) בדסקטופ, שנפתח כ-Sheet
(מגירה off-canvas) מתחת ל-`lg`. תוכן העמוד במרכז ברוחב מוגבל (`max-w-5xl`,
ריפוד `px-4` מובייל / `px-6` מ-`sm`). אזור התוכן מכיל את הגלישה האופקית שלו
(`overflow-x-clip`) כדי שילד רחב לא יזליג גלילה לכל הדף.

קצב spacing על בסיס 4px (`xs 4 · sm 8 · md 16 · lg 24 · xl 32`). מרווח נדיב בין
בלוקים (`space-y-6`), הדוק בתוך שורה (`gap-1/2`). הרווח — לא הקווים — יוצר קיבוץ.
רספונסיביות mobile-first: בסיס עמודה-אחת שמתרחב ב-`sm 640 / md 768 / lg 1024`.

## Elevation & Depth

הממשק **שטוח**. אין צללים כבדים — ההיררכיה נבנית מ-ניגודיות, רווח לבן, וקווי-
שיער. כרטיסים מופרדים בטבעת 1px ב-10% דיו (`ring-1 ring-foreground/10`) או
מסגרת `border`, לא בצל, ו**לא ברקע מגוון**. צל רך (`shadow-md`) שמור אך ורק
ל-overlays צפים (תפריטים, פופאוברים) שעוברים portal מעל התוכן.

## Shapes

סקאלת עיגול מ-`--radius` (0.625rem): `sm 6px · md 8px · lg 10px · xl 14px ·
full`. כפתורים וקלט = `lg` (10px). כרטיסים = `xl` (14px). שבבים/badges =
`full` (גלולה). עקביות: לא לערבב פינות חדות ומעוגלות באותו מסך.

## Components

- **Buttons:** ראשי = מילוי אינדיגו מלא (hover מתעמעם ל-80%); משני = אפור בהיר
  (`muted`) עם טקסט `#171717`; ghost/outline = שקוף עם hover; **הרס = tint**
  (`bg-destructive/10 text-destructive`), לא אדום מלא. פוקוס = טבעת אינדיגו 3px.
  לחיצה = שקיעה זעירה (`active:translate-y-px`). גובה h-10 במובייל → h-8 בדסקטופ.
- **Cards / Containers:** `rounded-xl`, **רקע לבן טהור**, טבעת קו-שיער (או
  `border`), בלי צל, בלי גוון. ריפוד פנימי נדיב (`md`, 16px).
- **Inputs:** `rounded-lg`, מסגרת אפורה דקה, רקע שקוף; פוקוס מדגיש מסגרת ל-
  אינדיגו + טבעת 3px; שגיאה = מסגרת+טבעת הרס.
- **Chips / Badges:** גלולה (`full`), טקסט זעיר, מילוי-tint סמנטי (או ניטרלי).
  אין tint אינדיגו על שבב לא-אינטראקטיבי.
- **Lists / Tables:** מעל `lg` — טבלה מלאה; מתחת — כרטיסי-רשימה צפופים
  (שורה בת 2–3 שורות למוזמן), לעולם לא טבלה דחוסה במובייל. שורות על רקע לבן,
  מופרדות ב-`divider`.

## Do's and Don'ts

- **עשה** לשמור את כל המשטחים (רקע, כרטיסים, שורות, סיידבר) **ניטרליים טהורים** —
  לבן או אפור חסר-גוון.
- **אל** תגוון שום רקע / כרטיס / שורה / כותרת / שבב באינדיגו או בלבנדר. **אין
  washes סגולים.**
- **עשה** לשמור את האינדיגו לאלמנטים אינטראקטיביים בלבד: כפתורים ראשיים,
  קישורים, מצב-פעיל בניווט, טבעת-פוקוס, ומספרי-מפתח מודגשים.
- **אל** תשתמש באינדיגו כמילוי של קונטיינר לא-אינטראקטיבי או כרקע-עמוד.
- **אל** תשתמש במילוי-אדום מלא לפעולות הרס — השתמש ב-tint (`/10`).
- **עשה** לשמור ניגודיות WCAG AA (≥4.5:1) לטקסט רגיל, במיוחד לטוקני הסטטוס.
- **אל** תערבב פינות חדות ומעוגלות באותו view; היצמד לסקאלת ה-`rounded`.
- **עשה** להשתמש ב-logical properties (`ms/me/ps/pe/start/end`) לכיבוד RTL;
  **אל** תשתמש ב-`left`/`right` פיזיים.
- **עשה** להעדיף רווח לבן וקווי-שיער על צללים ליצירת עומק.

<!-- מקורות: src/app/globals.css (:root + .dark, OKLCH; אומת 1:1 מול beta.kalfa.me) ·
src/components/ui/{button,card,input,sidebar}.tsx (shadcn מעל @base-ui/react +
DirectionProvider) · src/app/layout.tsx (Heebo). -->
