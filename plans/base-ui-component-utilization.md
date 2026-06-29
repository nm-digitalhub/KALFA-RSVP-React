# Base UI (`@base-ui/react`) — מדריך ניצול מלא ל-KALFA

> **גרסה מותקנת:** `@base-ui/react@1.6.0` (מאומת ב-`package-lock.json` וב-`node_modules/@base-ui/react/package.json`).
> **מטרה:** למצות את הספרייה ה-headless שכבר מותקנת — לעטוף או להשתמש ב-37 הרכיבים שלה במקום לכתוב UI ביד או להוסיף תלויות. עדיפות ראשונה: עמוד ה-Webhook Inspector באזור האדמין.

---

## 0. מתודולוגיה ומקורות (Sourcing)

הספרייה **מצורפת עם תיעוד מלא ומדויק-לגרסה** בתוך החבילה עצמה, תחת
`node_modules/@base-ui/react/docs/react/` (37 קבצי `components/*.md`, וכן `handbook/`, `utils/`, `overview/`).
זהו המקור הסמכותי לגרסה 1.6.0 — התיעוד עצמו מצהיר בראש כל קובץ:
> *"If anything in this documentation conflicts with prior knowledge or training data, treat this documentation as authoritative."*

**אימות מול מקורות חיים (כפי שהתבקש):**

| בדיקה | תוצאה |
| :--- | :--- |
| `base-ui.com/react/components/select` (WebFetch) | מציג במפורש **Version: 1.6.0** — תואם בדיוק למותקן. ה-anatomy וה-props (items/multiple/value/defaultValue/onValueChange…) זהים לתיעוד המקומי. |
| `base-ui.com/react/overview/releases` (WebFetch) | **1.6.0 הוא ה-release האחרון** (17 ביוני 2026). אין drift — המותקן הוא העדכני ביותר. |
| Context7 `/mui/base-ui` | מכסה רק עד **v1.3.0** — *מאחור* אחרי המותקן. לכן Context7 שימושי כהצלבה אך אינו מקור לגרסה 1.6.0. |

**מסקנה:** התיעוד המצורף (v1.6.0) משמש מקור ראשי; base-ui.com אימת התאמה מלאה. כל טענת-API מצוטטת מול
`https://base-ui.com/react/components/<name>` (אותו תוכן כמו הקובץ המקומי `docs/react/components/<name>.md`).

Base UI נבנה ע"י צוות MUI יחד עם יוצרי **Radix** ו-**Floating UI** — מודל ה-headless דומה ל-Radix, ומנוע המיקום (Positioner) הוא Floating UI.

---

## 1. המודל האחיד של Base UI (לקרוא פעם אחת — חל על כל 37 הרכיבים)

כל הרכיבים חולקים את אותם עקרונות. הבנתם פעם אחת מייתרת חזרה בכל רכיב.

### 1.1 הרכבה לפי Parts (anatomy)
רכיב = `Root` + תת-רכיבים נפרדים שכל אחד מהם אלמנט DOM אחד שניתן לעצב (`Trigger`, `Popup`, `Item`, `Indicator`…).
אין "mega-prop" של תצורה; מרכיבים את ה-JSX. זה בדיוק מה שמאפשר את עטיפות ה-shadcn בפרויקט (פונקציה לכל Part).

### 1.2 ה-prop האוניברסלי `render` (מנגנון ההרכבה / escape hatch)
לכל Part יש `render`. הוא מחליף את אלמנט ה-HTML המוגדר כברירת מחדל באלמנט/רכיב אחר **תוך שמירת ההתנהגות וה-a11y**:
```tsx
<Dialog.Close render={<Button variant="ghost" />}>סגור</Dialog.Close>   // Close מתמזג לתוך ה-Button שלנו
<Menu.Item render={<Link href="…" />}>פתח</Menu.Item>                    // Item רץ כקישור Next
```
זה כבר בשימוש ב-`src/components/ui/sheet.tsx` (ה-Close מרונדר כ-`<Button>`). מקבל גם פונקציה
`(props, state) => <el {...props} />` כשצריך לגעת ב-state.
- **`useRender` + `mergeProps`** (`@base-ui/react/use-render`, `/merge-props`) הם הכלים לבניית רכיבים משלנו עם אותה תמיכת-`render`. `mergeProps` ממזג כמה אובייקטי props: event-handlers משורשרים (ימין-לשמאל; `event.preventBaseUIHandler()` עוצר את הקודמים), `className` משורשר, `style` ממוזג. הפרויקט כבר מייבא את שניהם.

### 1.3 עיצוב מבוסס state — `className`/`style` כפונקציות + data-attributes
- `className` ו-`style` יכולים להיות ערך **או** פונקציה של ה-state: `className={(state) => state.open ? '…' : '…'}`.
- אבל הדרך המועדפת בפרויקט (וב-Base UI) היא **data-attributes**: כל Part חושף `data-*` שניתן לתפוס ב-Tailwind. לדוגמה מה-codebase:
  `group-data-[panel-open]:rotate-180` (accordion), `data-[side=bottom]:slide-in-from-top-2` (dropdown), `data-ending-style:opacity-0` (sheet).
- מאפיינים אוניברסליים לשליטה/מצב: `data-disabled`, `data-open`/`data-closed`, `data-checked`/`data-unchecked`, `data-pressed`, `data-highlighted`, `data-selected`.

### 1.4 Controlled / Uncontrolled — דפוס אחיד
- **ערך:** `value` + `onValueChange` (controlled) **או** `defaultValue` (uncontrolled). פתיחה: `open` + `onOpenChange` **או** `defaultOpen`.
- ה-callbacks מקבלים `(value, eventDetails)` — `eventDetails` מכיל `reason`, `event`, ו-`cancel()` / `event.preventBaseUIHandler()` כדי לבטל את הטיפול של Base UI. שימושי כדי, למשל, למנוע סגירת dialog במצבים מסוימים.

