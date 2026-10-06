# הפעלת קמפיין חבילה אחרי תשלום (P-C) — תוכנית מימוש

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **מצב ביצוע (5.10):** Tasks 0-7 בוצעו בעץ העבודה, **לא ב-commit, לא פרוסים, `npm run build` לא רץ**. המיגרציות `20261005041849_guests_seq_order` ו-`20261005041852_fill_authorized_set` הופעלו בידי הבעלים ואומתו בקריאה בלבד (45 ערכי `seq` ייחודיים, identity, שני אינדקסים, הטריגר פעיל, ה-ACL של הפונקציה זהה ל-`reconcile_authorized_set`). `tsc`, `lint`, `worker:deps` נקיים, 10,443 טסטים עוברים. **נשאר:** Task 8 (שער ה-₪1 עם אישור הבעלים ובדיקת דפדפן אחרי פריסה) ותנאי "אסור להפעיל" שבסוף המסמך. **הסטיות שנוצלו לפי ההמלצה:** השלמה ולא החלפה, מילוי גם באישור התנאים, סירוב להפעיל בלי אנשי קשר.

**Goal:** לקוח ששילם על חבילה מקבל קמפיין חי: הרשימה מתמלאת באנשי הקשר הראשונים לפי סדר ההוספה עד המכסה, הקמפיין עובר ל-`active`, והמסכים מציגים את המצב האמיתי. היום תשלום מצליח ומשאיר את הקמפיין ב-`approved` לנצח.

**Architecture:** (1) פונקציית SQL אחת, `fill_authorized_set`, ממלאת את רשימת המורשים בנעילת שורת הקמפיין, באותו כלל הכשירות של `reconcile_authorized_set`. (2) `activateCampaign` (נקודת המעבר היחידה, ראו `campaign-lifecycle-parity.test.ts`) מקבלת ענף חבילה: תנאי המימון נקרא **מהיומן** (`payment_operations`), לא מ-`capture_status`, ואחריו המילוי, ואחריו המעבר. (3) מסלול הרכישה מפעיל אוטומטית אחרי חיוב מצליח; אם ההפעלה נדחית, התשלום נשאר, והמסך מציג "שולם" עם כפתור הפעלה וסיבה. (4) `campaignStage` ושלבי ההקמה מקבלים מצב תשלום מהיומן, עם נפילה לדרך הישנה לקמפיינים לפי תוצאה.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres (מיגרציות ב-CLI, מופעלות בידי הבעלים), Vitest 5, Zod 4, `@testing-library/react` + jsdom.

**Spec:** `2026-10-04-package-payment-plan.md` (סעיפים P-B, P-C, "אסור להפעיל את המתג", Review Focus 6, D6), `2026-09-30-contact-quota-package.md` (החלטות 4-10, 4.3.1, 8.7), `2026-09-24-campaign-payment-domain-split.md` (Task 8: `campaigns_guard_activate`).

## Global Constraints

- מיגרציות רק ב-`npx supabase migration new <name>`; הבעלים מריץ `supabase db push --linked --dry-run`, ואז `supabase db push --linked`, ואז `npm run gen:types && npm run types:check`. `types.generated.ts` לא נערך ידנית. אין יצירת נתוני בדיקה במסד החי.
- פונקציית SQL חדשה: `security definer`, `set search_path to 'public'`, `revoke all … from public, anon, authenticated`, `grant execute … to service_role`; ה-ACL נבדק ב-dry-run (`revoke from anon` לא מסיר מ-`public`).
- קוד כסף ומעבר סטטוס: fail-closed. כשל בקריאת היומן הוא "לא ידוע", לא "לא שולם" וגם לא "שולם".
- רק `activateCampaign`/`pauseCampaign`/`closeCampaign` כותבות `campaigns.status` (`campaign-lifecycle-parity.test.ts`). route לא כותב סטטוס.
- בדיקת הבעלות וכללי האירוע (עתידי, פעיל) קודמים לכל כתיבה, כולל המילוי.
- Zod (או parse מפורש) על כל תשובת RPC; בלי `any`; הודעות משתמש בעברית וגנריות; לא נרשמים בלוג פרטי כרטיס, טוקנים, ת"ז או מספרי טלפון.
- מחירים, מכסות ואחוזי ביטול הם נתונים. התוכנית לא מוסיפה אף נוסח או סכום קשיח.
- בלי commit, push, deploy, `npm run build` על העץ החי או הפעלת מיגרציה בלי בקשת הבעלים. כל Task מסתיים בהודעת commit מוכנה בלבד.
- אימות לכל Task: טסטים ממוקדים, אחר כך `npx tsc --noEmit`, `npx eslint <הקבצים>`, וכש-`src/lib/data` משתנה גם `npm run worker:deps`.
- **המתג `app_settings.package_model_enabled` נשאר כבוי.** התוכנית לא מוסיפה כפתור הפעלה, והוא לא נדלק לפני שכל תנאי "אסור להפעיל" (בסוף) מתקיימים.

## מה אומת (4.10, אחרי הכתיבה הראשונה של התוכנית, בקריאה מלאה ולא ב-grep)

| טענה | מקור |
|---|---|
| אחרי רכישה מוצלחת שורת `campaigns` **לא משתנה בכלל**; המקור היחיד לתשלום הוא היומן. הרכישה דורשת `capture_status` ו-`charge_status` ריקים, ולכן הם חייבים להישאר ריקים בקמפיין חבילה | `package-purchase.ts:168`, `:230-290` (אין `update` על `campaigns`) |
| `activateCampaign` דורשת `capture_status='authorized'` לכל מי שמפעיל; לכן קמפיין חבילה ששולם אינו ניתן להפעלה | `campaigns.ts:1135-1150`, `transitionCampaignStatus` `:1036-1111` (`query.eq(extraGuard.column, …)`) |
| השלב `pay`/`live` ב-stepper נגזרים מ-`campaignStage`, שנגזר מ-`capture_status`; קמפיין חבילה ששולם נשאר `awaiting_payment` | `event-labels.ts:130-145`, `setup-steps.ts:121-169` |
| כפתור "הפעל" ומצב "ממתין לתשלום" בדף הניהול נגזרים מ-`capture_status` | `manage-client.tsx:1009-1021` |
| שליחה ומנוע ההפניות קוראים רק את `campaign_authorized_contacts`; רשימה ריקה = אפס נמענים. ה-cron `handleArm` מזריע `outreach_state` מהרשימה לקמפיין `active` ("הפעלה רק מהפכת סטטוס, ה-arm מזריע") | `sendable-contacts.ts:43-51`, `outreach-engine.ts:74-96`, `worker/main.ts:578-590` |
| `snapshotAuthorizedSet` (המילוי הראשון הקיים) נקרא רק מ-`prepareCampaignHold`, כלומר רק בנתיב תפיסת המסגרת | `campaigns.ts:854`, `contacts.ts:437` |
| `reconcile_authorized_set` עובד על קמפיין `approved`/`scheduled`/`active`/`paused`, מכבד מכסה (`quota_full`), ו-`delete` מוציא חבר לא-חשוף ומקטין את הרשימה | מיגרציה `20261004082517`, שורות 42-222 |
| `campaign_authorized_set_audit` מאפשר `action in ('in','out','kept_exposed')` ו-`reason in ('add','repoint','delete','snapshot')` בלבד | `pg_constraint` חי, 4.10 |
| ה-ACL של `reconcile_authorized_set`: `{postgres=X/postgres,service_role=X/postgres}`, `prosecdef=true`, `search_path=public` | `pg_proc` חי, 4.10 |
| היומן חי: סוגי פעולה `authorize(commit)`, `charge(collect)`, `package_purchase(collect)`, `package_upgrade(collect)`, `refund(return)`, `release(void)`; **0 שורות** (הכתיבה הכפולה של המסלול הישן לא נבנתה) | `payment_operation_kinds`, `payment_operations` חי, 4.10 |
| `campaign_payment_ready` ו-`campaigns_guard_activate` **אינם קיימים** במסד החי; הם מתוכננים ב-24.9 Task 8 (Contract) בלבד | `pg_proc` חי; `grep` ב-`supabase/` |
| החוזה v6 מאושר ופעיל בנתונים (הבעלים אישר 4.10, 16:06 UTC); המתג כבוי | `agreement_documents`, `app_settings` חי |
| `app_settings`: `cancellation_fee_percent=5`, `cancellation_fee_cap=100`, `cancellation_refund_days=14` | חי, 4.10 |
| `guests.seq` **אינו קיים** (Task 1 של תוכנית החבילה לא בוצע) | `types.generated.ts`; תוכנית החבילה "אומת מול ה-DB החי" |

**מה לא אומת:** התנהגות `fill_authorized_set` על מסד אמיתי (אין מסד בדיקה; ראו Task 1); המסכים בדפדפן (דורש פריסה); `RECONCILE_AUTHORIZED_SET_ENABLED` בסביבת הפרודקשן הנוכחית (נקרא מ-`.env.local` רק לפי המסמכים).

## סטיות מהתוכנית הראשית (מצריכות החלטה של הבעלים)

תוכנית החבילה (P-C) כתבה: "`fill_authorized_set` בסמנטיקת **החלפה** … חברים חשופים נשארים נעוצים". אחרי קריאת `reconcile_authorized_set` במלואו, שלוש סטיות מוצעות:

1. **השלמה (top-up) ולא החלפה.** הבעלים החליט (4.3.1) שהלקוח יכול להחליף אורח בפנים באורח ממתין לפני הפנייה הראשונה (`repoint`, חי). מילוי בסמנטיקת החלפה לפי `seq` היה מבטל החלפה כזו בהפעלה. השלמה: ממלאת רק את המקומות הפנויים, לפי `seq`, ולעולם לא מוציאה חבר. נשמרות בחירות הלקוח, ואין צורך בנעיצת חשופים כי אין הוצאה.
2. **מילוי גם באישור התנאים, לא רק בהפעלה.** `reconcile_authorized_set` מקבל אורח חדש מרגע ש-`approved`. בלי מילוי באישור, אורח שנוסף אחרי האישור נכנס ראשון לרשימה הריקה, ואורחים שנוספו קודם מתמלאים רק בשארית. המילוי באישור (best-effort) סוגר את זה; המילוי בהפעלה הוא הערובה (אידמפוטנטי).
3. **תנאי המימון נקרא ישירות מהיומן ב-TypeScript**, לא דרך `campaign_payment_ready` ב-SQL (לא קיימת). טריגר ה-DB `campaigns_guard_activate` נשאר ב-24.9 Task 8; קמפיין חבילה ששולם מקיים אותו (פעולה מצליחת עם `effect=collect`).

## מה לא בתוכנית (ולמה)

