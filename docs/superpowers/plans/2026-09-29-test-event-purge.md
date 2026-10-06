# מחיקת אירועי בדיקה — סימון מפורש ומחיקה מבוקרת

**סטטוס:** טיוטה לאישור (29.9.2026). שום דבר מהמסמך הזה עוד לא מיושם, חוץ ממה שמסומן "כבר חי".
**כל העובדות נמדדו מול המסד החי (PostgreSQL 17.6) ב-29.9.2026.**

## המטרה

למחוק אירוע בדיקה של הצוות, גם אם נרשמו לו חיובים, בלי לפתוח מסלול שבו לקוח או איש צוות יוכלו למחוק רישומי חיוב של אירוע אמיתי.

## המצב היום

מחיקת אירוע נחסמת על ידי מפתחות זרים. `events` → `campaigns` מוגדר CASCADE, אבל הטבלאות הבאות חוסמות (RESTRICT או NO ACTION שאינו דחוי):

| טבלה | מפנה אל | פעולה במחיקה |
|---|---|---|
| `billed_results` | `events`, `campaigns`, `contacts` | RESTRICT |
| `campaign_authorized_contacts` | `events`, `campaigns` | RESTRICT |
| `campaign_authorized_set_audit` | `events`, `campaigns` | RESTRICT, ויש עליה טריגר append-only |
| `event_cancellation_requests` | `events` | RESTRICT |
| `inbound_agent_attempts` | `events`, `guests`, `contacts` | RESTRICT |
| `contact_interactions` | `guests` (`guest_id`) | NO ACTION |
| `support_access_log` | `events` (העמודה `event_id` nullable) | NO ACTION — לא מאפס אוטומטית |

**שני אירועי הבדיקה** (בעליהם איש צוות, אף קמפיין שלהם לא חויב):

| טבלה | `294d23e1-6be9-4b4f-ad79-4d10f4a6e31b` | `659ae5e7-268b-4f04-abd8-fbb89fc3ebe4` |
|---|---|---|
| `billed_results` | 21 | 1 |
| `campaign_authorized_contacts` | 38 | 1 |
| `campaign_authorized_set_audit` | 0 | 0 |
| `event_cancellation_requests` | 1 | 0 |
| `inbound_agent_attempts` | 0 | 0 |
| `contact_interactions` (דרך אורחים) | 0 | 0 |
| `support_access_log` | 57 | 39 |

**מסלולי מחיקה קיימים:** ההרשאה `events_owner_delete` (ל-`authenticated`) מתירה למשתמש מחובר למחוק את האירועים שלו דרך ה-Data API. אין באפליקציה מסך שמוחק אירוע.

### כבר חי (מיגרציות `20260928231225`, `20260928231226`)

- `campaigns`: הגבלות CHECK על `capture_status`, `charge_status`, `release_status`. **נשארות.**
- `events`: טריגר `BEFORE DELETE` בשם `events_purge_staff_test_dependents`, שמוחק את הרשומות החוסמות כשבעל האירוע רשום ב-`platform_staff`. **יבוטל בתוכנית הזו.** הבעיה בו: כל איש צוות (3 היום) יכול למחוק דרך ה-API אירוע שלו יחד עם רישומי החיוב, ובעלות של איש צוות לא אומרת שהאירוע הוא אירוע בדיקה.
- `campaign_authorized_set_audit_no_mutate`: השומר מתיר DELETE רק כשההגדרה המקומית לטרנזקציה `kalfa.purge_test_event` היא `'on'`. **נשאר**, ישמש את הפונקציה החדשה.

## ההחלטות