### 1.5 שכבות-על: Portal + Positioner + CSS variables
overlays מרונדרים דרך `<X.Portal>` (ל-`document.body`), עם `<X.Positioner>` (Floating UI) שחושף:
- props מיקום: `side` (`top|bottom|left|right|inline-start|inline-end`), `align` (`start|center|end`), `sideOffset`, `alignOffset`, `collisionAvoidance`, `collisionBoundary`, `collisionPadding`, `sticky`, `anchor` (עיגון לאלמנט וירטואלי — נקודת עכבר וכו'), `positionMethod`.
- data: `data-side`, `data-align`, `data-open`, `data-closed`, `data-anchor-hidden`.
- **CSS variables** למידות אנימציה: `--anchor-width`, `--anchor-height`, `--available-width`, `--available-height`, `--transform-origin` (וב-scroll/toast יש משלהם). כך עושים `min-w-(--anchor-width)` ו-`max-h-(--available-height)` — כבר בשימוש ב-`dropdown-menu.tsx`.
- אנימציות mount/unmount: `data-starting-style` / `data-ending-style` + `data-open`/`data-closed` (ראו `sheet.tsx`).

### 1.6 ⚠️ כלל-העל ל-RTL (קריטי ל-KALFA)
Base UI **ברירת-מחדל ל-LTR ומתעלם מ-`dir` של ה-DOM**. כדי שניווט מקלדת, צדדים לוגיים ומיקום יתנהגו נכון בעברית צריך
`<DirectionProvider direction="rtl">` שעוטף את הרכיבים (`@base-ui/react/direction-provider`).
- **חשוב במיוחד לרכיבים portaled** — הם מרונדרים מחוץ לשורש האפליקציה (ל-`body`), כך ש-`dir="rtl"` שעל ה-root **לא מגיע אליהם**. `DirectionProvider` מעביר את הכיוון דרך React Context אל ה-Portal. (`useDirection()` קורא את הכיוון הנוכחי — שימושי בעטיפות.)
- `DirectionProvider` **לא** מגדיר HTML/CSS — עדיין צריך `dir="rtl"` או `direction: rtl` ב-CSS משלנו.
- ה-14 הרכיבים ה-portaled (סעיף 1.7) **כולם** דורשים זאת. זה תיעוד ה-gotcha שכבר נרשם בזיכרון הפרויקט `[[base-ui-rtl-direction-provider]]`.
- בנוסף: השתמשו ב-**properties לוגיות** ב-Tailwind (`ps`/`pe`, `ms`/`me`, `start`/`end`, `border-s`/`border-e`) ובצדדים `inline-start`/`inline-end` — כפי שכבר נעשה ב-`dropdown-menu.tsx` (`ms-auto`, `rtl:rotate-180`).

### 1.7 אילו רכיבים עושים Portal (ולכן חייבים DirectionProvider ב-RTL)
`alert-dialog, autocomplete, combobox, context-menu, dialog, drawer, menu, menubar, navigation-menu, popover, preview-card, select, toast, tooltip` — **14 רכיבים**.
שאר 23 הרכיבים inline (לא portaled): מושפעים מ-`dir` של ה-DOM הרגיל, אך עדיין נהנים מ-DirectionProvider לניווט מקלדת לוגי (slider, tabs, toggle-group, toolbar, radio-group…).

---

## 2. סטטוס ב-KALFA — מה כבר עטוף, מה גולמי, מה לא בשימוש

עטיפות קיימות ב-`src/components/ui/`. שימו לב: **הסטטוס נקבע לפי ה-primitive המיובא, לא לפי שם הקובץ.**

| Base UI primitive | עטוף ב-KALFA? | קובץ העטיפה |
| :--- | :--- | :--- |
| `accordion` | ✅ עטוף | `ui/accordion.tsx` |
| `button` | ✅ עטוף | `ui/button.tsx` |
| `dialog` | ✅ עטוף (כ-Sheet) | `ui/sheet.tsx` ⟵ `Dialog as SheetPrimitive` |
| `input` | ✅ עטוף | `ui/input.tsx` |
| `menu` | ✅ עטוף (כ-DropdownMenu) | `ui/dropdown-menu.tsx` ⟵ `Menu as MenuPrimitive` |
| `separator` | ✅ עטוף | `ui/separator.tsx` |
| `tabs` | ✅ עטוף | `ui/tabs.tsx` |
| `tooltip` | ✅ עטוף | `ui/tooltip.tsx` |
| `collapsible` | ✅ עטוף (חדש) | `ui/collapsible.tsx` |
| `scroll-area` | ✅ עטוף (חדש) | `ui/scroll-area.tsx` |
| `select` | ✅ עטוף (חדש) | `ui/select.tsx` |
| `switch` | ✅ עטוף (חדש) | `ui/switch.tsx` |
| `direction-provider`,`merge-props`,`use-render` | מיובאים גולמית | תשתית RTL/composition |
| **27 הרכיבים האחרים** | ❌ עדיין לא בשימוש | הזדמנות מיצוי |

> **עדכון (Main session):** `switch`, `collapsible`, `scroll-area`, `select` נעטפו זה עתה (tsc/lint/build ירוקים) — **12 פרימיטיבים עטופים** כעת. הוסרו מרשימת "לעטוף הבא" (סעיף 5).

> `ui/card.tsx`, `ui/chart.tsx`, `ui/sidebar.tsx`, `ui/skeleton.tsx` **אינם** רכיבי Base UI — הם פרימיטיבים מקומיים (אל תתייחסו אליהם כעטיפות Base UI).

קונבנציית העטיפה (לחיקוי ברכיבים חדשים, נלמדה מ-`sheet.tsx`/`accordion.tsx`/`dropdown-menu.tsx`):
פונקציה לכל Part · `import { X as XPrimitive } from '@base-ui/react/x'` · `data-slot="…"` בכל Part · `cn()` עם טוקנים סמנטיים (`bg-popover`, `text-popover-foreground`, `border-border`, `ring-primary/30`) · עיצוב מצב דרך `data-*` · `render` להרכבה · properties לוגיות (`ps`/`pe`/`ms`/`me`/`start`/`end`) · טיפוסים מיובאים כ-`XPrimitive.Part.Props`.

---

## 3. רפרנס לכל 37 הרכיבים

לכל רכיב: **מבנה/anatomy · props/התנהגויות מפתח · הערת RTL · סטטוס KALFA · use-case (עדיפות: Webhook Inspector) · המלצת עטיפה · מקור**.
דפוסי-העל מסעיף 1 (render, data-attrs, controlled/uncontrolled, Positioner CSS-vars) חלים תמיד ולא חוזרים בכל ערך.

---

### קבוצה A — שכבות-על וחלוניות (Portaled · כולן צריכות DirectionProvider ב-RTL)

#### A1. Dialog — `ui/sheet.tsx` ✅ עטוף
- **Anatomy:** `Root › Trigger › Portal › Backdrop › Viewport › Popup{Title, Description, Close}`.
- **Props מפתח (Root):** `open`/`defaultOpen`/`onOpenChange`, `modal` (`boolean | 'trap-focus'`, ברירת מחדל `'trap-focus'`), `dismissible` דרך `disablePointerDismissal`, `actionsRef`/`handle` (שליטה אימפרטיבית + פתיחה מרחוק עם payload), `onOpenChangeComplete` (אחרי סיום אנימציה — לניקוי). a11y: focus-trap, `Esc`, `aria-labelledby`/`describedby` אוטומטי מ-Title/Description.
- **RTL:** Portal → DirectionProvider. הצדדים של ה-Sheet כבר עם variants לוגיים (`border-s`/`border-e`, `rtl:` translate) ב-`sheet.tsx`.
- **KALFA / Webhook Inspector:** ה-Sheet הקיים הוא **חלונית הפירוט** של אירוע webhook — לחיצה על שורה פותחת Sheet מימין עם payload מלא, כותרת (סוג האירוע + זמן), ו-Close. אין צורך ברכיב חדש.
- **המלצה:** **השתמשו ב-Sheet הקיים.** אם רוצים דיאלוג ממורכז (אישורים) שקול וריאנט `Dialog` נוסף על אותו primitive.
- מקור: https://base-ui.com/react/components/dialog

#### A2. Alert Dialog — ❌ לא בשימוש
- **Anatomy:** כמו Dialog אך **ללא dismiss מקרי** (אין `Backdrop` שסוגר בלחיצה, אין `Esc` מובנה לסגירה ללא בחירה) — `Root › Trigger › Portal › Backdrop › Viewport › Popup{Title, Description, Close}`.
- **Props מפתח:** `open`/`onOpenChange`, `actionsRef`/`handle`. מיועד להחלטות הרסניות שמחייבות בחירה מפורשת.
- **RTL:** Portal → DirectionProvider.
- **KALFA:** אישורי פעולות הרסניות — "מחק אירוע", "מחק אורח", "סגור קמפיין", "Replay webhook" (ב-Inspector), "Revoke RSVP token". עדיף על `window.confirm` (לא RTL, לא נגיש, לא ממותג).
- **המלצה:** **לעטוף** — `ui/alert-dialog.tsx` עם API דמוי-shadcn (`AlertDialogAction`/`AlertDialogCancel`). מינוף גבוה, חוזר בכל האפליקציה.
- מקור: https://base-ui.com/react/components/alert-dialog

#### A3. Popover — ❌ לא בשימוש
- **Anatomy:** `Root › Trigger › Portal › Backdrop › Positioner › Popup{Arrow, Viewport{Title, Description, Close}}`.
- **Props מפתח:** `open`/`defaultOpen`/`onOpenChange`, `modal` (`boolean | 'trap-focus'`); ב-Positioner: `side`/`align`/`sideOffset`/`alignOffset`/`collisionAvoidance`/`anchor`/`sticky`. `Viewport` מאפשר אנימציית מעבר תוכן בגודל משתנה. CSS vars: `--anchor-width`, `--available-height`, `--transform-origin`.
- **RTL:** Portal → DirectionProvider; השתמשו ב-`side="inline-start"/"inline-end"` במקום left/right.
- **KALFA / Webhook Inspector:** פאנל **פילטרים** (טווח תאריכים, סטטוס) שנפתח מכפתור; כרטיסיות מידע קצרות ("מה זה signature mismatch?"); תפריט פעולות עשיר על שורה. גם באפליקציה: בורר תאריך/שעה, helper-popover בטפסים.
- **המלצה:** **לעטוף** — `ui/popover.tsx`. בסיס לרכיבים רבים (date-picker, filter-panel). מינוף גבוה.
- מקור: https://base-ui.com/react/components/popover

#### A4. Tooltip — `ui/tooltip.tsx` ✅ עטוף
- **Anatomy:** `Provider › Root › Trigger › Portal › Positioner › Popup{Arrow, Viewport}`.
- **Props מפתח:** `Provider` עם `delay`/`closeDelay`/`timeout` (ברירת מחדל 400ms) — קובע התנהגות גלובלית; `Root` עם `delay`/`closeDelay`/`trackCursorAxis`/`disableHoverablePopup`. מופיע רק ב-hover/focus (לא ב-touch) — לא לשים בו מידע קריטי.
- **RTL:** Portal → DirectionProvider; `side="inline-start"` וכו'.
- **KALFA / Webhook Inspector:** הסברי-עזר על אייקוני סטטוס (✓ delivered, ✗ failed, ⏳ pending), קיצור של מזהים/טוקנים ארוכים, הצגת timestamp מלא בריחוף מעל זמן יחסי.
- **המלצה:** **השתמשו בקיים.** ודאו `Tooltip.Provider` גבוה בעץ (פעם אחת) ו-DirectionProvider.
- מקור: https://base-ui.com/react/components/tooltip

#### A5. Menu (Dropdown) — `ui/dropdown-menu.tsx` ✅ עטוף
- **Anatomy:** `Root › Trigger › Portal › Backdrop › Positioner › Popup{Arrow, Item, LinkItem, Separator, Group{GroupLabel}, RadioGroup{RadioItem{RadioItemIndicator}}, CheckboxItem{CheckboxItemIndicator}, SubmenuRoot{SubmenuTrigger}, Viewport}`.
- **Props מפתח:** `modal` (ברירת מחדל `true`), `openOnHover`, `loopFocus`, `orientation`; פריטים תומכים ב-checkbox/radio/submenu (כל אלה כבר ממופים ב-`dropdown-menu.tsx`). `LinkItem` לניווט.
- **RTL:** Portal → DirectionProvider. ה-submenu chevron כבר `rtl:rotate-180` ו-side `inline-end`.
- **KALFA / Webhook Inspector:** תפריט "⋯" לכל שורת אירוע — Replay, Copy payload, Mark resolved, Open related guest. גם בחירת עמודות לתצוגה (CheckboxItem).
- **המלצה:** **השתמשו בקיים.** רכיב עשיר ומלא — נצלו checkbox/radio items במקום לבנות.
- מקור: https://base-ui.com/react/components/menu

#### A6. Context Menu — ❌ לא בשימוש
- **Anatomy:** זהה ל-Menu אך נפתח ב-**right-click** על `ContextMenu.Trigger` (אזור), לא בכפתור.
- **Props מפתח:** כמו Menu (אותו מנוע). `Trigger` עוטף את האזור הלוחץ.
- **RTL:** Portal → DirectionProvider.
- **KALFA / Webhook Inspector:** right-click על שורה בטבלה → אותן פעולות כמו תפריט ה-"⋯" (UX מהיר לאדמינים). אופציונלי.
- **המלצה:** **שימוש ישיר** בעת הצורך; חולק עיצוב עם עטיפת ה-Menu (אפשר לשתף classNames).
- מקור: https://base-ui.com/react/components/context-menu

#### A7. Select — ❌ לא בשימוש
- **Anatomy:** `Root › Label › Trigger{Value, Icon} › Portal › Backdrop › Positioner › Popup{ScrollUpArrow, List{Item{ItemText, ItemIndicator}, Group{GroupLabel}, Separator}, ScrollDownArrow, Arrow}`.
- **Props מפתח:** `items` (מיפוי value→label), `value`/`defaultValue`/`onValueChange`, `multiple`, `modal`, `required`, `isItemEqualToValue`, `itemToStringValue` (object values), `highlightItemOnHover`. ל-Positioner יש `alignItemWithTrigger` (ברירת מחדל `true` — ה-popup חופף לטריגר ומיישר את הפריט הנבחר; כבה ל-dropdown רגיל). **לא ניתן לסינון** — לרשימות גדולות ראו Combobox.
- **RTL:** Portal → DirectionProvider.
- **KALFA / Webhook Inspector:** פילטר **סטטוס** (delivered/failed/pending), פילטר **סוג אירוע**, בורר "מציג N לעמוד". באפליקציה: בחירת track/channel (מנתוני אדמין), tz/locale, סטטוס RSVP.
- **המלצה:** **לעטוף** — `ui/select.tsx`. רכיב טופס בסיסי שחוזר בכל מקום. מינוף גבוה מאוד.
- מקור: https://base-ui.com/react/components/select

#### A8. Drawer — ❌ לא בשימוש
- **Anatomy:** `Provider › IndentBackground › Indent › Root › Trigger › SwipeArea › Portal › Backdrop › Viewport › Popup › Content{Title, Description, Close}`. כולל `VirtualKeyboardProvider`.
- **Props מפתח:** `snapPoints`/`defaultSnapPoint`/`onSnapPointChange` (bottom-sheet עם נקודות עצירה), `swipeDirection`, `modal`, `Indent`/`IndentBackground` (אפקט iOS — הרקע מצטמצם). אופטימיזציות swipe ו-keyboard למובייל.
- **RTL:** Portal → DirectionProvider; `swipeDirection` עם צדדים לוגיים.
- **KALFA:** bottom-sheet במובייל — פעולות אורח, מסנני קמפיין, פירוט webhook במסך קטן (אלטרנטיבה ל-Sheet במובייל). מינוף בינוני (אפליקציה מובייל-first).
- **המלצה:** **שימוש ישיר** כשנדרש bottom-sheet עם snap; ה-Sheet (Dialog) מכסה רוב הצרכים בדסקטופ.
- מקור: https://base-ui.com/react/components/drawer

#### A9. Tooltip-grade hovercard → Preview Card — ❌ לא בשימוש
- **Anatomy:** `Root › Trigger › Portal › Backdrop › Positioner › Popup{Arrow, Viewport}`. כמו Popover אך נפתח ב-**hover** (לא קליק) ונועד לתצוגה מקדימה עשירה.
- **Props מפתח:** `delay`/`closeDelay`, Positioner מלא.
- **RTL:** Portal → DirectionProvider.
- **KALFA / Webhook Inspector:** ריחוף מעל מזהה אורח/אירוע → כרטיס תצוגה מקדימה (שם, טלפון מוסתר חלקית, סטטוס RSVP) בלי לעזוב את הטבלה. גם ריחוף מעל שם קמפיין → סיכום.
- **המלצה:** **שימוש ישיר**; חולק עיצוב עם עטיפת Popover.
- מקור: https://base-ui.com/react/components/preview-card

#### A10. Toast — ❌ לא בשימוש
- **Anatomy:** `Provider › Portal › Viewport › [Toast.Root{Content{Title, Description, Action, Close}}]` (stacked) ו/או `Positioner › Toast.Root{Arrow, Content…}` (anchored).
- **Props מפתח:** `Provider` עם `limit` (ברירת מחדל 3), `timeout` (5000ms), `toastManager`. יצירת toast מקוד: **`Toast.useToastManager()`** (בתוך עץ React — חושף `add`/`close`/`update`/`promise` + מערך `toasts` ריאקטיבי) או **`Toast.createToastManager()`** (מחוץ לעץ — אותם מתודות, ללא `toasts`). data: `data-swipe-direction`, `data-expanded`; CSS vars `--toast-index`/`--toast-offset-y` לערימה.
- **RTL:** Portal → DirectionProvider; כיוון swipe לוגי.
- **KALFA / Webhook Inspector:** משוב פעולה — "Webhook replayed ✓", "Payload copied", "Failed to reprocess". באפליקציה: אישור שליחת קמפיין, שמירת אורח, שגיאות פעולה. מחליף כל פתרון toast חיצוני.
- **המלצה:** **לעטוף** — `ui/toast.tsx` + `Toast.Provider` בשורש + hook `useToast()`. מינוף גבוה (משוב גלובלי לכל האפליקציה).
- מקור: https://base-ui.com/react/components/toast

#### A11. Navigation Menu — ❌ לא בשימוש
- **Anatomy:** `Root › List › Item{Trigger{Icon}, Content{Link}} › Portal › Positioner › Popup{Arrow, Viewport}`.
- **Props מפתח:** `value`/`onValueChange` (איזה תפריט פתוח), `delay`/`closeDelay` (ברירת מחדל 50ms), `orientation`. מיועד לניווט אתר עם תפריטי-על (mega-menu) ומעברי תוכן מונפשים.
- **RTL:** Portal → DirectionProvider; `orientation` + צדדים לוגיים.
- **KALFA:** ניווט ראשי/אדמין עם תת-קטגוריות (אירועים, קמפיינים, דוחות, הגדרות). מינוף בינוני — תלוי במורכבות הניווט.
- **המלצה:** **שימוש ישיר** אם הניווט גדל; ל-sidebar הקיים אין צורך.
- מקור: https://base-ui.com/react/components/navigation-menu

#### A12. Menubar — ❌ לא בשימוש
- **Anatomy:** `<Menubar>` עוטף כמה `<Menu.Root>` (אותו primitive של Menu) לשורת תפריטים בסגנון דסקטופ-app.
- **Props מפתח:** `loopFocus`, `modal`, `orientation`, `disabled`; ניווט מקלדת חוצה-תפריטים.
- **RTL:** ה-Menu-ים בתוכו portaled → DirectionProvider; `orientation`.
- **KALFA:** לוח אדמין בסגנון אפליקציה (קובץ/עריכה/תצוגה). מינוף נמוך עבור B2C RSVP — כנראה לא נדרש.
- **המלצה:** **דלגו** אלא אם נבנה כלי-אדמין כבד.
- מקור: https://base-ui.com/react/components/menubar

---

### קבוצה B — חיפוש ובחירה (Portaled · DirectionProvider ב-RTL)

#### B1. Combobox — ❌ לא בשימוש ⭐ (מינוף גבוה מאוד)
- **Anatomy:** `Root › Label › InputGroup{Input, Trigger, Icon, Clear, Value, Chips{Chip{ChipRemove}}} › Portal › Backdrop › Positioner › Popup{Arrow, Status, Empty, List{Row{Item{ItemIndicator}}, Group{GroupLabel}, Separator, Collection}}`.
- **Props מפתח:** `items`/`filteredItems`, `value`/`onValueChange`, `inputValue`/`onInputValueChange`, **`filter`** (פונקציית סינון; `null` לסינון חיצוני/שרת), `multiple` (+`Chips` ל-tokens), `autoHighlight`, `openOnInputClick`, `limit`, **`virtualized`** (רשימות ענק), `grid`, `required`/`disabled`/`readOnly`. `Empty`/`Status` לטיפול ב-no-results/loading.
- **RTL:** Portal → DirectionProvider; ה-Input בתוך InputGroup צריך `dir`/`text-align` לוגי.
- **KALFA / Webhook Inspector:** **חיפוש/סינון** רב-עוצמה — סינון אירועים לפי guest/phone/type עם typeahead; multi-select של סוגי אירוע כ-Chips. באפליקציה: **בחירת אורח** (מתוך מאות, עם סינון), שיוך אורח לשולחן, חיפוש אירוע. זה ה-workhorse של כל בחירה-מתוך-רשימה-גדולה.
- **המלצה:** **לעטוף** — `ui/combobox.tsx`. ההשקעה הגבוהה ביותר בתועלת. מחליף כל "react-select"/autocomplete ידני.
- מקור: https://base-ui.com/react/components/combobox

#### B2. Autocomplete — ❌ לא בשימוש
- **Anatomy:** כמו Combobox אך **free-text** — הערך הוא מחרוזת חופשית; הרשימה היא הצעות. `Root › InputGroup{Input, Trigger, Icon, Clear, Value} › Portal › Positioner › Popup{Status, Empty, List{Row{Item}, Group, Collection}}`.
- **Props מפתח:** `value` (string), `mode` (`'list' | 'both' | 'inline'` — האם להשלים inline), `submitOnItemClick`, `filter`, `items`, `virtualized`. ההבדל מ-Combobox: כאן המשתמש יכול להזין ערך שלא ברשימה.
- **RTL:** Portal → DirectionProvider.
- **KALFA / Webhook Inspector:** שדה חיפוש חופשי עם היסטוריית/הצעות חיפוש. באפליקציה: הזנת עיר/אולם עם הצעות, תגיות חופשיות לאורחים.
- **המלצה:** **שימוש ישיר** במקרים של free-text; ל-בחירה-מרשימה-סגורה העדיפו Combobox.
- מקור: https://base-ui.com/react/components/autocomplete

---

### קבוצה C — בקרות טופס (רובן inline; נהנות מ-DirectionProvider לניווט לוגי)

#### C0. דפוס משותף — אינטגרציית Field
checkbox/radio/switch/slider/number-field/otp-field/input חושפים, **כשעטופים ב-`Field.Root`**, את אותם data-attributes:
`data-valid`/`data-invalid`/`data-dirty`/`data-touched`/`data-filled`/`data-focused` — כך מעצבים מצבי-תקינות אחיד. כולם תומכים ב-`name`/`form` לשליחת טופס נייטיב.

#### C1. Field — ❌ לא בשימוש ⭐
- **Anatomy:** `Root{Label, Control, Description, Item, Error, Validity}`.
- **Props מפתח:** `name`, **`validate`** (פונקציית ולידציה — מחזירה string/string[]/null), `validationMode` (`'onSubmit'|'onChange'|'onBlur'`), `validationDebounceTime`, `disabled`, `invalid`. `Field.Error` מציג שגיאות אוטומטית; `Field.Description` נקשר ל-`aria-describedby`.
- **RTL:** inline — נשען על `dir` של ה-DOM; יישור Label/Error לוגי.
- **KALFA:** **תשתית הטפסים** — עוטף כל input/select/checkbox עם label, תיאור, ושגיאת-ולידציה נגישים. משלים את Zod בצד-לקוח (Zod נשאר מקור-האמת בשרת). מינוף גבוה — בכל טופס באפליקציה.
- **המלצה:** **לעטוף** יחד עם Input/Form — `ui/field.tsx`. ליבת מערכת הטפסים.
- מקור: https://base-ui.com/react/components/field · מדריך: `handbook/forms.md`

#### C2. Form — ❌ לא בשימוש
- **Anatomy:** `<Form>` עוטף שדות `Field.Root`. עובד עם React Hook Form / TanStack Form / native.
- **Props מפתח:** **`errors`** (אובייקט שגיאות מהשרת → מוצג בשדות המתאימים), `onClearErrors`. מרכז ולידציית-שרת חזרה ל-UI.
- **RTL:** inline.
- **KALFA:** מיפוי **שגיאות-שרת** (תוצאות Zod/Server Actions) חזרה לשדות הנכונים — בדיוק מה שחסר היום בין `FormState` ל-UI. מינוף גבוה לטפסים עם ולידציית-שרת.
- **המלצה:** **לעטוף** עם Field. חברו ל-`FormState`/Server Actions הקיימים.
- מקור: https://base-ui.com/react/components/form

#### C3. Input — `ui/input.tsx` ✅ עטוף
- **Anatomy:** Part יחיד `<Input />` (`<input>`). עובד אוטומטית בתוך `Field`.
- **Props מפתח:** `value`/`defaultValue`/`onValueChange`; data-attrs של Field. דק מאוד מעל input נייטיב.
- **RTL:** inline; `text-align` לוגי, placeholder עברי.
- **KALFA / Webhook Inspector:** שדה חיפוש מהיר בטבלה. כבר עטוף — נצלו.
- **המלצה:** **השתמשו בקיים**; חברו ל-Field כשנבנה.
- מקור: https://base-ui.com/react/components/input

#### C4. Checkbox + Checkbox Group — ❌ לא בשימוש
- **Anatomy:** `Checkbox.Root{Indicator}`; קבוצה: `<CheckboxGroup>{<Checkbox.Root/>…}`.
- **Props מפתח:** `checked`/`defaultChecked`/`onCheckedChange`, **`indeterminate`**, **`parent`** (checkbox-אב ששולט בילדים דרך `allValues` ב-CheckboxGroup), `value`/`name`/`uncheckedValue`, `nativeButton`. data: `data-checked`/`data-unchecked`/`data-indeterminate`.
- **RTL:** inline; הציבו את ה-Indicator/label בסדר לוגי (`ms`/`me`).
- **KALFA / Webhook Inspector:** בחירת שורות מרובות (bulk replay/resolve) עם checkbox-אב "בחר הכל" (indeterminate). באפליקציה: בחירת אורחים מרובים לקמפיין, אישור תנאים.
- **המלצה:** **לעטוף** — `ui/checkbox.tsx` (+ parent pattern). מינוף גבוה (טבלאות + טפסים).
- מקור: https://base-ui.com/react/components/checkbox · https://base-ui.com/react/components/checkbox-group

#### C5. Radio + Radio Group — ❌ לא בשימוש
- **Anatomy:** `<RadioGroup>{<Radio.Root>{<Radio.Indicator/>}</Radio.Root>}`.
- **Props מפתח:** RadioGroup: `value`/`defaultValue`/`onValueChange`, `disabled`, `required`; Radio.Root: `value` (חובה). data-attrs כמו checkbox.
- **RTL:** inline.
- **KALFA:** בחירה בלעדית — ערוץ העדפה (WhatsApp/SMS/Email), שפת אורח, סוג RSVP (מגיע/לא/אולי). מינוף בינוני-גבוה.
- **המלצה:** **לעטוף** — `ui/radio-group.tsx`.
- מקור: https://base-ui.com/react/components/radio

#### C6. Switch — ❌ לא בשימוש
- **Anatomy:** `Root{Thumb}`.
- **Props מפתח:** `checked`/`defaultChecked`/`onCheckedChange`, `name`/`value`, `nativeButton`. data-attrs כמו checkbox.
- **RTL:** inline — ה-Thumb נע לכיוון לוגי (DirectionProvider משפיע על אנימציית הכיוון).
- **KALFA / Webhook Inspector:** toggles — "הצג רק כשלים", "auto-refresh live", "mask PII". באפליקציה: הפעלת ערוץ, פרסום אירוע, התראות. מינוף גבוה.
- **המלצה:** **לעטוף** — `ui/switch.tsx`. זול וחוזר הרבה.
- מקור: https://base-ui.com/react/components/switch

#### C7. Number Field — ❌ לא בשימוש
- **Anatomy:** `Root › ScrubArea{ScrubAreaCursor} › Group{Decrement, Input, Increment}`.
- **Props מפתח:** `value`/`onValueChange`/`onValueCommitted`, `min`/`max`/`step`/`smallStep`/`largeStep`/`snapOnStep`, **`format`** (`Intl.NumberFormatOptions`) + `locale`, `allowWheelScrub`, ScrubArea (גרירה לשינוי). data: `data-scrubbing`.
- **RTL:** inline; Decrement/Increment בסדר לוגי; `format`+`locale` עבריים.
- **KALFA:** **ספירת אורחים/מלווים** (guest count, +1), max_contacts בקמפיין, מחיר/כמות בהגדרות אדמין — עם פורמט מספרים עברי. מינוף בינוני-גבוה (הליבה היא ספירת אורחים).
- **המלצה:** **לעטוף** — `ui/number-field.tsx`.
- מקור: https://base-ui.com/react/components/number-field

#### C8. OTP Field — ❌ לא בשימוש ⭐ (רלוונטי ישירות)
- **Anatomy:** `Root{Input, Separator}`.
- **Props מפתח:** **`length`** (חובה), `value`/`onValueChange`, **`onValueComplete`** (כשכל התאים מלאים), `autoSubmit`, `autoComplete='one-time-code'`, `mask`, `validationType` (`'numeric'`), `inputMode`. data: `data-complete`. *הוכרז יציב ב-1.6.0.*
- **RTL:** inline; ספרות נשארות LTR גם בעברית (numeric).
- **KALFA:** **קוד אימות SMS** — בדיוק זרם ה-OTP של ExtrA SMS שכבר במערכת (`[[extra-sms-api]]`). מחליף 6 inputs ידניים בקלט נגיש עם paste/auto-submit.
- **המלצה:** **לעטוף** — `ui/otp-field.tsx`. התאמה ישירה לצורך קיים.
- מקור: https://base-ui.com/react/components/otp-field

#### C9. Toggle + Toggle Group — ❌ לא בשימוש
- **Anatomy:** `<Toggle/>` (כפתור דו-מצבי); `<ToggleGroup>{<Toggle/>…}`.
- **Props מפתח:** Toggle: `pressed`/`defaultPressed`/`onPressedChange`, `value`. ToggleGroup: `value`/`onValueChange` (string[]), `multiple`, `loopFocus`, `orientation`, `disabled`. data: `data-pressed`.
- **RTL:** inline; `orientation` + ניווט מקלדת לוגי (DirectionProvider).
- **KALFA / Webhook Inspector:** **מסנן-מקטעים** (segmented control) — "הכל / נכשל / ממתין / הצליח", או בורר תצוגה (טבלה/כרטיסים). באפליקציה: מסנני סטטוס RSVP, view switchers. מינוף בינוני-גבוה.
- **המלצה:** **לעטוף** — `ui/toggle-group.tsx` (segmented). שימושי מאוד ב-Inspector.
- מקור: https://base-ui.com/react/components/toggle · https://base-ui.com/react/components/toggle-group

#### C10. Fieldset — ❌ לא בשימוש
- **Anatomy:** `Root{Legend}` (`<fieldset>` + `<legend>` נגיש וניתן-עיצוב).
- **Props מפתח:** `Root.disabled` (משבית את כל הקבוצה). `Legend` נקשר אוטומטית לקבוצה. משלים את Field/CheckboxGroup לקיבוץ שדות קשורים.
- **RTL:** inline; יישור Legend לוגי.
- **KALFA:** קיבוץ שדות בטופס — "פרטי אירוע", "הגדרות ערוץ", "כתובת". מינוף בינוני.
- **המלצה:** **לעטוף** יחד עם Field — `ui/fieldset.tsx` (זול).
- מקור: https://base-ui.com/react/components/fieldset

#### C11. Slider — ❌ לא בשימוש
- **Anatomy:** `Root › Label › Value › Control › Track{Indicator, Thumb}`.
- **Props מפתח:** `value`/`defaultValue` (`number | number[]` — **טווח** עם כמה Thumbs), `onValueChange`/**`onValueCommitted`** (אחרי שחרור — להימנע מ-spam), `min`/`max`/`step`/`largeStep`/`minStepsBetweenValues`, `thumbCollisionBehavior` (`push|swap`), `orientation`, `format`+`locale`. data: `data-dragging`.
- **RTL:** inline — **הכיוון מתהפך עם DirectionProvider** (ה-Thumb נע נכון בעברית); דוגמת ה-RTL הרשמית של Base UI משתמשת ב-Slider בדיוק להמחשה הזו.
- **KALFA:** טווח תאריכים/שעות לסינון ב-Inspector, סף-התראה, בקרת קצב שליחה (rate). מינוף בינוני.
- **המלצה:** **שימוש ישיר** בעת הצורך; לא דחוף.
- מקור: https://base-ui.com/react/components/slider

---

### קבוצה D — חשיפה ופריסה (inline)

#### D1. Accordion — `ui/accordion.tsx` ✅ עטוף
- **Anatomy:** `Root › Item › Header › Trigger / Panel`.
- **Props מפתח:** `value`/`defaultValue` (Value[]), `multiple` (כמה פתוחים בו-זמנית), `disabled`, **`hiddenUntilFound`** (תוכן נמצא ב-Ctrl+F / אינדוקס SEO), `keepMounted`, `loopFocus`. CSS var לאנימציית גובה: `--accordion-panel-height`.
- **RTL:** inline; ה-chevron כבר `group-data-[panel-open]:rotate-180`.
- **KALFA / Webhook Inspector:** **payload מקופל** — כל אירוע כ-Item, ה-Panel חושף את ה-JSON המלא (`<pre>` בתוך scroll-area). גם FAQ/הגדרות מקובצות.
- **המלצה:** **השתמשו בקיים.** מצוין לתצוגת payload מדורגת.
- מקור: https://base-ui.com/react/components/accordion

#### D2. Collapsible — ❌ לא בשימוש
- **Anatomy:** `Root › Trigger / Panel`. גרסת disclosure בודדת (לא קבוצה כמו Accordion).
- **Props מפתח:** `open`/`defaultOpen`/`onOpenChange`, `disabled`, `hiddenUntilFound`. CSS vars `--collapsible-panel-height`/`-width`.
- **RTL:** inline.
- **KALFA / Webhook Inspector:** "הצג headers", "הצג raw body", "הצג stack trace" — אזורי-גילוי בודדים בתוך כרטיס פירוט. באפליקציה: "הצג פרטים נוספים" בכל מקום.
- **המלצה:** **לעטוף** — `ui/collapsible.tsx` (זול; הבסיס ל-show/hide נגיש מונפש).
- מקור: https://base-ui.com/react/components/collapsible

#### D3. Tabs — `ui/tabs.tsx` ✅ עטוף
- **Anatomy:** `Root › List{Tab, Indicator} › Panel`.
- **Props מפתח:** `value`/`defaultValue`/`onValueChange`, `orientation`. `Tabs.Indicator` נע אוטומטית; data: `data-activation-direction` (לאנימציית כיוון המחוון).
- **RTL:** inline — **`data-activation-direction` מתהפך נכון רק עם DirectionProvider**; ה-Indicator צריך לזוז לכיוון הלוגי.
- **KALFA / Webhook Inspector:** טאבים בתוך חלונית הפירוט — **Payload | Headers | Response | Timeline**. באפליקציה: טאבים בעמוד אירוע (אורחים/קמפיין/דוחות).
- **המלצה:** **השתמשו בקיים** (ודאו DirectionProvider לכיוון מחוון נכון).
- מקור: https://base-ui.com/react/components/tabs

#### D4. Scroll Area — ❌ לא בשימוש ⭐
- **Anatomy:** `Root › Viewport{Content} › Scrollbar{Thumb} › Corner`.
- **Props מפתח:** `overflowEdgeThreshold`; data עשיר: `data-has-overflow-x/y`, **`data-overflow-x-start/end`**, `data-overflow-y-start/end` (לצללי-דהייה בקצוות), `data-scrolling`. CSS vars `--scroll-area-corner-width/height`. scrollbar מותאם-עיצוב חוצה-דפדפנים.
- **RTL:** inline; ה-scrollbar עובר לצד הלוגי הנכון לפי הכיוון.
- **KALFA / Webhook Inspector:** **גלילת ה-payload/JSON** בתוך הפאנל עם scrollbar ממותג + צללי-דהייה שמרמזים על תוכן נוסף. גם רשימות ארוכות (אורחים, אירועים) בתוך גובה קבוע.
- **המלצה:** **לעטוף** — `ui/scroll-area.tsx`. רכיב מפתח ל-Inspector (תצוגת JSON) + שימוש רוחבי.
- מקור: https://base-ui.com/react/components/scroll-area

#### D5. Separator — `ui/separator.tsx` ✅ עטוף
- **Anatomy:** Part יחיד `<Separator />` (`<div role="separator">`).
- **Props מפתח:** `orientation` (`horizontal|vertical`); data: `data-orientation`. נגיש לקוראי-מסך (בניגוד ל-`<hr>` מעוצב).
- **RTL:** inline; אנכי נשאר אנכי.
- **KALFA / Webhook Inspector:** הפרדה בין מטא-דאטה לתוכן בכרטיס; מפריד בתפריטי פעולה. כבר עטוף.
- **המלצה:** **השתמשו בקיים.**
- מקור: https://base-ui.com/react/components/separator

#### D6. Toolbar — ❌ לא בשימוש
- **Anatomy:** `Root{Button, Link, Separator, Group{Button…}, Input}`.
- **Props מפתח:** `loopFocus`, `orientation`, `disabled`. **ניווט מקלדת אחיד** (חצים) על פני קבוצת פעולות — roving tabindex.
- **RTL:** inline; `orientation` + ניווט חצים לוגי (DirectionProvider).
- **KALFA / Webhook Inspector:** **סרגל-הפעולות מעל הטבלה** — חיפוש (Input) + מסננים (Toggle) + פעולות-bulk (Buttons) כיחידת-מקלדת אחת נגישה. באפליקציה: סרגל פעולות מעל רשימת אורחים.
- **המלצה:** **לעטוף** — `ui/toolbar.tsx`. מאחד את ה-header של ה-Inspector לחוויית-מקלדת אחת.
- מקור: https://base-ui.com/react/components/toolbar

---

### קבוצה E — תצוגה ומשוב (inline)

#### E1. Avatar — ❌ לא בשימוש
- **Anatomy:** `Root › Image / Fallback`.
- **Props מפתח:** `Image.onLoadingStatusChange`; `Fallback.delay` (למנוע הבהוב). מצב טעינה: `idle|loading|loaded|error` → Fallback אוטומטי (ראשי-תיבות).
- **RTL:** inline.
- **KALFA / Webhook Inspector:** אינדיקטור מקור/ערוץ (אייקון WhatsApp/SMS) ליד שורה; אווטאר אורח עם ראשי-תיבות בעברית. באפליקציה: רשימת אורחים, owner של אירוע.
- **המלצה:** **לעטוף** — `ui/avatar.tsx` (זול, חוזר ברשימות).
- מקור: https://base-ui.com/react/components/avatar

#### E2. Progress — ❌ לא בשימוש
- **Anatomy:** `Root › Label › Track{Indicator} › Value`.
- **Props מפתח:** `value`/`max`, `format` (`Intl.NumberFormatOptions`)+`locale`, `getAriaValueText`. **determinate** (ערך ידוע 0–100).
- **RTL:** inline; ה-Indicator מתמלא מהצד הלוגי הנכון.
- **KALFA / Webhook Inspector:** **התקדמות עיבוד batch** (replay של N webhooks), שיעור הצלחת-שליחה בקמפיין. באפליקציה: התקדמות ייבוא אורחים, שלב בתהליך.
- **המלצה:** **לעטוף** — `ui/progress.tsx`.
- מקור: https://base-ui.com/react/components/progress

#### E3. Meter — ❌ לא בשימוש
- **Anatomy:** `Root › Label › Track{Indicator} › Value`. (כמו Progress אך **מדידה סטטית** ולא התקדמות — `role="meter"`.)
- **Props מפתח:** `value`/`min`/`max`, `format`+`locale`, `getAriaValueText`. לערכים בטווח ידוע (מלאי, ניצול, יחס).
- **RTL:** inline.
- **KALFA / Webhook Inspector / דוחות:** **יחסי RSVP** (מגיעים מול קיבולת), אחוז delivery, ניצול max_contacts בקמפיין, "בריאות" תור ה-webhooks. מינוף בינוני בדוחות.
- **המלצה:** **לעטוף** — `ui/meter.tsx` יחד עם Progress (חולקים אנטומיה). מצוין למסכי דוחות.
- מקור: https://base-ui.com/react/components/meter

#### E4. Button — `ui/button.tsx` ✅ עטוף
- **Anatomy:** Part יחיד `<Button />` (`<button>`).
- **Props מפתח:** `nativeButton` (כש-`render` הופך אותו ל-`<div>` וכו'), **`focusableWhenDisabled`** (שמירת פוקוס במצב loading), `disabled`. אוכף סמנטיקת-כפתור (לא לקישורים — ל-`<a>` עצבו ישירות).
- **RTL:** inline; אייקונים מובילים/נגררים בסדר לוגי (`ms`/`me`).
- **KALFA:** כבר ה-primitive בכל מקום (גם בתוך `Sheet.Close` דרך `render`). נצלו `focusableWhenDisabled` בכפתורי-שליחה.
- **המלצה:** **השתמשו בקיים.**
- מקור: https://base-ui.com/react/components/button

---

## 4. תוכנית-אב ל-Webhook Inspector (מיפוי רכיבים → מסך)

מסך אדמין `/(admin)/admin/webhooks` — נבנה כולו מ-Base UI, **אפס תלות חדשה**:

```
DirectionProvider dir="rtl"  ⟵ עוטף הכל (קריטי ל-overlays)
└─ Toolbar (D6)  ── סרגל עליון כיחידת-מקלדת אחת
   ├─ Input (C3✅)                חיפוש מהיר (guest/phone/id)
   ├─ Combobox (B1)              סינון מתקדם: סוג אירוע (multi, Chips)
   ├─ Select (A7)               פילטר סטטוס · "N לעמוד"
   ├─ ToggleGroup (C9)          segmented: הכל / נכשל / ממתין / הצליח
   ├─ Switch (C6)               "auto-refresh" · "mask PII"
   └─ Button (E4✅)             "Replay נבחרים" · "Export"
└─ טבלת אירועים (שרת: pagination/sort/filter — לא בדפדפן)
   ├─ Checkbox (C4) per-row + אב "בחר הכל" (indeterminate)  ── bulk
   ├─ Avatar (E1)               אייקון ערוץ (WhatsApp/SMS/Email)
   ├─ Tooltip (A4✅)            הסבר אייקון-סטטוס + timestamp מלא
   ├─ PreviewCard (A9)          ריחוף על guest → תצוגה מקדימה
   └─ DropdownMenu (A5✅ "⋯")   Replay · Copy · Resolve · Open guest
       └─ ContextMenu (A6)      אותן פעולות ב-right-click (אופציונלי)
└─ Sheet (A1✅)  ── חלונית פירוט (קליק על שורה)
   ├─ Tabs (D3✅)               Payload | Headers | Response | Timeline
   ├─ Accordion (D1✅)          חלקי payload מקופלים
   ├─ ScrollArea (D4)           גלילת ה-JSON (<pre>) עם צללי-קצה
   ├─ Collapsible (D2)          "הצג stack trace" / "raw body"
   ├─ Progress (E2)             התקדמות batch-replay
   └─ AlertDialog (A2)          אישור Replay/Reprocess הרסני
└─ Toast (A10)  ── משוב גלובלי: "Replayed ✓" · "Copied" · שגיאות
```

תצוגת ה-**JSON** עצמה: `ScrollArea` + `<pre>` + `JSON.stringify(payload, null, 2)` (אופציונלי: רינדור עץ ידני עם `Collapsible` לכל אובייקט). **אין צורך ב-json-viewer חיצוני.**

---

## 5. מה לעטוף הבא — סדר עדיפויות (מינוף יורד)

> ✅ **כבר נעטפו (הוסרו מהרשימה):** Select · Switch · ScrollArea · Collapsible.

| # | רכיב | קובץ מוצע | למה עכשיו (מינוף) |
| :-: | :--- | :--- | :--- |
| 1 | **Combobox** | `ui/combobox.tsx` | בחירת-אורח/חיפוש-מתוך-רשימה-גדולה; מחליף react-select ידני; חיפוש Inspector |
| 2 | **Field + Form** | `ui/field.tsx`, `ui/form.tsx` | תשתית טפסים נגישה + מיפוי שגיאות-שרת (Zod/Server Actions) → UI; מחליף את `forms.tsx` הגולמי (ראו `ui-audit.md` P0) |
| 3 | **Toast** | `ui/toast.tsx` (+Provider בשורש) | משוב פעולה גלובלי לכל האפליקציה (hook `useToastManager()`) |
| 4 | **AlertDialog** | `ui/alert-dialog.tsx` | אישורי פעולות הרסניות (מחיקה/replay) — מחליף `confirm()` |
| 5 | **Checkbox (+parent)** | `ui/checkbox.tsx` | בחירת-שורות bulk + טפסים; דפוס "בחר הכל" |
| 6 | **Popover** | `ui/popover.tsx` | בסיס ל-date-picker/filter-panel/helpers |
| 7 | **ToggleGroup** | `ui/toggle-group.tsx` | segmented-filters (Inspector + סטטוס RSVP) |
| 8 | **NumberField** | `ui/number-field.tsx` | ספירת אורחים/מלווים עם פורמט עברי |
| 9 | **OTPField** | `ui/otp-field.tsx` | קוד אימות SMS (זרם ExtrA קיים) |
| 10 | **Drawer** | `ui/drawer.tsx` | bottom-sheet מובייל עם swipe/snap (ראו `shell-nav-dashboard-buildplan.md` חלק 1) |
| 11 | **Avatar** | `ui/avatar.tsx` | אייקון ערוץ/owner ברשימות (זול) |
| 12 | **RadioGroup** | `ui/radio-group.tsx` | בחירה בלעדית (ערוץ/שפה/סוג RSVP) |
| — | Toolbar · Progress · Meter · Fieldset | — | מינוף בינוני; לעטוף לפי דרישת-מסך |
| — | PreviewCard · ContextMenu · NavigationMenu · Autocomplete · Slider · Menubar | — | שימוש-ישיר לפי צורך נקודתי |

> כל עטיפה תיבנה לפי הקונבנציה בסעיף 2 ותעבור את שער-הריצה של הפרויקט (`[[verification-gate-runtime]]`): גבולות client/server + DirectionProvider לכל portaled + בדיקת קונסול בדפדפן מאומת.

---

## 6. פסק-דין: אפס תלויות חדשות נדרשות (יעד הושג ✅)

עבור ה-Webhook Inspector ושאר ה-design-system, Base UI + מובנים מכסים הכול:

| צורך | פתרון ללא תלות חדשה |
| :--- | :--- |
| צפייה ב-JSON/payload | `ScrollArea` (D4) + `<pre>` + `JSON.stringify(…, null, 2)` (+`Collapsible` D2 לעץ). **לא** json-view חיצוני |
| זמן יחסי ("לפני 3 דק'") | `Intl.RelativeTimeFormat` + `Intl.DateTimeFormat` (עברית) — מובנה. **לא** date-fns/dayjs |
| עדכון חי (live) | `@supabase/realtime` שכבר בפרויקט (subscribe ל-`webhook_events`). **לא** socket-lib |
| העתקה ללוח | `navigator.clipboard.writeText` — מובנה |
| toasts/notifications | `Toast` (A10). **לא** sonner/react-toastify |
| dialogs/confirm | `Dialog` (A1✅) / `AlertDialog` (A2). **לא** confirm() |
| select/combobox/multiselect | `Select` (A7) / `Combobox` (B1). **לא** react-select/downshift |
| tooltips/popovers/menus | קיימים ✅ / `Popover` (A3). **לא** floating-ui ישיר (Base UI כבר עוטף אותו) |
| scrollbars מותאמים | `ScrollArea` (D4). **לא** os-scrollbar |
| אייקונים | `lucide-react` שכבר בפרויקט |

**מסקנה:** המלצה חד-משמעית — **לא להוסיף אף חבילת UI חדשה**. כל פער-UI ב-KALFA ניתן לגישור מתוך `@base-ui/react@1.6.0` הקיים + Intl/Supabase/navigator המובנים. ההשקעה היחידה היא **עטיפות** ב-`src/components/ui/` לפי סדר סעיף 5.

---

## נספח — ביקורת כיסוי (37/37)

**Portaled (14 · צריך DirectionProvider):** dialog✅, alert-dialog, popover, tooltip✅, menu✅, context-menu, select, drawer, preview-card, toast, navigation-menu, menubar, combobox, autocomplete.
**Inline (23):** accordion✅, collapsible, tabs✅, scroll-area, separator✅, toolbar, field, fieldset, form, input✅, checkbox, checkbox-group, radio (+radio-group), switch, slider, number-field, otp-field, toggle, toggle-group, avatar, progress, meter, button✅.
**Utils (תשתית):** direction-provider, merge-props, use-render (כולם מיובאים גולמית) · csp-provider (nonce ל-CSP — לא בשימוש).
(✅ = כבר עטוף ב-`src/components/ui/`. סה"כ עטוף היום: 8 primitives.)