- **ביטול והחזר של קמפיין ששולם** (P-E): `campaigns_guard_cancel`, `cancel_campaign` ו-`test_event_purge_blocker` עדיין לא מכירים את היומן. קמפיין חבילה שאושר ושולם נראה להם "לפני כסף" ולכן ניתן לביטול בלי החזר. **זה תנאי חובה לפני הדלקת המתג** (ראו "אסור להפעיל"). התוכנית הזאת לא משנה אותם.
- שדרוג והתראות (P-D), מסך אורחים "בחבילה/ממתין" והחלפה בממשק (P-C חלק מסכים; נשאר להמשך), פינוי מקום שנוצר אחרי הפעלה לממתין הראשון (היום ממתין עד שדרוג או עד הרצה חוזרת של המילוי).
- `dispatchVoicePurposeCall` (החלטה פתוחה 8.1), `tax-ceiling.ts` ו-`owner_agent_billing_sums` מהיומן, אירוע GA `purchase`.
- `campaigns_guard_activate` ב-DB (24.9 Task 8).

## Review Focus

1. **שילם והפעלה נדחתה** (אין אנשי קשר, אירוע שחלף, כשל במילוי): הכסף נשאר, הלקוח רואה "התשלום התקבל" עם הסיבה וכפתור הפעלה, ויש התראת Slack. טסטים: Task 5 (סירוב), Task 7 (route, מסך).
2. **הפעלה כפולה** (אוטומטית ולחיצה, שתי לשוניות): הראשונה מצליחה, השנייה נדחית על ידי `.in('status', …)`; המילוי אידמפוטנטי. טסט: Task 1 (הרצה כפולה), Task 5.
3. **גבולות המכסה:** פחות כשירים מהמכסה, שווה, יותר; איש קשר עם כמה אורחים (דרגתו = `min(seq)`); `removal_requested` לא נכנס; חבר קיים לא נספר פעמיים; מכסה 0. טסטי אינטגרציה (Task 1).
4. **אורח שנוסף בזמן המילוי או בין האישור להפעלה:** נעילת שורת הקמפיין מסדרת את שניהם. מילוי באישור (Task 6) מצמצם את חלון ההיפוך.
5. **החזר בין התשלום להפעלה:** ההפעלה קוראת את היומן ברגע ההפעלה. אי אפשר להפוך את הבדיקה לאטומית עם ה-UPDATE עד שיש טריגר DB (24.9 Task 8); זה נשאר פער ידוע, מתועד, וקשור ל-P-E.
6. **קמפיין לפי תוצאה לא משתנה:** המגן נשאר `capture_status='authorized'`, אין קריאה ליומן ואין מילוי. טסטי רגרסיה ב-Task 5.

## מבנה קבצים

| קובץ | פעולה | אחריות |
|---|---|---|
| `supabase/migrations/<ts>_fill_authorized_set.sql` | חדש | `fill_authorized_set(p_event, p_campaign, p_actor)` |
| `src/lib/data/fill-authorized-set.integration.test.ts` | חדש | מקרי DB (מדולג בלי DB בדיקה) |
| `src/lib/data/authorized-fill.ts` (+ `.test.ts`) | חדש | עטיפת RPC + Zod |
| `src/lib/payments/package-paid.ts` (+ `.test.ts`) | חדש | `getPackagePaymentState` (מועבר), `packagePaymentOf` |
| `src/lib/payments/package-purchase.ts` | שינוי קטן | re-export של `getPackagePaymentState` |
| `src/lib/data/event-labels.ts` | שינוי | `campaignStage` מקבל `package_price` ו-`payment` |
| `src/lib/data/setup-steps.ts` | שינוי | קלט `payment`, תווית `pay` בזרימת חבילה |
| `src/lib/data/package-activation-errors.ts` | חדש | קבועי הודעות הסירוב של הפעלת חבילה |
| `src/lib/data/campaigns.ts` | שינוי | `activateCampaign`, `transitionCampaignStatus`, `getCampaignStageForEvent` |
| `src/lib/data/agreements.ts` | שינוי | מילוי באישור התנאים |
| `src/app/api/campaigns/[id]/status/route.ts` | שינוי | הודעות סירוב חדשות ב-`CONFLICT_MESSAGES` |
| `src/app/api/campaigns/[id]/purchase/route.ts` | שינוי | הפעלה אוטומטית אחרי `paid` |
| `src/lib/payments/package-payment-screen.ts` | שינוי | וריאנט `paid` עם `activation` |
| `payment/package-payment-view.tsx`, `payment/page.tsx` | שינוי | כפתור הפעלה, סיבת סירוב |
| `campaign/[campaignId]/page.tsx`, `manage-client.tsx` | שינוי | `packagePaid` |
| `events/[id]/setup/page.tsx`, `setup-steps.tsx`, `stats/page.tsx`, `guests/page.tsx` | שינוי | העברת `payment` ל-`campaignStage` |

---

### Task 0: דרישה מקדימה — `guests.seq` (בלי קוד חדש כאן)

**למה:** "הראשונים לפי סדר ההוספה" דורש עמודת סדר. באירוע הגדול 39 מתוך 43 אורחים חולקים `created_at`, ו-`ORDER BY created_at` לא קובע סדר.

- [ ] **Step 1:** לבצע את Task 1 של `2026-10-04-package-payment-plan.md` כמות שהוא (מיגרציה `guests_seq_order`, `.order('seq')` ב-`buildContactsForEvent`, טסטים). הבעלים מריץ את המיגרציה.
- [ ] **Step 2: בדיקת קריאה בלבד אחרי ההפעלה (כתובה שם, Step 7):** `total = distinct_seq`; `attidentity = 'd'`; שני האינדקסים קיימים.
- [ ] **Gate:** Tasks 1 ואילך לא מתחילים לפני ש-`guests.seq` קיים ב-`types.generated.ts`.

---

### Task 1: פונקציית SQL `fill_authorized_set`

**Files:**
- Create: `supabase/migrations/<ts>_fill_authorized_set.sql`
- Create: `src/lib/data/fill-authorized-set.integration.test.ts`

**Interfaces:**
- Produces: `public.fill_authorized_set(p_event uuid, p_campaign uuid, p_actor text default null) returns jsonb`. התשובה היא אחת מ:
  `{"verdict":"filled","admitted":int,"size":int,"quota":int,"waiting":int}` או `{"verdict":"no_campaign"|"event_mismatch"|"not_operational"|"no_quota"}`.
- Consumes: `guests.seq` (Task 0), `campaigns.contact_quota`, `campaign_authorized_contacts`, `campaign_authorized_set_audit`.

**כללי הפונקציה:** נועלת את שורת הקמפיין (`for update`); דורשת התאמת אירוע (כמו `reconcile_authorized_set`); פועלת רק בסטטוסים `approved`, `scheduled`, `active`, `paused`; דורשת `contact_quota` לא ריק; הכשירות זהה ל-`v_target_ok` שם (איש קשר של האירוע, `removal_requested=false`, יש לו אורח של האירוע); הדרגה היא `min(guests.seq)` ואז `contacts.id`; ממלאת רק `quota - size` מקומות; לא מוציאה אף חבר; כל כניסה נרשמת ב-audit עם `action='in', reason='snapshot'` (אוצר המילים הסגור; אין צורך בשינוי אילוץ).

- [ ] **Step 1: צור את המיגרציה**

Run: `npx supabase migration new fill_authorized_set`

- [ ] **Step 2: כתוב את ה-SQL**

```sql
-- fill_authorized_set: the FIRST fill of a quota campaign's authorized list, in order of addition.
--
-- A package campaign has no card-hold step, so the list that every send reads (campaign_authorized_contacts)
-- is empty until something fills it. This function admits the first eligible contacts by guests.seq up to
-- campaigns.contact_quota. It only TOPS UP: it never removes a member, so a swap the customer made through
-- reconcile_authorized_set (repoint) before activation is kept, and a member that already has service exposure
-- is never touched. Re-running it is a no-op unless room appeared (a guest was deleted).
--
-- Eligibility is the one reconcile_authorized_set uses for ADD (v_target_ok), so the two writers agree on who
-- may be on the list. The campaign row is locked FOR UPDATE, which serialises this with every reconcile call.
--
-- Rank of a contact = the smallest guests.seq among its guests (order of addition; created_at is shared by a
-- bulk import and cannot order). Audit rows use reason 'snapshot' (the closed vocabulary of
-- campaign_authorized_set_audit_reason_check; no constraint change).
--
-- ROLLBACK: drop function public.fill_authorized_set(uuid, uuid, text);

create or replace function public.fill_authorized_set(
  p_event    uuid,
  p_campaign uuid,
  p_actor    text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_event_id uuid;
  v_status   text;
  v_quota    int;
  v_size     int;
  v_room     int;
  v_admitted int := 0;
  v_waiting  int;
  r          record;
begin
  select event_id, status::text, contact_quota
    into v_event_id, v_status, v_quota
    from public.campaigns
    where id = p_campaign
    for update;
  if not found then
    return jsonb_build_object('verdict', 'no_campaign');
  end if;
  if p_event is distinct from v_event_id then
    return jsonb_build_object('verdict', 'event_mismatch');
  end if;
  if v_status not in ('approved', 'scheduled', 'active', 'paused') then
    return jsonb_build_object('verdict', 'not_operational');
  end if;
  if v_quota is null then
    return jsonb_build_object('verdict', 'no_quota');
  end if;

  select count(*) into v_size
    from public.campaign_authorized_contacts
    where campaign_id = p_campaign;
  v_room := greatest(v_quota - v_size, 0);

  for r in
    select c.id as contact_id
      from public.contacts c
      cross join lateral (
        select min(g.seq) as first_seq
          from public.guests g
          where g.event_id = v_event_id and g.contact_id = c.id
      ) fg
      where c.event_id = v_event_id
        and c.removal_requested = false
        and fg.first_seq is not null
        and not exists (
          select 1 from public.campaign_authorized_contacts a
          where a.campaign_id = p_campaign and a.contact_id = c.id
        )
      order by fg.first_seq, c.id
      limit v_room
  loop
    insert into public.campaign_authorized_contacts (event_id, campaign_id, contact_id)
      values (v_event_id, p_campaign, r.contact_id)
      on conflict (campaign_id, contact_id) do nothing;
    v_size := v_size + 1;
    v_admitted := v_admitted + 1;
    insert into public.campaign_authorized_set_audit
      (event_id, campaign_id, contact_id, prev_contact_id, action, reason, actor, resulting_size)
      values (v_event_id, p_campaign, r.contact_id, null, 'in', 'snapshot', p_actor, v_size);
  end loop;

  -- Eligible contacts that did not get a seat: they WAIT (visible to the owner later; an upgrade admits them).
  select count(*) into v_waiting
    from public.contacts c
    where c.event_id = v_event_id
      and c.removal_requested = false
      and exists (select 1 from public.guests g where g.event_id = v_event_id and g.contact_id = c.id)
      and not exists (
        select 1 from public.campaign_authorized_contacts a
        where a.campaign_id = p_campaign and a.contact_id = c.id
      );

  return jsonb_build_object(
    'verdict', 'filled',
    'admitted', v_admitted,
    'size', v_size,
    'quota', v_quota,
    'waiting', v_waiting
  );
end;
$function$;

revoke all on function public.fill_authorized_set(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.fill_authorized_set(uuid, uuid, text) to service_role;
```