1. **סימון מפורש ולא ניחוש.** אירוע נחשב אירוע בדיקה רק אם איש צוות מורשה סימן אותו. לא לפי שם, ולא לפי מי הבעלים.
2. **הסימון לא גלוי ללקוחות.** הוא נשמר בטבלה נפרדת בלי הרשאות ל-`anon` ול-`authenticated`, ולא כעמודה ב-`events`. זו ההמלצה של Supabase ב-[column-level-security](https://supabase.com/docs/guides/database/postgres/column-level-security) ("dedicated table" במקום column privileges), והיא גם מונעת חשיפה ב-GraphQL (advisors 0026/0027).
3. **שתי הרשאות נפרדות.** `events.mark_test` לסימון, ו-`events.purge_test` למחיקה. סימון לבדו לא מתיר מחיקה.
4. **מחיקה רק דרך פונקציה אחת, בטרנזקציה אחת.** אין טריגר על `events`, כך שמחיקה מה-API או מלוח הבקרה מתנהגת כמו לפני 28.9: נחסמת אם יש רישומי חיוב.
5. **שמירת עותק לפני מחיקה.** הרשומות הכספיות ורשימות הנמענים נשמרות כ-`jsonb` בשורה של `test_events`, לפני שהן נמחקות.
6. **יומן הגישה של הצוות לא נמחק.** ב-`support_access_log` מאפסים רק את `event_id`.

## סבב ביקורת 1 (29.9, 03:07) — ממצאים שנבדקו מול המסד החי והתיקונים

| # | טענת הביקורת | מה נמדד | התיקון בתוכנית |
|---|---|---|---|
| 1 | מחיקה לפי `event_id` בלבד עלולה להשאיר שורות שמפנות לקמפיין / איש קשר / אורח של האירוע | היום אין שורות כאלה: 0 שורות בכל נתיב (billed_results לפי campaign/contact, authorized/audit לפי campaign, inbound לפי contact, interactions לפי guest) | הפונקציה בונה את קבוצות המזהים (קמפיינים, אנשי קשר, אורחים) ומוחקת לפי **כל** עמודת FK. בסוף היא בודקת שלא נשארה אף הפניה, ואם נשארה — `raise` ו-rollback |
| 2 | `charge_status='charged'` צר מדי | בשני האירועים: `nothing_to_charge`, סכום 0, בלי מסמך SUMIT; בקשת הביטול היחידה בלי מסמך ובלי סכום | הגדרת "נגעו בו כספים" רחבה (ראו `purge_blockers` למטה). כולל חיוב בתהליך/בבדיקה, מסמך או תשלום SUMIT, סטטוס קמפיין `billed`/`paid`/`awaiting_invoice`, סכום סופי > 0, בקשת ביטול עם מסמך או סכום, ותפיסת מסגרת שלא סומנה כמשוחררת |
| 3 | `SECURITY DEFINER` עם `search_path 'public'` | — | `set search_path = ''` ושמות מלאים (`public.x`) בכל הפונקציות החדשות, לפי `security-rls-performance.md` של Supabase |
| 4 | ה-GUC אינו גבול הרשאה | RLS דלוק בכל טבלאות הכסף, ויש בהן רק policies של SELECT (ו-INSERT ל-audit/ביטול), כך ש-DELETE דרך ה-API נדחה כבר היום. **אבל** ל-`anon` ול-`authenticated` יש GRANT מלא (כולל DELETE ו-TRUNCATE) על `billed_results`, `campaign_authorized_contacts`, `campaign_authorized_set_audit`, `event_cancellation_requests` — ברירת המחדל של Supabase. TRUNCATE לא כפוף ל-RLS | ההרשאה האמיתית: EXECUTE על הפונקציות רק ל-`service_role`, ובאפליקציה `requirePlatformPermission`. בנוסף: `revoke delete, truncate, update` מ-`anon`/`authenticated` על ארבע הטבלאות. `service_role` נשאר בברירת המחדל (החלטת הבעלים 25.9 בתוכנית 2026-09-24) |
| 5 | ה-snapshot מכסה רק ארבע טבלאות | עץ ה-CASCADE מ-`events` כולל 22 טבלאות, ביניהן `signed_agreements` ו-`billing_credits` | ה-snapshot כולל גם `signed_agreements` (בלי ראיות OTP/חתימה גולמיות — רק מזהים, גרסה, hash, תאריכים) ו-`billing_credits`, ומספר השורות שנמחקו מכל אחת מ-22 הטבלאות. JSONB הוא תיעוד, לא שחזור |
| 6 | נעילות לא מסונכרנות בין סימון, ביטול ומחיקה | — | הסימון והביטול עוברים לפונקציות DB (`mark_test_event`, `unmark_test_event`, רק `service_role`). כל שלוש הפונקציות נועלות קודם את שורת `events` ואז את שורת `test_events`, תמיד באותו סדר |
| — | `support_access_log` לא מאפס את עצמו | נכון: ה-FK הוא NO ACTION, והעמודה nullable | ניסוח תוקן: האיפוס הוא פעולה מפורשת של הפונקציה |
| — | בדיקת rollback במסד החי עלולה לגרום לתופעות לוואי | אין בעץ ה-CASCADE אף טריגר מחיקה של משתמש, חוץ מהטריגר שלנו שיבוטל. אין קריאות HTTP מטריגרים | הרצה ניסיונית ב-`BEGIN … ROLLBACK` בטוחה. אין לנו סביבת staging נפרדת |

**`events_owner_delete`:** הביקורת ממליצה להסיר. **ההמלצה שלי זהה:** להסיר את ה-policy ולבטל את `DELETE` על `events` מ-`authenticated` ו-`anon`. אין מסך שמשתמש בזה, ו-CASCADE מוחק גם הסכמים והיסטוריה. אם בעתיד יידרש ביטול אירוע מצד לקוח — מסלול שרת ייעודי. **ממתין להחלטת הבעלים.**

**דחוף, בנפרד מהתוכנית:** הטריגר `events_purge_staff_test_dependents` חי עכשיו. איש צוות יכול כבר היום למחוק דרך ה-API אירוע שלו יחד עם רישומי החיוב. מומלץ לבטל אותו במיגרציה קטנה כבר עכשיו, לפני שאר התוכנית.

## שינויי מסד (מיגרציה אחת)

### 1. ביטול הטריגר

```sql
drop trigger if exists events_purge_staff_test_dependents on public.events;
drop function if exists public.purge_staff_test_event_dependents();
```

### 2. טבלת `test_events`

```sql
create table public.test_events (
  event_id   uuid primary key,          -- בלי FK: השורה נשמרת גם אחרי שהאירוע נמחק
  marked_by  uuid not null,
  marked_at  timestamptz not null default now(),
  purged_by  uuid,
  purged_at  timestamptz,
  snapshot   jsonb                       -- עותק הרשומות שנמחקו
);
alter table public.test_events enable row level security;   -- בלי policies
revoke all on public.test_events from anon, authenticated;
```

**למה בלי FK:** עם `CASCADE` הסימון וההיסטוריה נמחקים יחד עם האירוע. עם `RESTRICT` הוא עצמו חוסם את המחיקה. גם `activity_log` מוגדרת CASCADE ל-`events`, ולכן היסטוריה שתלויה במזהה האירוע לא יכולה להישמר שם.

### 3. הפונקציה `purge_test_event`

> **עודכן אחרי סבב ביקורת 1.** הגרסה למימוש: `set search_path = ''` ושמות מלאים; נעילת `public.events` ואז `public.test_events`; בדיקת `purge_blockers` (למטה) במקום `charge_status='charged'` בלבד; מחיקה לפי קבוצות המזהים (`v_campaigns`, `v_contacts`, `v_guests`) בכל עמודת FK; snapshot שכולל גם `signed_agreements` (מזהים, גרסה, hash, תאריכים) ו-`billing_credits` ומספרי שורות לכל טבלה בעץ; ובדיקה סופית שלא נשארה הפניה. הקוד שלמטה הוא השלד המקורי.
>
> **`purge_blockers`** — הפונקציה מחזירה `financial_activity` אם מתקיים אחד מאלה לקמפיין כלשהו של האירוע: `charge_status in ('charged','pending','charge_review')`; `sumit_charge_document_id` או `charge_payment_id` לא ריקים; `status in ('billed','paid','awaiting_invoice')`; `final_charge_amount > 0`; `capture_status in ('pending','hold_review')`; `capture_status = 'authorized'` ו-`release_status` ריק. או לבקשת ביטול של האירוע: `sumit_document_id` לא ריק, או `resolution_amount > 0`.

```sql
create function public.purge_test_event(p_event uuid, p_actor uuid)
returns text language plpgsql security definer set search_path to 'public' as $$
begin
  -- 1. נעילה ובדיקות
  perform 1 from events where id = p_event for update;
  if not found then return 'no_event'; end if;
  perform 1 from test_events where event_id = p_event and purged_at is null for update;
  if not found then return 'not_marked'; end if;
  if exists (select 1 from campaigns where event_id = p_event and charge_status = 'charged')
    then return 'charged'; end if;

  -- 2. עותק (billed_results, campaign_authorized_contacts, campaign_authorized_set_audit,
  --    event_cancellation_requests) לתוך test_events.snapshot

  -- 3. מחיקת החוסמים (השומר של הטבלה append-only נפתח רק כאן)
  perform set_config('kalfa.purge_test_event', 'on', true);
  delete from billed_results               where event_id = p_event;
  delete from campaign_authorized_contacts where event_id = p_event;
  delete from campaign_authorized_set_audit where event_id = p_event;
  delete from event_cancellation_requests  where event_id = p_event;
  delete from inbound_agent_attempts       where event_id = p_event
     or guest_id in (select id from guests where event_id = p_event);
  delete from contact_interactions         where event_id = p_event
     or guest_id in (select id from guests where event_id = p_event);
  update support_access_log set event_id = null where event_id = p_event;
  perform set_config('kalfa.purge_test_event', 'off', true);

  -- 4. מחיקת האירוע (CASCADE לקמפיינים, אורחים, אנשי קשר וכו')
  delete from events where id = p_event;

  update test_events set purged_by = p_actor, purged_at = now() where event_id = p_event;
  return 'purged';
end $$;
revoke all on function public.purge_test_event(uuid, uuid) from public, anon, authenticated;
grant execute on function public.purge_test_event(uuid, uuid) to service_role;
```

### 4. הרשאות צוות

שתי שורות ב-`platform_permission_definitions` (`events.mark_test`, `events.purge_test`, קטגוריה `ops`), ושיוך שלהן ב-`platform_role_permissions` לתפקיד שבו `platform_roles.is_owner_role = true`. אותו דפוס כמו ב-`20260721183855_campaigns_runstate_permission.sql`.

### מה לא משתנה

- העמודות והמפתחות הזרים של `events`, `campaigns`, `billed_results` וכל שאר הטבלאות.
- `events_owner_delete`: ראו "פתוח להחלטה".

## שינויי קוד

לפי [Next.js data-security](node_modules/next/dist/docs/01-app/02-guides/data-security.md): שכבת נתונים בשרת בלבד, בדיקת הרשאה בתוך כל פעולת שרת.

- **`src/lib/data/admin/test-events.ts`** (`import 'server-only'`):
  - `markEventAsTest(eventId)`: `requirePlatformPermission('events.mark_test')` ואחר כך `rpc('mark_test_event')` (נועלת את שורת האירוע).
  - `unmarkEventAsTest(eventId)`: אותה הרשאה, `rpc('unmark_test_event')`, מותר רק לפני מחיקה.
  - `purgeTestEvent(eventId)`: `requirePlatformPermission('events.purge_test')` ואחר כך `rpc('purge_test_event')` דרך admin client.
  - `getTestEventMark(eventId)`: קריאה בלבד, לדף הניהול.
  - בכולן: אימות Zod של המזהה, ורישום פעולה שנשמר גם אחרי המחיקה (לא ב-`activity_log` עם `event_id`).
- **`src/app/(admin)/admin/events/[id]/actions.ts`:** פעולות שרת קצרות, שכל אחת מאמתת קלט ובודקת הרשאה בעצמה.
- **`src/app/(admin)/admin/events/[id]/page.tsx`:** מקטע "אירוע בדיקה" שמוצג רק עם `hasPlatformPermission` המתאים. כפתור המחיקה מופיע רק לאירוע מסומן, עם אישור שבנוי בתוך הדף. תוצאות הפונקציה (`not_marked`, `charged` וכו') מתורגמות להודעות בעברית.
- הקוד בצד הלקוח לא קורא את `test_events` בשום מקום.

## אימות

1. **הרצה ניסיונית במסד החי, בתוך `BEGIN … ROLLBACK`:**
   - מחיקה בהקשר של משתמש API (`set local role authenticated` ו-JWT claims) נחסמת.
   - `purge_test_event` על אירוע לא מסומן מחזירה `not_marked`, ושום דבר לא נמחק.
   - על אירוע שחויב היא מחזירה `charged`.
   - על `659ae5e7` אחרי סימון: `purged`, עותק שמכיל 1 + 1 שורות, `support_access_log` מנותק (39 שורות נשמרות), והאירוע נמחק.
   - `campaign_authorized_set_audit` חסומה לעדכון ולמחיקה מחוץ לפונקציה.
   - `authenticated` לא יכול לבצע `select` מ-`test_events` ולא להפעיל את `purge_test_event`.
2. **בדיקות יחידה** לשכבת הנתונים: סירוב בלי הרשאה, מזהה לא תקין, ומיפוי תוצאות. הבדיקה הקיימת `admin-data-layer-coverage.test.ts` מוודאת שכל פונקציית ניהול בודקת הרשאה.
3. `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run gen:types` ו-`npm run types:check`.
4. **בדפדפן:** `/admin/events/[id]`. סימון, ביטול סימון, ומחיקה של אירוע בדיקה.

## גבולות

- **SUMIT:** המחיקה לא נוגעת ב-SUMIT. תפיסות מסגרת פתוחות משחררים בלוח הבקרה של SUMIT.
- **תוכנית `2026-09-24-campaign-payment-domain-split`:** כשתיווצר `payment_operations` (עם `on delete restrict` ל-`campaigns`), צריך להוסיף אותה לפונקציה: גם לעותק וגם למחיקה.
- **דוחות:** הסתרת אירועי בדיקה מדוחות, מסיכומי הכנסות וממעקב תקרת העוסק הפטור היא שלב נפרד.

## החזרה לאחור

`drop function purge_test_event`, `drop table test_events`, ומחיקת שתי ההרשאות. אחרי שאירוע נמחק אין דרך להחזיר אותו: העותק ב-`snapshot` מתעד את הרישומים, אבל הוא לא שחזור.

## פתוח להחלטה

- **`events_owner_delete`:** לקוח יכול למחוק דרך ה-API אירוע שלו שאין לו רישומי חיוב. זה המצב גם לפני 28.9, ואין מסך שמשתמש בזה. להשאיר או להסיר?
