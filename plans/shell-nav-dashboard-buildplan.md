# Shell · ניווט · דשבורד — תוכנית בנייה (לאישור)

> ⚠️ **אוחד לתוך `plans/ui-audit.md`** (חלקים **B** בנייה-מחדש + **C** תוכנית מדורגת) — שם המקור-הקנוני לחלק-2. קובץ זה נשמר כפירוט-עזר (דוגמת Recharts מלאה, הערות Drawer CSS-vars). לקריאה רצופה השתמשו ב-`ui-audit.md`.

> **סטטוס:** תוכנית-בנייה לאישור — **לא** מתחילים מימוש עדיין. ה-Shells הם שינוי חוצה-מערכת, ולכן (לפי CLAUDE.md) קודם תוכנית + אישור.
> **תוצר אחי:** רפרנס הרכיבים המלא ב-`plans/base-ui-component-utilization.md` — אין כאן חזרה על ה-API, רק קומפוזיציה קונקרטית. APIs מצוטטים שם.
> **קבצי יעד:** `src/components/app-shell.tsx`, `src/components/admin-shell.tsx`, `src/components/ui/sidebar.tsx` (קיים, מלא), `src/components/ui/chart.tsx` (קיים), `src/components/ui/collapsible.tsx` (**נעטף ✅** — step 0 הושלם).
>
> **עדכון סטטוס (Main session):** נעטפו `switch`, `collapsible`, `scroll-area`, `select` (ירוקים). ה-**step 0** של תוכנית זו (עטיפת `ui/collapsible`) **בוצע** — מוכן לבניית קבוצות-Disclosure ב-AdminShell.

---

## מקורות (חומר עבודה מדויק — לא השראה)

| # | מקור | מאמת מה | סטטוס מול הקוד |
| :-: | :--- | :--- | :--- |
| 1 | Base UI **Drawer** (`docs/.../drawer.md`, v1.6.0 מקומי) | bottom-sheet/side, swipe-to-dismiss, snap, VirtualKeyboard | רכיב לא עטוף; ראו ממצא בחלק 1 |
| 2 | Base UI **Direction Provider** (מקומי v1.6.0) | RTL ל-portaled | כבר בשני ה-Shells ✓ |
| 3 | **shadcn Sidebar** = `src/components/ui/sidebar.tsx` | קבוצות, header/footer, sub-items, collapsible | קיים ומלא; בשימוש בשני ה-Shells |
| 4 | **shadcn Chart + Recharts 3** = `src/components/ui/chart.tsx` | composition: Recharts אמיתי בתוך ChartContainer | קיים, **טרם בשימוש** |
| 5 | **W3C APG Disclosure** (w3.org/WAI/ARIA/apg/patterns/disclosure) | תפריט אדמין מקובץ נגיש | `ui/collapsible` **נעטף ✅** — מוכן |
| 6 | **W3C APG Menu Button** (w3.org/WAI/ARIA/apg/patterns/menu-button) | תפריט אווטאר | כבר תקין דרך Base UI Menu ✓ |

**גרסאות מותקנות (מאומת ב-package.json):** `next 16.2.9` · `react 19.2.4` · `recharts ^3.8.0` · `@base-ui/react ^1.6.0` · `lucide-react ^1.21.0` · `tailwindcss ^4`.

**סדר עבודה (כפי שביקשת):** קודם מבנה+ניווט → Drawer · DirectionProvider · Sidebar · Disclosure · Menu Button — ורק אז דשבורד+גרפים (Chart).

---

## חלק 1 — ניווט מובייל (Drawer)  ⟵ ממצא חשוב מהמקור עצמו

**הממצא הכן:** תיעוד ה-Drawer קובע מפורשות:
> *"Drawer extends Dialog: it adds gesture support, snap points, and indent effects. If you don't need these, use Dialog instead. A panel that slides in from the edge and doesn't need gesture support is a positioned Dialog."*