- [ ] **Step 3: מקרי אינטגרציה (מדולגים בלי DB בדיקה)**

`src/lib/data/fill-authorized-set.integration.test.ts` באותו דפוס שער של `reconcile.integration.test.ts` (`OUTREACH_DB_IT=1`, `resolveTestDb()` שנכשל בכוונה מול prod, כל מקרה בתוך `begin … rollback` עם `session_replication_role = replica`):

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

import { resolveTestDb } from '@/lib/outreach/test-db-guard';

const RUN = process.env.OUTREACH_DB_IT === '1';
const TEST = RUN ? resolveTestDb() : null;

describe.skipIf(!RUN)('fill_authorized_set — rollback-isolated', () => {
  let pool: Pool;
  beforeAll(() => {
    pool = new Pool({ connectionString: TEST!.dbUrl, ssl: { rejectUnauthorized: false }, max: 1, application_name: 'kalfa-fill-it' });
  });
  afterAll(async () => { if (pool) await pool.end(); });

  // guests: [{ contact, seq }] — one row per guest; a contact may have several guests.
  async function run(
    cfg: { quota: number | null; status?: string; removed?: string[]; preMembers?: string[] },
    guests: Array<{ contact: string; seq: number }>,
    fn: (ctx: { event: string; campaign: string; call: () => Promise<Record<string, unknown>>; members: () => Promise<string[]> }) => Promise<void>,
  ) {
    const event = randomUUID();
    const campaign = randomUUID();
    const q = (t: string, v?: unknown[]) => pool.query(t, v);
    await q('begin');
    try {
      await q('set local session_replication_role = replica');
      await q(
        `insert into public.campaigns (id, event_id, status, max_contacts, price_per_reached, base_price, included_reached, contact_quota)
         values ($1,$2,$3,0,0,0,0,$4)`,
        [campaign, event, cfg.status ?? 'approved', cfg.quota],
      );
      // contacts.normalized_phone and guests.full_name are NOT NULL without a default (checked on the live schema).
      let phone = 0;
      for (const id of new Set(guests.map((g) => g.contact))) {
        await q(
          `insert into public.contacts (id, event_id, normalized_phone, removal_requested) values ($1,$2,$3,$4)`,
          [id, event, `+97250000${String(++phone).padStart(4, '0')}`, (cfg.removed ?? []).includes(id)],
        );
      }
      for (const g of guests) {
        await q(
          `insert into public.guests (id, event_id, full_name, contact_id, seq) values ($1,$2,'Test Guest',$3,$4)`,
          [randomUUID(), event, g.contact, g.seq],
        );
      }
      for (const id of cfg.preMembers ?? []) {
        await q(`insert into public.campaign_authorized_contacts (event_id, campaign_id, contact_id) values ($1,$2,$3)`, [event, campaign, id]);
      }
      await fn({
        event,
        campaign,
        call: async () => (await q(`select public.fill_authorized_set($1,$2,'it') as r`, [event, campaign])).rows[0].r as Record<string, unknown>,
        members: async () => (await q(`select contact_id from public.campaign_authorized_contacts where campaign_id=$1`, [campaign])).rows.map((r) => r.contact_id as string),
      });
    } finally {
      await q('rollback');
    }
  }

  const A = randomUUID(), B = randomUUID(), C = randomUUID(), D = randomUUID();

  it('admits the first contacts by seq up to the quota; the rest wait', async () => {
    await run({ quota: 2 }, [{ contact: C, seq: 3 }, { contact: A, seq: 1 }, { contact: B, seq: 2 }, { contact: D, seq: 4 }], async (x) => {
      expect(await x.call()).toEqual({ verdict: 'filled', admitted: 2, size: 2, quota: 2, waiting: 2 });
      expect((await x.members()).sort()).toEqual([A, B].sort());
    });
  });

  it('ranks a contact by the SMALLEST seq among its guests', async () => {
    await run({ quota: 1 }, [{ contact: A, seq: 5 }, { contact: B, seq: 2 }, { contact: A, seq: 1 }], async (x) => {
      await x.call();
      expect(await x.members()).toEqual([A]);
    });
  });

  it('fewer eligible than the quota: admits all, nobody waits', async () => {
    await run({ quota: 10 }, [{ contact: A, seq: 1 }, { contact: B, seq: 2 }], async (x) => {
      expect(await x.call()).toMatchObject({ admitted: 2, size: 2, waiting: 0 });
    });
  });

  it('never removes a member and keeps a swap: a pre-existing member outside the first N stays, and takes its seat', async () => {
    await run({ quota: 2, preMembers: [D] }, [{ contact: A, seq: 1 }, { contact: B, seq: 2 }, { contact: D, seq: 9 }], async (x) => {
      expect(await x.call()).toMatchObject({ admitted: 1, size: 2 });
      expect((await x.members()).sort()).toEqual([A, D].sort());
    });
  });

  it('is idempotent: a second call admits nobody', async () => {
    await run({ quota: 2 }, [{ contact: A, seq: 1 }, { contact: B, seq: 2 }, { contact: C, seq: 3 }], async (x) => {
      await x.call();
      expect(await x.call()).toMatchObject({ admitted: 0, size: 2, waiting: 1 });
    });
  });

  it('skips a contact that asked to be removed', async () => {
    await run({ quota: 2, removed: [A] }, [{ contact: A, seq: 1 }, { contact: B, seq: 2 }, { contact: C, seq: 3 }], async (x) => {
      await x.call();
      expect((await x.members()).sort()).toEqual([B, C].sort());
    });
  });

  it('quota 0 admits nobody', async () => {
    await run({ quota: 0 }, [{ contact: A, seq: 1 }], async (x) => {
      expect(await x.call()).toMatchObject({ admitted: 0, size: 0, waiting: 1 });
    });
  });

  it.each([
    ['no quota', { quota: null }, 'no_quota'],
    ['a campaign that is not operational', { quota: 5, status: 'pending_approval' }, 'not_operational'],
  ])('answers %s with its verdict and writes nothing', async (_l, cfg, verdict) => {
    await run(cfg, [{ contact: A, seq: 1 }], async (x) => {
      expect(await x.call()).toEqual({ verdict });
      expect(await x.members()).toEqual([]);
    });
  });

  it('refuses a campaign of another event', async () => {
    await run({ quota: 5 }, [{ contact: A, seq: 1 }], async (x) => {
      const r = (await pool.query(`select public.fill_authorized_set($1,$2,'it') as r`, [randomUUID(), x.campaign])).rows[0].r;
      expect(r).toEqual({ verdict: 'event_mismatch' });
    });
  });

  it('writes one audit row per admission (action in, reason snapshot) with the growing size', async () => {
    await run({ quota: 2 }, [{ contact: A, seq: 1 }, { contact: B, seq: 2 }], async (x) => {
      await x.call();
      const rows = (await pool.query(
        `select action, reason, actor, resulting_size from public.campaign_authorized_set_audit where campaign_id=$1 order by resulting_size`,
        [x.campaign],
      )).rows;
      expect(rows).toEqual([
        { action: 'in', reason: 'snapshot', actor: 'it', resulting_size: 1 },
        { action: 'in', reason: 'snapshot', actor: 'it', resulting_size: 2 },
      ]);
    });
  });
});
```

- [ ] **Step 4: הרצה (מדולגת) ואימות שהקובץ תקין**

Run: `npx vitest run src/lib/data/fill-authorized-set.integration.test.ts` → Expected: כל המקרים SKIPPED (בלי `OUTREACH_DB_IT=1`), בלי שגיאת טעינה.

- [ ] **Step 5: הבעלים מריץ ובודק (קריאה בלבד)**

```bash
supabase db push --linked --dry-run
supabase db push --linked && npm run gen:types && npm run types:check
```

```sql
-- ה-ACL זהה לזה של reconcile_authorized_set, וחוץ מזה SECURITY DEFINER עם search_path קבוע
select proname, prosecdef, proconfig::text, proacl::text
  from pg_proc where proname in ('fill_authorized_set', 'reconcile_authorized_set') order by 1;
-- צפוי, לשתיהן: prosecdef=t, {search_path=public}, {postgres=X/postgres,service_role=X/postgres}
```

אסור ליצור נתוני בדיקה במסד החי. ההתנהגות נבדקת במקרי האינטגרציה כשיהיה מסד בדיקה, ובינתיים בקריאת ה-diff ובשער ה-₪1 (Task 8).

- [ ] **Step 6: commit מוכן (לא מבוצע)** `feat(db): fill_authorized_set — first fill of a quota campaign's list, in order of addition`

---

### Task 2: עטיפת ה-RPC

**Files:**
- Create: `src/lib/data/authorized-fill.ts`
- Create: `src/lib/data/authorized-fill.test.ts`

**Interfaces:**
- Produces: `fillAuthorizedSet(eventId: string, campaignId: string, actor: string): Promise<FillResult>`; `type FillResult` = האיחוד של Task 1.
- Consumes: `createAdminClient`, `fill_authorized_set` (מופיע ב-`types.generated.ts` אחרי Task 1).

- [ ] **Step 1: טסט נכשל**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { fillAuthorizedSet } from './authorized-fill';

function rpcReturning(result: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(result);
  vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
  return rpc;
}

beforeEach(() => {
  vi.mocked(createAdminClient).mockReset();
});

