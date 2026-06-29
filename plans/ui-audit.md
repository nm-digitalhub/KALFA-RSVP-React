# ביקורת ה-UI הקיים + בנייה מחדש של ה-Shells — KALFA (תוצר חלק 2)

> **תוצר אח** ל-`plans/base-ui-component-utilization.md` (רפרנס 37 רכיבי Base UI + רשימת "לעטוף הבא").
> **מבנה הקובץ:** **A** ביקורת ה-UI הקיים · **B** בנייה מחדש של AppShell+AdminShell · **C** תוכנית-מימוש מדורגת.
> **היקף:** חלק A הוא קריאה-בלבד (לא שונה קוד). חלקים B/C הם **הצעות לאישור** — שינוי חוצה-מערכת, ולכן (CLAUDE.md) תוכנית קודם.
> כל טענת best-practice מצוטטת למקור חי שנקרא בפועל; ממצאי-עקביות פנימיים מסומנים במפורש.

---

## מקורות סמכותיים (בסדר הלימוד שנקבע)

| # | מקור | מאמת | סטטוס |
| :-: | :--- | :--- | :--- |
| 1 | **Base UI Drawer** — `node_modules/@base-ui/react/docs/react/components/drawer.md` (v1.6.0, **סמכותי**) · https://base-ui.com/react/components/drawer | תפריט מובייל: צד, overlay, swipe-to-close, focus, snap | נקרא (מקומי) |
| 2 | **Base UI Direction Provider** — מקומי v1.6.0 · https://base-ui.com/react/utils/direction-provider | RTL ל-14 רכיבים portaled | נקרא (מקומי) |
| 3 | **shadcn Sidebar** — מאומת ב-`src/components/ui/sidebar.tsx` (upstream: https://ui.shadcn.com/docs/components/sidebar) | קבוצות, header/footer, sub-items, collapsible, מובייל | נקרא (בריפו) |
| 4 | **W3C APG Disclosure** — https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/ | תפריט אדמין מקובץ נגיש | נקרא (live) |
| 5 | **W3C APG Menu Button** — https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/ | תפריט אווטאר | נקרא (live) |
| 6 | **shadcn Chart + Recharts 3** — מאומת ב-`src/components/ui/chart.tsx` (upstream: https://ui.shadcn.com/docs/components/chart) · recharts ^3.8.0 | דשבורד תוצאות (composition) | נקרא (בריפו) |

**best-practice נוסף שנקרא ואומת (לחלק A):**
- WCAG 2.2 **2.5.8 Target Size** ≥ 24×24px (AA): https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- WCAG 2.1 **1.4.3 Contrast** ≥ 4.5:1 / 3:1 (AA): https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html
- NN/g **Visual Hierarchy**: https://www.nngroup.com/articles/visual-hierarchy-ux-definition/
- NN/g **Data Tables**: https://www.nngroup.com/articles/data-tables/
- NN/g **Legibility/Readability**: https://www.nngroup.com/articles/legibility-readability-comprehension/

> דפי Material (8dp/type-scale) לא נטענו (JS) — **אינם מצוטטים**; טיפוגרפיה/רווח מעוגנים ב-NN/g Visual Hierarchy.
> **גרסאות (package.json):** next 16.2.9 · react 19.2.4 · recharts ^3.8.0 · @base-ui/react ^1.6.0 · react-hook-form ^7.80 (+@hookform/resolvers) · tailwindcss ^4.

---

# חלק A — ביקורת ה-UI הקיים

**נקרא (READ-ONLY):** `app-shell.tsx`, `admin-shell.tsx`, `ui/sidebar.tsx`, `ui/card.tsx`, `ui/chart.tsx`, `forms.tsx`, `globals.css`, `admin/_components.tsx`, ועמודים: `events/[id]/page.tsx`, `guests/page.tsx` (+`guest-list-controls`/`loading`/`not-found`), `campaign/[campaignId]/approve/page.tsx`, `admin/orders|packages|users`.

## A.1 מה נעשה **נכון** (לשמר)
1. **פרימיטיבי shadcn מתוקצבים:** `ui/card.tsx` (`--card-spacing`, `font-heading`, `ring-1`), `ui/sidebar.tsx`, `ui/chart.tsx` — תקינים עם data-attributes.
2. **ביצועי-שרת:** עימוד/סינון/מיון בצד-שרת בכל הרשימות — bookmarkable, ללא טעינת רשימות לדפדפן (CLAUDE.md).
3. **RTL נכון (במקומות):** `dir="ltr"` לטלפון/אימייל (`guests/page.tsx:128`), חץ `→` נכון ב-`approve`, properties לוגיות ב-sidebar, `DirectionProvider` בשני ה-Shells.
4. **נגישות:** `loading.tsx` עם `aria-busy/live`+sr-only; `not-found.tsx`; `forms.tsx` עם `role="alert"/"status"` ו-`<label htmlFor>`; עימוד `aria-label`.
5. **i18n מרוכז:** `Intl` he-IL (ILS + date) ב-`admin/_components.tsx`.
6. **יסוד OKLCH** + מותג אינדיגו יחיד (`--primary`).

## A.2 ממצאים — חלש/שגוי (מול עקרונות)

**⬛ ממצא-על — שכפול פרימיטיבים אדמין↔לקוח** *(עקביות design-system)*
`admin/_components.tsx` מספק `PageHeading`(28), `EmptyState`(32-38), `Badge`(41-47), `Pagination`(70+), `formatCurrency/DateTime` — ומשמש יפה באדמין. אבל **הלקוח לא מייבא** ומשכפל גרסאות נחותות: `guests/page.tsx:102-107` empty-state (שכפול מילולי), `:73` h1 (שכפול PageHeading), `:161-186` עימוד (**fork נחות** — ללא disabled, ללא `rel`). זהו עמוד-השדרה לכל השאר.

**🟥 P0 — אין מערכת סטטוס/צבע סמנטית** *(NN/g Visual Hierarchy)* — `Badge` (`_components.tsx:41`) וה-spans (`events/[id]/page.tsx:64`, `guests:135`) **תמיד אפורים**; כל הסטטוסים (RSVP, הזמנה, contact) זהים-ויזואלית. אין `--success/--warning/--info` ב-`globals.css` (רק `--destructive`).

**🟥 P0 — צבעים קשיחים עוקפי-טוקן ושוברי-dark** *(design-system; dark מותנה)* — `forms.tsx`: `text-red-600`(20), `bg-red-50/text-red-700`(28), `bg-green-50`(40); `approve`: `bg-green-50`, `bg-amber-50`. ללא מקבילת dark.

**🟧 P0/P1 — פיצול כפתור** *(design-system)* — 3+ מימושים: `ui/button.tsx`, `forms.tsx SubmitButton` (`<button>` גולמי 5-16), ועשרות `<Link className="rounded-md bg-primary px-4 py-2…">` (`events:70`, `guests:77,83`, `packages`, `users`, `not-found`, `approve`).

**🟧 P1 — פיצול כרטיס** *(design-system)* — `Card` קנוני מול `rounded-lg border bg-card p-6` (`events/[id]/page.tsx:80`) ו-`p-4` (`approve`).

**🟧 P1 — טבלה מול רשימה** *(NN/g Data Tables)* — לקוח `<table>` (טוב להשוואה), אדמין `<ul>`; אין `Table` משותף; טבלת guests ללא hover-highlight/zebra.

**🟨 P1 — טיפוגרפיה דקה** *(NN/g Visual Hierarchy + Legibility)* — `--font-heading`=`--font-sans` (אין גופן-תצוגה); עמודים `font-bold` מול Card `font-heading`; גוף כמעט תמיד `text-sm`.

**🟨 P1 — `<select>`/`<input>` נייטיב בסינון** *(עקביות + RTL/נגישות)* — `guest-list-controls.tsx` (×4 select גולמי) ו-`users`; כעת `ui/select`/`ui/input` **קיימים** → אימוץ, לא עטיפה.

**🟦 P2 — גודל-יעד גבולי** *(WCAG 2.5.8 = 24px AA)* — pills `px-2 py-0.5` (~20px) וקישורי עימוד `px-3 py-1` (~24-28px) על/סמוך לסף. (44px = Apple HIG, מקור לא-מאומת.)
**🟦 P2 — empty-state ללא CTA** · **🟦 P2 — חץ-חזרה `←` ב-`events/[id]/page.tsx:54`** (RTL) · **🟦 P2 — ניגודיות למדידה** (`muted-foreground` 0.556 + `text-xs`-on-tint; לא ניתן לחשב מ-OKLCH בעין).

---

# חלק B — בנייה מחדש: AppShell + AdminShell

מצב נוכחי: שני ה-Shells משתמשים ב-`ui/sidebar.tsx` (`side="right" collapsible="offcanvas"`) + `DirectionProvider`, ניווט **שטוח**, ותפריט אווטאר `DropdownMenu`. הבנייה-מחדש מנצלת מה שכבר קיים.

## B.1 RTL — DirectionProvider (מקור 2)
**כבר תקין** (`app-shell.tsx:148`, `admin-shell.tsx:133`). הכלל: Base UI מתעלם מ-`dir` ב-DOM; 14 רכיבים portaled (dialog/menu/select/drawer/tooltip…) מרונדרים ל-`body` ולכן צריכים את ה-Context. **פעולה:** לוודא שכל overlay חדש (Drawer/Select/Popover) נשאר בתוך ה-DirectionProvider.

## B.2 סיידבר מקובץ — Disclosure (מקורות 3+4)
`ui/sidebar.tsx` כבר מייצא: `SidebarGroup`/`SidebarGroupLabel` · `SidebarMenu`/`SidebarMenuItem`/`SidebarMenuButton`(+`tooltip`,`isActive`) · `SidebarMenuSub`/`SidebarMenuSubItem`/`SidebarMenuSubButton` · `collapsible="offcanvas|icon|none"`.

**מיפוי 13 מסלולי האדמין → 4 קבוצות:**

| קבוצה (`SidebarGroupLabel`) | מסלולים |
| :--- | :--- |
| (עליון, ללא קבוצה) | `/admin` סקירה |
| **תפעול** | `/admin/users` · `/admin/contacts` · `/admin/callbacks` · `/admin/activity` |
| **מסחר** | `/admin/orders` · `/admin/packages` · `/admin/agreement` · `/admin/sumit-test` |
| **תקשורת** | `/admin/channels` · `/admin/templates` · *(עתידי: `/admin/webhooks`)* |
| **מערכת** | `/admin/company` · `/admin/settings` |

**מפרט W3C Disclosure (מאומת live):** טריגר `role=button` + **`aria-expanded`** (true/false) + `aria-controls`; **Enter/Space** מחליפים נראות; **הפוקוס נשאר על הטריגר**; chevron ימינה(סגור)/מטה(פתוח) — ויזואלי בלבד.

**קומפוזיציה (משתמש ב-`ui/collapsible` שכבר נעטף):**
```
SidebarGroup
  Collapsible (defaultOpen = הקבוצה מכילה את ה-route הפעיל)
    CollapsibleTrigger → render=SidebarGroupLabel  (כפתור + chevron + aria-expanded "חינם" מ-Base UI)
    CollapsiblePanel
      SidebarGroupContent › SidebarMenu › SidebarMenuItem › SidebarMenuButton(render=Link, isActive)
```
**Caveat:** `SidebarMenuSub` מקבל `group-data-[collapsible=icon]:hidden` (`sidebar.tsx:644`) → במצב icon-rail תתי-פריטים נעלמים. **המלצה: להישאר `offcanvas`** לאדמין (icon-rail בהמשך עם flyouts אם נדרש). **AppShell** נשאר שטוח (4-5 פריטים); קיבוץ אופציונלי ל"האירועים שלי".

## B.3 תפריט אווטאר — Menu Button (מקור 5) — **מאומת, לא פריט-עבודה**
**מפרט W3C Menu Button (live):** `aria-haspopup="menu"` + `aria-expanded` + `aria-controls`; `role=menu`+`menuitem`; Enter/Space/Down פותחים וממקדים פריט ראשון, Up→אחרון; חצים/Home/End/Esc/typeahead לפי Menu Pattern. **מצב KALFA:** התפריט בנוי על Base UI **Menu** (`DropdownMenu`, `app-shell.tsx:212`) שמספק את כל זה אוטומטית → **תקין ✓**. וידוא בלבד: שם-נגיש לטריגר (אווטאר+אימייל — תקין), ו-logout דרך `requestSubmit()` (כבר מטופל).

## B.4 ניווט מובייל — Drawer (מקור 1) — ממצא כן מהמקור
תיעוד ה-Drawer: *"Drawer extends Dialog… אם לא צריך מחוות, השתמש ב-Dialog. פאנל שמחליק מהקצה ללא מחוות = Dialog ממוקם."* הסיידבר במובייל **כבר** על `Sheet` (=Dialog, `sidebar.tsx:182-205`). לכן **Drawer אינו החלפה נדרשת**; ערכו = swipe-to-dismiss (`swipeDirection`; ב-RTL הצד inline-end) + snap (`snapPoints`) + `VirtualKeyboardProvider`. **המלצה:** ניווט מובייל נשאר על Sheet; לעטוף `ui/drawer` רק ל-bottom-sheet אמיתי (פעולות אורח/מסנני קמפיין) — לא חוסם את ה-Shell.

## B.5 דשבורד תוצאות — Chart/Recharts 3 (מקור 6)
`ui/chart.tsx` מותאם כבר ל-Recharts 3. composition: רכיבי Recharts אמיתיים בתוך `<ChartContainer config>`, צבעים `var(--color-<key>)`. **RTL מדויק:** `<XAxis reversed />`, `<YAxis orientation="right" />`, `tickFormatter` עם `Intl.*('he-IL')`. **אזהרת פלטה:** `--chart-1..5` ב-`globals.css` כולם גווני-אפור (chroma 0) → גרפים מונוכרום עד שתוגדר פלטה. נתונים מ-**aggregation בשרת** (view/RPC), לא בדפדפן. צ'ארטים: פילוח RSVP (Donut), תגובות לאורך זמן (Bar), delivery לפי ערוץ, משפך קמפיין.

---

# חלק C — תוכנית-מימוש מדורגת

**שער-וידוא לכל שלב:** `npm run lint` · `npx tsc --noEmit` · `npm run test` (vitest) · `npm run build` (`next build --webpack` — לא Turbopack). + בדיקת קונסול בדפדפן מאומת (גבולות client/server + DirectionProvider לכל portaled) — `[[verification-gate-runtime]]`.
**עיקרון:** כל שלב עצמאי-לאימות ואינו תלוי בעוקב. סדר: יסוד design-system → ניווט → דשבורד.

| שלב | תוצר | קבצים עיקריים | עטיפות @base-ui נדרשות | ממצאי-ביקורת שנסגרים |
| :-: | :--- | :--- | :--- | :--- |
| **0** ✅ | *בוצע* — `switch`,`collapsible`,`scroll-area`,`select` נעטפו (Main session) | `ui/*` | — | — |
| **1** | **יסוד design-system (P0):** (א) להעלות `PageHeading/EmptyState/Badge/Pagination/formatters` מ-`admin/_components` ל-`ui/`+לאמץ בלקוח; (ב) טוקני `--success/--warning/--info` (+dark) + variants ל-`Badge`+מיפוי סטטוסים; (ג) כפתור אחד — לבטל `SubmitButton`/`<Link>` גולמיים, `Button`+`render`; (ד) לנתב צבעי `red/green/amber` דרך טוקנים | `admin/_components.tsx`→`ui/`, `globals.css`, `ui/button.tsx`, `forms.tsx`, `events`/`guests`/`approve` | אין (משתמש ב-`Button` קיים) | ממצא-על, P0×3 |
| **2** | **AdminShell מקובץ (Disclosure):** מיפוי 4-הקבוצות (B.2); רמה-1 סטטי תחילה, אז רמה-2 מתקפל עם `Collapsible`; `defaultOpen` לקבוצה הפעילה | `admin-shell.tsx` | `collapsible` (✅ קיים) | ניווט שטוח |
| **3** | **AppShell + אימוץ `ui/select`+`ui/input` בסינון** + וידוא אווטאר Menu Button + DirectionProvider | `app-shell.tsx`, `guest-list-controls.tsx`, `admin/users` | `select`,`input` (✅ קיימים) | P1 בקרות נייטיב |
| **4** | **איחוד Card/Table + טיפוגרפיה:** `Card` בכל מקום; `Table`/`DataList` משותף (+hover/zebra); type-scale נקוב + העלאת גוף ל-`text-base`; תיקון חץ-RTL + empty-state CTA | `ui/card`+חדש `ui/table`, עמודים, `globals.css` | אין | P1 כרטיס/טבלה/טיפו, P2 חץ/empty |
| **5** | **Drawer מובייל (אופציונלי):** bottom-sheet לפעולות/מסננים; או swipe-close לסיידבר | `ui/drawer` (חדש), Shells | **`drawer`** (חדש) | — |
| **6** | **דשבורד תוצאות:** `ChartContainer`+Recharts RTL (B.5); aggregation בשרת; פלטת-chart סמנטית | `events/[id]` dashboard, `globals.css` (פלטה), `ui/chart` (קיים) | אין (chart קיים) | אזהרת פלטה מונוכרום |

**P2 חוצה-שלבים:** גודל-יעד ≥24px (שלבים 1-4 בעת נגיעה ברכיב), ביקורת-ניגודיות בכלי (שלב 1 עם הטוקנים). 
**תלות בעטיפות מרשימת "לעטוף הבא" (תוצר אח):** שלב 1 נהנה מ-`Field+Form` (#2) להחלפת `forms.tsx` ומיפוי שגיאות-שרת; שלב 5 = `Drawer` (#10). שאר השלבים אינם חוסמים על עטיפות חדשות.

---

## סיכום
החוזק: יסוד shadcn תקין, ביצועי-שרת, ופרטי RTL/נגישות רבים. החולשה: **חוסר-קונסולידציה** (שתי מערכות-פרימיטיבים, אין סטטוס סמנטי, צבעים קשיחים, פיצול כפתור/כרטיס/טבלה). **שלב 1 (P0)** הוא בעל-המינוף-הגבוה — מסיר את רוב חוסר-העקביות לפני בניית הניווט המקובץ והדשבורד. ה-Shells (B) נשענים על מה שכבר קיים (sidebar.tsx מלא, collapsible/select נעטפו, DirectionProvider במקום, אווטאר תקין) — העבודה היא קומפוזיציה + מיפוי, לא תשתית חדשה. הכול הצעה; מומלץ לאשר את מיפוי 4-הקבוצות + שלב 1 לפני מימוש.