ה-Sidebar במובייל **כבר** משתמש ב-`Sheet` (שהוא Base UI Dialog) — `sidebar.tsx:182-205`. כלומר **Drawer אינו החלפה נדרשת** לניווט המובייל; הוא נכון רק כשרוצים את הערך המוסף שלו:
- **swipe-to-dismiss** (החלקה לסגירה) — `swipeDirection` (ברירת מחדל `"down"`; לסיידבר RTL מימין → `"right"`). CSS vars במהלך החלקה: `--drawer-swipe-progress`, `--drawer-swipe-movement-x/y`, `--drawer-swipe-strength` (להנעת ה-popup + עמעום backdrop).
- **snap points** (bottom-sheet עם עצירות) — `snapPoints`/`defaultSnapPoint`/`onSnapPointChange`.
- **`Drawer.VirtualKeyboardProvider`** — bottom-sheet עם שדות טופס + מקלדת רכה.
- `Drawer.Content` מאפשר בחירת-טקסט בלי להפעיל swipe (עכבר); `data-base-ui-swipe-ignore` לאלמנט שמוחרג.

**המלצה:**
1. **ניווט מובייל נשאר על ה-Sheet הקיים** (נכון, נגיש, פשוט) — לא לגעת.
2. לעטוף `ui/drawer.tsx` רק כשנבנה **bottom-sheet** אמיתי (פעולות אורח / מסנני קמפיין במובייל) — שם swipe+snap משדרגים UX. כניסה ל"לעטוף הבא" בעדיפות בינונית, **לא** חוסם את ה-Shell.
3. אם בכל-זאת רוצים swipe-to-close לסיידבר המובייל — להחליף את ה-`Sheet` הפנימי ב-Drawer עם `swipeDirection="right"` (לזכור: ב-RTL הצד הפותח הוא inline-end).

---

## חלק 2 — Direction Provider (RTL)

**כבר תקין:** שני ה-Shells עוטפים ב-`<DirectionProvider direction="rtl">` (`app-shell.tsx:148`, `admin-shell.tsx:133`) + `dir="rtl"` על `<html>`. הכלל המלא בתוצר האח (חלק 1.6). פעולה היחידה: לוודא שכל overlay חדש (Drawer, Popover, Select…) נשאר בתוך ה-DirectionProvider — אחרת ה-Portal יוצא LTR. אין שינוי נדרש כעת.

---

## חלק 3 — בניית הסיידבר מחדש (קבוצות + sub-items)

`ui/sidebar.tsx` כבר מייצא את **כל** אוצר-המילים הדרוש — אין צורך לכתוב primitive:
`SidebarGroup`/`SidebarGroupLabel`/`SidebarGroupContent` · `SidebarMenu`/`SidebarMenuItem`/`SidebarMenuButton` (עם `tooltip`+`isActive`) · `SidebarMenuSub`/`SidebarMenuSubItem`/`SidebarMenuSubButton` · `SidebarMenuBadge`/`SidebarMenuAction` · `collapsible="offcanvas"|"icon"|"none"` · בנוי-RTL (`rtl:` variants, `side`, `useRender`+`mergeProps`).

### 3א. מיפוי האדמין: 13 מסלולים → 4 קבוצות  ⟵ הליבה של חלק זה
היום `admin-shell.tsx:58-72` הוא רשימה שטוחה של 13. המיפוי המוצע:

| קבוצה (`SidebarGroupLabel`) | מסלולים |
| :--- | :--- |
| **(עליון, ללא קבוצה)** | `/admin` · סקירה (LayoutDashboard) |
| **תפעול** | `/admin/users` משתמשים · `/admin/contacts` פניות · `/admin/callbacks` בקשות חזרה · `/admin/activity` יומן פעילות |
| **מסחר** | `/admin/orders` הזמנות · `/admin/packages` חבילות · `/admin/agreement` חוזה · `/admin/sumit-test` בדיקת SUMIT |
| **תקשורת** | `/admin/channels` ערוצי תקשורת · `/admin/templates` תבניות פנייה · *(עתידי: `/admin/webhooks` — Webhook Inspector, task #9)* |
| **מערכת** | `/admin/company` פרטי חברה · `/admin/settings` הגדרות |

(שיוך גמיש: למשל `users` יכול לעבור ל"מערכת" אם מתייחסים אליו כניהול-מערכת ולא CRM. מומלץ להשאיר ב"תפעול".)

### 3ב. שתי רמות מימוש לקבוצות
- **רמה 1 — קבוצות סטטיות (פשוט, ללא Disclosure):** כל קבוצה = `SidebarGroup` עם `SidebarGroupLabel` + `SidebarMenu`. תמיד גלויות. אפס תלות חדשה. מתאים ל-13 מסלולי האדמין.
- **רמה 2 — קבוצות מתקפלות (Disclosure, חלק 4):** כל קבוצה נפתחת/נסגרת. דורש `ui/collapsible` (ראו חלק 4, **step 0**).

### 3ג. caveat — `collapsible="icon"` מול sub-items
`SidebarMenuSub` מקבל `group-data-[collapsible=icon]:hidden` (`sidebar.tsx:644`) — כלומר במצב icon-rail תתי-הפריטים **נעלמים**. לכן: או נשארים `collapsible="offcanvas"` (כמו היום) עם קבוצות/תתי-פריטים, או אם רוצים מצב icon-rail בדסקטופ צריך לעצב flyouts לפריט מקובץ. המלצה: **להישאר offcanvas** לאדמין; להעריך icon-rail בנפרד.

### 3ד. AppShell (לקוח)
נשאר בעיקר שטוח (4-5 פריטים) — אין צורך בקבוצות. שיפור אופציונלי: לקבץ "האירועים שלי" עם sub-items (אירוע אחרון, יצירת אירוע) דרך אותו דפוס Disclosure.

---

## חלק 4 — Disclosure (קבוצות מתקפלות נגישות)

**מפרט W3C APG (מאומת live):**
- כפתור-הטריגר: `role=button` + **`aria-expanded`** (`true` פתוח / `false` סגור) + **`aria-controls`** (אופציונלי, מצביע ל-id של האזור).
- מקלדת: **Enter ו-Space** מחליפים נראוּת. **הפוקוס נשאר על הטריגר** (אין העברת פוקוס לתוכן).
- ויזואלי: chevron ימינה (סגור) / מטה (פתוח) — רמז ויזואלי בלבד.

**מימוש ב-KALFA:**
- **Step 0 (תנאי מקדים) — ✅ בוצע:** `ui/collapsible.tsx` נעטף (מ-`@base-ui/react/collapsible` — `Collapsible`/`CollapsibleTrigger`/`CollapsiblePanel`). Base UI Collapsible מספק `aria-expanded` + Enter/Space + ניהול-פוקוס "חינם" (CSS var `--collapsible-panel-height` לאנימציה). אפשר לעבור ישירות לקומפוזיציה למטה.
- **קומפוזיציה לקבוצת-ניווט מתקפלת:**
  ```
  SidebarGroup
    Collapsible (defaultOpen אם הקבוצה מכילה את המסלול הפעיל)
      CollapsibleTrigger → render=SidebarGroupLabel (כפתור עם chevron + aria-expanded)
      CollapsiblePanel
        SidebarGroupContent › SidebarMenu › SidebarMenuItem › SidebarMenuButton(render=Link)
  ```
- ברירת-מחדל פתוחה לקבוצה שמכילה את ה-route הפעיל (כדי שהמשתמש לא "מאבד" את עצמו). את ה-active מחשבים כבר ב-`isActive()` הקיים.

---

## חלק 5 — Menu Button (תפריט אווטאר)  ⟵ מאומת, לא פריט-עבודה

**מפרט W3C APG (מאומת live):** כפתור עם `aria-haspopup="menu"` + `aria-expanded` + `aria-controls`; `role=menu` + `role=menuitem`; Enter/Space/Down פותחים וממקדים פריט ראשון, Up → אחרון; חצים/Home/End/Esc/typeahead/Tab לפי Menu Pattern.

**מצב KALFA:** תפריט האווטאר בשני ה-Shells בנוי על `DropdownMenu` (= Base UI **Menu**), שמספק את **כל** האמור אוטומטית (`app-shell.tsx:212`, `admin-shell.tsx:188`). **תקין ✓** — לא נדרש שינוי. בדיקות-וידוא בלבד: (1) ל-`DropdownMenuTrigger` יש שם נגיש (כרגע אווטאר+אימייל — תקין; אם רק אווטאר, להוסיף `aria-label`); (2) ה-logout עובד דרך `requestSubmit()` כדי לא להתנגש עם אנימציית הסגירה (כבר מטופל).

---

## חלק 6 — דשבורד תוצאות (Chart + Recharts 3)

`ui/chart.tsx` הוא ה-wrapper של shadcn, **כבר מותאם ל-Recharts 3** (`TooltipValueType`, `ResponsiveContainer initialDimension`). מודל ה-composition: רכיבי Recharts **אמיתיים** בתוך `<ChartContainer config={…}>`, צבעים כ-`var(--color-<key>)`.

**API קיים:** `ChartContainer({config, children})` · `ChartConfig = Record<key,{label, icon?, color|theme}>` · `ChartTooltip`(=Recharts Tooltip) + `ChartTooltipContent` · `ChartLegend` + `ChartLegendContent`.

### 6א. ⚠️ Recharts ו-RTL — הפרט המדויק שקל לפספס
Recharts **אינו** עושה RTL אוטומטי. בעברית:
- **`<XAxis reversed />`** — ציר ה-X מימין לשמאל.
- **`<YAxis orientation="right" />`** — תוויות הערכים בצד ימין.
- **עיצוב מספרים/תאריכים עבריים** דרך `Intl`: `tickFormatter={(v) => new Intl.NumberFormat('he-IL').format(v)}` ול-תאריכים `Intl.DateTimeFormat('he-IL', {…})`.
- legend/tooltip של ה-wrapper כבר יורשים `dir` מה-DOM; לוודא שה-ChartContainer בתוך תת-עץ `dir="rtl"`.

### 6ב. דוגמה קונקרטית (פאנל "סקירת תוצאות" באירוע)
```tsx
const config = {
  attending:   { label: 'מגיעים',   color: 'var(--chart-1)' },
  declined:    { label: 'לא מגיעים', color: 'var(--chart-2)' },
  pending:     { label: 'ממתינים',  color: 'var(--chart-3)' },
} satisfies ChartConfig;

<ChartContainer config={config} className="aspect-[16/6]">
  <BarChart data={daily} accessibilityLayer>
    <CartesianGrid vertical={false} />
    <XAxis dataKey="date" reversed tickLine={false}
           tickFormatter={(d) => new Intl.DateTimeFormat('he-IL',{day:'2-digit',month:'2-digit'}).format(new Date(d))} />
    <YAxis orientation="right" tickFormatter={(v)=>new Intl.NumberFormat('he-IL').format(v)} />
    <ChartTooltip content={<ChartTooltipContent />} />
    <Bar dataKey="attending" fill="var(--color-attending)" radius={4} />
    <Bar dataKey="declined"  fill="var(--color-declined)"  radius={4} />
  </BarChart>
</ChartContainer>
```
**צ'ארטים מומלצים ל-KALFA:** (א) פילוח RSVP (Pie/Donut: מגיעים/לא/אולי) · (ב) תגובות לאורך זמן (Bar/Area יומי) · (ג) שיעור delivery לפי ערוץ (Bar) · (ד) משפך קמפיין (נשלח→נמסר→נפתח→הגיב). הנתונים מגיעים **server-side** (aggregation ב-DB), לא בדפדפן.

---

## רצף בנייה מוצע (לפי הסדר שביקשת)

0. ~~**`ui/collapsible.tsx`**~~ — ✅ **בוצע** (נעטף ב-Main session). התנאי המקדים ל-Disclosure הושלם.
1. **AdminShell → קבוצות** — מיפוי 4-הקבוצות (3א). רמה 1 (סטטי) תחילה, אז רמה 2 (Collapsible) — **הצעד הפעיל הבא**.
2. **AppShell** — לוודא DirectionProvider + (אופציונלי) Disclosure לאירועים.
3. **Drawer** — רק אם נדרש bottom-sheet/swipe (לא חוסם).
4. **Dashboard** — לאחר התייצבות הניווט: פאנל תוצאות עם Chart + Recharts RTL.

**שער-וידוא לכל צעד (`[[verification-gate-runtime]]`):** `npm run lint` · `npx tsc --noEmit` · `npm run build` · בדיקת קונסול בדפדפן מאומת (גבולות client/server + DirectionProvider לכל portaled).

---

## סיכונים / שאלות פתוחות
1. **icon-rail מול sub-items** (3ג) — להחליט אם רוצים מצב icon בדסקטופ (דורש flyouts) או להישאר offcanvas. ברירת-מחדל מומלצת: offcanvas.
2. **שיוך `users`** — תפעול מול מערכת (3א).
3. **היקף הדשבורד** — אילו 2-4 צ'ארטים ב-MVP, ומאיפה ה-aggregation (view/RPC ב-DB).
4. **Drawer לסיידבר** — האם swipe-to-close שווה את ההחלפה, או להשאיר Sheet.
5. **פלטת ה-charts מונוכרום** — `--chart-1..5` ב-`globals.css` כולם גווני-אפור (oklch chroma 0). הגרפים יֵצאו מונוכרום עד שיוגדרו גוונים אמיתיים (למשל גזירה מ-`--primary` indigo + צבעים סמנטיים למגיע/לא-מגיע). להחליט פלטה לפני בניית הדשבורד.