describe('fillAuthorizedSet', () => {
  it('calls the function with the event, the campaign and the actor and returns the parsed answer', async () => {
    const rpc = rpcReturning({ data: { verdict: 'filled', admitted: 3, size: 3, quota: 100, waiting: 0 }, error: null });
    expect(await fillAuthorizedSet('e1', 'c1', 'activation')).toEqual({ verdict: 'filled', admitted: 3, size: 3, quota: 100, waiting: 0 });
    expect(rpc).toHaveBeenCalledWith('fill_authorized_set', { p_event: 'e1', p_campaign: 'c1', p_actor: 'activation' });
  });

  it.each(['no_campaign', 'event_mismatch', 'not_operational', 'no_quota'])('returns the %s verdict as it is', async (verdict) => {
    rpcReturning({ data: { verdict }, error: null });
    expect(await fillAuthorizedSet('e1', 'c1', 'activation')).toEqual({ verdict });
  });

  it('throws a safe message when the database fails, never the database message', async () => {
    rpcReturning({ data: null, error: { message: 'permission denied for table campaigns' } });
    await expect(fillAuthorizedSet('e1', 'c1', 'activation')).rejects.toThrow('מילוי רשימת אנשי הקשר נכשל');
  });

  it.each([
    ['an unknown verdict', { verdict: 'maybe' }],
    ['a filled answer without counts', { verdict: 'filled' }],
    ['a negative count', { verdict: 'filled', admitted: -1, size: 0, quota: 1, waiting: 0 }],
    ['a fractional count', { verdict: 'filled', admitted: 1.5, size: 1, quota: 2, waiting: 0 }],
    ['nothing at all', null],
  ])('refuses %s: an answer the code has no branch for must not pass as success', async (_label, data) => {
    rpcReturning({ data, error: null });
    await expect(fillAuthorizedSet('e1', 'c1', 'activation')).rejects.toThrow('מילוי רשימת אנשי הקשר החזיר תשובה לא מוכרת');
  });
});
```

- [ ] **Step 2:** `npx vitest run src/lib/data/authorized-fill.test.ts` → FAIL (המודול לא קיים).

- [ ] **Step 3: מימוש**

```ts
import 'server-only';

import { z } from 'zod';

import { createAdminClient } from '@/lib/supabase/admin';

// The first fill of a quota campaign's authorized list (SQL: fill_authorized_set). Service-role and request-free: the
// caller has already authorized the campaign. Request-free so the worker can import it too.

const count = z.number().int().nonnegative();

const fillResultSchema = z.discriminatedUnion('verdict', [
  z.object({ verdict: z.literal('filled'), admitted: count, size: count, quota: count, waiting: count }),
  z.object({ verdict: z.literal('no_campaign') }),
  z.object({ verdict: z.literal('event_mismatch') }),
  z.object({ verdict: z.literal('not_operational') }),
  z.object({ verdict: z.literal('no_quota') }),
]);

export type FillResult = z.infer<typeof fillResultSchema>;

export async function fillAuthorizedSet(eventId: string, campaignId: string, actor: string): Promise<FillResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('fill_authorized_set', {
    p_event: eventId,
    p_campaign: campaignId,
    p_actor: actor,
  });
  if (error) throw new Error('מילוי רשימת אנשי הקשר נכשל');
  const parsed = fillResultSchema.safeParse(data);
  if (!parsed.success) throw new Error('מילוי רשימת אנשי הקשר החזיר תשובה לא מוכרת');
  return parsed.data;
}
```

- [ ] **Step 4:** `npx vitest run src/lib/data/authorized-fill.test.ts` → PASS. `npx tsc --noEmit`, `npx eslint src/lib/data/authorized-fill*.ts`, `npm run worker:deps`.
- [ ] **Step 5: commit מוכן** `feat(data): fillAuthorizedSet wrapper with a validated answer`

---

### Task 3: מצב התשלום של קמפיין חבילה, בקובץ קל

**Files:**
- Create: `src/lib/payments/package-paid.ts`, `src/lib/payments/package-paid.test.ts`
- Modify: `src/lib/payments/package-purchase.ts` (מעביר את `getPackagePaymentState`)

**למה קובץ נפרד:** `campaigns.ts` צריך את מצב התשלום, ואסור לו לייבא את `package-purchase.ts` (שמושך את שכבת SUMIT) כדי לא להכביד על `worker:deps`.

**Interfaces:**
- Produces: `getPackagePaymentState(campaignId): Promise<PaymentState>` (זורק אם היומן לא נקרא; זה התפקיד הקיים), `packagePaymentOf(campaign: { id: string; package_price?: number | null }): Promise<PaymentState | null>`: `null` לקמפיין שאינו חבילה **ולכשל קריאה**, ולכן "לא ממומן" (כיוון בטוח).
- Consumes: `loadOperations` (`ledger.ts`), `deriveStatus` (`status.ts`), `createAdminClient`.

- [ ] **Step 1: טסט נכשל** (`package-paid.test.ts`)

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('./ledger', () => ({ loadOperations: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { loadOperations } from './ledger';
import { getPackagePaymentState, packagePaymentOf } from './package-paid';

const COLLECTED = [{ kind: 'package_purchase', effect: 'collect', outcome: 'succeeded', amount: 150, occurredAt: '2026-10-04T10:00:00Z', recordedAt: '2026-10-04T10:00:01Z' }] as const;

beforeEach(() => {
  vi.mocked(createAdminClient).mockReset().mockReturnValue({} as never);
  vi.mocked(loadOperations).mockReset();
});

describe('getPackagePaymentState', () => {
  it('derives the state from the ledger', async () => {
    vi.mocked(loadOperations).mockResolvedValue([...COLLECTED]);
    expect(await getPackagePaymentState('c1')).toMatchObject({ status: 'collected', collected: 150 });
  });

  it('throws when the ledger cannot be read — an unreadable ledger must never look like "nothing paid"', async () => {
    vi.mocked(loadOperations).mockRejectedValue(new Error('db down'));
    await expect(getPackagePaymentState('c1')).rejects.toThrow('db down');
  });
});

describe('packagePaymentOf', () => {
  it('is null for a campaign that is not a package, without touching the ledger', async () => {
    expect(await packagePaymentOf({ id: 'c1', package_price: null })).toBeNull();
    expect(await packagePaymentOf({ id: 'c1' })).toBeNull();
    expect(loadOperations).not.toHaveBeenCalled();
  });

  it('is the ledger state for a package campaign', async () => {
    vi.mocked(loadOperations).mockResolvedValue([...COLLECTED]);
    expect(await packagePaymentOf({ id: 'c1', package_price: 150 })).toMatchObject({ status: 'collected' });
  });

  it('is null — "not funded" — when the ledger cannot be read, and says so in the log without any card data', async () => {
    vi.mocked(loadOperations).mockRejectedValue(new Error('db down'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await packagePaymentOf({ id: 'c1', package_price: 150 })).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});
```

- [ ] **Step 2:** → FAIL.
- [ ] **Step 3: מימוש**

```ts
import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

import { loadOperations } from './ledger';
import { deriveStatus, type PaymentState } from './status';

// The campaign's payment state, DERIVED from the ledger — the one thing the purchase, the payment page, the stage of
// the campaign and its activation all decide on, so a reload, a second tab or a stale `?paid=1` can never disagree
// with what was actually recorded. Throws when the ledger cannot be read: an unreadable ledger must never look like
// "nothing paid".
export async function getPackagePaymentState(campaignId: string): Promise<PaymentState> {
  return deriveStatus(await loadOperations(createAdminClient(), campaignId));
}

// The payment state a SCREEN needs to compute the stage of a campaign: only a package campaign has one (a
// pay-per-result campaign is funded by its card hold, a column of the campaign). An unreadable ledger answers null —
// "not funded" — which is the safe direction for a display: the payment page, which fails closed on its own, then
// tells the customer what is wrong.
export async function packagePaymentOf(campaign: {
  id: string;
  package_price?: number | null;
}): Promise<PaymentState | null> {
  if (campaign.package_price == null) return null;
  try {
    return await getPackagePaymentState(campaign.id);
  } catch (err) {
    console.error('[package-paid] payment state could not be read', {
      campaignId: campaign.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
```

ב-`package-purchase.ts`: למחוק את הגדרת `getPackagePaymentState` (שורות 113-118) ואת הייבוא שנעשה מיותר (`loadOperations`, `deriveStatus` אם אינם בשימוש), ולהוסיף:

```ts
import { getPackagePaymentState } from './package-paid';
export { getPackagePaymentState };
```

כך `payment/page.tsx` ו-`package-purchase.test.ts` ממשיכים לייבא משם.

- [ ] **Step 4:** `npx vitest run src/lib/payments` → PASS (כולל 55 הטסטים הקיימים של הרכישה). `npx tsc --noEmit`, `npx eslint`, `npm run worker:deps`.
- [ ] **Step 5: commit מוכן** `refactor(payments): package payment state in its own light module`

---

### Task 4: שלב הקמפיין ושלבי ההקמה מהיומן

**Files:**
- Modify: `src/lib/data/event-labels.ts` (`campaignStage`)
- Modify: `src/lib/data/setup-steps.ts` (קלט, תווית)
- Modify: `src/lib/data/campaigns.ts:465-485` (`getCampaignStageForEvent`)
- Modify (העברת `payment`): `events/[id]/setup/page.tsx:73`, `events/[id]/setup-steps.tsx:48`, `events/[id]/stats/page.tsx:78`, `campaign/[campaignId]/page.tsx:179` + `manage-client.tsx:318,1009-1021`
- Modify: `src/lib/data/campaign-status.ts` (`isCampaignCancellable`)
- Test: `event-labels.test.ts`, `setup-steps.test.ts`, `campaign-status.test.ts`, `campaigns.test.ts`

**Interfaces:**
- Produces: `campaignStage(campaign: { status; capture_status; package_price?: number | null; payment?: Pick<PaymentState, 'status'> | null } | null)`. **ממומן** = `capture_status === 'authorized'` (מודל ישן, בלי שינוי) **או** (`package_price != null` ו-`payment.status === 'collected'`).
- Produces: `PACKAGE_PAY_LABEL = 'תשלום החבילה'` ב-`setup-steps.ts`; `setupStepLabels` מחליפה בו את `pay` בזרימת חבילה.

- [ ] **Step 1: טסטים נכשלים**

ב-`event-labels.test.ts`:

```ts
describe('campaignStage — a package campaign is funded by its payment, not by a card hold', () => {
  const approved = { status: 'approved' as const, capture_status: null, package_price: 150 };

  it('approved and paid in full: awaiting activation', () => {
    expect(campaignStage({ ...approved, payment: { status: 'collected' } })).toBe('awaiting_activation');
  });

  it.each(['none', 'pending', 'review', 'declined', 'refunded', 'released', 'committed'] as const)(
    'approved with payment %s: still awaiting payment',
    (status) => {
      expect(campaignStage({ ...approved, payment: { status } })).toBe('awaiting_payment');
    },
  );

  it('approved package whose payment could not be read (null): awaiting payment — the safe direction', () => {
    expect(campaignStage({ ...approved, payment: null })).toBe('awaiting_payment');
  });

  it('a campaign that is not a package ignores any payment it is handed', () => {
    expect(campaignStage({ status: 'approved', capture_status: null, package_price: null, payment: { status: 'collected' } })).toBe('awaiting_payment');
  });

  it('the pay-per-result rule is unchanged', () => {
    expect(campaignStage({ status: 'approved', capture_status: 'authorized' })).toBe('awaiting_activation');
    expect(campaignStage({ status: 'approved', capture_status: 'pending' })).toBe('awaiting_payment');
    expect(campaignStage({ status: 'scheduled', capture_status: 'authorized' })).toBe('awaiting_activation');
  });

  it('statuses past activation do not depend on the payment', () => {
    for (const status of ['active', 'paused', 'closed'] as const) {
      expect(campaignStage({ status, capture_status: null, package_price: 150, payment: null })).toBe(campaignStage({ status, capture_status: 'authorized' }));
    }
  });
});
```

