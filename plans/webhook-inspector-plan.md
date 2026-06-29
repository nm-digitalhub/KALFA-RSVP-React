# תוכנית מאוחדת — עמוד אדמין "Webhook Inspector" (`/admin/webhooks`)

מסמך-תכנון · גרסה 1 · 2026-06-29 · מצב: **לעיון לפני מימוש** · READ-ONLY (לא בוצע שום שינוי קוד/מיגרציה)
עברית-ראשון, RTL · אדמין-בלבד · קורא את הטבלה המתוכננת `webhook_inbox`

---

## 1. סקירה + תלות-מפתח

המטרה: עמוד אדמין שמ**רשים** (list) ו**בודק** (inspect) אירועי-webhook נכנסים מ-WhatsApp (Meta), מעל הטבלה המתוכננת `webhook_inbox`. כל אבני-הבניין של תשתית-האדמין כבר קיימות וניתנות לשימוש-חוזר ישיר (gate, pagination, primitives, filters, JSON-preview, Sheet). העבודה החדשה מצומצמת לשכבת-נתונים אחת, עמוד, מגירת-פירוט, label-maps, ושורת-NAV.

**🔴 חוסם-קשיח יחיד (Hard Gate) — מיגרציה B: `webhook_inbox`.** הטבלה **אינה קיימת** עדיין: נעדרת מ-`src/` ומ-`supabase/migrations/` (אומת: `grep -rln webhook_inbox src/ supabase/` → NONE), ומוגדרת **רק** כ-SQL מוצע בספֵק §5 (`plans/whatsapp-webhook-hardening-spec.md:43-67`), המסומן במפורש "**מיגרציה — מותנה-אישור, SQL מוצע, לא הורץ**". כל מה שמתחת — ה-Row המוטפס, ה-reader, העמוד, ה-NAV — תלוי בכך שהמיגרציה תוחל ל-DB החי **קודם** (זיכרון: introspect live, never push-from-scratch), ואז `types.ts` יורענן.

