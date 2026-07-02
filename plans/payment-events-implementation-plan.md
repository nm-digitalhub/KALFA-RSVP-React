# payment_events — תוכנית מימוש מלאה

**מצב:** תכנון בלבד. לא הוחל שום migration, לא נכתב קוד. ממתין לאישור מפורש
לפני יישום (בהתאם לכלל הפרויקט לשינויי DB). **לכן** רשימת-התיוג ב-§5 (כולל
9 סעיפי-אימות RLS) היא מפרט-לביצוע-לאחר-מימוש, לא טסטים שכבר נכתבו/רצו —
זה תואם את כלל "אל תתחיל מימוש" במפורש, לא פער בביקורת.

**היקף:** רק `/admin/sumit-test` (כלי אבחון ה-POC). **לא** נוגע ב-
`authorize.ts`/`capture.ts`/`charge.ts` הייצוריים בשלב הזה — במובן של
**לא עורך** את הקבצים האלה. הסכימה מתוכננת להיות ניתנת-להרחבה לשם כך
מאוחר יותר (עמודות nullable + `source` discriminator), אך שום קוד ייצורי
לא ישתנה כעת.

**אימות-בידוד (ביקורת עשירית, נדרש ע"י המשתמש — "המסמך אינו מציג את כל
ה-callers"):** `grep -rn "from '@/lib/sumit/raw-charge'" src/` → 3 תוצאות
בלבד: `route.ts` (הצרכן היחיד בקוד-ייצור), `route.test.ts`,
`raw-charge.test.ts` — **אין אף קריאה מ-authorize/capture/charge.ts או
מכל נתיב-תשלום ייצורי אחר**. השינוי היחיד ש-§4 מציע ל-`charge.ts` עצמו
הוא **ייבוא** חד-כיווני של `SumitNetworkError` הקיים-כבר-מיוצא-משם (לא
עריכה של `charge.ts`) — `raw-charge.ts` **קורא** מ-`charge.ts`, לא
משנה אותו; אפס סיכון-רגרסיה לנתיבי-תשלום אמיתיים.

**הבהרה ארכיטקטונית חשובה (התגלתה בסקירה):** ל-`orders`/`campaigns` **כבר
יש** היום דפוס קיים של שמירת שדות SUMIT כעמודות ישירות על השורה עצמה —
למשל `campaigns.sumit_charge_document_id`/`charge_auth_number`/
`charge_payment_id` (מיגרציה `202606290027_charge_findings.sql`) ו-
`orders.sumit_document_id`/`payment_attempt_ref` (`202606240003_order_payment_flow.sql`).
`payment_events` הוא דפוס **נוסף ומכוון**, לא תחליף — יומן-ביקורת append-only
של **כל ניסיון** (כולל כשלונות), לעומת העמודות הקיימות שהן מצב-נוכחי בלבד
על השורה. אין כפילות בהיקף הנוכחי (admin_poc בלבד, לא קשור ל-campaign
אמיתי) — אך כשמרחיבים בעתיד ל-production, יש להחליט במפורש אם payment_events
משלים את העמודות הקיימות או מתחיל להחליף אותן.

**מקור:** מבוסס במלואו על `docs/sumit-response-capture-and-audit.md` §4B/§4C
(שנכתב 2026-07-01, מאומת מול swagger.json חי) — תוכנית זו רק ממירה אותו
למפרט מימוש קונקרטי, תוך אימות נוסף מול מוסכמות ה-DB בפועל בפרויקט.

---

## 1. מה נבדק ואומת (לא הנחות)

| נושא | איך אומת | ממצא |
|---|---|---|
| דפוס RLS ל-admin-only | סוכן-סקירה: השווה `otp_challenges`, `message_templates`, `webhook_inbox` | **`drop policy if exists <name> ...; create policy <name> ...`** הוא הדפוס הנפוץ (2/3 דוגמאות: `otp_challenges`, `message_templates`); ה-`do $$ ... exception` שראיתי ב-`webhook_inbox` הוא variant בודד. עדכנתי את §2 להשתמש בדפוס הנפוץ |
| `has_role` עדיין בתוקף (לא הוחלף ע"י `has_org_permission`) | grep על כל migrations אחרי `org_multitenancy` (202606280021) + קריאת `src/lib/auth/dal.ts` + חתימה מ-`types.ts:1823` | כן — `requireAdmin()`/`isAdmin()` עדיין קוראים ל-`has_role` RPC ישירות; `has_org_permission()` הוא מערכת נפרדת ל-scoped org perms, לא תחליף. `app_role` enum = `"admin" \| "user"` בלבד |
| פורמט timestamp למיגרציה חדשה | `ls supabase/migrations/` כרונולוגית, מאומת ע"י תאריכי git | עבר מ-12 ספרות ידניות ל-14 ספרות (`supabase migration new`) החל מ-2026-06-30 — **להשתמש בפורמט החדש** |
| `createAdminClient()` | `src/lib/supabase/admin.ts` | קיים, service-role, בייפאס RLS — לשימוש בכתיבה |
| דפוס insert/update קיים | `recordCampaignHold` ב-`src/lib/data/campaigns.ts:339` | `createAdminClient().from(...).insert/update(...)`, זורק שגיאה בעברית ב-failure |
| `logActivity()` מתאים כתחליף ל-payment_events? | `src/lib/data/activity.ts:35` + סוכן-סקירה | **לא כתחליף** — דורש `requireUser()` session (לא ריצה מהקשר service-role/webhook), אוסר במפורש PII/tokens. **כן כתוספת**: הדפוס הקיים ב-`admin/webhooks/actions.ts` הוא לכתוב לטבלה הייעודית דרך `createAdminClient()` **וגם** לקרוא ל-`logActivity()` בנפרד עם `meta` בטוח (ids/amounts, לא נתוני כרטיס) — כדי שהאירוע יופיע גם בפיד הפעילות הכללי. מוצע כתוספת אופציונלית (§4) |
| FK convention (cascade מול set null) | סוכן-סקירה: `contact_interactions`/`billing_credits` ב-`org_multitenancy.sql` | **cascade** כששורה חסרת-משמעות בלי ההורה (billed_results); **set null** כשזו רשומת יומן עצמאית שצריכה לשרוד מחיקת הורה (contact_interactions, billing_credits) — payment_events הוא המקרה השני, `on delete set null` נכון |
| מוסכמת שם אינדקס | סוכן-סקירה: grep על כל `*_idx` בכל המיגרציות | **סיומת** `<table>_<col>_idx` (17 מופעים, למשל `webhook_inbox_received_idx`) — **לא** קידומת `idx_<table>_<col>` (מופיע פעם אחת בהערה בלבד, לא בקוד בפועל). כבר השתמשתי בסיומת הנכונה ב-§2 |
| jsonb columns | `webhook_inbox.payload jsonb not null`, `contact_interactions.payload_meta jsonb` | ישיר, בלי CHECK constraint, בלי GIN index, בלי type constraint — הגבול "רק non-sensitive" נאכף ע"י **קומנט/מוסכמה בלבד**, לא ע"י ה-DB. תואם למסמך המקור |

---

## 1א. Audit — קוד ידני מיותר במקום מנגנון מובנה

בוצע לפי דרישה מפורשת, **לפני** נעילת התוכנית. שני ממצאים אמיתיים, מתוקנים
בגרסה זו:

1. **טיפוסי TypeScript** — כל פונקציית data קיימת בפרויקט (`recordCampaignHold`
   ב-`campaigns.ts:19,621`, `activity.ts:7`, `webhooks.ts:14`, וכו') מקלידה את
   ה-payload דרך `Database['public']['Tables']['<table>']['Insert'/'Update'/'Row']`
   — הטיפוסים **המיוצרים אוטומטית** (`supabase gen types`) — **לא** interface
   ידני מקביל. התוכנית המקורית לא ציינה זאת במפורש. **תוקן:** §4 ו-§8 עכשיו
   דורשים במפורש הרצת `gen types` אחרי המיגרציה, ושימוש ב-
   `Database['public']['Tables']['payment_events']['Insert']`.

2. **אידמפוטנטיות** — `webhooks.ts:27-29` כבר פותר בדיוק את הבעיה הזו (מניעת
   רישום כפול לפי מפתח-קורלציה) עם המנגנון **המובנה** של supabase-js:
   `.upsert(rows, { onConflict: 'provider,dedupe_key', ignoreDuplicates: true })`
   — לא `.insert()` פשוט + טיפול-שגיאות ידני. התוכנית המקורית הציעה `.insert()`
   בלי הגנת ייחודיות בכלל. **תוקן:** `correlation_id` עכשיו UNIQUE (§2), ו-§4
   עכשיו משתמש ב-`.upsert(row, { onConflict: 'correlation_id', ignoreDuplicates: true })`.

3. **כפילות עזר (`asObj`/`present`/`firstItem`)** — `redact-for-storage.ts`
   המתוכנן (§3) היה מגדיר מחדש 3 פונקציות-עזר גנריות שכבר קיימות ב-
   `safe-preview.ts`. אין בהן היגיון אבטחתי (טהורות, type-narrowing בלבד) —
   **תוקן:** מיוצאות מ-`safe-preview.ts` ומיובאות ב-`redact-for-storage.ts`,
   במקום כפילות.

4. **Zod ב-`recordPaymentEvent`?** נשקל ונדחה במכוון — הפונקציה מקבלת נתונים
   שכבר נגזרו מ-`chargeRaw()` הפנימי, לא קלט חיצוני גולמי. Zod שם יהיה
   ולידציה כפולה, לא גבול-מערכת אמיתי (עקבי עם "ולידציה רק בגבולות" ב-
   CLAUDE.md). **לא תוקן — נשאר כפי שהיה, במכוון.**

5. **Enum מובנה (Postgres `type ... as enum`) מול `text + check`?** נבדק —
   הפרויקט משתמש בשניהם, תלוי הקשר: enum אמיתי לעמודות-ליבה יציבות
   (`campaign_status`, `app_role`), אך `text + check`/הערה בלבד לעמודות
   audit-log מתפתחות (`webhook_inbox.event_kind`, `.provider`). `outcome`/
   `source` שלנו הם מהסוג השני (עשויים להתרחב) — **`text + check` נכון,
   לא ממצא**.

---

## 1ב. ביקורת שנייה — עצמאית, מבוססת-ראיות (2026-07-02)

בוצע לפי דרישה מפורשת שלא לקבל שום קביעה קודמת (כולל §1א) כאמת מראש.
**§1א הייתה חלקית/שגויה בנקודה מהותית אחת (ממצא 2). כל הממצאים כאן משנים
את §2-§5 בפועל, לא רק תיעוד.**

**ממצא 1 — "בלתי-ניתן-לשינוי" הוא כוונה, לא אכיפה.** ה-RLS policy הקודמת
(`for all`) כוללת UPDATE/DELETE — Postgres `FOR ALL` = כל הפקודות
([PostgreSQL RLS docs](https://www.postgresql.org/docs/current/sql-createpolicy.html)).
נבדק תקדים דומה בפרויקט עצמו: `rsvp_responses`, המתועד "(g) append-only audit
row" (`202606290034_rsvp_harden.sql:303`, `20260630164747_...sql:240`) — גם
שם **אין** `revoke update`/trigger, רק RPC שקורא ל-INSERT ולא UPDATE.
**פסיקה: מופרכת בחלקה.** עקבי עם מוסכמת הפרויקט (לא סטייה), אבל לא אכיפה
אמיתית. **תוקן ב-§2 (עודכן שוב בביקורת עשירית):** RLS ל-select-בלבד
לאדמין (לא `for all`, ולא `insert` כלל) — מונע עדכון/מחיקה **וגם**
יצירה **דרך ה-cookie client**. `service_role` (`createAdminClient`)
עוקף RLS לגמרי תמיד — שום policy לא יכולה למנוע ממנו; אכיפה מלאה תדרוש
trigger ייעודי, **אין לזה תקדים בפרויקט**, ולכן זו **החלטת-מוצר** (§7),
לא תוקנה כברירת מחדל.

**ממצא 2 — §1א שגויה: ה-upsert לא מונע חיוב כפול.** `route.ts:190` יוצר
`correlation_id` **מחדש בכל בקשת HTTP** (`poc-${Date.now()}`) — לא מפתח יציב
שנשלח מהלקוח ונשמר גם ב-retry. `grep -ni idempoten swagger.json` → **0
תוצאות**: ל-SUMIT עצמו **אין** מנגנון idempotency-key. `sumit-test-form.tsx`
— טופס מסלול B (הכפתור "חייב טוקן שמור") **חסר לגמרי** הגנת שליחה-כפולה
(`disabled`/`submitting`, שקיימת רק בטופס 1, שורות 281-282).
**פסיקה: §1א טענה (במרומז) שהתיקון פותר אידמפוטנטיות — זה שגוי.** ה-upsert
מונע **שורת-ביקורת** כפולה בלבד; הוא רץ **אחרי** ש-`chargeRaw()` כבר חייב.
**סיכון ממשי:** לחיצה כפולה = שתי עסקאות אמיתיות ונפרדות ב-SUMIT, בלי שום
הגנה בשום שכבה. **תוקן/נדרש:** (א) להוסיף `disabled`/`submitting` לטופס
מסלול B — **שינוי קוד נדרש**, מחוץ להיקף `payment_events` עצמו אך תלוי-בו
מבחינת חומרה. (ב) הגנה מלאה (רב-טאב/רב-מכשיר) דורשת נעילת-שרת — **החלטת-
מוצר**, לא נכללת.

**ממצא 3 — `correlation_id` אינו "מפתח אידמפוטנטיות".** נגזר מ-`Date.now()`
בשרת, לא נוצר פעם אחת אצל הלקוח ונשמר ב-retry — לכן **לא יכול מבנית** לשמש
לזיהוי "זו אותה בקשה שוב". **פסיקה: חלקית** — כמזהה-רשומה ל-DB תקין (עם
UNIQUE); כהגנת-אידמפוטנטיות לא מתאים. **תוקן:** התיעוד לא יקרא לזה
"idempotency key" יותר.

**ממצא 4 — `document_download_url` מבוסס הנחה לא-מאומתת.** `swagger.json:8668`
לא מתעד אם ה-URL חתום/פג-תוקף. `docs/sumit-response-capture-and-audit.md:48`
קבע "safe (signed link)" **בלי אימות** מול הסכימה. **פסיקה: הנחה לא-מאומתת
שעברה בירושה מהמסמך המקורי, ולא נבדקה על ידי.** **תוקן ב-§3:** הושמט
מרשימת ההתרה עד לאימות ישיר (בדיקה חיה: לבדוק אם ה-URL מכיל טוקן/תפוגה).

**ממצא 5 — כפילות מיפוי אמיתית, לא רק ניסוח.** §1א/§4 הקודמים כתבו "נגזרים
מ-redacted **באותו אופן** (השמטתי לקיצור)" — לא קוד בפועל. אם המימוש יפרסר
`raw` פעמיים (פעם לעמודות, פעם ל-jsonb), התוצאות עלולות לסטות. **תוקן ב-§4:**
קוד מפורש — עמודות מנורמלות נגזרות **מתוך** `redacted`, לא מפירסור שני.

**ממצא 6 — פער בחוזה השגיאות.** `console.error` המתוכנן לא כלל
`correlationId`, בניגוד לתקדים (`authorize/route.ts:170`,
`console.error('[hold] failed...', { campaignId })`). **תוקן ב-§4.**

**ממצא 7 — תוכנית הבדיקות לא כיסתה את הסיכונים האמיתיים.** לא נבדקו: שליחה
כפולה/מקבילית (ממצא 2), כשל-רשת, payload מעוות/ענק, אימות ש-audit-failure
לא חוסם. **תוקן ב-§5.**

**נבדק ונמצא תקין (לא ממצא):** חוזה-שגיאות `throw`-then-`catch`-ולבלוע ב-
`recordPaymentEvent` — עקבי עם תבנית הפרויקט (הפונקציה זורקת כחוזה כללי,
הקורא הספציפי בוחר לבלוע ל-best-effort). כפילות `outcome` union ב-TS מול
CHECK ב-SQL — לא ניתנת למניעה עם `gen types` (לא הופך CHECK ל-union), הגנה
כפולה מכוונת, לא ממצא.

---

## 2. סכימה — `payment_events`

```sql
create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),

  -- היקף: nullable כרגע (admin POC אינו קשור לקמפיין אמיתי). FK מוכן להרחבה
  -- עתידית לחיווט authorize.ts/capture.ts, ללא שינוי סכימה נוסף.
  campaign_id uuid references public.campaigns(id) on delete set null,
  source text not null default 'admin_poc'
    check (source in ('admin_poc', 'campaign_hold', 'campaign_charge')),

  correlation_id text not null,      -- Customer.ExternalIdentifier ששלחנו
  http_status int,                    -- res.status מ-SUMIT; null אם לא הגענו לתגובה (כשל רשת)

  -- נגזר מ-isSumitSuccess() הקיימת כבר ב-route.ts (Status===0 && ValidPayment===true) —
  -- שימוש חוזר באותה לוגיקה, לא הגדרה כפולה. 'unknown' = תגובת SUMIT אבדה
  -- אחרי שהבקשה כבר נשלחה — ייתכן שחויב בפועל, לא ידוע (ביקורת שלישית, §4).
  outcome text not null check (outcome in ('success', 'failed', 'error', 'unknown')),

  sumit_status int,                   -- Status הגולמי (0/1/2) — מספרי בפועל, מאומת חי
  valid_payment boolean,
  payment_id bigint,
  document_id bigint,
  customer_id bigint,                 -- Data.CustomerID (top-level)
  auth_number text,                   -- בטוח לשמירה לפי המסמך (§3) — ערך אמיתי, לא boolean
  amount numeric,
  currency int,                       -- enum גולמי מ-SUMIT (0=ILS וכו')
  card_last4 text,
  had_saved_token boolean not null default false,  -- נוכחות בלבד — לעולם לא הטוקן עצמו

  request_summary jsonb,              -- תוצאת summarizeSumitRequest() הקיימת (reuse)
  raw_response jsonb,                 -- תוצאת redactSumitResponseForStorage() החדשה (ראו §3)

  created_at timestamptz not null default now()
);

-- UNIQUE (not just indexed): NOT an idempotency key (see §1ב/§4/§4ד — it's
-- generated fresh per HTTP request, so it can never catch a duplicate charge
-- attempt). It's a per-attempt audit anchor; the UNIQUE constraint exists only
-- to make the audit write itself replay-safe (matches webhook_inbox's
-- unique(provider, dedupe_key)) via upsert(..., { onConflict, ignoreDuplicates:
-- true }) in §4, instead of hand-rolled duplicate-row checking.
create unique index if not exists payment_events_correlation_idx
  on public.payment_events (correlation_id);
create index if not exists payment_events_created_idx
  on public.payment_events (created_at desc);
create index if not exists payment_events_campaign_idx
  on public.payment_events (campaign_id) where campaign_id is not null;

alter table public.payment_events enable row level security;

-- Admin-only READ access. All writes happen via createAdminClient()
-- (service-role, bypasses RLS entirely) from recordPaymentEvent() — there is
-- no legitimate feature where an admin needs to write a payment_events row
-- directly via the cookie-authenticated client. No INSERT policy at all is
-- granted to admins.
--
-- ביקורת שנייה (2026-07-02): הביקורת הקודמת שלי השתמשה ב-`for all`, שכולל
-- UPDATE/DELETE — סתירה ישירה לכוונת "append-only" (ראו §1ב ממצא 1). תוקן
-- ל-select-בלבד (לא select+insert): מונע עדכון/מחיקה **וגם** יצירה דרך
-- ה-cookie client (אין תקדים כזה בפרויקט ל-`for all` על audit-log, ולא
-- מוצדק פה). זו הגנה חלקית בלבד — service-role עדיין עוקף RLS לגמרי; אין
-- בפרויקט trigger שאוכף אי-שינוי גם נגד service-role (ראו §1ב ממצא 1 —
-- "append-only" בפרויקט כולו הוא כוונה, לא אכיפת DB).
--
-- ביקורת עשירית (2026-07-02) — תוקן שוב: הגרסה הקודמת של המדיניות הזו כללה
-- גם `for insert` לאדמין דרך cookie-client. זה מיותר ומסוכן: מכיוון שהכתיבה
-- היחידה המתוכננת היא מ-`recordPaymentEvent()` דרך service-role (עוקף RLS
-- ולא תלוי במדיניות הזו כלל), מתן INSERT לאדמין דרך cookie-client פותח
-- וקטור-זיוף מיותר — אדמין (או session גנוב) יכול ליצור שורת-ביקורת
-- שלא נובעת מקריאה אמיתית ל-SUMIT, בלי שום תועלת תפקודית מקבילה.
-- הוסר לגמרי — SELECT הוא היחיד שאדמין מקבל דרך ה-cookie client.
drop policy if exists payment_events_admin_select on public.payment_events;
create policy payment_events_admin_select on public.payment_events for select
  using (public.has_role(auth.uid(), 'admin'::app_role));
drop policy if exists payment_events_admin_insert on public.payment_events;
```

**במכוון נעדר** (תואם §4B/§4C במסמך המקור): `CreditCard_Token` (רק
`had_saved_token` boolean), `CreditCard_CitizenID` (לא בכלל — לא אפילו
boolean, בהתאם לעיקרון "עותק יחיד על campaigns"), `CreditCard_Number`/`CVV`/
`Track2` (לעולם לא, אם כי SUMIT ממילא לא מחזיר אותם).

**קובץ המיגרציה ייווצר עם** `supabase migration new payment_events` (מייצר
timestamp בפורמט הנוכחי אוטומטית) — לא ידנית.

### 2א. נימוק שדה-שדה (ביקורת רביעית — לכל עמודה: צורך, הרשאות צפייה, שימור)

כל השדות: **הרשאות צפייה זהות** (admin בלבד, RLS select-בלבד דרך
cookie-client; כתיבה רק דרך service-role — תוקן בביקורת עשירית), **שימור
זהה** (permanent — אין מדיניות מחיקה-אוטומטית מתוכננת; זהו יומן-ביקורת,
לא נתון-בר-מחיקה-לפי-בקשה). הטבלה מתמקדת בעמודת "צורך" הייחודית לכל שדה.

| שדה | צורך עסקי/תפעולי/חשבונאי מדויק |
|---|---|
| `id`, `created_at` | טכני — מפתח וחותמת-זמן. |
| `campaign_id`, `source` | היקף/סיווג — nullable כרגע, מוכן להרחבה עתידית. |
| `correlation_id` | עוגן-מעקב לכל ניסיון (לא "מפתח אידמפוטנטיות" — ראו §1ב). |
| `http_status` | אבחוני — מבדיל תקלת-HTTP מתקלה עסקית. |
| `outcome` | סינון-מהיר לאדמין; 5 הקטגוריות המפורטות ב-§4א למטה. |
| `sumit_status`, `valid_payment` | "מגלה-הדחייה האמיתי" לפי המסמך המקורי §3 — `Status`/`ValidPayment` הם ההבדל בין HTTP 200 להצלחה עסקית אמיתית (ראינו את זה חי: 4/4 ניסיונות נכשלו עם HTTP 200). |
| `payment_id`, `document_id`, `customer_id` | **מפתחות התאמה של SUMIT עצמו** — נדרשים כדי לשאול את `/billing/payments/get/` (דורש `PaymentID` בדיוק — מאומת ב-swagger.json, `required:["Credentials","PaymentID"]`) במקרה של מחלוקת. |
| `auth_number` | מספר-האישור הסטנדרטי שרשתות-האשראי/עסקים מבקשים במחלוקת/chargeback — הצידוק החזק ביותר בטבלה. |
| `amount`, `currency` | בדיקת-הצלבה מול מה שהתכוונו לחייב (גילוי פער). |
| `card_last4` | תמיכת-לקוחות ("איזה כרטיס חויב") — כבר ממוסך, בטוח מבחינת PCI. |
| `had_saved_token` | אבחוני בלבד — מבדיל מסלול A/B; **בוליאני, לא הטוקן עצמו**. |
| `request_summary` (jsonb) | "מה ביקשנו בפועל" — allow-list קיים (`summarizeSumitRequest`), reuse. |
| `raw_response` (jsonb) | שדות "בטוחים לשמירה" (§3 במסמך המקור) **שלא קודמו לעמודה מוקלדת**: `payment.date`, `payment.status_description`, `payment_method.type`, `document_number`, `user_error_message`, `technical_error_details`, `expiration_month/year`. **לא כפילות** של העמודות המוקלדות — משלים אותן. |

**נימוק חלש שזוהה (לא הוסר, מתועד כפער-ידוע):** `expiration_month`/
`expiration_year` — מסווגים "OK to store" במסמך המקור (§3, "cardholder
data"), אך **אין היום שימוש תפעולי בפועל** בהם בהיקף admin_poc (אין חיוב
חוזר/subscription כאן). הצידוק הוא "מותר" לא "נדרש". **החלטת-מוצר**: להשאיר
(עלות-אחסון זניחה, יישור עם §3) או להסיר (מינימיזציה מחמירה יותר)?

**`user_error_message`/`technical_error_details` — פער-אורך לא-פתור:**
`swagger.json:11228,11235` — ללא הגבלת אורך מתועדת (ראו ביקורת שלישית).
לא הוגבל אורך לפני אחסון. **החלטת-מוצר** (§9) אם להוסיף `substring(...,500)`
לפני האחסון.

---

## 3. מודול redaction חדש לאחסון — `src/lib/sumit/redact-for-storage.ts`

**שונה מ-`safe-preview.ts` הקיים** (זה לתצוגה בדפדפן — מחמיר יותר, למשל
`AuthNumber`/`payment_id` כ-boolean בלבד). זה לאחסון DB — server-only,
מאחורי RLS — ומותר לו לשמור יותר, לפי הסיווג המדויק במסמך המקור §3.

עקרון זהה לזה שכבר קיים ב-`safe-preview.ts`: **projection מפורש בלבד, אין
walker גנרי** — כל שדה מוקצה בנפרד משם ידוע, כדי ששדה עתידי לא-מוכר לעולם לא
יזלוג.

**עדכון-audit:** `asObj`/`present` מיוצאות מ-`safe-preview.ts` (לא מוגדרות
מחדש) — הן פונקציות-עזר טהורות, ללא היגיון אבטחתי, ולכן אין סיבה לכפול אותן.
`safe-preview.ts` מקבל `export` על שתיהן; `redact-for-storage.ts` מייבא.

```ts
import 'server-only';
import { asObj, present } from '@/lib/sumit/safe-preview';

type Obj = Record<string, unknown>;

// לאחסון DB בלבד (RLS admin-only). AuthNumber/last4/expiry הם ערכים אמיתיים
// (בטוחים לפי המסמך) — בניגוד לגרסת הדפדפן ב-safe-preview.ts. הטוקן וה-ת״ז
// עדיין לעולם לא נשמרים כאן (עותק יחיד חי רק ב-campaigns, לא כפול).
export function redactSumitResponseForStorage(raw: unknown): Obj {
  const r = asObj(raw);
  if (!r) return { non_object_response: true };
  const data = asObj(r.Data);
  const pay = data ? asObj(data.Payment) : null;
  const pm = pay ? asObj(pay.PaymentMethod) : null;
  return {
    status: r.Status ?? null,
    user_error_message: r.UserErrorMessage ?? null,
    technical_error_details: r.TechnicalErrorDetails ?? null,
    document_id: data?.DocumentID ?? null,
    document_number: data?.DocumentNumber ?? null,
    customer_id: data?.CustomerID ?? null,
    // document_download_url: הושמט בביקורת השנייה (§1ב ממצא 4) — swagger.json
    // לא מתעד אם זה קישור חתום/פג-תוקף; ההנחה "safe (signed link)" במסמך
    // המקורי לא אומתה. אם יאומת עתידית שהוא חתום/פג-תוקף, אפשר להוסיף בחזרה.
    payment: pay
      ? {
          id: pay.ID ?? null,
          date: pay.Date ?? null,
          valid_payment: pay.ValidPayment ?? null,
          status: pay.Status ?? null,
          status_description: pay.StatusDescription ?? null,
          amount: pay.Amount ?? null,
          currency: pay.Currency ?? null,
          auth_number: pay.AuthNumber ?? null, // ערך אמיתי — בטוח (§3)
        }
      : null,
    payment_method: pm
      ? {
          type: pm.Type ?? null,
          card_last_digits: pm.CreditCard_LastDigits ?? null,
          card_mask: pm.CreditCard_CardMask ?? null,
          expiration_month: pm.CreditCard_ExpirationMonth ?? null,
          expiration_year: pm.CreditCard_ExpirationYear ?? null,
          had_saved_token: present(pm.CreditCard_Token), // boolean בלבד
          // CreditCard_CitizenID: מושמט לגמרי, גם לא boolean.
          // CreditCard_Number/_CVV/_Track2: מושמטים (הגנה כפולה — ממילא null מ-SUMIT).
        }
      : null,
  };
}
```

**טסטים (TDD, כמו `safe-preview.test.ts`):** ערכי sentinel בכל שדה אסור,
אימות `JSON.stringify` לא מכיל את ה-sentinel, ואימות ש-`auth_number` **כן**
מוחזר בערכו האמיתי (ההפך מהבדיקה המקבילה ב-safe-preview.test.ts — כדי לתפוס
רגרסיה משני הכיוונים).

### 3א. סגירת נושא 3 במפורש (ביקורת שביעית) — רשימת-התרה, ולידציה בזמן ריצה, שדות מיותרים

ה-goal דרש לבדוק 5 צירים לכל שדה: טיפוס / אורך / ערך-חוקי / מבנה-לא-מקונן
/ העדר-מידע-רגיש. הראיות היו כבר פזורות ב-§2א/§3/§4 בסבבים קודמים —
כאן הן מרוכזות במפורש עם קביעה חד-משמעית לכל ציר, כדי שלא יישאר תלוי-באוויר.

**רשימת-התרה סגורה בפועל (לא רק שמות-שדות) — מאומת:** קריאה ישירה של
`redactSumitResponseForStorage()` (§3, שורות 287-328) מאשרת: **אין**
`...spread`, **אין** `Object.keys`/walker גנרי, **אין** העברת `raw`/
`data`/`pay`/`pm` כמות-שהם. כל מפתח בפלט מוקצה בנפרד מנתיב-מקור נקוב
בשם (`r.Status`, `data?.DocumentID`, `pay.AuthNumber` וכו') — שדה עתידי
לא-צפוי מ-SUMIT (שינוי סכימה בצד שלהם) **לא יכול** לזלוג, כי שום קוד לא
מעתיק מפתחות-שלא-נקראו-בשם. זהה לעיקרון שכבר קיים ומאומת ב-`safe-
preview.ts`. **קביעה: כן, סגורה בפועל.**

**טיפוס (type) — מאומת חלקית, לפי סוג העמודה, בכוונה:**
- עמודות מוקלדות (`sumit_status`/`valid_payment`/`payment_id`/
  `document_id`/`customer_id`/`auth_number`/`amount`/`card_last4`):
  `asFiniteNumberOrNull`/`asBooleanOrNull`/`asStringOrNull` (§4,
  שורות 400-408) בודקות `typeof`-בזמן-ריצה **אמיתי**, לא רק `as`.
  ערך מסוג object/array/כל דבר-שאינו-הטיפוס-הצפוי **נדחה במפורש ל-
  `null`** (לא מאוחסן כמות-שהוא) — מאמת ישירות את שאלת ה-hook "האם
  שדה שאמור להיות טקסט/מספר/בוליאני יכול בפועל להכיל אובייקט/מערך":
  **לא, לעמודות המוקלדות** — הבדיקה חוסמת זאת structurally.
- עמודות `jsonb` (`raw_response`/`request_summary`): **במכוון ללא**
  בדיקת-טיפוס לכל תת-שדה פנימי (`payment.status_description`,
  `payment.date` וכו') — הוכרע כבר בסבב קודם (§9, "שינויים שאינם
  נדרשים") שזו קטגוריה נכונה-מיועדת, לא פער: jsonb מיועד לקבל כל
  צורת-JSON תקינה, "מבנה-לא-מקונן" כדרישה לא רלוונטית ל-jsonb מטבעו —
  ה-nesting עצמו (`payment.{...}`, `payment_method.{...}`) הוא מכוון
  ותיעודי, לא תקלה. **קביעה: תואם את ההיגיון של jsonb, לא פער.**

**אורך (length) — פער ידוע, כבר מתועד, לא נפתר החדש:** `user_error_
message`/`technical_error_details` — `swagger.json` ללא הגבלת-אורך
מתועדת (ביקורת שלישית), ומאוחסנים ב-`raw_response` **בלי חיתוך**. זו
כבר החלטת-מוצר פתוחה (§9 סעיף 6, "לא כרגע — אין ראיה לבעיה בפועל").
עמודות טקסט אחרות (`auth_number`/`card_last4`/`correlation_id`) הן
`text` ללא CHECK-אורך ב-DB (§2) — **לא** סווג כפער חדש: אלה שדות
קצרים-מטבעם (מספר-אישור/4-ספרות-אחרונות/UUID-מבוסס), לא טקסט-חופשי,
ואין תרחיש-סביר שבו SUMIT יחזיר בהם בלוק-ענק — בניגוד ל-`UserError
Message` שהוא טקסט-חופשי-מיועד ולכן כן רלוונטי שם.

**ערך-חוקי (valid value) — לא נאכף לעומק, במכוון:** `sumit_status`
מקבל כל `number` סופי, לא רק `{0,1,2}` המתועדים ב-swagger — אם SUMIT
יחזיר קוד רביעי עתידי, הוא יישמר כמות-שהוא. **זו התנהגות נכונה, לא
פער**: אכיפת-enum מחמירה-מדי ב-audit-log תגרום ל-INSERT להיכשל בדיוק
כש-הכי חשוב לתעד מה שקרה (קוד-שגיאה לא-צפוי). עקבי עם ההחלטה הקיימת
נגד enum מובנה ל-`outcome`/`source` (§9, "שינויים שאינם נדרשים").

**העדר-מידע-רגיש — מאומת שוב, במפורש:** `CreditCard_CitizenID` מושמט
לגמרי (גם לא boolean, §3 הערה בקוד); `CreditCard_Token`/`SingleUseToken`
→ boolean בלבד (`had_saved_token`); `CreditCard_Number`/`_CVV`/`_Track2`
מושמטים; ה-API key שלנו לא חלק מ-`raw` (תגובת SUMIT) כלל, ומוסתר
בנפרד ב-`sentBody` (הבקשה) דרך `raw-charge.ts:114`.

**הרחבת ממצא קיים (לא חדש בעצם השאלה, חדש בבדיקה+המלצה, ביקורת שביעית)
— הד אפשרי של הבקשה בהודעת-שגיאה:** השאלה "האם `UserErrorMessage`/
`TechnicalErrorDetails` עלולים לשקף בפועל נתון רגיש מהבקשה שלנו" **כבר
תועדה כהנחה-לא-מאומתת** בסבב מוקדם יותר (§9, "הנחות שלא ניתן היה
לאמת"). מה שחדש כאן: (1) בדיקה אקטיבית אם קיים sample שמור של תגובת-
שגיאה אמיתית (ריפו + scratchpad session הנוכחי) — **לא נמצא**, ההנחה
נשארת פורמלית לא-מאומתת, לא רק "לא נבדק". (2) קריאה ישירה של `redact-
for-storage.ts` (§3, שורות 295-296) מאשרת ש-`UserErrorMessage`/
`TechnicalErrorDetails` מועברים **כמחרוזת-חופשית, ללא סינון תוכן כלל**
(`r.UserErrorMessage ?? null` — אין אפילו type-narrowing "האם זה
string", בניגוד לעמודות המוקלדות) — כלומר אם ההד אכן קורה, שום דבר
בקוד המתוכנן לא עוצר אותו. ספקי-סליקה בדרך-כלל **לא** משקפים ללקוח את
המפתח-שלו-עצמו (אין להם סיבה — הלקוח כבר מכיר את המפתח שלו), כך
שהסבירות נמוכה, אבל ההנחה עדיין לא-מאומתת ועכשיו יש לה מסלול-דליפה
מפורש לתוך `raw_response`. **המלצה חדשה (זו כן חדשה):** תיקון זול —
regex שמחפש תבנית-דמוית-API-key/GUID ומחליף ב-`***` לפני האחסון של
שני השדות האלה בלבד — מול סיכון נמוך-אך-לא-אפס עם פגיעה גבוהה (מפתח
API בטבלה שכל אדמין יכול לקרוא). **סיווג:** שינוי נדרש-מומלץ (לא חוסם
— עלות המימוש הנוכחי כבר כוללת כתיבת `redact-for-storage.ts` מאפס,
כך שזו תוספת שורה אחת לאותו קובץ, לא עבודה נפרדת).

**מסקנת נושא 3 (סגור):** רשימת-ההתרה סגורה ומאומתת; ולידציית-טיפוס
אמיתית קיימת בדיוק היכן שהיא אמורה (עמודות מוקלדות), ומכוונת-נעדרת
היכן שהיא לא רלוונטית (jsonb); אין מידע-רגיש-ידוע דולף; שני פערים
נשארים מתועדים כהחלטות-מוצר פתוחות (אורך UserErrorMessage/
TechnicalErrorDetails — §9 סעיף 6; והד-אפשרי-של-הבקשה — סעיף 10 חדש
למטה) — לא "לא נבדק", אלא "נבדק, שתי נקודות פתוחות ידועות".

---

## 4. חיווט ב-`route.ts`

מיקום מדויק: אחרי `const result = await chargeRaw(...)` (שורה 191 היום),
**לפני** ה-`return resultPage(...)` (שורה 197). קריאה **אחת** נוספת, לא
תלויה בהצלחה/כישלון העסקה — כל ניסיון שהגיע בפועל ל-SUMIT נרשם.

**ביקורת שנייה (§1ב):** `correlation_id` הוא **מזהה-מעקב-לפי-ניסיון**, לא
"מפתח אידמפוטנטיות" — הוא נוצר טרי בכל בקשת HTTP, לכן לא יכול לתפוס בקשה
כפולה. ה-UNIQUE/upsert מונע רק שורת-ביקורת כפולה, לא חיוב כפול. הגנה על
חיוב כפול בפועל דורשת **בנוסף** תיקון בטופס (ראו §7).

**גרסה מלאה ומתוקנת (ביקורת עשירית) — מחליפה את הטיוטה החלקית מסבבים
1-4.** הטיוטה הקודמת (עוד לפני התיקון) הראתה רק את המסלול "התקבלה
תגובה", והשאירה את מסלול ה-`unknown` (§4א/4ב/4ג) כפִּסקת-פרשנות נפרדת
בלי לשלב אותו בפועל בקוד המוצג. הגרסה הזו **משלבת** את כל התיקונים
שנצברו (§4ג/4ד) ישירות לתוך הקוד המוצג, במקום להשאיר אותם כתוספות
נפרדות:

```ts
import { SumitNetworkError } from '@/lib/sumit/charge'; // דפוס קיים, לא הומצא מחדש (§4ג תיקון עצמי)

// crypto.randomUUID(), לא Date.now() — מסיר סיכון-התנגשות-מילישנייה בין שתי
// בקשות בו-זמניות (§4ד, ביקורת שמינית). אותו ערך גם ל-chargeRaw וגם לרשומת הביקורת.
const correlationId = crypto.randomUUID();

let result: SumitRawResult;
try {
  result = await chargeRaw({
    // ...
    externalId: correlationId,
  });
} catch (err) {
  if (err instanceof SumitNetworkError) {
    // תגובת SUMIT אבדה אחרי שהבקשה כבר נשלחה (או סירוב-שרת/body לא-תקין —
    // אותו boundary בדיוק כמו charge.ts:61-95) — ייתכן שחויב בפועל, לא ידוע.
    // best-effort, אבל זו בדיוק השורה שהכי חשוב לא להפסיד בשקט.
    try {
      await recordPaymentEvent({
        source: 'admin_poc',
        correlationId,
        httpStatus: null,
        outcome: 'unknown',
        raw: null,
        requestSummary: {},
      });
    } catch {
      console.error('[payment-events] failed to record unknown-outcome audit row', { correlationId });
    }
    // outcome:'unknown' מרחיב את resultPage()'s outcomeBanner (route.ts:80-85)
    // לענף שלישי — לא רק 'success'/'failed'. בלי זה השורה נרשמת ב-DB אך שום
    // דבר לא מונע מהאדמין ללחוץ שוב מיד (§4ג/§9 חסם מימוש).
    return resultPage({
      title: 'error',
      outcome: 'unknown',
      error: 'תגובת SUMIT אבדה — מצב לא ידוע. ייתכן שהחיוב בוצע. אל תנסו שוב לפני בדיקה ידנית מול /billing/payments/list/ (§4ב).',
    });
  }
  // כשל-לפני-שליחה (ולידציה/קונפיג חסר) — לא הגיע ל-SUMIT בכלל, בטוח לנסות שוב.
  return resultPage({ title: 'error', error: 'הקריאה ל-SUMIT נכשלה (שגיאת תקשורת).' });
}

const outcome = isSumitSuccess(result.raw) ? 'success' : 'failed';

// Best-effort: כשל בשמירת רשומת האודיט לעולם לא חוסם את הצגת התוצאה לאדמין —
// זה יומן משני, לא נתיב-קריטי. נכשל בשקט (עם console.error), לא throw.
try {
  await recordPaymentEvent({
    source: 'admin_poc',
    correlationId,
    httpStatus: result.httpStatus,
    outcome,
    raw: result.raw,
    requestSummary: summarizeSumitRequest(result.sentBody),
  });
} catch {
  // עדכון-audit: correlationId בהקשר ה-log — תואם לתקדים
  // (authorize/route.ts:170, console.error('[hold] failed...', { campaignId })).
  console.error('[payment-events] failed to record audit row', { correlationId, outcome });
}

return resultPage({
  title: 'ok',
  httpStatus: result.httpStatus,
  sent: summarizeSumitRequest(result.sentBody),
  response: summarizeSumitResponse(result.raw),
  outcome,
});
```

**`raw-charge.ts` בהתאם — `chargeRaw()` זורק `SumitNetworkError` (מיובא
מ-`charge.ts`, לא מוגדר מחדש) בדיוק בשלושת תנאי-הגבול הקיימים כבר שם
(`charge.ts:61-95`, בשימוש גם ב-`capture.ts`/`authorize.ts`):**

```ts
import { SumitNetworkError } from '@/lib/sumit/charge';

let res: Response;
try {
  res = await fetch(SUMIT_CHARGE_URL, { method: 'POST', headers: {...}, body: JSON.stringify(body) });
} catch (networkErr) {
  throw new SumitNetworkError('שגיאת תקשורת עם מערכת התשלום');
}
if (!res.ok) {
  // ייתכן שהגיע ל-SUMIT (בייחוד 5xx) — לא דחייה עסקית ודאית. אותו boundary
  // בדיוק כמו charge.ts:67-70.
  throw new SumitNetworkError('לא התקבל אישור חד משמעי ממערכת התשלום');
}
let text: string;
try {
  text = await res.text();
} catch {
  throw new SumitNetworkError('תגובת SUMIT אבדה — מצב לא ידוע'); // §4ג ממצא 2
}
let raw: unknown;
try {
  raw = JSON.parse(text);
} catch {
  throw new SumitNetworkError('תגובה לא תקינה ממערכת התשלום'); // §4ג ממצא 3
}
// מכאן ואילך raw הוא תמיד JSON תקין שהתקבל במלואו — isSumitSuccess() בהמשך
// יכולה להניח את זה, ולכן הענף typeof raw !== 'object' שלה הופך לגיבוי-הגנתי
// בלבד (JSON תקין-אך-לא-object, פתולוגי), לא הנתיב העיקרי ל-unknown כמו קודם.
return { httpStatus: res.status, ok: res.ok, sentBody, raw };
```

**פונקציית `recordPaymentEvent()` חדשה** ב-`src/lib/data/payment-events.ts`
(מיקום תואם ל-`src/lib/data/campaigns.ts` הקיים):

```ts
import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { redactSumitResponseForStorage } from '@/lib/sumit/redact-for-storage';
import type { Database, Json } from '@/lib/supabase/types';

// עדכון-audit: הטיפוס מיוצר (gen types), לא interface ידני — עקבי עם כל
// פונקציית data אחרת בפרויקט (recordCampaignHold, logActivity, וכו').
type PaymentEventInsert = Database['public']['Tables']['payment_events']['Insert'];

// עזר-narrowing קטן: מחליף `as` שקוף (בלי אכיפה בזמן ריצה) בבדיקה אמיתית.
// רלוונטי רק לעמודות המנורמלות (typed columns) — לא ל-jsonb, ששם כל צורת-
// JSON תקינה מלכתחילה (זו המשמעות של jsonb; אין "צורה שגויה" לאכוף שם).
function asStringOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
function asFiniteNumberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function asBooleanOrNull(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

export async function recordPaymentEvent(input: {
  source: string;
  correlationId: string;
  httpStatus: number | null;
  // 'unknown' = תגובת SUMIT אבדה אחרי שהבקשה כבר נשלחה (ביקורת שלישית, §4
  // בגוף התוכנית) — ייתכן שחויב בפועל, לא ידוע. שונה במכוון מ-'error'
  // (שגיאה מקומית ברורה, לפני שליחה).
  outcome: 'success' | 'failed' | 'error' | 'unknown';
  raw: unknown;
  requestSummary: Record<string, unknown>;
}): Promise<void> {
  // ביקורת שנייה, ממצא 5: מקור אמת יחיד — כל העמודות המנורמלות נגזרות מתוך
  // אותו אובייקט `redacted` שכבר חושב, לא מפירסור שני ועצמאי של `raw`.
  const redacted = redactSumitResponseForStorage(input.raw);
  const payment = redacted.payment as Record<string, unknown> | null;
  const paymentMethod = redacted.payment_method as Record<string, unknown> | null;

  const row: PaymentEventInsert = {
    source: input.source,
    correlation_id: input.correlationId,
    http_status: input.httpStatus,
    outcome: input.outcome,
    // גבול-cast מתועד — תואם בדיוק את `activity.ts:41-45`/`campaigns.ts:173`/
    // `rsvp.ts:110` (ביקורת אחת-עשרה, נמצא ע"י בדיקת ה-Json הנוצר ב-
    // types.ts מול הדפוס הקיים בפרויקט): `Record<string, unknown>` אינו
    // ניתן-להקצאה ישירות ל-`Json` המיוצר (`unknown` אינו `Json | undefined`
    // בפועל ב-TS) — נדרש `as unknown as Json`, לא רק `redacted`/
    // `input.requestSummary` כמות-שהם כפי שהוצג בטעות בגרסאות קודמות של
    // התוכנית. זהות מבנית בזמן ריצה, לא ניתנת-להקצאה בזמן קומפילציה.
    request_summary: input.requestSummary as unknown as Json,
    raw_response: redacted as unknown as Json,
    // ביקורת שלישית, ממצא 3: narrowing אמיתי במקום `as` שקוף — עמודות
    // typed מקבלות גם אכיפת-טיפוס אמיתית מ-Postgres בזמן ה-INSERT (ערך
    // בצורה לא-תואמת יגרום לשגיאת PostgREST, שכבר נתפסת למטה), אבל בדיקה
    // מפורשת כאן נותנת כשל-ולידציה ברור בזמן ריצה, לא הסתמכות עקיפה על ה-DB.
    sumit_status: asFiniteNumberOrNull(redacted.status),
    valid_payment: asBooleanOrNull(payment?.valid_payment),
    payment_id: asFiniteNumberOrNull(payment?.id),
    document_id: asFiniteNumberOrNull(redacted.document_id),
    customer_id: asFiniteNumberOrNull(redacted.customer_id),
    auth_number: asStringOrNull(payment?.auth_number),
    amount: asFiniteNumberOrNull(payment?.amount),
    currency: asFiniteNumberOrNull(payment?.currency),
    card_last4: asStringOrNull(paymentMethod?.card_last_digits),
    had_saved_token: Boolean(paymentMethod?.had_saved_token),
  };
  const admin = createAdminClient();
  // upsert עם ignoreDuplicates — המנגנון המובנה הזהה בדיוק לזה ש-
  // webhooks.ts:27-29 כבר משתמש בו ל-unique(provider,dedupe_key). מונע שורת-
  // ביקורת כפולה (לא חיוב כפול — ראו הבהרה למעלה).
  // ביקורת שלישית, ממצא 2: ignoreDuplicates=true אומר ON CONFLICT DO NOTHING —
  // אם correlation_id אי-פעם יתנגש באמת, השורה השנייה תיעלם בשקט, בלי שגיאה.
  // מקובל בהיקף admin_poc בנפח נמוך; **לא** להעתיק כמו-שהוא אם payment_events
  // יורחב לשימוש-חוזר-מכוון של אותו מפתח (retry אמיתי) — שם צריך DO UPDATE
  // או שגיאה מפורשת, לא שתיקה.
  const { error } = await admin
    .from('payment_events')
    .upsert(row, { onConflict: 'correlation_id', ignoreDuplicates: true });
  if (error) throw new Error('שמירת רשומת ביקורת התשלום נכשלה');
}
```

**ביקורת שלישית (2026-07-02) — חסם קריטי, לא "החלטה פתוחה":**
`chargeRaw()` (`raw-charge.ts:100-104`) לא עוטף את ה-`fetch()` בשום try/catch
משלו, ו-`route.ts`'s ה-`catch` היחיד (שורה 204-206) מתייחס **לכל** שגיאת-רשת
זהה: "הקריאה ל-SUMIT נכשלה". **אין הבחנה בין "הבקשה מעולם לא נשלחה" (למשל
DNS/חיבור-סורב, לפני `fetch`) לבין "הבקשה נשלחה אך התגובה אבדה" (timeout/
reset, **אחרי** ש-SUMIT כבר עלול היה לקבל ולעבד את הבקשה)**. במקרה השני,
SUMIT יכול היה **כבר לחייב בפועל** — והאדמין רואה "נכשל", עלול לנסות שוב,
וליצור **חיוב כפול אמיתי**, בלי שום איתות שזה המצב.

**תיקון נדרש (לא אופציונלי):** `chargeRaw()` יעטוף את `fetch()` בעצמו
ויבחין:
```ts
let res: Response;
try {
  res = await fetch(SUMIT_CHARGE_URL, { /* ... */ });
} catch (networkErr) {
  // השגיאה קרתה בזמן/אחרי השליחה — לא ניתן לדעת אם SUMIT קיבל וביצע.
  throw new SumitNetworkAmbiguousError('תגובת SUMIT אבדה — מצב לא ידוע', { cause: networkErr });
}
```

#### 4א. טקסונומיית outcome מלאה (ביקורת רביעית — 5 קטגוריות, לא 4)

| קטגוריה | תנאי | בטוח לנסות שוב? |
|---|---|---|
| `success` | תגובה התקבלה, `Status===0 && ValidPayment===true` | — (הצליח) |
| `failed` | תגובה התקבלה, אך `Status≠0` או `ValidPayment===false` | כן — SUMIT דחה בבירור, שום כסף לא זז |
| **`unknown`** | הבקשה **נשלחה** (fetch עצמו רץ), אך התגובה אבדה (timeout/reset) | **לא** — ייתכן שחויב |
| `error` (כשל-מערכת-מקומי) | קוד שלנו נכשל **לפני** ניסיון שליחה (ולידציה, קונפיג חסר, `redactSumitResponseForStorage` זרק) | כן — בטוח, הבקשה מעולם לא יצאה |
| `error` (כשל-תעבורתי-לפני-שליחה) | `fetch()` נכשל **לפני** שיצא בית אחד (DNS/חיבור-סורב) | כן — בטוח, לא הגיע ל-SUMIT |

**החלטת-מימוש:** שתי השורות האחרונות חולקות את הערך `'error'` (שתיהן
"בטוח לנסות שוב") — ההבחנה החשובה מבחינת-בטיחות היא **בינארית**: `unknown`
(לא בטוח) מול הכל-השאר (בטוח). לא נדרש ערך חמישי נפרד ב-DB; ה-CHECK
הקיים (`'success','failed','error','unknown'`) מספיק — ההבחנה בין שני סוגי
ה-`error` נשארת ברמת ה-`console.error`/קוד (context שונה), לא בעמודה.

#### 4ב. מנגנון ההתאמה הנדרש לפני ניסיון חוזר — **תוקן, הביקורת השלישית טעתה**

הביקורת השלישית קבעה (בטעות, בלי לבדוק) שההתאמה תהיה מול
`/billing/payments/get/` "לפי `correlation_id`". **נבדק עכשיו ונמצא שגוי:**
`swagger.json` — `PaymentsController_Payments_Get_Request`:
`required:["Credentials","PaymentID"]`, `additionalProperties:false` —
**דורש דווקא את ה-`PaymentID` של SUMIT עצמו**, בדיוק המזהה שחסר לנו
במצב `unknown` (מעולם לא התקבל, כי התגובה אבדה)! אין שדה חלופי
(correlation/external-id) בסכימה הזו.

**הנתיב האמיתי היחיד:** `/billing/payments/list/`
(`PaymentsController_Payments_List_Request`) — מקבל **טווח-תאריכים**
(`Date_From`/`Date_To`, שניהם חובה) + `Valid` (סינון) + `StartIndex`
(pagination). **לא** מקבל correlation_id/external-id ישירות. **הליך התאמה
ידני נדרש:** לשלוף רשימת תשלומים בטווח הצר (±דקות) סביב זמן השליחה,
ולהתאים ידנית לפי `Amount`/`CreditCard_LastDigits`/`CustomerID`.

**המשמעות המעשית:** אין "בדיקה אוטומטית" אפשרית לפני retry — ההתאמה היא
תמיד **ידנית** (אדמין קורא ל-`/billing/payments/list/` עם הטווח, סורק
ידנית). זה מספיק להיקף admin_poc (ניסיון בודד, אדמין יחיד), אבל **לא
scalable** לשימוש-ייצורי עתידי — אם `payment_events` יורחב ל-
authorize/capture, תידרש אוטומציה של ההתאמה הזו (או שינוי-ארכיטקטורה
לצד SUMIT, אם קיים — לא נבדק).

`route.ts`/`recordPaymentEvent` ירשמו `outcome:'unknown'` — עם הודעה
מפורשת לאדמין: **"מצב לא ידוע — ייתכן שהחיוב בוצע. אל תנסו שוב. בדקו ידנית
מול `/billing/payments/list/` (טווח התאריכים סביב `{timestamp}`) לפני כל
פעולה נוספת."** `outcome` בסכימה (§2) יורחב ל-
`check (outcome in ('success','failed','error','unknown'))`.

**חסם נוסף שזוהה כרגע — נקודה נפרדת מה-DB:** `resultPage()`'s
`outcomeBanner` (`route.ts:80-85`, **כבר חי ב-production**, פיצ'ר נפרד
שנפרס היום קודם) תומך היום **רק** ב-`opts.outcome?: 'success' | 'failed'`
— שני ענפים. הרחבת `recordPaymentEvent` ל-`'unknown'` **לא** משפיעה על
הבאנר שהאדמין רואה בפועל — צריך להרחיב **גם** את `resultPage()`'s
`outcome` type ל-3 ערכים, עם ענף שלישי מפורש שמציג את אזהרת "אל תנסו שוב"
בפועל על המסך. בלי זה, השורה נרשמת ב-DB אך **שום דבר לא מונע** מהאדמין
ללחוץ שוב מיד — הרישום קיים, ההגנה בפועל לא.

**תוספת אופציונלית — `logActivity()`:** הסקירה מצאה דפוס קיים ב-
`src/app/(admin)/admin/webhooks/actions.ts`: כתיבה לטבלה הייעודית דרך
`createAdminClient()` **וגם** קריאה נפרדת ל-`logActivity()` עם `meta` בטוח
(ids/סכומים בלבד, בלי נתוני כרטיס) — כדי שהאירוע יופיע גם בפיד "פעילות
אחרונה" הכללי לאדמין. לא חובה למימוש הליבה (שמירת ה-audit עצמה), אבל תואם
את המוסכמה הקיימת. **החלטה פתוחה:** להוסיף בשלב זה או להשאיר לשלב הבא?

#### 4ג. ביקורת חמישית (2026-07-02) — השלמת נושא 4, קריאה ישירה של `raw-charge.ts`

שלושה ממצאים חדשים, שלא עלו בסבבים 1–4, מקריאה ישירה של `raw-charge.ts`
המלא (לא רק הקטע שכבר צוטט):

**ממצא 1 — צינור ה-`unknown` לא מחווט בפועל בקוד שהתוכנית עצמה מציגה.**
הטענה: §4/§4א/§4ב מפרטים *מה* אמור לקרות במצב `unknown` (רישום ל-DB,
באנר שלישי), אבל קטע הקוד המוצג ב-§4 (שורות ~347-382 של המסמך) עוטף
ב-`try/catch` רק את `recordPaymentEvent()` — **לא** את `chargeRaw()`
עצמה. אם `chargeRaw()` תזרוק `SumitNetworkAmbiguousError` (התיקון
המוצע, §4 שורות ~474-484), השגיאה תיפול ל-`catch` **החיצוני הקיים**
ב-`route.ts:204-206` (`catch { return resultPage({title:'error', error:
'הקריאה ל-SUMIT נכשלה (שגיאת תקשורת).'}) }`) — קטע שהתוכנית **לא הראתה
תיקון** עבורו. אותו catch גנרי לא מבחין `SumitNetworkAmbiguousError`
מכל שגיאה אחרת, לא קורא ל-`recordPaymentEvent` בכלל (השורה לא נכתבת
ל-DB!), ולא מעביר `outcome:'unknown'` ל-`resultPage`.
אימות: קריאה ישירה של `route.ts:104-207` (מצורף לתחילת הסבב הזה) —
מאושר, ה-`try` היחיד עוטף את כל הגוש (`chargeRaw` + `recordPaymentEvent`
+ `resultPage`), וה-`catch` היחיד לא עושה הבחנה בין סוגי שגיאה.
סיכון אמיתי: בלי תיקון ל-catch החיצוני, כל שלושת שאר התיקונים (throw
מסוג חדש ב-chargeRaw, `outcome:'unknown'` ב-DB, באנר שלישי) **לא
מגיעים לעולם לנקודת-הפעלה** — התכונה תיראה שלמה בקוד אך לא תפעל בפועל
במקרה בדיוק שבשבילו כל §4א/4ב נכתבו.
המלצה מדויקת: להרחיב את ה-`catch` הקיים ב-`route.ts` (השורות שמסביב ל-
204-206 היום) לבדוק `instanceof SumitNetworkAmbiguousError` **לפני**
הבלוק הגנרי: אם כן — לקרוא ל-`recordPaymentEvent({..., outcome:
'unknown', ...})` (best-effort, כמו הענף הרגיל) ואז ל-`resultPage`
עם הענף השלישי; אחרת — ההתנהגות הקיימת (`outcome:'error'`, ללא רישום,
עקבי עם §4א: כשל-מקומי/כשל-לפני-שליחה תמיד "בטוח" ולא טעון audit-row).
סיווג: **חסם מימוש נוסף** (מצטרף לרשימת §9) — זהו לא "שינוי-נלווה", זו
נקודת-החיבור היחידה שבלעדיה כל מנגנון ה-unknown קיים רק על הנייר.

**ממצא 2 — `res.text()` הוא await נפרד שהתיקון המוצע לא עוטף.**
הטענה: `raw-charge.ts:105` (`const text = await res.text();`) הוא
await **נפרד** מ-`fetch()` עצמה (שורה 100), ויכול לזרוק בפני עצמו
(חיבור מתנתק **אחרי** שההדרים/status כבר התקבלו, באמצע קריאת הגוף) —
זה בדיוק תרחיש "SUMIT קרוב-לוודאי קיבל ועיבד את הבקשה (התחיל לענות),
אך לא ידוע איך הסתיים", החמור מבין תרחישי ה-`unknown`. התיקון המוצע
כרגע (§4, שורות ~476-484) עוטף רק את קריאת ה-`fetch()`, לא את
`res.text()` שאחריה.
אימות: קריאה ישירה של `raw-charge.ts:100-111` — מאושר, `res.text()`
ו-`JSON.parse` יושבים **מחוץ** לבלוק ה-try/catch המוצע.
המלצה: להרחיב את בלוק ה-try/catch המוצע כך שיעטוף גם את `res.text()`
(לא את `JSON.parse` — כשל-parse אחרי טקסט שכבר התקבל בשלמותו הוא
תרחיש אחר, ראו ממצא 3 למטה), ושתיהן ייפלו לאותו
`SumitNetworkAmbiguousError`.
סיווג: חלק מאותו חסם-מימוש (ממצא 1) — לא חסם נפרד, אך תיקון-קוד קונקרטי
נוסף שצריך להיכלל באותה עריכת `raw-charge.ts`.

**ממצא 3 — באג קיים, כבר חי בפרודקשן, בלתי-תלוי ב-payment_events:**
`isSumitSuccess()` (`route.ts:59-65`) מחזיר `false` עבור **כל** `raw`
שאינו object (`typeof raw !== 'object'`) — ו-`route.ts:202` ממפה
`false` ⇐ `outcome:'failed'`, שמוצג לאדמין כ-"❌ עסקה נדחתה / נכשלה"
(הבאנר האדום). אבל `raw` הופך למחרוזת (לא object) ב-`raw-charge.ts:
107-110` בדיוק כשה-body **לא** JSON תקין — כלומר שגיאת-שרת/proxy של
SUMIT (עמוד HTML של 5xx), timeout-page, או body שנקטע. תחת ההתנהגות
התקינה של ה-API (מאומת לאורך כל הסבבים הקודמים) SUMIT **תמיד** מחזיר
JSON תקין כשהבקשה התקבלה ועובדה במלואה — גם בדחייה עסקית ברורה
(`Status≠0`). כלומר: body לא-JSON הוא **בדיוק** האות לתרחיש `unknown`
(לא ברור אם חויב), אבל הקוד הקיים מציג אותו כ"נכשלה" בביטחון מלא —
ההפך הגמור מהכוונה של כל המנגנון שנבנה בסבבים 1-5.
אימות: קריאה ישירה, `route.ts:59-65` + `raw-charge.ts:105-111`.
סיכון אמיתי: זהו **לא** תרחיש היפותטי של payment_events העתידית —
זהו קוד חי היום ב-`/admin/sumit-test` (נפרס בקומיט `ee19ef9`). אדמין
שרואה "❌ נכשלה" בעקבות body מעוות עלול לנסות שוב, בדיוק תרחיש-חיוב-
כפול שכל המסמך הזה נועד למנוע.
המלצה **(מקורית, סבב 5 — הוחלפה, ראו תיקון עצמי מיד למטה)**: להוסיף
ל-`route.ts` פונקציה חדשה `isSumitOutcomeUnknown(raw)`.
סיווג: **חסם מימוש נוסף**, אך שונה מהותית מהשניים הקודמים — זהו תיקון
בקוד **שכבר חי היום**, בלתי-תלוי לחלוטין באם `payment_events` ייושם
בכלל. מומלץ לתקן אותו **גם אם** המשתמש יבחר לדחות את `payment_events`
כולו — זו נקודה נפרדת שדורשת החלטה משלה, לא רק "חלק מהתוכנית".

**תיקון עצמי (ביקורת שישית) — ההמלצה המקורית הייתה מיותרת, קיים כבר
מנגנון מובנה:** ה-hook שאל במפורש "האם זה באג או החלטה עיצובית?" —
קריאת `src/lib/sumit/charge.ts` (המשמש את `charge`/`capture.ts`/
`authorize.ts` הייצוריים, **לא** את ה-POC) עונה בוודאות: **זהו לא
עיצוב מכוון**, אלא **סטייה** מדפוס קיים, מתועד ומבחין-בדיוק-באותה
הבחנה שהתגלתה כאן:
```ts
// charge.ts:19-30 (מיוצא, נצרך גם ע"י capture.ts:3)
export class SumitNetworkError extends Error { ... }   // תוצאה לא-ודאית
export class SumitDeclinedError extends Error { ... }   // דחייה ודאית בלבד
```
עם שלוש בדיקות מפורשות (`charge.ts:61-64`, `67-70`, `82-84`), כל אחת
עם הערה מתועדת בקוד עצמו:
- `fetch()` זורק → `SumitNetworkError` ("charge may or may not have
  reached SUMIT... move to payment_review, not failed").
- `!res.ok` (סטטוס לא-2xx) → `SumitNetworkError` ("may have reached
  SUMIT esp. 5xx... Only IsError=true in a 2xx body is a definite
  decline").
- `res.json()` זורק (body לא-JSON) → `SumitNetworkError` ("Got a
  response but can't parse — treat as unknown outcome").
- רק `Status.IsError===true` **בתוך תגובת 2xx תקינה** → `SumitDeclinedError`
  (הדחייה הוודאית היחידה).
`authorize.ts:65-109` ו-`capture.ts` משתמשים באותו דפוס בדיוק (חלקן
מייבאות את המחלקות מ-`charge.ts` ישירות). **המלצה מתוקנת:** לא להמציא
`isSumitOutcomeUnknown()` חדש — `raw-charge.ts`/`route.ts` (ה-POC)
צריכים לאמץ **את אותם שלושה תנאי-גבול בדיוק** (`fetch` נכשל /
`!res.ok` / `res.text()`-ואז-`JSON.parse` נכשל) כ-`outcome:'unknown'`,
לפני שממשיכים ל-`isSumitSuccess`. ה-POC לא יכול לזרוק את השגיאות
(`SumitNetworkError`/`SumitDeclinedError`) כמו הקוד הייצורי, כי
המטרה שלו היא **להציג** לאדמין את מה שהתקבל, לא לעצור בזריקה — אז
צריך helper נפרד שמחזיר `boolean` במקום לזרוק, אבל עם **אותו** תנאי-
גבול בדיוק, לא המצאה עצמאית. זו בדיוק "ביקורת קוד-ידני-מיותר במקום
מנגנון-מובנה-קיים" שהתבקשה ב-goal של הסבב השני — יושמה כאן על ממצא
של הסבב שלה עצמה.

**מיצוי נושא 4 (נדרש ע"י ה-hook):** עם שלושת הממצאים לעיל, טקסונומיית
ה-outcome (§4א) עצמה **לא** משתנה (עדיין 4 ערכים ב-DB, הבחנה בינארית
unknown/הכל-השאר) — הפער היה **בחיווט בפועל**, לא בטקסונומיה. תרחישים
נוספים שנבדקו ונמצאו **לא** רלוונטיים כאן: ריבוי-טאבים/מכשירים (מכוסה
ב-§7 החלטה 5, לא קשור לנתיב-רשת), retry-לאחר-timeout (מכוסה ע"י §4ב —
תמיד ידני, אין דרך אוטומטית להבדיל "retry אחרי unknown תקין" מ"ניסיון
כפול חדש" בלי מזהה יציב מ-SUMIT, ואין כזה). timeout מפורש (AbortSignal)
ל-`fetch()` עצמה **אינו** קיים היום (`raw-charge.ts:100-104` — אין
`signal`); בלי זה, חיבור-שתקוע לא בהכרח יזרוק שגיאה כלל, ומנגנון ה-
unknown לא יופעל גם הוא. שינוי נדרש נוסף (לא חוסם בפני עצמו — ללא timeout
הבעיה היא "חוסר-תגובה נראה-לעין" לאדמין, לא חיוב-כפול-שקט): להוסיף
`signal: AbortSignal.timeout(30_000)` (או ערך דומה) לקריאת ה-`fetch()`.

#### 4ד. 7 תרחישי חיוב-כפול ומקביליות + תשובה מפורשת לאידמפוטנטיות (ביקורת שישית)

תשובה ישירה לשאלת ה-hook — **"האם קיימת אידמפוטנטיות אמיתית בצד השרת?
אם לא, מה צריך להשתנות כדי להשיג אותה?"** — **לא, אין**. אין נעילה,
שורת-שריון (reservation), או בדיקת-ייחודיות **לפני** הקריאה ל-SUMIT.
`correlation_id` (§4, שורה ~349) נוצר מ-`Date.now()` **בכל בקשת HTTP
מחדש**, ונרשם ל-DB רק **אחרי** ש-`chargeRaw()` כבר חזר — כלומר אחרי
שהחיוב (אם קרה) כבר קרה. ה-UNIQUE constraint על `correlation_id` (§2)
לא יכול למנוע כלום מראש, כי אין מפתח יציב-מהלקוח שחוזר על עצמו בין
שתי בקשות "אותה כוונה" — לכל בקשה יש `correlation_id` שונה גם אם היא
כפולה בפועל.

| # | תרחיש | הגנת-שרת היום | הגנת-טופס (אחרי התיקון המתוכנן) | חשיפה בפועל |
|---|---|---|---|---|
| 1 | שני טאבים (אותו אדמין) | **אין** | **אין** — `disabled`/`submitting` הוא state בתוך React, ייחודי-לטאב | חיוב כפול אמיתי אפשרי |
| 2 | רענון דף באמצע בקשה | הבקשה השרתית ל-SUMIT ממשיכה לרוץ ברקע (Next.js Route Handler לא נעצר כי הלקוח התנתק, אלא אם נבדק `request.signal` במפורש — לא קיים כאן) | **אין** — רענון מוחק את ה-state, אם האדמין שולח שוב זה הופך לתרחיש #3 | זהה מהותית ל-#3 |
| 3 | שתי בקשות מקבילות (race) | **אין** — שום lock/insert-מוקדם לפני הקריאה ל-SUMIT | חוסמת רק מקרה **אותו** instance של הטופס | חיוב כפול אמיתי |
| 4 | ניסיון חוזר אחרי timeout | מכוסה — `outcome:'unknown'` + אזהרה על המסך + התאמה ידנית לפני retry (§4א-4ג) | לא רלוונטי (זה כבר *אחרי* ניסיון קודם) | תלוי בציות פרוצדורלי של האדמין לאזהרה, לא באכיפה טכנית |
| 5 | קריאה ישירה לנתיב (curl/Postman, עוקף UI) | `requireAdmin()`+`isAllowedOrigin()` חוסמים גישה לא-מאומתת/cross-origin, אך Origin/Referer ניתנים לזיוף בקריאה ישירה עם cookie תקף | **אין בכלל** — הגנת-הכפתור היא HTML/JS, לא קיימת מחוץ לדפדפן | ממחיש שההגנה המתוכננת כולה קוסמטית-UI, לא אכיפה |
| 6 | אותה בקשה ממכשיר אחר | **אין** (זהה למנגנון #1/#3) | **אין** | חיוב כפול אמיתי |
| 7 | תגובה אבדה אחרי שהספק כבר חייב | מכוסה — `outcome:'unknown'` (§4א/4ב/4ג) | — | תלוי שהתיקון ב-§4ג (חיווט ה-catch) אכן יבוצע |

**מסקנה מפורשת (עונה על נושא 1+2 של ה-goal יחד):** #1/#3/#5/#6 חושפים
את אותה עובדה בדיוק מזוויות שונות — **אין שום אכיפה שרתית אמיתית נגד
חיוב כפול היום, ותיקון הכפתור (§7 החלטה 4) לא משנה את זה** — הוא מגן
רק מפני "אדמין לוחץ פעמיים באותו טאב", לא מעבר לכך. זה כבר תועד כהחלטה
מקובלת ל-POC (§7 החלטה 5), אך כאן זה מאומת שיטתית לכל 7 התרחישים
שהוגדרו, לא רק נטען כללית.

**מה נדרש בפועל כדי להשיג אידמפוטנטיות אמיתית (תשובה טכנית מדויקת,
לא המלצה למימוש עכשיו):**
1. מזהה יציב שנוצר **פעם אחת** בזמן טעינת הטופס (לא `Date.now()` בזמן
   ה-POST) ומועבר כשדה חבוי (`hidden input`) — כך ששתי שליחות של
   *אותו* טופס-render חולקות את אותו מזהה.
2. **לפני** הקריאה ל-`chargeRaw()`: `insert` שורת `payment_events` עם
   `status:'pending'` ומזהה זה תחת **UNIQUE** — אם ה-`insert` נכשל
   (התנגשות מפתח), **לא** לקרוא ל-SUMIT שוב, להחזיר את התוצאה/מצב
   הקיימים במקום.
3. אחרי התגובה: `UPDATE` לאותה שורה עם ה-`outcome` הסופי.
   זה הופך את `payment_events` **משורת-יומן-פסיבית ל-reservation lock
   אקטיבי** — שינוי ארכיטקטוני אמיתי, לא תוספת עמודה.
**סיווג:** שיפור עתידי (future-improvement), **לא** חוסם ל-POC הנוכחי
(אדמין יחיד, נפח נמוך, §7 החלטה 5 כבר ממליצה שלא כרגע) — אך זו התשובה
המדויקת שנדרשה, לא הימנעות מהשאלה.

**ממצא נוסף (ביקורת שמינית) — התנגשות-מילישנייה ב-`correlation_id`
עלולה **להשמיט ראיית-ביקורת אמיתית**, לא רק "לא למנוע חיוב כפול":**
`correlationId = \`poc-${Date.now()}\`` (§4) מחושב **מוקדם**, לפני כל
`await` — כלומר לפני שהקוד "מחכה" לראשונה. `Date.now()` ברזולוציית
מילישנייה: שתי בקשות POST שמגיעות לאותו תהליך Node כמעט-בו-זמנית
(בדיוק תרחישים #1/#3 בטבלה למעלה — שני טאבים / race) יכולות לחשב
את אותה מילישנייה **לפני** ש-`chargeRaw()` (הפעולה האיטית, תלוית-
רשת) בכלל מתחיל. במקרה כזה, שתי הבקשות מקבלות `correlation_id` **זהה**
— וה-UNIQUE index + `ignoreDuplicates:true` (§2, §4) גורמים לשורת-
הביקורת **השנייה** להישמט בשקט (`ON CONFLICT DO NOTHING`, ללא שגיאה).
**זה שונה מהותית מהממצא הקודם** ("אין הגנה מפני חיוב כפול") — כאן
מדובר בכך שגם **מנגנון-הראיה עצמו** (המטרה המוצהרת של payment_events)
עלול להשמיט תיעוד של ניסיון-חיוב אמיתי-ושני בדיוק בתרחיש-הכי-מסוכן
(שני חיובים בו-זמנית). עונה במפורש על שאלת ה-goal: "עלול לגרום
להעלמת ניסיון תשלום... או אובדן ראיית ביקורת" — **כן, במנגנון
המתואר, לא באופן תיאורטי-כללי**.
**סיווג:** לא חוסם (הסתברות נמוכה — דורש שני requests ממש באותה
מילישנייה, ותרחיש-הבסיס [חיוב כפול עצמו] כבר מתועד כסיכון-מקובל
ל-POC) — אך שינוי-נדרש-זול אם/כשמתקנים את #7-ל-§9: `crypto.randomUUID()`
במקום `Date.now()` (כבר בשימוש בפרויקט כדפוס, למשל `paymentAttemptRef`
ב-`charge.ts`) מסיר את הסיכון הזה לגמרי, ללא תלות בהחלטה על idempotency
מלאה (§4ד למעלה) — שינוי חד-שורתי, לא ארכיטקטורה חדשה.

---

## 5. תוכנית בדיקות (TDD, כמו כל השינויים היום)

1. **`redact-for-storage.test.ts`** — RED→GREEN, sentinel-based (כמו
   `safe-preview.test.ts`), + בדיקת "auth_number כן מוחזר בערכו האמיתי".
2. **`payment-events.test.ts`** (החדש, `src/lib/data/`) — mock
   `createAdminClient`, אימות שה-insert נקרא עם השדות הנכונים; **אימות
   ש-`recordPaymentEvent()` עצמה כן זורקת** כשה-insert נכשל (תואם
   ל-`throw new Error(...)` בקוד, §4) — לא "לא זורק". ה-best-effort
   הוא התנהגות ה-**caller** (`route.ts`), לא של פונקציית ה-data עצמה —
   ראו סעיף 3 מיד למטה, שם זה נבדק בפועל (תוקן, ביקורת עשירית: הניסוח
   הקודם כאן סתר ישירות את `recordPaymentEvent`'s `throw` בקוד עצמו).
3. **`route.test.ts` (הרחבה)** — mock `recordPaymentEvent`, אימות שהוא
   נקרא אחרי `chargeRaw` בשני המסלולות (הצלחה/כישלון), ושה-`resultPage`
   עדיין מוחזר גם אם ה-mock זורק שגיאה.
4. **מיגרציה — אימות חי, רשימת-תיוג מפורשת (ביקורת רביעית: כל סעיף בנפרד, לא "אימות RLS" כללי):**
   - [ ] `supabase migration new payment_events` (לא ידני) → apply (Mgmt
     API/CLI הרשמי, **לא** סקריפטים ad-hoc).
   - [ ] `supabase db advisors --linked` — 0 אזהרות RLS.
   - [ ] **SELECT** דרך cookie-client, משתמש לא-admin → 0 שורות.
   - [ ] **SELECT** דרך cookie-client, משתמש admin → שורות מוחזרות.
   - [ ] **INSERT** דרך cookie-client, **גם משתמש admin** → **נכשל** (אין
     policy ל-insert דרך cookie-client כלל, גם לא לאדמין — תוקן בביקורת
     עשירית, §2: הכתיבה היחידה היא service-role מ-`recordPaymentEvent()`).
   - [ ] **INSERT** דרך `createAdminClient()` (service-role) → מצליח (עוקף
     RLS לגמרי, לא תלוי במדיניות) — זה המסלול היחיד שאמור לעבוד.
   - [ ] **UPDATE** דרך cookie-client, משתמש admin → **נכשל** (אין policy
     ל-update כלל אחרי התיקון ב-§2 — לא רק "אמור להיכשל", לוודא בפועל).
   - [ ] **DELETE** דרך cookie-client, משתמש admin → **נכשל** (אותה סיבה).
   - [ ] `supabase gen types` **אחרי** ה-apply → `git diff` על
     `src/lib/supabase/types.ts` מראה את `payment_events` בפועל (לא רק
     "כוונה להריץ" — אימות שהקובץ באמת השתנה).
5. **שליחה כפולה/מקבילית** (ביקורת שנייה, ממצא 2/7) — טסט שמדמה שתי קריאות
   `POST` מקביליות עם אותם פרמטרים (לפני שהתיקון לטופס קיים): לתעד בפירוש
   שהתנהגות היום היא **שתי קריאות נפרדות ל-`chargeRaw`** (אין הגנה) — טסט
   שמאמת את המגבלה הידועה, לא טסט ש"עובר" באשליה. אחרי תיקון הטופס (§7) —
   טסט UI שמאמת שהכפתור השני `disabled` בזמן שהראשון עדיין `submitting`.
6. **payload מעוות/ענק ל-`redactSumitResponseForStorage`** — קלט לא-אובייקט,
   `Data`/`Payment`/`PaymentMethod` בעלי צורה לא-צפויה (מערך במקום אובייקט,
   `null` באמצע השרשרת), ומחרוזת ארוכה חריגה — לוודא שהפונקציה לא זורקת
   ומחזירה תמיד אובייקט בטוח (fail-closed, לא fail-open).
7. **כשל-רשת — 3 טסטים נפרדים, לא אחד** (ביקורת רביעית, §4א/4ב):
   - [ ] כשל **לפני** `fetch()` (ולידציה/קונפיג חסר) → `outcome:'error'`,
     אין רישום ניסיון-שנשלח.
   - [ ] כשל **בתוך** `fetch()` (network error אחרי קריאה) →
     `outcome:'unknown'`, **לא** `'error'` — טסט שמאמת את ההבחנה עצמה
     (המרכיב הקריטי של §4א), לא רק "יש טיפול-שגיאות כלשהו".
   - [ ] תגובה שהתקבלה אך היא עסקית-נכשלת (`Status≠0`/`ValidPayment:false`)
     → `outcome:'failed'`, לא `'unknown'`/`'error'` — לוודא שהגבולות בין
     3 הקטגוריות לא מיטשטשים.
8. **audit-failure לא חוסם את תוצאת ה-SUMIT** — mock ל-`recordPaymentEvent`
   שזורק שגיאה → לוודא ש-`resultPage` עדיין מוחזר עם הפרטים הנכונים (לא
   רק "לא קרס").

---

## 6. סיווג DB storage מול תצוגת דפדפן — טבלת השוואה

| שדה | דפדפן (`safe-preview.ts`) | DB (`redact-for-storage.ts` החדש) |
|---|---|---|
| `AuthNumber` | boolean (`has_auth_number`) | **ערך אמיתי** |
| `Payment.ID` / `DocumentID` | ערך אמיתי | ערך אמיתי |
| `CreditCard_Token` | boolean | boolean (`had_saved_token`) — **לעולם לא** ערך |
| `CreditCard_CitizenID` | לא נקרא בכלל | לא נקרא בכלל |
| `CreditCard_LastDigits`/`CardMask` | ערך אמיתי (כבר ממוסך) | ערך אמיתי |
| `CreditCard_Number`/`CVV`/`Track2` | לא נקרא | לא נקרא |

---

## 7. החלטות פתוחות — דורשות את אישורך המפורש לפני מימוש

1. **מסלול כשל-רשת** — לרשום ב-payment_events גם ניסיון שלא הגיע לתגובה
   כלל (§4)? המלצה: כן.
2. **`outcome` — פשוט או עשיר?** המסמך המקורי מציע טקסונומיה עשירה
   (`authorized`/`declined`/`review`/`billed`) לשימוש ייצורי עתידי. להיקף
   הנוכחי (admin POC בלבד) הצעתי `success`/`failed`/`error` פשוט, בהתבסס
   על `isSumitSuccess()` הקיימת. אפשר להרחיב כשהיקף יגדל לקמפיינים אמיתיים.
3. **מסך-צפייה admin** — לא כלול בשלב זה (רק שמירה). תוסף בנפרד אם תרצה.
4. **(חדש, ביקורת שנייה) הגנת שליחה-כפולה לטופס מסלול B** — `disabled`/
   `submitting` כמו טופס 1. **המלצה: כן, נדרש** — בלי זה, §2-§5 כולם בונים
   יומן-ביקורת יפה לחיובים כפולים אמיתיים שאין שום דבר שמונע אותם. זה שינוי
   קטן (`sumit-test-form.tsx` בלבד), אבל **מהותי** לחומרת הסיכון הכולל.
5. **(חדש) נעילת-שרת מלאה נגד ריבוי-טאבים/מכשירים** — מעבר לתיקון #4 —
   **לא מומלץ בשלב זה**: מורכבות לא-מידתית לכלי אבחון admin-only בהיקף נמוך.
   לשקול מחדש אם/כש-payment_events יורחב ל-production (authorize/capture).
6. **(חדש) הידוק RLS מלא (trigger אנטי-מוטציה נגד service_role)** — **לא
   מומלץ בשלב זה**: אין תקדים בפרויקט, עלות מול תועלת לא ברורה בהיקף POC.
   ה-RLS select-בלבד לאדמין (§2, תוקן שוב בביקורת עשירית) מספיק ליעד הנוכחי.

---

## 8. רצף מימוש מוצע (לאחר אישור)

1. `redact-for-storage.ts` + טסטים — RED→GREEN.
2. `supabase migration new payment_events` → מילוי הסכימה מ-§2 (RLS
   **select-בלבד לאדמין, אין insert דרך cookie-client כלל**, **לא**
   for-all — תוקן בביקורת עשירית) → apply מבודד → `db advisors --linked`
   **+ אימות ידני ש-UPDATE/DELETE/INSERT דרך cookie-client כולם נדחים**
   (לא רק ש-SELECT מאושר).
3. **`supabase gen types` (חדש, ביקורת עשירית — היה חסר מהרצף הזה)** →
   `git diff` על `src/lib/supabase/types.ts` מאשר ש-`payment_events`
   קיים בפועל. **חייב לקרות לפני שלב 4** — `PaymentEventInsert`
   (§4) נגזר מהטיפוס המיוצר, לא interface ידני; בלי השלב הזה כאן קודם,
   שלב 4 לא יכול לקמפל.
4. `src/lib/data/payment-events.ts` (`recordPaymentEvent`, מקור-אמת-יחיד
   מ-`redacted` — לא פירסור כפול) + טסטים.
5. **`sumit-test-form.tsx`: הוספת הגנת שליחה-כפולה לטופס מסלול B** —
   נדרש **לפני** שהתכונה נחשבת שלמה (החלטה 4 לעיל), לא "nice to have".
6. `raw-charge.ts`: `chargeRaw()` זורק `SumitNetworkError` (מיובא מ-
   `charge.ts`, §4) בשלושת תנאי-הגבול; חיווט ב-`route.ts` (כולל
   `correlationId` = `crypto.randomUUID()`, ה-catch שמזהה
   `SumitNetworkError` ומרחיב את `resultPage`'s `outcome` ל-3 מצבים) +
   הרחבת `route.test.ts` (כולל טסטי §5 8-5: מקביליות/payload-מעוות/
   כשל-רשת/audit-failure).
7. `tsc`+`lint`+טסטים מלאים.
8. Smoke test חי דרך `/admin/sumit-test` — אימות שורה נכתבה בפועל בטבלה
   (שאילתה ישירה, לא רק "הצליח בלי שגיאה") **+ ניסיון ידני של לחיצה כפולה**
   לוודא שהתיקון בצעד 5 אכן מונע קריאה שנייה.

---

## 9. סיכום — הפרדה מפורשת (לפי דרישת הביקורת, מעודכן אחרי סבב עשירי)

### עובדות מאומתות (קוד/סכימה/git, נבדקו ישירות)
- `FOR ALL` ב-Postgres RLS כולל UPDATE/DELETE, לא רק SELECT/INSERT.
- `rsvp_responses` ("append-only" מתועד) — אין `revoke`/trigger, מוסכמה בלבד.
- `route.ts:190` בונה `correlation_id` טרי בכל בקשת HTTP (`Date.now()`), לא
  מפתח יציב מהלקוח.
- `grep -ni idempoten swagger.json` → 0 תוצאות — ל-SUMIT אין idempotency-key.
- טופס מסלול B ב-`sumit-test-form.tsx` חסר `disabled`/`submitting` (קיים רק
  בטופס 1, שורות 281-282).
- `webhooks.ts:27-29` משתמש ב-`.upsert(..., {onConflict, ignoreDuplicates})`
  כמנגנון-מובנה קיים לדדופ' שורות (לא לדדופ' חיובים) — `ignoreDuplicates`
  = `ON CONFLICT DO NOTHING`, שורה מתנגשת נעלמת בשקט, בלי שגיאה.
- כל פונקציית data בפרויקט מקלידה payload דרך `Database['public']['Tables']`
  המיוצר, לא interface ידני.
- `swagger.json:8668` לא מתעד אם `DocumentDownloadURL` חתום/פג-תוקף.
- `raw-charge.ts:100-104` — `fetch()` בלי try/catch משלו; `route.ts:204-206`
  — `catch` יחיד גנרי, לא מבחין "לא נשלח" מ"נשלח אך תגובה אבדה".
- `swagger.json:11228,11235` — `UserErrorMessage`/`TechnicalErrorDetails`
  ללא הגבלת אורך מתועדת.
- **(חדש, ביקורת רביעית)** `swagger.json` —
  `PaymentsController_Payments_Get_Request`: `required:["Credentials",
  "PaymentID"]`, `additionalProperties:false` — **דורש דווקא את** ה-`PaymentID`
  של SUMIT, לא correlation_id/external-id. **תיקון עצמי:** הביקורת השלישית
  טענה (בלי לבדוק) שההתאמה תהיה "לפי correlation_id" מול endpoint זה — טעות.
- **(חדש)** `PaymentsController_Payments_List_Request`: מקבל
  `Date_From`/`Date_To` (חובה) + `Valid`/`StartIndex` — לא מקבל
  correlation_id. זהו נתיב-ההתאמה **היחיד** הזמין במצב `unknown`, וגם הוא
  ידני (סריקת-טווח, לא שאילתה ממוקדת).
- **(חדש, ביקורת חמישית)** קטע הקוד המוצג ב-§4 עוטף ב-try/catch רק את
  `recordPaymentEvent()`, לא את `chargeRaw()` — שגיאה מ-`chargeRaw()`
  (כולל `SumitNetworkAmbiguousError` המוצע) נופלת ל-catch החיצוני הקיים
  (`route.ts:204-206`) שהתוכנית לא הראתה תיקון עבורו (§4ג, ממצא 1).
- **(חדש)** `raw-charge.ts:105` (`res.text()`) הוא await נפרד מ-`fetch()`
  (שורה 100) ואינו עטוף ע"י בלוק ה-try/catch המוצע ב-§4 (§4ג, ממצא 2).
- **(חדש)** `route.ts:59-65` (`isSumitSuccess`) מחזיר `false` (⇐
  `outcome:'failed'`) עבור כל `raw` שאינו object — כולל body לא-JSON
  (שגיאת-שרת/proxy של SUMIT, לא דחייה עסקית) — קוד **חי כבר בפרודקשן**
  (קומיט `ee19ef9`), בלתי-תלוי ב-payment_events (§4ג, ממצא 3).
- **(חדש)** `raw-charge.ts:100-104` — קריאת ה-`fetch()` ללא `signal`/
  timeout מפורש כלשהו.
- **(חדש, ביקורת שישית)** `src/lib/sumit/charge.ts:19-30,61-95` —
  `SumitNetworkError`/`SumitDeclinedError` **קיים כבר**, נצרך גם ע"י
  `capture.ts`/`authorize.ts`, ומבחין **בדיוק** את שלושת התנאים שממצא 3
  (§4ג) זיהה כחסרים (fetch נכשל / `!res.ok` / JSON-parse נכשל ⇐ תוצאה
  לא-ודאית). ה-POC (`raw-charge.ts`/`route.ts`) **לא** משתמש בדפוס הזה
  כלל — סטייה מתועדת מדפוס-קיים, לא החלטה עיצובית (§4ג, תיקון עצמי).
- **(חדש)** אין שום lock/insert-מוקדם/reservation לפני הקריאה ל-SUMIT
  בשום מסלול קיים — `correlation_id` נוצר ונרשם רק **אחרי** ש-
  `chargeRaw()` כבר חזר (§4ד). מאומת שיטתית מול 7 תרחישי מקביליות.

### הנחות שלא ניתן היה לאמת
- האם `DocumentDownloadURL` בפועל חתום/פג-תוקף — לא נבדק חי (רק תיעוד חסר).
- מידת השימוש התדיר-בפועל בכפתור-כפול (double-click) אצל אדמינים אמיתיים —
  לא נמדד, רק זוהה כפער-הגנה תיאורטי-אך-אמיתי.
- האם `UserErrorMessage`/`TechnicalErrorDetails` אי-פעם מהדהדים בפועל נתון
  רגיש מהבקשה שלנו — אין ראיה לכאן או לכאן, רק היעדר-הבטחה בסכימה.
  **(עודכן, ביקורת שביעית):** נבדק אקטיבית אם קיים sample שמור של
  תגובת-שגיאה אמיתית (ריפו + scratchpad) — לא נמצא, ההנחה נשארת לא-
  מאומתת. בעקבות זאת נוספה המלצת-מיטיגציה קונקרטית וזולה (§3א, §9
  סעיף 10 למטה) במקום להשאיר את זה כפער פתוח בלבד.
- האם קיים אצל SUMIT נתיב-התאמה נוסף/טוב-יותר (לפי external-id) שלא
  מתועד ב-swagger.json — לא נבדק מעבר לסכימה הרשמית עצמה.

### סיכונים שהתקבלו במודע במסגרת ה-POC (חדש — קטגוריה נפרדת שהתבקשה)
- אין אוטומציה להתאמת `unknown`-outcome מול SUMIT — תמיד ידני (§4ב). מקובל
  להיקף נוכחי (אדמין יחיד, נפח נמוך); **לא scalable** לייצור.
- `ignoreDuplicates:true` בולע קונפליקט אמיתי בשקט (§9, עובדות מאומתות) —
  מקובל כי correlation_id כמעט לא יתנגש בהיקף admin_poc בפועל.
- אין Trigger שאוכף אי-שינוי נגד `service_role` — עקבי עם כל שאר הפרויקט
  (אין תקדים), לא סטייה חדשה.
- אין הגבלת-אורך ל-`UserErrorMessage`/`TechnicalErrorDetails` — אין ראיה
  לבעיה בפועל, רק פוטנציאל תיאורטי לא-מאומת.
- `expiration_month`/`expiration_year` נשמרים ב-`raw_response` בלי שימוש
  תפעולי בפועל בהיקף הנוכחי (§2א) — "מותר" לפי המסמך המקורי, לא "נדרש".

### החלטות מוצר/סיכון שדורשות אישורך
1. `outcome` פשוט מול עשיר (המלצה: פשוט, כולל `'unknown'` החדש — כרגע)
2. מסך-צפייה admin (המלצה: לא כרגע)
3. נעילת-שרת מלאה נגד ריבוי-טאבים/מכשירים (המלצה: לא כרגע, מורכבות
   לא-מידתית לכלי admin-only בהיקף נמוך — **אך שים לב**: תיקון הכפתור
   (שינוי נדרש למטה) מגן רק מפני לחיצה-כפולה-באותו-טאב, לא מעבר לזה.
   **עיצוב קונקרטי אם/כש-יאושר בעתיד: ראו §4ד** — מזהה יציב מהטופס +
   `insert` מוקדם עם UNIQUE כ-reservation lock **לפני** קריאה ל-SUMIT,
   לא רק עמודה נוספת. מאומת שיטתית מול 7 תרחישי מקביליות, §4ד)
4. Trigger אנטי-מוטציה נגד service_role (המלצה: לא כרגע, אין תקדים)
5. תוספת `logActivity()` (המלצה: לשלב הבא)
6. הגבלת אורך ל-`UserErrorMessage`/`TechnicalErrorDetails` לפני אחסון
   (המלצה: לא כרגע — אין ראיה לבעיה בפועל, רק פוטנציאל תיאורטי)
7. **(חדש)** `expiration_month`/`expiration_year` ב-`raw_response` —
   להשאיר (יישור עם §3 המקורי) או להסיר (מינימיזציה מחמירה, אין שימוש
   תפעולי היום)?
8. **(חדש)** אוטומציית-התאמה ל-`unknown`-outcome — להשאיר ידני (מומלץ
   להיקף POC) או לבנות כלי-עזר (שאילתת `/billing/payments/list/` +
   הצגה) כבר בשלב זה?
9. **(חדש, ביקורת שישית)** אימוץ דפוס `SumitNetworkError`/
   `SumitDeclinedError` הקיים (מ-`charge.ts`) בתוך `raw-charge.ts`/
   `route.ts` של ה-POC, במקום הבדיקה הבינארית הנוכחית (§4ג תיקון עצמי)
   — משפיע גם על הבאנר שכבר חי בפרודקשן, לא רק על payment_events
   העתידית. המלצה: כן, לפני שהתכונה נחשבת שלמה (זהו למעשה עדכון-מומלץ
   לחסם הקיים "isSumitSuccess מסווג body לא-JSON", לא החלטה נפרדת
   באמת — מובא כאן כדי לקבל אישור מפורש על *הגישה* לתיקון, לא רק על
   עצם הצורך בתיקון).
10. **(חדש, ביקורת שביעית; הורחב בביקורת עשירית)** ל-`user_error_message`/
    `technical_error_details` (§3א): (א) סינון תבנית-דמוית-סוד (`***`)
    — הגנה זולה מול הד אפשרי-אך-לא-מאומת של הבקשה (כולל API key)
    בהודעת-שגיאה חוזרת מ-SUMIT. (ב) **הורחב עכשיו**: type-guard זהה
    לעמודות המוקלדות (`typeof v === 'string' ? v : null`) — "JSON תקין
    אינו שקול ל-'בטוח לאחסון'" (הערת המשתמש, ביקורת עשירית): jsonb
    יקבל ללא תלונה גם object/array אם SUMIT אי-פעם יחזיר צורה לא-צפויה
    כאן, וזה יישבר רק בעתיד כש-**צרכן** (מסך-אדמין, §7 החלטה 2, עדיין
    נדחה) ינסה `.substring()`/`.includes()` על ערך שאינו string. שני
    התיקונים זולים מאותה סיבה — קוד נכתב-מאפס בין כה — ומיושמים באותה
    שורה ב-`redact-for-storage.ts`. המלצה: כן, שניהם, לפני שהתכונה
    נחשבת שלמה.

### חסמי מימוש (לא "נחמד שיהיה" — התכונה לא בטוחה-לשימוש-עם-כסף-אמיתי בלעדיהם)
- **RLS ל-select-בלבד לאדמין דרך cookie-client, אין insert כלל שם, לא
  for-all (§2, עודכן בביקורת עשירית).**
- **הגנת שליחה-כפולה בטופס מסלול B (§7, §8 צעד 5)** — בלי זה, כל שאר
  התוכנית לא מגנה על כלום מפני חיוב כפול מלחיצה כפולה בסיסית.
- **הבחנת `chargeRaw()` בין "לא נשלח" ל"נשלח, תגובה אבדה" + `outcome:'unknown'`
  (§4א/4ב)** — בלי זה, timeout אחרי חיוב אמיתי נראה זהה ל"נכשל לגמרי",
  ומעודד ניסיון-חוזר מסוכן.
- **(חדש) הודעת-אזהרה מפורשת לאדמין במצב `unknown`** — לא מספיק לרשום
  `outcome:'unknown'` ב-DB; חייבת להיות הודעה גלויה על המסך שאומרת "אל
  תנסו שוב" **לפני** שהתכונה נחשבת שלמה — אחרת הרישום קיים אך לא מונע
  בפועל התנהגות מסוכנת.
- **(חדש, ביקורת חמישית) חיווט בפועל של ה-catch החיצוני ב-`route.ts`**
  (§4ג ממצא 1+2) — בלי הרחבת ה-`catch` הקיים לזהות תוצאה-לא-ודאית
  ולקרוא ל-`recordPaymentEvent`+באנר-שלישי משם, כל שאר מנגנון ה-
  `unknown` (בדיקה חדשה ב-chargeRaw, עמודת DB, באנר) קיים בקוד אך **לא
  מגיע לעולם לנקודת-הפעלה** בתרחיש שבשבילו נבנה.
- **(חדש, ביקורת חמישית, מתוקן בביקורת שישית) `isSumitSuccess` מסווג
  body לא-JSON כ-`'failed'`** (§4ג ממצא 3) — **קוד חי בפרודקשן היום**,
  בלתי-תלוי ב-payment_events; מציג "❌ נכשלה" בביטחון-מלא במקרה שהוא
  בדיוק תרחיש `unknown` אמיתי. **אושר בביקורת שישית שזו סטייה מדפוס-
  קיים, לא החלטה עיצובית** — `charge.ts`/`capture.ts`/`authorize.ts`
  כבר פותרים בדיוק את זה עם `SumitNetworkError`/`SumitDeclinedError`
  (§4ג, תיקון עצמי). התיקון: לאמץ את **אותם שלושה תנאי-גבול** (fetch
  נכשל / `!res.ok` / JSON-parse נכשל), לא להמציא בדיקה חדשה. דורש
  החלטה נפרדת: לתקן גם אם payment_events נדחה כולו.

### שינויים נדרשים (לא אופציונליים, אך לא חוסמים-שימוש כמו למעלה)
- מקור-אמת-יחיד בגזירת העמודות המנורמלות מ-`redacted` (§4).
- הסרת `document_download_url` מרשימת ההתרה עד אימות (§3).
- `correlationId` בהקשר ה-`console.error` (§4).
- `as` → narrowing אמיתי (`asStringOrNull` וכו') בעמודות typed (§4) — לא
  ה-jsonb, ששם זה לא רלוונטי.
- טבלת נימוק שדה-שדה (§2א) — הושלמה בסבב הזה.
- 10 טסטי-סיכון + רשימת-תיוג מיגרציה בת 9 סעיפים (§5) — כולל 3 טסטי
  כשל-רשת נפרדים (לא-נשלח / נשלח-אבד / נכשל-עסקית) במקום אחד גנרי.
- **(חדש)** `signal: AbortSignal.timeout(...)` על קריאת ה-`fetch()` ב-
  `raw-charge.ts` (§4ג) — בלי זה חיבור-תקוע לא בהכרח יזרוק שגיאה כלל, ומנגנון
  ה-unknown לא יופעל; לא סווג כחוסם (הבעיה היא חוסר-תגובה נראה-לעין
  לאדמין, לא חיוב-כפול-שקט), אך נדרש לשלמות התכונה.
- **(חדש, ביקורת שמינית)** `crypto.randomUUID()` במקום `Date.now()`
  ליצירת `correlationId` (§4ד) — מסיר סיכון-התנגשות-מילישנייה שעלול
  להשמיט שורת-ביקורת אמיתית בשקט (`ignoreDuplicates`). דפוס קיים
  בפרויקט (`charge.ts`'s `paymentAttemptRef`). שינוי חד-שורתי.
- **(חדש, ביקורת שביעית)** סינון תבנית-דמוית-סוד לפני אחסון
  `user_error_message`/`technical_error_details` (§3א) — ראו §9 סעיף 10.

### שינויים שאינם נדרשים (נבדקו ונדחו במכוון)
- Zod ב-`recordPaymentEvent` — לא גבול-מערכת אמיתי.
- Enum מובנה במקום `text+check` ל-`outcome`/`source` — עמודות מתפתחות,
  `text+check` הוא הדפוס הנכון כאן.
- מניעת כפילות `outcome` union (TS) מול CHECK (SQL) — `gen types` לא סוגר
  את הפער הזה; הגנה כפולה מכוונת, לא באג.
- `as` → narrowing ב-`raw_response`/`request_summary` (jsonb) — קטגוריה
  שגויה: jsonb מיועד לקבל כל צורת-JSON תקינה, "צורה שגויה" לא רלוונטי שם.
- ערך `outcome` חמישי נפרד ל-2 סוגי ה-`error` (§4א) — ההבחנה החשובה
  בינארית (unknown/לא), לא נדרשת עמודה נוספת.

---

## 10. טבלת אימות מאסטרית — כל תת-שאלה מה-goal העומד, תשובה, וראיה (ביקורת שמינית)

מרכזת במקום אחד את כל תתי-השאלות שהופיעו בנוסח ה-goal החוזר (סבבים 3-9),
עם תשובה חד-משמעית, ראיה (file:line) וסעיף-מפנה. לא מכילה ממצא חדש
בפני עצמה — זו נקודת-כניסה, לא תחליף לפירוט בסעיפים המצוינים.

### נושא 1 — זהויות, קורלציה, אידמפוטנטיות

| # | שאלה | תשובה | ראיה | סעיף |
|---|---|---|---|---|
| 1.1 | סתירה בין משמעות `correlation_id`, אילוצי-DB, יצירה, ושימוש בתיעוד? | **כן** — נקרא "correlation" אך משמש הלכה למעשה כ"עוגן-מעקב-לפי-ניסיון" בלבד; ה-UNIQUE constraint יוצר רושם-אידמפוטנטיות שגוי | `route.ts` (מתוכנן): `correlationId = poc-${Date.now()}` נוצר מחדש בכל POST | §4, §1ב ממצא 2 |
| 1.2 | באמת ייחודי בתנאי מקביליות? | **לא** — התנגשות-מילישנייה אפשרית, גורמת ל-`ignoreDuplicates` להשמיט שורה שנייה בשקט | `Date.now()` רזולוציית-מילישנייה, מחושב לפני כל `await` | §4ד (ביקורת שמינית) |
| 1.3 | מבוסס מנגנון אמין ולא רק זמן/מצב-דפדפן? | **לא** — `Date.now()` בלבד, שרתי אך זמן-תלוי; אין תרומה ממצב-דפדפן (זה כן שרתי, לא client state — אך עדיין לא-אמין כפי שהוכח ב-1.2) | כנ"ל | §4ד |
| 1.4 | מזהה פעולה-עסקית/ניסיון-טכני/קבוצת-ניסיונות? | **ניסיון טכני בודד בלבד** — כל POST מקבל מזהה חדש, גם אם מייצג "אותה כוונה עסקית" (retry) | כנ"ל | §4, §1ב |
| 1.5 | מוגדר בטעות כמנגנון-אידמפוטנטיות? | **תוקן** — §1ב (ביקורת שנייה) זיהתה זאת כטעות בסבב 1 והתוכנית מתעדת עכשיו במפורש "לא מפתח אידמפוטנטיות" | הערת-קוד מתוכננת ב-§4, שורה ~342 | §1ב, §4 |
| 1.6 | עלול לגרום להעלמת-ניסיון/דריסת-רישום/אובדן-ראיית-ביקורת? | **כן, קונקרטית** — התנגשות-מילישנייה + `ignoreDuplicates:true` = `ON CONFLICT DO NOTHING` בשקט | כנ"ל | §4ד |
| 1.7 | מנגנון ה-DB יכול למנוע חיוב כפול **לפני** פנייה לספק? | **לא** — אין `insert`/lock לפני `chargeRaw()`; ה-UNIQUE נבדק רק על השורה שנכתבת **אחרי** שהקריאה ל-SUMIT כבר חזרה | §4, קוד מתוכנן שורות ~347-373 (recordPaymentEvent נקרא אחרי chargeRaw) | §4, §4ד |

### נושא 2 — חיוב כפול ומקביליות

| # | שאלה | תשובה | ראיה | סעיף |
|---|---|---|---|---|
| 2.1 | הגנות דפדפן (disabled/submitting) — UI בלבד או גם שרת? | **UI בלבד** — לא קיימת שום אכיפה שרתית מקבילה | `sumit-test-form.tsx` — טופס 1 יש `disabled`, טופס 2 (route B) אין (§9 עובדות מאומתות) | §4ד, §7 החלטה 4 |
| 2.2-2.8 | 7 התרחישים (טאבים/רענון/מקביליות/retry/קריאה-ישירה/מכשיר-אחר/תגובה-אבדה) | טבלה מלאה, סטטוס פר-תרחיש | `route.ts:28-44` (`isAllowedOrigin`/`requireAdmin`), `raw-charge.ts` (אין lock) | §4ד (טבלה מלאה) |
| 2.9 | קביעה מפורשת: אידמפוטנטיות אמיתית בצד שרת? | **לא, באופן חד-משמעי.** סיכון: חיוב כפול אמיתי בתרחישי #1/#3/#5/#6. נדרש לאידמפוטנטיות אמיתית: מזהה-יציב-מטופס + insert-מוקדם-כ-lock (מפורט, לא כללי) | — | §4ד |

### נושא 3 — רדוקציה, רשימת התרה, מידע רגיש

| # | שאלה | תשובה | ראיה | סעיף |
|---|---|---|---|---|
| 3.1 | רשימת-התרה סגורה בפועל, לא רק שמות-שדות? | **כן, מאומת** — אין spread/walker גנרי, כל מפתח מוקצה בנפרד מנתיב-מקור נקוב | `redact-for-storage.ts` (מתוכנן) שורות 287-328, אין `...`/`Object.keys` | §3א |
| 3.2 | ולידציית-ריצה: טיפוס/אורך/ערך-חוקי/מבנה-לא-מקונן/העדר-מידע-רגיש — לכל שדה? | **חלקי, במכוון**: טיפוס נאכף לעמודות מוקלדות (לא ל-jsonb — נכון מטבע ה-jsonb); אורך לא נאכף (פער ידוע, §9 סעיף 6); ערך-חוקי לא נאכף (נכון — לא לחסום ערכי-SUMIT-עתידיים); מידע-רגיש מוצא-החוצה (מאומת) | `asStringOrNull`/`asFiniteNumberOrNull`/`asBooleanOrNull` (§4, שורות 400-408); בדיקה חוזרת (סבב 8): אין `as` עוקף בבלוק המתוכנן | §3א |
| 3.3 | שדות טקסט/מספר/בוליאני יכולים להכיל אובייקט/מערך/קישור/אסימון/פרטי-כרטיס/ת.ז./הודעת-שגיאה-חופשית? | **לא, לעמודות מוקלדות** (narrowing דוחה). **כן באופן תיאורטי-לא-מאומת** ל-`user_error_message`/`technical_error_details` (jsonb, ללא סינון-תוכן) — ראה 3.5 | §3, שורות 295-296 | §3א |
| 3.4 | `as` משמש כתחליף-ולידציה בטעות? | **לא** — כל `as` בקוד המתוכנן מלווה ב-narrowing פונקציונלי אמיתי; נבדק ישירות, 0 מופעי `as`-בלי-guard בבלוק `recordPaymentEvent` (סבב 8) | grep ישיר על בלוק הקוד ב-§4 | §4, סבב 8 |
| 3.5 | שדות-מיותרים (מספר-אישור/תוקף/קישורי-הורדה/פרטי-שגיאה/מזהים-פנימיים/אמצעי-תשלום) — נימוק לכל אחד? | **כן, טבלה מלאה קיימת** — `auth_number` (chargeback), `expiration_month/year` (נימוק חלש, מתועד כפער-מוצר #7), `document_download_url` (**הוסר**, לא מאומת שהוא חתום), `user_error_message`/`technical_error_details` (אבחוני, אורך-לא-חסום), `payment_id`/`document_id`/`customer_id` (מפתחות-התאמה נדרשים ל-`/billing/payments/get/`), `card_last4`/`had_saved_token` (תמיכת-לקוחות/אבחוני, לא הטוקן עצמו) | — | §2א |

### נושא 4 — כשל רשת ותוצאה לא ידועה

| # | שאלה | תשובה | ראיה | סעיף |
|---|---|---|---|---|
| 4.1 | התוכנית מניחה בטעות שכשל-רשת = לא הגיע לספק? | **לא (עכשיו) — תוקן.** הטקסונומיה המקורית (סבב 1-4) כן בלבלה זאת; מסבב 5 ואילך: 3 מצבי-גבול נפרדים (fetch נכשל-לפני-שליחה / `!res.ok` / JSON-parse נכשל-אחרי-שהתחיל-להתקבל), תואמים בדיוק את הדפוס הקיים ב-`charge.ts` | `charge.ts:61-95` | §4ג (תיקון עצמי) |
| 4.2 | תרחיש: הספק חייב, תגובה אבדה/פקעה — המערכת מזהה זאת נכון? | **בתכנון כן, ומעכשיו (ביקורת עשירית) גם מחווט במלואו בקוד-הספק המוצג ב-§4** (`SumitNetworkError` נתפס, `recordPaymentEvent`/`outcome:'unknown'`/באנר-שלישי מוצגים) — אך **הקוד החי בפועל היום** (`route.ts:104-207`) עדיין לא שונה (ואינו אמור להשתנות — אין implementation עדיין, לפי ההוראה העומדת). ההבחנה: §4 עכשיו הוא ספק-מלא-ועקבי, לא רק ניתוח-פערים | `route.ts:104-207` בפועל היום — ללא שינוי; §4 בתוכנית — מעודכן ומלא | §4 (גרסה מלאה), §9 חסמי מימוש |

**סיכום השורה התחתונה:** מתוך ~20 תתי-שאלות במסמך ה-goal, כולן נענו
עם ראיה קונקרטית. שלוש נשארות **חסם-מימוש מפורש** (RLS, הגנת-שליחה-
כפולה, חיווט ה-unknown עד הבאנר) שידוע וסומן; שאר הממצאים הם או
עובדות-מאומתות-חיוביות (התכנון תקין) או סיכונים-מקובלים-לתיעוד
בהיקף POC (§9). לא נמצא ממצא-חדש נוסף בהשוואה לטבלה זו — הבנייה שלה
היא ריכוז-פורמט, לא תוכן חדש.

---

## 11. נושאים 5-8 (ביקורת אחת-עשרה) — יומן/הרשאות, טיפוסים, תלויות-קבצים, חוזה-שגיאות

נושאים 1-4 מכוסים במלואם ב-§10. נושאים 5-8 מרכזים בדיקה חדשה, בפורמט
המדויק שנדרש (נושא / סטטוס / ראיות / מקור רשמי / סיכון / המלצה / סיווג).

| # | נושא שנבדק | סטטוס | ראיות מדויקות | סיכון ממשי | המלצה | סיווג |
|---|---|---|---|---|---|---|
| 5.1 | הטבלה — יומן-ביקורת מחייב, רישום אבחוני, או שילוב לא-מוגדר? | **מאומת: יומן-ביקורת** — לא רישום-אבחוני-בלבד (הוא חלק מהתפקיד, לא כולו) | §2א: "יומן-ביקורת append-only... לא נתון-בר-מחיקה-לפי-בקשה" | אין — הגדרה ברורה, לא מעורפלת | — | — |
| 5.2 | מי יכול לקרוא/להוסיף/לעדכן/למחוק בפועל? | **מאומת, טבלה מלאה:** SELECT: אדמין בלבד (cookie, RLS). INSERT: **רק** service-role (RLS insert הוסר לגמרי, ביקורת עשירית). UPDATE/DELETE: **אף אחד** דרך RLS; service-role עוקף תמיד (אין trigger-חסימה). משתמש-רגיל/לקוח-לא-מאומת: 0 גישה | §2 (מדיניות SQL בפועל), §1ב ממצא 1 | service-role שקוף-לחלוטין ל-RLS — זה תקדים-פרויקטי קיים (לא סטייה), אך פירושו שרכיב-שרת-פגום יכול לשנות/למחוק היסטוריה בלי שום שכבת-הגנה שנייה | לא לבנות trigger (כבר הוחלט, §7 החלטה 6 — אין תקדים, עלות/תועלת לא ברורה) | סיכון שהתקבל |
| 5.3 | ניתן לייצר רשומה ידנית שאינה נובעת מאירוע אמיתי? | **מצומצם אך לא נעלם:** לפני התיקון — כן, כל אדמין דרך cookie-client. אחרי (§2, ביקורת עשירית) — רק מי שיש לו גישת-קוד/service_role (משמעותית יותר מוגבל) | §2 מדיניות מעודכנת | קיים תיאורטית תמיד כש-service-role זמין (לא ניתן לסגור לגמרי בלי DB-trigger) | — | סיכון שהתקבל (מוקטן, לא מסולק) |
| 5.4 | ההיסטוריה נשמרת גם כשכתיבה ל-DB נכשלת? | **מאומת: לא** — `recordPaymentEvent()` זורקת, `route.ts` תופס ב-catch (best-effort), רק `console.error` — **אין** dead-letter/retry/outbox. אם ה-insert נכשל, האירוע אובד **סופית**, לא רק "מושהה" | §4 קוד מוצג, שורות ~455-462 | פער-ידוע: כשל-DB חד-פעמי (network blip וכו') מוחק ראיה לצמיתות, בלי איתות חוץ מלוג-שרת חולף | מקובל להיקף admin_poc (נפח נמוך, לא ייצור אמיתי) — outbox/retry הוא over-engineering כרגע | סיכון שהתקבל (חדש, לא תועד במפורש קודם) |
| 6.1 | טיפוסים ידניים המשכפלים מקור-אמת קיים? | **נמצא ותוקן עכשיו:** `PaymentEventInsert` מ-`Database[...]` (נכון, לא כפילות). **אך** `raw_response`/`request_summary` הוקצו כ-`Record<string,unknown>` ישירות ל-עמודת `Json` המיוצרת — לא ניתן-להקצאה ב-TS בלי cast | `types.ts:1-6` (`export type Json = ...`), השוואה מול `activity.ts:41-45`/`campaigns.ts:173`/`rsvp.ts:110` — כל השלושה משתמשים ב-`as unknown as Json` מתועד | קוד-הספק לא היה עובר `tsc` כמו-שהוצג | תוקן: `as unknown as Json` בשתי העמודות (§4, תואם דפוס פרויקטי קיים) | **תיקון נדרש — תוקן בסבב הזה** |
| 6.2 | טיפוסים מיוצרים מתעדכנים אחרי מיגרציה, מודולים תלויים בהם רק-אחרי? | **מאומת בתכנון:** §8 צעד 3 (נוסף בביקורת עשירית) — `gen types` **לפני** כתיבת `payment-events.ts` (צעד 4) | §8 (רצף מימוש מעודכן) | לפני התיקון: לא היה סדר מפורש, סיכון-קומפילציה | — | תוקן |
| 6.3 | עמודות מנורמלות ורישום נגזרים ממקור-השלכה יחיד? | **מאומת: כן** — `payment`/`paymentMethod` נגזרים מ-`redacted` אחד, לא פירסור-כפול של `raw` | §4, `recordPaymentEvent` שורות 607-609 | — | — | עובדה מאומתת |
| 7.1 | `raw-charge.ts` — כל הקריאות אליו, מבודד לכלי-האבחון? | **מאומת: כן, ורק** | `grep -rn "from '@/lib/sumit/raw-charge'" src/` → `route.ts` + 2 קבצי-טסט בלבד | — | — | עובדה מאומתת (§4, כבר תועד) |
| 7.2 | `sumit-test-form.tsx` — כל הקריאות אליו? | **מאומת: כן, קריאה יחידה** | `grep -rn "sumit-test-form\|SumitTestForm" src/` → `page.tsx` בלבד (import + render) | — | — | עובדה מאומתת (חדש, ביקורת אחת-עשרה) |
| 7.3 | `safe-preview.ts` — הוספת `export` ל-`asObj`/`present` בטוחה? | **מאומת: כן** — כרגע לא-exported (`function asObj`, אין `export`); `safe-preview.test.ts` לא בודק/מסתמך על אי-הייצוא שלהן (0 אזכורים בשם) | `grep -n "^function asObj\|^export function"` + `grep` על קובץ הטסט | שינוי-visibility טהור, לא משנה התנהגות-ריצה | — | עובדה מאומתת (חדש, ביקורת אחת-עשרה) |
| 7.4 | `charge.ts` — ה-import החדש של `SumitNetworkError` בטוח? | **מאומת: כן** — קריאה חד-כיוונית ל-class שכבר מיוצא (`export class SumitNetworkError`, `charge.ts:19`); `raw-charge.ts` לא עורך את `charge.ts` | §4 (סעיף "אימות-בידוד"), `charge.ts:19-30` | אפס — אין שינוי לקובץ הייצורי עצמו | — | עובדה מאומתת |
| 8.1 | חוזה-שגיאות עקבי data/payment/route/UI/tests? | **חלקי, תוקן ברובו:** `recordPaymentEvent` זורקת (עקבי, תוקן §5 פריט 2); `chargeRaw` זורקת `SumitNetworkError` (עקבי עם charge.ts, תוקן §4); `route.ts` מבחין 3 ענפים (success/failed/unknown+error) — עקבי מקצה-לקצה **בקוד המוצג**, לא (עדיין) בקוד-החי (§9, חסם מימוש) | §4, §5 | — | — | תוקן ברמת המסמך; ממתין למימוש |
| 8.2 | רשימת 10 כיסויי-הבדיקה הנדרשת — כולה קיימת ב-§5? | **9/10 קיימים, 1 חדש נוסף עכשיו:** מקביליות(§5-5)✓ ניסיונות-כפולים(§5-5)✓ תוצאה-לא-ידועה(§5-7)✓ כשל-רשת(§5-7)✓ כשל-שמירת-ביקורת(§5-8)✓ דליפת-מידע-רגיש(§5-1,§5-6)✓ מבנים-זדוניים(§5-6)✓ חוסר-התאמת-טיפוסים(**חסר עד עכשיו**) השפעה-על-נתיבים-קיימים(חלקי — רק §4 טקסט, לא טסט) הרשאות-שגויות(§5-4 RLS)✓ | סעיפי §5 שצוינו | טסט-טיפוסים לא היה ברשימה במפורש | **נוסף פריט 9 חדש ל-§5** (למטה) | תיקון נדרש |

**תוספת ל-§5 (פריט 9, ביקורת אחת-עשרה — היה חסר מרשימת 8 הכיסויים):**
9. **טסט-קומפילציה/טיפוסים** — `tsc --noEmit` על `payment-events.ts` אחרי
   `gen types` בפועל, כולל אימות ש-`raw_response`/`request_summary`
   מקבלות את ה-cast (`as unknown as Json`) ולא נכשלות; לא רק "הקוד
   רץ" — ולידציה מפורשת שהוא **מתקמפל** נגד הטיפוסים המיוצרים האמיתיים.

**מסקנת נושאים 5-8:** ממצא אחד ממשי-וחדש דרש תיקון (6.1 — cast חסר
ל-`Json`, קוד-הספק לא היה עובר `tsc`); שאר הבדיקות באו נקיות (בידוד-
קבצים מאומת לכל קובץ שהתוכנית נוגעת בו, לא רק לפי שם) או כבר-מכוסות.
נושא 5 (יומן/הרשאות) הוסיף זווית-חדשה אחת (5.4 — אובדן-היסטוריה-בשקט
בכשל-DB) שסווגה כסיכון-מקובל-להיקף-POC, לא חוסם.