ב-`setup-steps.test.ts`:

```ts
describe('computeSetupSteps — a package campaign after payment', () => {
  const event = { status: 'active', event_type: 'wedding', event_date: '2999-01-01T10:00:00+00:00', venue_name: 'אולם', venue_address: 'רחוב 1', celebrants: { a: 'x' } } as never;
  const campaign = (payment: { status: string } | null) =>
    ({ status: 'approved', capture_status: null, package_price: 150, payment }) as never;
  const keys = (r: ReturnType<typeof computeSetupSteps>) => Object.fromEntries(r.steps.map((s) => [s.key, s.state]));

  it('unpaid: the payment step is current, and the campaign is not live', () => {
    expect(keys(computeSetupSteps({ event, campaign: campaign({ status: 'none' }), isPast: false }))).toMatchObject({ package: 'done', sign: 'done', pay: 'current', live: 'pending' });
  });

  it('paid, not yet active: payment done, activation is the current step', () => {
    const r = computeSetupSteps({ event, campaign: campaign({ status: 'collected' }), isPast: false });
    expect(keys(r)).toMatchObject({ pay: 'done', live: 'current' });
    expect(r.stage).toBe('awaiting_activation');
  });

  it('names the payment step for what the owner does', () => {
    const r = computeSetupSteps({ event, campaign: campaign({ status: 'none' }), isPast: false });
    expect(setupStepLabels(r.steps).pay).toBe(PACKAGE_PAY_LABEL);
    expect(setupStepLabels(computeSetupSteps({ event, campaign: { status: 'approved', capture_status: null } as never, isPast: false }).steps).pay).toBe(SETUP_STEP_LABELS.pay);
  });
});
```

ב-`campaign-status.test.ts`:

```ts
describe('isCampaignCancellable — a paid package is not erased by flipping its status', () => {
  const approved = { status: 'approved' as const, capture_status: null, charge_status: null };
  it.each(['collected', 'pending', 'review'] as const)('is false while the payment is %s', (status) => {
    expect(isCampaignCancellable({ ...approved, payment: { status } }, 0)).toBe(false);
  });
  it.each(['none', 'declined', 'refunded'] as const)('stays as before when the payment is %s', (status) => {
    expect(isCampaignCancellable({ ...approved, payment: { status } }, 0)).toBe(true);
  });
  it('is unchanged for a campaign that was not given a payment', () => {
    expect(isCampaignCancellable(approved, 0)).toBe(true);
  });
});
```

> **זה רק הכפתור.** `cancel_campaign` ב-SQL עדיין מקבל קמפיין חבילה ששולם (הוא קורא רק `capture_status`/`charge_status`). השער האמיתי הוא P-E ("אסור להפעיל"); הטסט כאן מונע רק שהממשק יציע ביטול.

- [ ] **Step 2:** `npx vitest run src/lib/data/event-labels.test.ts src/lib/data/setup-steps.test.ts src/lib/data/campaign-status.test.ts` → FAIL.

- [ ] **Step 3: מימוש**

`event-labels.ts`:

```ts
import type { PaymentState } from '@/lib/payments/status';

export type CampaignStageInput = {
  status: CampaignStatus;
  capture_status: string | null;
  // `package_price` set = a fixed-price package campaign, funded by its payment (the ledger); otherwise by a card hold.
  package_price?: number | null;
  payment?: Pick<PaymentState, 'status'> | null;
};

// Funded = ready to start. Pay-per-result: a confirmed card hold (the only `authorized` is a confirmed hold, see the
// capture_status vocabulary in campaigns.ts). Package: paid in full according to the ledger.
function isFunded(c: CampaignStageInput): boolean {
  if (c.capture_status === 'authorized') return true;
  return (c.package_price ?? null) != null && c.payment?.status === 'collected';
}

export function campaignStage(campaign: CampaignStageInput | null): CampaignStage {
  if (!campaign) return 'not_set';
  switch (campaign.status) {
    // …draft / pending_approval unchanged…
    case 'approved':
    case 'scheduled':
      return isFunded(campaign) ? 'awaiting_activation' : 'awaiting_payment';
    // …active / paused / closed… unchanged
  }
}
```

(השאר בפונקציה כמות שהוא; רק הענף של `approved`/`scheduled` ונקודת הכניסה משתנים.)

`setup-steps.ts`: ב-`SetupInput.campaign` להוסיף `payment?: Pick<PaymentState, 'status'> | null`; `computeSetupSteps` כבר קוראת `campaignStage(input.campaign)` ולכן מקבלת את השינוי; להוסיף:

```ts
export const PACKAGE_PAY_LABEL = 'תשלום החבילה';

export function setupStepLabels(steps: readonly SetupStep[]): Record<SetupStepKey, string> {
  const packageFlow = steps.some((s) => s.key === 'package');
  return packageFlow ? { ...SETUP_STEP_LABELS, sign: PACKAGE_SIGN_LABEL, pay: PACKAGE_PAY_LABEL } : SETUP_STEP_LABELS;
}
```

`campaign-status.ts`:

```ts
export function isCampaignCancellable(
  campaign: {
    status: CampaignStatus;
    capture_status: string | null;
    charge_status: string | null;
    // The ledger state of a package campaign; absent for the other model.
    payment?: { status: string } | null;
  },
  reachedCount: number,
): boolean {
  return (
    (CANCELLABLE_CAMPAIGN_STATUSES as readonly CampaignStatus[]).includes(campaign.status) &&
    !BLOCKING_CAPTURE_STATUSES.has(campaign.capture_status ?? '') &&
    !BLOCKING_PAYMENT_STATUSES.has(campaign.payment?.status ?? '') &&
    campaign.charge_status === null &&
    reachedCount === 0
  );
}
const BLOCKING_PAYMENT_STATUSES = new Set(['collected', 'pending', 'review']);
```

`campaigns.ts` `getCampaignStageForEvent` (קרא את הפונקציה: `select('status, capture_status')` ב-`:478`):

```ts
// select: add package_price
const { data } = await supabase.from('campaigns').select('id, status, capture_status, package_price') /* …same filters… */;
return campaignStage(data ? { ...data, payment: await packagePaymentOf(data) } : null);
```

(מייבאים `packagePaymentOf` מ-`@/lib/payments/package-paid`.) אם `data` הוא `null` — `null` כמו היום.

**מעבירים `payment` בכל קורא:** בכל אחד מהמקומות הבאים לקרוא `const payment = campaign ? await packagePaymentOf(campaign) : null` (אחרי שנטענה שורת הקמפיין, ורק אחרי בדיקת הבעלות שכבר קיימת שם) ולהעביר ל-`computeSetupSteps({ …, campaign: campaign && { ...campaign, payment } })` / `campaignStage({ …, payment })`:
- `setup/page.tsx:73`, `setup-steps.tsx:48` (גם הכרטיס של האירוע, כדי שלא יציג "ממתין לתשלום" אחרי תשלום),
- `stats/page.tsx:78` (קורא `stats.campaign` שלא כולל `package_price`: להוסיף `packagePrice` ל-`event-stats.ts` בשורת הקמפיין שהוא כבר בוחר, ולהעביר),
- `campaign/[campaignId]/page.tsx:179` ל-`manage-client.tsx`: להוסיף prop בוליאני `packagePaid` (= `payment?.status === 'collected'`) ו-`packagePrice`. ב-`manage-client.tsx`: `campaignStage({ status, capture_status: captureStatus, package_price: packagePrice, payment: packagePaid ? { status: 'collected' } : null })` (`:318`), ובבלוק `:1009-1021`:

```ts
const funded = campaign.capture_status === 'authorized' || packagePaid;
const heldOrLive = funded && ['approved', 'scheduled', 'active', 'paused'].includes(status);
// …
const canActivate = !isPast && activatableState && funded;
const needsPayment = !isPast && status === 'approved' && !funded;
```

`canSettle` (`:1032`) נשאר על `capture_status === 'authorized'` בלבד: סילוק חיוב סופי הוא של המודל הישן. ל-`isCampaignCancellable(campaign, reached)` (`:1038`) להעביר `payment: packagePaid ? { status: 'collected' } : null`.

- [ ] **Step 4:** הטסטים של Step 2 → PASS; `npx vitest run src/lib/data src/app/(customer)/app/events` → PASS (כולל `setup/page.test.tsx` ו-`setup-stepper.test.tsx`; לעדכן מה ששבר באמצעות הוספת `payment` ולא החלשת טענה). `npx tsc --noEmit`, `npx eslint`, `npm run worker:deps`.
- [ ] **Step 5: commit מוכן** `feat(campaigns): the stage and the setup steps of a package campaign come from the payment ledger`

---

### Task 5: `activateCampaign` — ענף החבילה

**Files:**
- Create: `src/lib/data/package-activation-errors.ts` (קבועים בלבד, בלי `server-only`, כדי שגם רכיב לקוח יוכל לייבא אותם; אותו דפוס כמו `package-purchase-errors.ts`)
- Modify: `src/lib/data/campaigns.ts` (`transitionCampaignStatus`, `activateCampaign`)
- Modify: `src/app/api/campaigns/[id]/status/route.ts` (`CONFLICT_MESSAGES`)
- Test: `src/lib/data/campaigns.test.ts`

**Interfaces:**
- Produces, ב-`package-activation-errors.ts` (כדי שה-route והמסכים יזהו אותם בלי להשוות מחרוזות בעותק): `PACKAGE_NOT_PAID_ERROR = 'התשלום על החבילה טרם הושלם'`, `PACKAGE_PAYMENT_UNVERIFIED_ERROR = 'לא ניתן לאמת את התשלום כרגע — נסו שוב בעוד רגע'`, `PACKAGE_NO_CONTACTS_ERROR = 'יש להוסיף מוזמנים לפני הפעלת הקמפיין'`, `PACKAGE_SUPPORT_ERROR = 'לא ניתן להפעיל את הקמפיין — פנו לתמיכה'`.
- Consumes: `packagePaymentOf`/`getPackagePaymentState` (Task 3), `fillAuthorizedSet` (Task 2).