**שלושה תיקונים שספֵק §5 משמיט (אומת מקריאת השורות):**
- **(א) הטבלה** — `webhook_inbox` (§5:47-62): `provider, event_kind, dedupe_key, message_id, context_message_id, phone_number_id, event_at, payload jsonb [PII], received_at, processed_at, attempts, last_error`, `unique(provider, dedupe_key)`.
- **(ב) מדיניות RLS אדמין** — §5:65-66 כולל רק `enable row level security` + הערה, **ללא SQL של policy**. RLS-מופעל-ללא-policy = אפס שורות ל-role של ה-cookie client. יש להוסיף `webhook_inbox_admin_all` בנוסח המאומת של `app_settings_admin_all` (`supabase/migrations/202606240005_app_settings.sql:16-20`: `using/with check (public.has_role(auth.uid(),'admin'::app_role))`). **הערה חשובה (ר' §3): ה-reader שלנו ישתמש ב-service-role (createAdminClient) שעוקף RLS — לכן ה-policy היא הגנה-בעומק (defense-in-depth), לא חוסם-קריאה.**
- **(ג) אינדקס לנתיב-הקריאה** — האינדקס היחיד בטיוטה (`webhook_inbox_unprocessed_idx`, חלקי `where processed_at is null`, §5:63-64) משרת את ה-worker (§6), **לא** את רשימת-האדמין הממוינת `received_at desc` על כל השורות. נדרש אינדקס נוסף `webhook_inbox (received_at desc)` (או `(provider, received_at desc)`). זה נדרש ללא קשר לבחירת-הclient.

**שני אבני-דרך נפרדים (לא לבלבל):**
- **"עולה לאוויר" (Ships):** מקמפל + מרנדר עם `EmptyState` — ברגע שטבלה+policy+אינדקס+types+reader+page+nav נחתו.
- **"מציג נתונים" (Shows data):** רק אחרי שמסלול ה-persist-then-process (ספֵק §6, שלב 1) מתחיל להכניס שורות ל-`webhook_inbox`. עד אז הטבלה **ריקה**.

**PII:** ה-payload הגולמי מכיל מידע אישי (טלפונים/שמות אורחים). התצוגה גדורה ע"י `requireAdmin` בליאאוט; ה-reader/page/error-path **לעולם לא** ירשמו ללוג payload/dedupe_key/message_id.

---

## 2. דרישות-מקדימות מקצה-לקצה — צ'קליסט מסודר

הסדר מחייב: 1→2 חוסמים את כל השאר.

| # | פריט | מצב | מקור/יעד |
|---|------|-----|----------|
| 1 | **טבלה `webhook_inbox`** מוחלת ל-DB החי (חלק א של מיגרציה B) | ❌ חסר — **Hard Gate** | ספֵק §5:47-62. דורש אישור-כתיבה (לא אני; read-only/introspect-only) |
| 2 | **policy `webhook_inbox_admin_all`** (חלק ב) — הגנה-בעומק | ❌ חסר (ספֵק משמיט) | בנוסח `202606240005_app_settings.sql:16-20` |
| 3 | **אינדקס `(received_at desc)`** לנתיב-הקריאה (חלק ג) | ❌ חסר (ספֵק משמיט) | מיגרציה B |
| 4 | **רענון `types.ts`** אחרי שהטבלה חיה | ❌ חסר | `src/lib/supabase/types.ts` — ידני (אין npm script), `supabase gen types` / Mgmt API introspection |
| 5 | **gate אימות/הרשאה** — `requireAdmin` על כל תת-עץ `/admin` | ✅ קיים | `src/app/(admin)/admin/layout.tsx:13` → `src/lib/auth/dal.ts:51-62` (has_role RPC) |
| 6 | **client של service-role** ל-PII מאחורי gate | ✅ קיים | `src/lib/supabase/admin.ts` (createAdminClient) — בדיוק כמו `users.ts:116-118` |
| 7 | **חוזה pagination + helper** | ✅ קיים | `src/lib/data/admin/shared.ts:8-32` (PageParams/PageResult/resolvePage) |
| 8 | **primitives של UI** | ✅ קיים | `_components.tsx`: PageHeading/EmptyState/Badge/Pagination/parsePageParam/formatDateTime |
| 9 | **Sheet primitive** (RTL-ready) | ✅ קיים | `src/components/ui/sheet.tsx:39-138` |
| 10 | **forms primitives** | ✅ קיים | `src/components/forms.tsx:5-45` (SubmitButton/FormError/FormNotice) |
| 11 | **reader `webhook-inbox.ts`** | ❌ חסר | חדש — `src/lib/data/admin/webhook-inbox.ts` |
| 12 | **page + drawer** | ❌ חסר | חדש — `src/app/(admin)/admin/webhooks/page.tsx` + רכיבי-client |
| 13 | **שורת NAV** | ❌ חסר | `src/components/admin-shell.tsx:58-72` (להוסיף `{href,label,icon}` + lucide חדש, למשל `Inbox`/`Webhook`) |
| 14 | **label-maps עבריים** | ❌ חסר | `src/lib/data/admin/labels.ts` (event_kind/delivery_status + fallback בטוח-לטקסט-חופשי כמו `callbackStatusLabel:39`) |

---

## 3. ארכיטקטורת-העמוד

### Route
- `src/app/(admin)/admin/webhooks/page.tsx` — server component, ירש את ה-gate מהליאאוט (אין קוד-gate חדש).
- מצב-הפירוט מנוהל ב-URL: `?inspect=<id>` (server-rendered, bookmarkable, focus-trap/Esc חינם מה-Sheet).

### שכבת-נתונים (server, requireAdmin-first)
קובץ חדש `src/lib/data/admin/webhook-inbox.ts`. **בחירת client (החלטה נעולה): service-role `createAdminClient()` מאחורי `requireAdmin()`** — בדיוק הדפוס של `users.ts:116-118` לטבלות PII נעולות. service-role **עוקף RLS**, ולכן:
- ה-reader מחזיר שורות ללא תלות ב-policy → ה-policy מ-§2#2 היא **הגנה-בעומק בלבד, לא חוסם-קריאה**.
- (הכשל "אפס שורות שקט" שייך **רק** ל-combination של cookie-client ללא policy — אנחנו לא שם.)

פונקציות:
1. `listWebhookInbox({ page, kind?, state?, provider?, from?, to?, q? }) → PageResult<AdminWebhookRow>` — `resolvePage` (`shared.ts:21-32`) → `.select(cols, { count: 'exact' }).order('received_at', { ascending: false }).range(from, to)` (בדיוק `users.ts:243-246`/`orders.ts`). **מקרין רק עמודות-תצוגה לרשימה** (id, event_kind, dedupe_key, message_id, context_message_id, phone_number_id, event_at, received_at, processed_at, attempts, last_error) — **דוחה את `payload` המלא ל-detail** (PII off the list, ללא blobs כבדים לכל שורה).
   - פילטרי-שרת (CLAUDE.md: סינון בצד-שרת): `kind` → `.eq('event_kind', …)`; `state` → pending=`processed_at is null AND last_error is null` / processed=`processed_at not null` / error=`last_error not null`; `provider` → `.eq`; `from/to` → `.gte/.lte('received_at', …)`; `q` → `.ilike` על **message_id / context_message_id / phone_number_id בלבד** (לעולם לא על טלפון-אורח).
2. `getWebhookInboxItem(id) → AdminWebhookDetail | null` — רשומה בודדת כולל `payload`, ל-detail (מקבילה ל-`users.ts:165-239 getUserDetail`).

### עמוד-שרת (composition)
`<div className="space-y-6">` + `<PageHeading>` + `<WebhookFilters>` (GET-form) + רשימת-events + `<Pagination queryParams={…}>`. כש-`?inspect` נוכח: `getWebhookInboxItem(id)` בשרת ומרכיב את ה-`InspectorDrawer` עם ה-detail כ-children. `export const metadata = { title }` (`users/page.tsx:7`).

### רכיבי-client (מינימליים — שאר הכל server)
- `InspectorDrawer` — עוטף `Sheet` (`side="right"`), `open = !!searchParams.inspect`, `onOpenChange(false) → router.replace(pathname + filters בלי inspect)`. גוף-הפירוט מרונדר-שרת ומועבר כ-children.
- `PayloadViewer` — reveal-gated (PII), `<pre dir="ltr">{JSON.stringify(payload,null,2)}</pre>`.
- `PhoneReveal` — מסכה ל-4 אחרונים, [הצג] מפורש.
- `CopyButton` — חילוץ של `channels-client.tsx CopyRow:124-150` (navigator.clipboard, zero-dep).
- `RelativeTime` — `Intl.RelativeTimeFormat('he')`; SSR מרנדר absolute (`formatDateTime`), משדרג ל-relative אחרי mount (מונע hydration mismatch).

### החלטת detail-surface (נעולה): מגירה (Sheet), לא sub-route
המשימה אומרת "detail drawer" במפורש ומספקת mockup של מגירה → **מגירה**. משתמשים ב-primitive **הקיים** `src/components/ui/sheet.tsx` — שימוש-חוזר ב-primitive קיים במיקום חדש **אינו** הפרת כלל אי-הכפילות. זהו **השימוש הראשון ב-Sheet בתת-עץ האדמין** (כיום Sheet בשימוש רק בזרימת אישור-הקמפיין של הלקוח) — החלטה מכוונת ומוצדקת ע"י לשון-המשימה, ובטוחה ל-RTL כי `admin-shell.tsx:133` כבר עוטף הכל ב-`DirectionProvider direction="rtl"` (הפורטל יורש RTL; נמנעים ממלכודות Base UI #31). **fallback מתועד:** אם יוחלט לוותר על מגירה, התבנית-האלטרנטיבית היא sub-route `/admin/webhooks/[id]/page.tsx` בנוסח `users/[id]/page.tsx` (requireAdmin בעמוד, notFound, sectionClass, חזרה-לרשימה).

### מפת שימוש-חוזר (reuse map)
| צורך | משתמשים חוזר ב | מקור |
|------|----------------|------|
| gate | `requireAdmin()` בליאאוט | `layout.tsx:13` / `dal.ts:51` |
| client ל-PII | `createAdminClient()` | `admin.ts` (כמו `users.ts`) |
| pagination | `resolvePage` + `Pagination` + `parsePageParam` | `shared.ts:21`, `_components.tsx:70,136` |
| reader-תבנית | `listAllUsers` (search-param) / `listAllOrders` | `users.ts:113-161` / `orders.ts:60-102` |
| רשימת-לוג + פילטרים + JSON | **`activity/page.tsx`** (האנלוג הקרוב ביותר) | `activity/page.tsx:61-180, 276-322` |
| pills | `StatusBadge` (emerald/amber/muted) | `channels-client.tsx:152-171` |
| label-maps | `ORDER_STATUS_LABELS` / `callbackStatusLabel` | `labels.ts:15,39` |
| Sheet | `Sheet*` + שימוש קיים | `ui/sheet.tsx` + `agreement-sheet.tsx:17-37` |
| forms | `SubmitButton/FormError/FormNotice` | `forms.tsx:5-45` |
| copy | `CopyRow` | `channels-client.tsx:124-150` |
| NAV | מערך `NAV` | `admin-shell.tsx:58-72` |

---

## 4. החלטת-חבילות

**אפס חבילות npm חדשות.** כל חמש היכולות מסופקות ע"י built-ins או deps מותקנות:

| יכולת | פתרון | נימוק |
|-------|-------|-------|
| הצגת JSON | `<pre>{JSON.stringify(payload,null,2)}</pre>` בתוך `accordion` קיים (`ui/accordion.tsx`, @base-ui/react — מותקן) | תואם idiom קיים `previewMeta`/`JSON.stringify` (`activity.ts:224-234`). **לא** להוסיף react-json-view (לא-מתוחזק) ולא @uiw/react-json-view — מיותר. trade-off הוגן: `<pre>` נותן pretty-print+collapse אך **לא** הדגשת-תחביר צבעונית; אם צבע נדרש — tokenizer פנימי ~30 שורות, עדיין zero-dep |
| העתקה | `navigator.clipboard.writeText` | precedent: `channels-client.tsx:124-150`, `rsvp-link.tsx:35` |
| זמן-יחסי | `Intl.RelativeTimeFormat('he',{numeric:'auto'})` | אין date-lib ישיר בפרויקט (convention: Intl-only, `_components.tsx:18-26`). title/tooltip = absolute |
| עדכון חי | polling / `router.refresh()` על interval + כפתור-רענון ידני | **לא Supabase Realtime ב-v1:** `postgres_changes` מכבד RLS אך **לא מסנן PII** מה-payload המוזרם ל-browser → מפר את "אין נתונים מורשים נשלפים ישירות ב-browser"; דורש publication חדש; Realtime לא בשימוש בקוד היום. דחייה לעתיד, scoped לאות לא-PII (count בלבד) |
| רשימות גדולות | server-pagination (resolvePage + range + count:'exact') | **לא** virtualization (react-window) — מרמז על טעינת-רשימה-מלאה ל-browser, מפר server-pagination + גבול-PII |

deps מותקנות רלוונטיות (`package.json`): `@base-ui/react ^1.6.0`, `@supabase/supabase-js ^2.108.2`, `lucide-react`, `recharts ^3.8.0`, `zod`. אין date-lib/json-viewer/virtualization — ואין צורך.

---

## 5. מפרט UI/UX

### עמודות-רשימה (idiom נבחר: כרטיסי-לוג כמו `activity`, `<ul className="space-y-3">` + `<li className="rounded-lg border border-border bg-card p-4">`)
`received_at` (RelativeTime + absolute במשני) · `KindBadge` (הודעה/סטטוס) · `ProcessBadge` (pending/processed/error מתוך processed_at+last_error) · `DeliveryBadge` (sent ✓ / delivered ✓ / read ✓✓ / failed ✕ / wrong_number — ציר נפרד מ-payload) · רמז-שיוך **לא-PII** (שם אירוע/קמפיין או "לא שויך") · `message_id` (wamid, `dir="ltr"`, קטוע, ⧉ copy). שורות failed/wrong_number מקבלות פס-התחלה צבעוני (inline-start) + רקע מגוון.

### פילטרים (GET-form, bookmarkable, ללא JS — clone של `activity/page.tsx:61-180`)
hidden `page=1` · חיפוש חופשי `q` (message_id/context_message_id/phone_number_id) · select `סוג` (הכל/הודעה/סטטוס) · select `מצב` (הכל/ממתין/עובד/שגיאה) · select `ספק` · תאריך `מתאריך`/`עד` · כפתורי [סנן]/[ניקוי] · chip של פילטר-פעיל + "הצג הכל". כל פילטר עובר ל-`queryParams` של Pagination.

### מגירת-פירוט (Sheet, side="right", reveal-gated)
SheetHeader: KindBadge+ProcessBadge · סקשנים: **סיכום מפוענח** (סוג/סטטוס/phone_number_id ⧉/dedupe_key ⧉/טלפון-נמען מסוכה+[הצג]) · **מסירה** (status + קוד-Meta גולמי `errors[].code` + סיווג שמרני) · **עיבוד** (attempts/processed_at/last_error `dir="ltr"`) · **payload גולמי** (reveal-gated `<pre dir="ltr">` + ⧉). SheetFooter: כפתור "עיבוד מחדש" — **stub מדורג, ר' §6 (לא בליבה)**.

### States
- **forbidden** = redirect שרת מ-`requireAdmin` (אין UI בעמוד).
- **loading** = skeleton אדמין קיים (`admin/loading.tsx:1-10`) + שורת-skeleton.
- **error** = error boundary אדמין קיים (`admin/error.tsx:1-26`, generic, ללא raw).
- **empty** = `EmptyState` עם נוסח מסונן מול לא-מסונן ("אין אירועי webhook" מול "אין תוצאות לסינון"). **זהו ה-state הצפוי עד שמסלול §6 מתחיל לכתוב.**

### RTL / a11y / privacy
DirectionProvider קיים (admin-shell:133). `dir="ltr"` לאיי-LTR (wamid/phone/phone_number_id/JSON/קודי-Meta). props לוגיים (ps/pe/ms/me). focus ring נראה; פתיחת-מגירה דרך `<Link>`/button נגיש (Enter/Space); Sheet נותן focus-trap/Esc/restore-focus. **Privacy:** טלפון מסוכה-כברירת-מחדל; payload מקופל מאחורי reveal; שום payload/טלפון לא נרשם ללוג; gate = ליאאוט + service-role + policy (defense-in-depth).

### ASCII Mockup

```
===== LIST VIEW (RTL; visually right-anchored) =====
┌─ /admin/webhooks ───────────────────────────────────────────────────────────┐
│  בדיקת Webhooks                                                              │
│  ┌── סינון (server GET form, ?params) ────────────────────────────────────┐ │
│  │ חיפוש: [ message_id / context_message_id / phone_number_id           ] │ │
│  │ סוג:[הכל▾] מצב:[הכל▾] ספק:[whatsapp▾] מתאריך:[__] עד:[__]  [סנן] [ניקוי]│ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│  התקבל            סוג    מצב       מסירה       תיאור / שיוך       wamid       │
│ ─────────────────────────────────────────────────────────────────────────── │
│  לפני 2 דק׳       הודעה  ● עובד    —           תגובה ← «חתונה»    …A1B2 ⧉    │
│ ▌לפני 8 דק׳       סטטוס  ◐ ממתין   ✕ נכשל      מספר שגוי #131026  …9F0D ⧉    │ ← red stripe
│ ▌לפני 9 דק׳       הודעה  ✕ שגיאה   —           לא שויך            …4D5E ⧉    │ ← amber stripe
│  לפני 1 שע׳       סטטוס  ● עובד    ✓✓ נקרא     «קמפיין יוני»      …22E1 ⧉    │
│ ─────────────────────────────────────────────────────────────────────────── │
│                                  עמוד 1 מתוך 12              [הקודם] [הבא]   │
└──────────────────────────────────────────────────────────────────────────────┘
שורה = <Link href="?inspect=<id>&…filters">  (Enter/Space פותח מגירה; aria-label)

===== DETAIL DRAWER (Sheet, side="right") =====
┌─ Sheet ──────────────────────────────────────────────────┐
│ אירוע webhook · סטטוס                       ● עובד  [✕]   │ ← KindBadge+ProcessBadge
│ התקבל 29/06/2026 14:53  ·  אירוע ב-14:52                  │
│ ▸ סיכום מפוענח                                            │
│   סוג: status   סטטוס: failed                             │
│   phone_number_id: 102938…  ⧉                            │
│   טלפון נמען: ••• 4821  [הצג]  (PII)                      │ ← PhoneReveal masked
│   dedupe_key: wa-status:…9F0D:failed  ⧉                  │
│ ▸ מסירה                                                   │
│   ✕ נכשל   קוד Meta: 131026  ⧉   סיווג: מספר שגוי         │
│ ▸ עיבוד                                                   │
│   ניסיונות: 2   processed_at: 14:53                       │
│   last_error: "timeout resolving context"  (dir=ltr)     │
│ ▸ payload גולמי  (PII)             [הצג]  [⧉ העתק]        │ ← reveal-gated
│   ┌──────────────────────────────── dir=ltr ──────────┐  │
│   │ { "object": "whatsapp_business_account",          │  │
│   │   "entry": [ { "changes": [ … ] } ] }             │  │ ← <pre> JSON.stringify(…,2)
│   └────────────────────────────────────────────────────┘ │
│ SheetFooter:                [ עיבוד מחדש ]  (deferred §6) │
└──────────────────────────────────────────────────────────┘
open = נוכחות ?inspect · onClose → router.replace(strip inspect, keep filters)
```

---

## 6. רצף-בנייה מדורג (כל שלב reviewable עצמאית: lint + tsc + vitest + build)

> שער-תשתית (חיצוני, לא-קוד): **אישור מיגרציה B + החלתה ל-DB החי** ע"י בעל-הרשאת-כתיבה (לא אני; read-only). build משתמש ב-`next build --webpack` (לא Turbopack — זיכרון).

**שלב 0 — שער מיגרציה B (חוסם):**
(א) `create table webhook_inbox` (§5); (ב) `webhook_inbox_admin_all` policy (נוסח app_settings); (ג) אינדקס `(received_at desc)`. → אחרי החלה: רענון `types.ts` מהסכימה החיה. *אימות:* `tsc` רואה את ה-Row החדש; `sb-query` מציג את הטבלה.

**שלב 1 — reader + label-maps (ליבה):** `src/lib/data/admin/webhook-inbox.ts` (`listWebhookInbox`+`getWebhookInboxItem`, requireAdmin+createAdminClient, פילטרים+pagination+count) + ערכי-עברית ב-`labels.ts` (event_kind/delivery_status + fallback). + מבחן ממוקד בנוסח `orders.test.ts`/`users.test.ts`. *אימות:* lint+tsc+vitest+build.

**שלב 2 — עמוד-רשימה + פילטרים + NAV (ליבה, "עולה לאוויר"):** `webhooks/page.tsx` (idiom של activity) + `WebhookFilters` + Badges (`_components`) + שורת-NAV (`admin-shell.tsx`, אייקון lucide פנוי `Inbox`/`Webhook`). מרנדר עם `EmptyState` כל עוד הטבלה ריקה. *אימות:* build + בדיקת-דפדפן authed (קונסול נקי — זיכרון verification-gate).

**שלב 3 — מגירת-פירוט (ליבה):** `InspectorDrawer` (Sheet, `?inspect`) + `WebhookDetail` (server) + `PayloadViewer`/`PhoneReveal`/`CopyButton`/`RelativeTime`. *אימות:* פתיחה/Esc/RTL בדפדפן; אין PII בלוג.

**— גבול "list + inspect" (המשימה הליבתית הושלמה) —**

**שלב 4 — שיוך מאצ'-בא (מדורג, תלוי-מיגרציה):** רזולוציית `context_message_id → event/campaign/contact/guest` **batched** (שאילתה אחת על `contact_interactions` עם `provider_id IN (…)`, מיפוי בזיכרון — לעולם לא N+1). **תלות:** עמודות `guest_id`/`context_message_id` הן חלק מ-ALTER ל-`contact_interactions` שגם הוא לא-מוחל (ספֵק §5:69-77). לרצף **אחרי** שהעמודות חיות.

**שלב 5 — "עיבוד מחדש" (מדורג, stub):** server action `reprocessWebhookEventAction` (requireAdmin + Zod id) שמאפס `processed_at=null`, מנקה `last_error`, מעלה `attempts` + `logActivity` + confirm dialog. **תלוי ב-worker של §6 שעדיין לא קיים** → stub מסומן, לא בליבה.

---

## 7. המסמכים הנדרשים

1. **תוכנית זו** — `plans/admin-webhooks-inspector-plan.md` (התכנון המאוחד; להחזרה כאן כטקסט, לא לכתוב כקובץ במסגרת המשימה הנוכחית).
2. **חוזה-נתונים `webhook_inbox`** — מסמך data-contract: כל עמודה (טיפוס/nullable/משמעות), `dedupe_key` format (`wa-msg:<wamid>` / `wa-status:<wamid>:<status>`), חוקי event_kind, RLS (admin/service-role-only), שני האינדקסים (unprocessed חלקי + received_at desc), סימון `payload` כ-PII. בסיס: ספֵק §5.
3. **Runbook אדמין** — `/admin/webhooks`: למה מיועד, מתי ריק (עד §6), פירוש Badges (Process מול Delivery), סיווג `wrong_number` השמרני (ספֵק §8), משמעות "עיבוד מחדש" (stub), והדגשת PII/אי-לוגינג.
4. **תוספת ל-migration B** — תיעוד שלושת-החלקים (טבלה+policy+אינדקס) כיחידת-אישור אחת, כולל הצעת-ה-policy וה-אינדקס שספֵק §5 משמיט.
5. **עדכון תיעוד-מסלולים** — הוספת `/admin/webhooks` למפת-ה-NAV/routes (CLAUDE.md: לעדכן תיעוד כשנוסף route).

---

## 8. סיכונים

- **PII (החמור):** `payload` מכיל טלפונים/שמות. מיטיגציה: gate ליאאוט + service-role-מאחורי-requireAdmin + policy (defense-in-depth); הקרנת-עמודות בלבד לרשימה (payload נדחה ל-detail); reveal-gating ל-payload/טלפון; **איסור מוחלט** על לוג של payload/dedupe_key/message_id ב-reader/page/error-path. q מסנן רק על מזהים-טכניים, לא על טלפון-אורח.
- **גודל-payload:** JSON של Meta עשוי להיות גדול; לעולם לא לשלוח payload מלא לכל שורה ב-list (רק detail-on-demand); pretty-print במגירה בלבד מאחורי reveal. שוקלים תקרת-גודל-תצוגה/קיטוע server-side.
- **נפח:** טבלה append-only שגדלה ללא הגבלה (כל webhook נכנס). האינדקס `(received_at desc)` חיוני ל-`order+range`; pagination בלבד (ללא virtualization). דחיית Realtime ל-v2 (לא לזרום PII ל-browser). שוקלים מדיניות-שמירה/retention עתידית (מחוץ-להיקף-נוכחי).
- **אפס-נתונים מטעה:** הדף "עולה לאוויר" ריק עד §6 — הסיכון שייתפס כתקלה. מיטיגציה: `EmptyState` מובהק + Runbook שמסביר את אבני-הדרך.
- **N+1 / טעינת-רשימות:** שיוך (שלב 4) חייב להיות batched; per-row resolve אסור (CLAUDE.md).
- **תלות-רצף:** types-regen רק אחרי החלת-טבלה חיה; שלבים 4-5 תלויים ב-ALTER/worker שאינם מוחלים — לא לבנות מולם לפני שהם קיימים.

---

קבצים רלוונטיים (absolute): `/var/www/vhosts/kalfa.me/beta/plans/whatsapp-webhook-hardening-spec.md` (§5 schema, §6/§10 רצף) · `/var/www/vhosts/kalfa.me/beta/src/lib/data/admin/{shared,users,orders,labels}.ts` · `/var/www/vhosts/kalfa.me/beta/src/app/(admin)/admin/{activity,orders,users/[id]}/page.tsx` · `/var/www/vhosts/kalfa.me/beta/src/app/(admin)/admin/_components.tsx` · `/var/www/vhosts/kalfa.me/beta/src/components/{admin-shell,forms}.tsx` · `/var/www/vhosts/kalfa.me/beta/src/components/ui/{sheet,accordion}.tsx` · `/var/www/vhosts/kalfa.me/beta/src/lib/supabase/admin.ts` · `/var/www/vhosts/kalfa.me/beta/src/lib/auth/dal.ts` · `/var/www/vhosts/kalfa.me/beta/supabase/migrations/202606240005_app_settings.sql` (נוסח policy).