**עיצוב:** `transitionCampaignStatus` מקבלת במקום הפרמטר הרביעי (`extraGuard`) את `funding?: 'by_model'`, ובתוך `opts` את `preparePackage?(campaign)`; `pauseCampaign` ו-`closeCampaign` ממשיכות להעביר `undefined` באותו מקום, ולכן הצורה המיקומית של שלוש הקריאות נשמרת. אחרי הזיהוי, בדיקות הבעלות ובדיקות האירוע (עתידי, פעיל), ולפני ה-UPDATE: קמפיין חבילה מריץ `preparePackage` (תנאי המימון מהיומן, ואז המילוי); ה-UPDATE מוגן ב-`package_price IS NOT NULL AND capture_status IS NULL AND charge_status IS NULL`. קמפיין לפי תוצאה: בדיוק מה שהיה (`capture_status='authorized'`). הקריאה הראשונה בפונקציה כבר טוענת את שורת הקמפיין; מוסיפים לה `package_price` בלי שאילתה נוספת (הטסטים הקיימים, שמחזירים שורה בלי `package_price`, ממשיכים לעבוד כמודל ישן).

- [ ] **Step 1: טסטים נכשלים** (`campaigns.test.ts`, describe חדש; משתמשים ב-`adminByTable` הקיים ובמוקים של `fillAuthorizedSet` ו-`package-paid`)

```ts
vi.mock('@/lib/data/authorized-fill', () => ({ fillAuthorizedSet: vi.fn() }));
vi.mock('@/lib/payments/package-paid', () => ({
  getPackagePaymentState: vi.fn(),
  packagePaymentOf: vi.fn(),
}));
```

```ts
describe('activateCampaign — a paid package campaign', () => {
  const PACKAGE_ROW = { id: 'c1', event_id: 'e1', package_price: 150 };
  const FUTURE = { event_date: '2999-01-01T00:00:00+00:00', status: 'active' };

  function wire(row: Record<string, unknown> = PACKAGE_ROW) {
    vi.mocked(requireOwnedEvent).mockResolvedValue(ownedEvent());
    vi.mocked(getPackagePaymentState).mockResolvedValue({ status: 'collected', collected: 150, committed: 0 });
    vi.mocked(fillAuthorizedSet).mockResolvedValue({ verdict: 'filled', admitted: 3, size: 3, quota: 100, waiting: 0 });
    return adminByTable({ campaigns: row, events: FUTURE });
  }

  beforeEach(() => {
    vi.mocked(getPackagePaymentState).mockReset();
    vi.mocked(fillAuthorizedSet).mockReset();
  });

  it('checks the ledger, fills the list, then moves to active — guarded by the package model and not by a card hold', async () => {
    const b = wire();
    await activateCampaign('c1');
    expect(getPackagePaymentState).toHaveBeenCalledWith('c1');
    expect(fillAuthorizedSet).toHaveBeenCalledWith('e1', 'c1', 'activation');
    expect(b.campaigns.update).toHaveBeenCalledWith({ status: 'active' });
    expect(b.campaigns.not).toHaveBeenCalledWith('package_price', 'is', null);
    expect(b.campaigns.is).toHaveBeenCalledWith('capture_status', null);
    expect(b.campaigns.is).toHaveBeenCalledWith('charge_status', null);
    expect(b.campaigns.eq).not.toHaveBeenCalledWith('capture_status', 'authorized');
  });

  it('proves ownership before it reads the ledger or writes the list', async () => {
    wire();
    await activateCampaign('c1');
    const order = (m: unknown) => (m as { mock: { invocationCallOrder: number[] } }).mock.invocationCallOrder[0];
    expect(order(requireOwnedEvent)).toBeLessThan(order(getPackagePaymentState));
    expect(order(getPackagePaymentState)).toBeLessThan(order(fillAuthorizedSet));
  });

  it.each(['none', 'pending', 'review', 'declined', 'refunded', 'released', 'committed'] as const)(
    'refuses while the payment is %s — and fills nothing',
    async (status) => {
      const b = wire();
      vi.mocked(getPackagePaymentState).mockResolvedValue({ status, collected: 0, committed: 0 });
      await expect(activateCampaign('c1')).rejects.toThrow(PACKAGE_NOT_PAID_ERROR);
      expect(fillAuthorizedSet).not.toHaveBeenCalled();
      expect(b.campaigns.update).not.toHaveBeenCalled();
    },
  );

  it('an unreadable ledger is "cannot verify", never "paid" and never "not paid"', async () => {
    const b = wire();
    vi.mocked(getPackagePaymentState).mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(activateCampaign('c1')).rejects.toThrow(PACKAGE_PAYMENT_UNVERIFIED_ERROR);
    expect(b.campaigns.update).not.toHaveBeenCalled();
  });

  it('refuses a past event before it touches the ledger or the list', async () => {
    wire();
    vi.mocked(requireOwnedEvent).mockResolvedValue(ownedEvent('2020-01-01T00:00:00+00:00'));
    await expect(activateCampaign('c1')).rejects.toThrow('האירוע כבר חלף');
    expect(getPackagePaymentState).not.toHaveBeenCalled();
    expect(fillAuthorizedSet).not.toHaveBeenCalled();
  });

  it('refuses to start with nobody to approach: the customer paid, so the message says what to do', async () => {
    const b = wire();
    vi.mocked(fillAuthorizedSet).mockResolvedValue({ verdict: 'filled', admitted: 0, size: 0, quota: 100, waiting: 0 });
    await expect(activateCampaign('c1')).rejects.toThrow(PACKAGE_NO_CONTACTS_ERROR);
    expect(b.campaigns.update).not.toHaveBeenCalled();
  });

  it.each([
    ['not_operational', 'לא ניתן לשנות את מצב הקמפיין במצבו הנוכחי'],
    ['no_quota', 'לא ניתן להפעיל את הקמפיין — פנו לתמיכה'],
    ['no_campaign', 'לא ניתן להפעיל את הקמפיין — פנו לתמיכה'],
    ['event_mismatch', 'לא ניתן להפעיל את הקמפיין — פנו לתמיכה'],
  ] as const)('a %s answer from the fill refuses the activation', async (verdict, message) => {
    const b = wire();
    vi.mocked(fillAuthorizedSet).mockResolvedValue({ verdict });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(activateCampaign('c1')).rejects.toThrow(message);
    expect(b.campaigns.update).not.toHaveBeenCalled();
  });

  it('a failure of the fill itself refuses the activation and leaves the status alone', async () => {
    const b = wire();
    vi.mocked(fillAuthorizedSet).mockRejectedValue(new Error('מילוי רשימת אנשי הקשר נכשל'));
    await expect(activateCampaign('c1')).rejects.toThrow('מילוי רשימת אנשי הקשר נכשל');
    expect(b.campaigns.update).not.toHaveBeenCalled();
  });

  it('a console revival (paused → active) of a package campaign needs the same payment', async () => {
    const b = wire();
    vi.mocked(getPackagePaymentState).mockResolvedValue({ status: 'refunded', collected: 0, committed: 0 });
    await expect(activateCampaign('c1', { kind: 'console', staffUserId: 's1' })).rejects.toThrow(PACKAGE_NOT_PAID_ERROR);
    expect(b.campaigns.update).not.toHaveBeenCalled();
  });
});

describe('activateCampaign — the pay-per-result model is unchanged', () => {
  it('still guards by the card hold, reads no ledger and fills nothing', async () => {
    vi.mocked(requireOwnedEvent).mockResolvedValue(ownedEvent());
    const b = adminByTable({ campaigns: { id: 'c1', event_id: 'e1', package_price: null }, events: { event_date: '2999-01-01T00:00:00+00:00', status: 'active' } });
    await activateCampaign('c1');
    expect(b.campaigns.eq).toHaveBeenCalledWith('capture_status', 'authorized');
    expect(b.campaigns.not).not.toHaveBeenCalledWith('package_price', 'is', null);
    expect(getPackagePaymentState).not.toHaveBeenCalled();
    expect(fillAuthorizedSet).not.toHaveBeenCalled();
  });
});
```

(`adminByTable` מחזיר builder לכל טבלה; אם `not`/`is` אינם ב-`CHAIN_METHODS` של `createMockSupabase`, להוסיף `not` ו-`is` שם: הם כבר ברשימה, ראו `src/test/supabase-mock.ts:29-52`.)

- [ ] **Step 2:** `npx vitest run src/lib/data/campaigns.test.ts` → FAIL (הקבועים והענף לא קיימים).

- [ ] **Step 3: מימוש** ב-`campaigns.ts`

`package-activation-errors.ts`:

```ts
// What a refused package activation says. Constants, so the route and the screens recognise a reason without
// comparing a copy of the sentence.
export const PACKAGE_NOT_PAID_ERROR = 'התשלום על החבילה טרם הושלם';
export const PACKAGE_PAYMENT_UNVERIFIED_ERROR = 'לא ניתן לאמת את התשלום כרגע — נסו שוב בעוד רגע';
export const PACKAGE_NO_CONTACTS_ERROR = 'יש להוסיף מוזמנים לפני הפעלת הקמפיין';
export const PACKAGE_SUPPORT_ERROR = 'לא ניתן להפעיל את הקמפיין — פנו לתמיכה';
```

`campaigns.ts`:

```ts
import { fillAuthorizedSet } from '@/lib/data/authorized-fill';
import {
  PACKAGE_NOT_PAID_ERROR,
  PACKAGE_NO_CONTACTS_ERROR,
  PACKAGE_PAYMENT_UNVERIFIED_ERROR,
  PACKAGE_SUPPORT_ERROR,
} from '@/lib/data/package-activation-errors';
import { getPackagePaymentState } from '@/lib/payments/package-paid';

const TRANSITION_REFUSED_ERROR = 'לא ניתן לשנות את מצב הקמפיין במצבו הנוכחי';

// What a package campaign needs before it may start, in this order: the payment is recorded in the ledger (the only
// source of truth for package money), then the list every send reads is filled (D6: charged → filled → activated).
// Runs AFTER the ownership and event checks of the transition and BEFORE the status write, so a refused activation
// never leaves a half-filled list behind for a customer who is not allowed to start.
async function requirePackageFundingAndFill(campaignId: string, eventId: string): Promise<void> {
  let paid: boolean;
  try {
    paid = (await getPackagePaymentState(campaignId)).status === 'collected';
  } catch {
    console.error('[campaign-lifecycle] package payment state could not be read', { campaignId });
    throw new Error(PACKAGE_PAYMENT_UNVERIFIED_ERROR);
  }
  if (!paid) throw new Error(PACKAGE_NOT_PAID_ERROR);

  const fill = await fillAuthorizedSet(eventId, campaignId, 'activation');
  if (fill.verdict === 'not_operational') throw new Error(TRANSITION_REFUSED_ERROR);
  if (fill.verdict !== 'filled') {
    console.error('[campaign-lifecycle] package list could not be filled', { campaignId, verdict: fill.verdict });
    throw new Error(PACKAGE_SUPPORT_ERROR);
  }
  // A campaign with nobody on its list would read "active" and approach no one. The customer has paid: tell them what
  // to do instead of activating into silence (the hold path refuses to hold at 0 contacts for the same reason).
  if (fill.size === 0) throw new Error(PACKAGE_NO_CONTACTS_ERROR);
}
```

ב-`transitionCampaignStatus`: הפרמטר הרביעי `extraGuard?: { column: 'capture_status'; value: string }` הופך ל-`funding?: 'by_model'`, וה-`opts` (החמישי) מקבל את `preparePackage`:

```ts
funding?: 'by_model',
// L1/R9: …(the existing comment)…
opts?: {
  rejectPastEvent?: boolean;
  requireActiveEvent?: boolean;
  // Package campaigns only: the funding precondition (payment from the ledger, then the first fill). Runs after the
  // identity and event checks, before the status write.
  preparePackage?: (campaign: { id: string; event_id: string }) => Promise<void>;
},
```

'by_model' פירושו שתנאי המימון תלוי במודל התמחור של הקמפיין: כרטיס מאושר (`capture_status='authorized'`) לקמפיין לפי תוצאה, תשלום רשום (מאומת ב-`preparePackage`) לקמפיין חבילה. הקריאה הראשונה בפונקציה: `.select('id, event_id, package_price')`. אחרי `applyEventGuards` (בכל שלושת ענפי ה-actor) ולפני בניית ה-UPDATE:

```ts
const isPackage = campaign.package_price != null;
if (funding === 'by_model' && isPackage) {
  await opts?.preparePackage?.({ id: campaign.id, event_id: campaign.event_id });
}
```

ובניית ה-UPDATE (מחליפה את הבלוק `if (extraGuard) { query = query.eq(extraGuard.column, extraGuard.value); }`):

```ts
let query = admin.from('campaigns').update({ status: to }).eq('id', campaignId).in('status', from);
if (funding === 'by_model') {
  query = isPackage
    ? query.not('package_price', 'is', null).is('capture_status', null).is('charge_status', null)
    : query.eq('capture_status', 'authorized');
}
```

`activateCampaign` קוראת:

```ts
const { eventDate } = await transitionCampaignStatus(
  campaignId,
  from,
  'active',
  'by_model',
  // L1: never begin outreach for a past event. R9: requires an active event.
  {
    rejectPastEvent: true,
    requireActiveEvent: true,
    preparePackage: (c) => requirePackageFundingAndFill(c.id, c.event_id),
  },
  actor,
);
```

(`pauseCampaign` ו-`closeCampaign` נשארות בלי שינוי: `undefined, undefined, actor`.) ההערה מעל `activateCampaign` ("Requires … a card hold") מתעדכנת: "…a card hold, or — for a fixed-price package — a recorded payment".

ב-`status/route.ts`: להוסיף ל-`CONFLICT_MESSAGES` את `PACKAGE_NOT_PAID_ERROR`, `PACKAGE_PAYMENT_UNVERIFIED_ERROR`, `PACKAGE_NO_CONTACTS_ERROR`, `PACKAGE_SUPPORT_ERROR` (ייבוא מ-`package-activation-errors.ts`), כדי שהקונסולה תקבל 409 ולא 500. טסט ב-`status/route.test.ts`: הפעלה שנזרקת עם כל אחת מהן → 409 עם ההודעה.

- [ ] **Step 4:** `npx vitest run src/lib/data/campaigns.test.ts src/lib/data/campaign-lifecycle-parity.test.ts src/app/api/campaigns` → PASS (כולל הטסטים הקיימים של `activateCampaign`). `npx tsc --noEmit`, `npx eslint`, `npm run worker:deps`.
- [ ] **Step 5: commit מוכן** `feat(campaigns): activateCampaign starts a paid package — payment from the ledger, then the first fill`

---

### Task 6: מילוי גם באישור התנאים

**Files:**
- Modify: `src/lib/data/agreements.ts` (`recordPackageApproval`, אחרי `approveCampaign`)
- Test: `src/lib/data/agreements.test.ts`

**למה:** ראו "סטיות" 2. best-effort: הכשל לא מבטל את האישור (הוא נרשם והקמפיין מאושר); ההפעלה ממלאת בכל מקרה.

- [ ] **Step 1: טסטים נכשלים** (במקום ה-describe של `recordPackageApproval`; מוק: `vi.mock('@/lib/data/authorized-fill', () => ({ fillAuthorizedSet: vi.fn() }))`)

```ts
it('fills the list right after the approval, so the places follow the order of addition from then on', async () => {
  wire();
  vi.mocked(fillAuthorizedSet).mockResolvedValue({ verdict: 'filled', admitted: 2, size: 2, quota: 100, waiting: 0 });
  expect(await recordPackageApproval(approvalInput)).toEqual({ ok: true });
  expect(fillAuthorizedSet).toHaveBeenCalledWith('e1', 'c1', 'package_approval');
  expect(vi.mocked(approveCampaign).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(fillAuthorizedSet).mock.invocationCallOrder[0]);
});

it('a failed fill never undoes the approval — activation fills again', async () => {
  wire();
  vi.mocked(fillAuthorizedSet).mockRejectedValue(new Error('מילוי רשימת אנשי הקשר נכשל'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(await recordPackageApproval(approvalInput)).toEqual({ ok: true });
  expect(approveCampaign).toHaveBeenCalled();
});

it('does not fill when the approval itself was refused', async () => {
  wire();
  vi.mocked(approveCampaign).mockRejectedValue(new Error('אישור הקמפיין נכשל'));
  await expect(recordPackageApproval(approvalInput)).rejects.toThrow();
  expect(fillAuthorizedSet).not.toHaveBeenCalled();
});
```

(ב-`beforeEach` של ה-describe: `vi.mocked(fillAuthorizedSet).mockReset()`.)

- [ ] **Step 2:** FAIL. **Step 3: מימוש** — ב-`afterApproval` או מיד אחרי `approveCampaign(...)` ב-`recordPackageApproval` (קרא את הפונקציה: הקריאה לאישור ואחריה שליחת הקבלה):

```ts
// The list every send reads is empty until something fills it. Filling it HERE (and again at activation) keeps the
// places in order of addition: otherwise a guest added after the approval would take the first place of an empty list
// ahead of everyone who was added earlier. Best-effort: the approval is recorded and must not be undone by this.
try {
  await fillAuthorizedSet(event.id, campaign.id, 'package_approval');
} catch (err) {
  console.error('[package-approval] first fill failed (non-fatal; activation fills again)', {
    campaignId: campaign.id,
    error: err instanceof Error ? err.message : String(err),
  });
}
```

- [ ] **Step 4:** `npx vitest run src/lib/data/agreements.test.ts` → PASS. `tsc`, `eslint`, `worker:deps`.
- [ ] **Step 5: commit מוכן** `feat(agreements): fill the package list when the terms are approved`

---

### Task 7: הפעלה אוטומטית אחרי תשלום, והמסכים

**Files:**
- Modify: `src/app/api/campaigns/[id]/purchase/route.ts`, `purchase/route.test.ts`
- Modify: `src/lib/payments/package-payment-screen.ts` (+ `.test.ts`)
- Modify: `payment/package-payment-view.tsx` (+ `.test.tsx`), `payment/page.tsx` (+ `page.test.tsx`)
- Modify: `events/[id]/setup/page.tsx` (בלוק ה-`live`)

**Interfaces:**
- `PackagePaymentScreen`: `{ kind: 'paid'; amount: number; activation: 'active' | 'ready' | 'unavailable' }`. `activation`: `active` כש-`campaignStatus==='active'`; `ready` כש-`['approved','scheduled','paused']` והאירוע לא חלף; אחרת `unavailable`.
- Redirect אחרי רכישה: `?paid=1` (פעיל), `?paid=1&activate=no_contacts`, `?paid=1&activate=failed`.

- [ ] **Step 1: טסטים נכשלים**

`package-payment-screen.test.ts`:

```ts
describe('paid: what the customer can do next', () => {
  const paid = { price: 150, payment: { status: 'collected', collected: 150, committed: 0 } as const, eventPast: false, eventActive: true, gatesOpen: true };
  it.each([
    ['active', 'active'],
    ['approved', 'ready'],
    ['scheduled', 'ready'],
    ['paused', 'ready'],
    ['closed', 'unavailable'],
    ['cancelled', 'unavailable'],
  ])('a %s campaign: activation is %s', (campaignStatus, activation) => {
    expect(packagePaymentScreen({ ...paid, campaignStatus })).toEqual({ kind: 'paid', amount: 150, activation });
  });
  it('a past event cannot be activated, but the customer still sees that they paid', () => {
    expect(packagePaymentScreen({ ...paid, campaignStatus: 'approved', eventPast: true })).toEqual({ kind: 'paid', amount: 150, activation: 'unavailable' });
  });
});
```

`purchase/route.test.ts` (המוקים הקיימים של `purchasePackage`, `requireUser` וכו'; להוסיף מוק ל-`activateCampaign` ול-`sendSlackAlert`):

```ts
it('after a payment that was just recorded the campaign is activated, and the customer lands on the paid page', async () => {
  vi.mocked(purchasePackage).mockResolvedValue('paid');
  vi.mocked(activateCampaign).mockResolvedValue(undefined);
  const res = await post();
  expect(activateCampaign).toHaveBeenCalledWith('c1');
  expect(location(res)).toMatch(/payment\?paid=1$/);
});

it('a refused activation keeps the payment and says why: no contacts', async () => {
  vi.mocked(purchasePackage).mockResolvedValue('paid');
  vi.mocked(activateCampaign).mockRejectedValue(new Error(PACKAGE_NO_CONTACTS_ERROR));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(location(await post())).toMatch(/payment\?paid=1&activate=no_contacts$/);
});

it('any other refused activation: paid, activate=failed, and Slack is told that a paying customer is not live', async () => {
  vi.mocked(purchasePackage).mockResolvedValue('paid');
  vi.mocked(activateCampaign).mockRejectedValue(new Error('לא ניתן לאמת את התשלום כרגע — נסו שוב בעוד רגע'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(location(await post())).toMatch(/payment\?paid=1&activate=failed$/);
  expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn', category: 'campaign_billing', source: 'package-activation' }));
});

it.each(['already_paid', 'declined', 'review', 'in_progress', 'disabled', 'not_purchasable', 'credit_unsupported', 'error'] as const)(
  'a %s outcome never activates anything',
  async (outcome) => {
    vi.mocked(purchasePackage).mockResolvedValue(outcome);
    await post();
    expect(activateCampaign).not.toHaveBeenCalled();
  },
);
```

`package-payment-view.test.tsx` (jsdom, מוק ל-`ActivateNowForm` עם marker, כמו שאר מסכי העמוד):

```ts
it('paid and ready: shows what was paid and the way to start, with the reason when the automatic start was refused', () => {
  render(<PackagePaymentView screen={{ kind: 'paid', amount: 150, activation: 'ready' }} activateReason="no_contacts" activateAction={vi.fn()} {...base} />);
  expect(screen.getByText('התשלום התקבל')).toBeTruthy();
  expect(screen.getByTestId('activate-form')).toBeTruthy();
  expect(screen.getByText(PACKAGE_NO_CONTACTS_ERROR)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'הוספת מוזמנים' })).toBeTruthy();
});

it('paid and active: no activation form', () => {
  render(<PackagePaymentView screen={{ kind: 'paid', amount: 150, activation: 'active' }} {...base} />);
  expect(screen.queryByTestId('activate-form')).toBeNull();
  expect(screen.getByText(/הקמפיין פעיל/)).toBeTruthy();
});

it('paid but not activatable (event passed): says they paid, offers no button', () => {
  render(<PackagePaymentView screen={{ kind: 'paid', amount: 150, activation: 'unavailable' }} {...base} />);
  expect(screen.queryByTestId('activate-form')).toBeNull();
  expect(screen.getByText('התשלום התקבל')).toBeTruthy();
});
```

- [ ] **Step 2:** FAIL.

- [ ] **Step 3: מימוש**

`package-payment-screen.ts`:

```ts
export type PackagePaymentScreen =
  | { kind: 'paid'; amount: number; activation: 'active' | 'ready' | 'unavailable' }
  // …the rest unchanged

// …in packagePaymentScreen:
case 'collected':
  return { kind: 'paid', amount: i.payment.collected, activation: activationOf(i) };

function activationOf(i: PackagePaymentScreenInput): 'active' | 'ready' | 'unavailable' {
  if (i.campaignStatus === 'active') return 'active';
  if (!i.eventPast && ['approved', 'scheduled', 'paused'].includes(i.campaignStatus)) return 'ready';
  return 'unavailable';
}
```

`purchase/route.ts` (בסוף `POST`, במקום השורה `if (outcome === 'paid' || outcome === 'already_paid') …`):

```ts
if (outcome === 'already_paid') return r303(payUrl('paid=1'));

if (outcome === 'paid') {
  // The payment was the customer's last real decision (D6: charged → list filled → activated), so the campaign starts
  // now instead of asking for one more click. FAIL-SAFE: the payment is recorded whatever happens below. If the start is
  // refused (nobody on the list, a ledger that cannot be read right now, a concurrent change) the customer lands on
  // the paid page with the reason and an explicit start button. Status is written ONLY by activateCampaign.
  try {
    await activateCampaign(campaignId);
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    console.error('[package-purchase] auto-activation after a confirmed payment was refused', { campaignId, message });
    void sendSlackAlert({
      level: 'warn',
      category: 'campaign_billing',
      source: 'package-activation',
      title: 'חבילה שולמה אך ההפעלה האוטומטית נדחתה',
      fields: { campaign_id: campaignId, event_id: campaign.event_id },
    });
    return r303(payUrl(message === PACKAGE_NO_CONTACTS_ERROR ? 'paid=1&activate=no_contacts' : 'paid=1&activate=failed'));
  }
  return r303(payUrl('paid=1'));
}
return payError(OUTCOME_TO_ERROR[outcome]);
```

(`OUTCOME_TO_ERROR` כבר מוגדר על `Exclude<…, 'paid' | 'already_paid'>`; ייבוא: `activateCampaign`, `PACKAGE_NO_CONTACTS_ERROR` מ-`@/lib/data/campaigns`, `sendSlackAlert` מ-`@/lib/alerts/slack`.)

`payment/page.tsx`: ב-`searchParams` להוסיף `activate` (כבר קיים בטיפוס), ובענף החבילה:

```tsx
<PackagePaymentView
  screen={screen}
  errorMessage={purchaseErrorMessage(error)}
  activateReason={activate === 'no_contacts' ? 'no_contacts' : activate === 'failed' ? 'failed' : null}
  activateAction={activateCampaignAction.bind(null, id, campaignId)}
  eventId={id}
  campaignId={campaignId}
  formConfig={publicConfig}
  signerName={profile?.full_name?.trim() || 'לקוח KALFA'}
/>
```

`package-payment-view.tsx`: ה-prop `activateReason: 'no_contacts' | 'failed' | null` ו-`activateAction`; בענף `paid`:

```tsx
case 'paid':
  return (
    <section className="space-y-4 rounded-lg border border-success/40 bg-success/10 p-6 text-center">
      <p className="text-2xl font-bold text-success">התשלום התקבל</p>
      <p className="text-sm">שולם {formatAmount(screen.amount)} עבור החבילה.</p>
      {screen.activation === 'active' ? <p className="text-sm">הקמפיין פעיל. הפניות לאורחים יישלחו לפי לוח הזמנים.</p> : null}
      {screen.activation === 'ready' ? (
        <div className="space-y-3 text-start">
          {activateReason ? (
            <p role="alert" className={NOTICE_CLASS}>
              {activateReason === 'no_contacts' ? PACKAGE_NO_CONTACTS_ERROR : 'הקמפיין עוד לא הופעל אוטומטית. אפשר להפעיל אותו כעת.'}
            </p>
          ) : null}
          <ActivateNowForm action={activateAction} />
        </div>
      ) : null}
      {/* …the two links, unchanged… */}
    </section>
  );
```

(`PACKAGE_NO_CONTACTS_ERROR` מיובא מ-`@/lib/data/package-activation-errors` (Task 5), לא מ-`campaigns.ts` שהוא `server-only`. כך גם ה-route וגם רכיב הלקוח משתמשים באותו קבוע.)

`setup/page.tsx` בלוק `current === 'live'`: הטקסט כבר מפנה לדף התשלום. לעדכן את ההערה לנכונה לשני המודלים, בלי שינוי התנהגות.

- [ ] **Step 4:** `npx vitest run src/app/api/campaigns src/lib/payments "src/app/(customer)/app/events"` → PASS; `npx tsc --noEmit`, `npx eslint`, `npm run worker:deps`.
- [ ] **Step 5: commit מוכן** `feat(package): a paid package starts by itself, with a visible way back when it cannot`

---

### Task 8: אימות כולל ושערים

- [ ] **Step 1:** `npx tsc --noEmit && npm run lint && npm run worker:deps && npx vitest run` — הכול ירוק (מספר הטסטים נרשם בדוח).
- [ ] **Step 2: קריאת קוד ידנית** של ה-diff מול `reconcile_authorized_set`: אותה כשירות (`v_target_ok`), אותו אוצר מילים ב-audit, אותו מנעול.
- [ ] **Step 3: שער ה-₪1 (באישור מפורש של הבעלים, אירוע שלו, ריצה אחת):** ראו "שלב 0" ו-P-B בתוכנית החבילה. אחרי החיוב, לקרוא (קריאה בלבד):

```sql
select status, package_price, contact_quota from public.campaigns where id = '<campaign>';
select o.kind, o.outcome, o.amount from public.payment_operations o where o.campaign_id = '<campaign>';
select count(*) as members from public.campaign_authorized_contacts where campaign_id = '<campaign>';
select action, reason, actor, resulting_size from public.campaign_authorized_set_audit where campaign_id = '<campaign>' order by at;
```

צפוי: `status='active'`, שורת `package_purchase`/`succeeded`, `members = min(contact_quota, כשירים)`, שורות audit עם `reason='snapshot'` ו-actor `package_approval` או `activation`.
- [ ] **Step 4: בדיקת דפדפן (הבעלים, אחרי פריסה):** דף התשלום אחרי תשלום, דף הניהול, ושלבי ההקמה: "תשלום החבילה" נגמר, "הקמפיין פעיל" נדלק. מקרה "אין אנשי קשר": ההודעה והכפתור.
- [ ] **Step 5:** דוח סיכום: קבצים ששונו, תוצאות אימות, מה לא נבדק.

## אסור להפעיל את `package_model_enabled` לפני שכל אלה נכונים

(מתוך תוכנית החבילה, מעודכן אחרי התוכנית הזאת. אין כפתור הפעלה בכוונה.)

- ✅ נתיב הפעלה לקמפיין חבילה (התוכנית הזאת, אחרי ביצוע ואימות).
- ✅ הסכם v6 מאושר ופעיל (הבעלים אישר 4.10).
- ❌ **מגן ה-SQL**: `campaigns_guard_cancel`, `cancel_campaign`, `test_event_purge_blocker` קוראים את היומן; אחרת אפשר לבטל קמפיין ששולם בלי החזר (P-E).
- ❌ ניסוי E1 חי ושער ה-₪1.
- ❌ לקוח עם קרדיט פתוח נדחה כיום (`credit_unsupported`); ניכוי הקרדיט (D5/E7) לא נבנה.
- ❌ `tax-ceiling.ts` ו-`owner_agent_billing_sums` לא קוראים את היומן (הכנסה מחבילה בלתי נראית).
- ❌ משטחי המחיר הציבוריים (P-G).
- ❌ אירוע GA `purchase`; תווית "מספר הקבלה" ללקוח.

## בדיקה עצמית

**כיסוי התוכנית הראשית (P-C):** מילוי בהפעלה — Tasks 1, 2, 5; קריאה מ-`activateCampaign` לפני המעבר — Task 5; הוצאת `snapshotAuthorizedSet` ממסלול החבילה — החבילה אינה עוברת ב-`prepareCampaignHold` (נחסם ב-`authorize/route.ts`), ואין קריאה אליה בענף החדש; "הפעלה נכשלה אחרי תשלום, מצב מתאושש" (Review Focus 6 של תוכנית החבילה) — Task 7; שלב "תשלום" ו"הפעלה" ב-`computeSetupSteps` — Task 4; רשימת הממתינים — `waiting` ב-`fill_authorized_set` (מסך: מחוץ להיקף). **לא כוסה במכוון:** נעיצת חשופים (אין הוצאה), `repoint` (חי), מסך אורחים.

**סריקת placeholders:** כל Step עם קוד מלא, פקודה ותוצאה צפויה. ההפניות ל"קרא את הפונקציה" ב-Tasks 4 ו-6 מציינות קובץ, שורות והשינוי המדויק.

**עקביות שמות:** `fill_authorized_set`/`fillAuthorizedSet`/`FillResult`; `packagePaymentOf`/`getPackagePaymentState`; `PACKAGE_NOT_PAID_ERROR`, `PACKAGE_PAYMENT_UNVERIFIED_ERROR`, `PACKAGE_NO_CONTACTS_ERROR`; `PACKAGE_PAY_LABEL`; `activation: 'active' | 'ready' | 'unavailable'`; actors `activation` ו-`package_approval`; `reason='snapshot'`.

**מה לא אומת:** ראו בראש המסמך.
