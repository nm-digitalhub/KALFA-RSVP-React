# ביקורת DB חיה — חיוב קמפיינים וייחוס אורחים (2026-09-04)

מסמך זה קובע את **אמת ה-DB החי** (פרויקט `kalfa-event-magic`) עבור שרשרת החיוב לפי מגע (billed_results), מערך המורשים (campaign_authorized_contacts) והייחוס של הודעות נכנסות (contact_interactions), ומשווה אותה לקבצי המיגרציה ולקוד ה-TypeScript.

מצב הביקורת: **קריאה בלבד**. לא בוצע DDL, לא שונו נתונים, לא הורצה טרנזקציית dry-run. כל המספרים הם ספירות/אגרגטים בלבד, ללא PII וללא מזהי שורות.

תיוג ממצאים: **VERIFIED-LIVE** = נמדד ישירות מול ה-DB החי; **MIGRATION** = נקרא מקובץ מיגרציה; **CODE** = נקרא מהקוד; **inferred** = מסקנה מהגדרה, לא נמדד.

---

## 0. תקציר מנהלים

| נושא | תשובה קצרה | תיוג |
|---|---|---|
| סנכרון מיגרציות | מלא. כל 230 המיגרציות המקומיות מופיעות ב-remote (0 local-only, 0 remote-only), האחרונה `20260903214126`. אין drift ברשימה. | VERIFIED-LIVE |
| מפתח מניעת חיוב כפול | אחד בלבד: `billed_results_event_contact_unique UNIQUE (event_id, contact_id)`. אין UNIQUE על (campaign_id, contact_id), על attempt_id או על provider_ref. | VERIFIED-LIVE |
| `try_record_billed_result` | `SECURITY DEFINER`, `search_path=public`, `FOR UPDATE` על שורת הקמפיין, `ON CONFLICT (event_id, contact_id) DO NOTHING`. EXECUTE רק ל-`postgres` ו-`service_role`. גוף הפונקציה זהה למיגרציה `20260902062917`. | VERIFIED-LIVE |
| שער החשיפה | `app_settings.billing_exposure_gate = false` (OFF), נמדד פעמיים (22:20 ו-22:50 UTC). לכן `exposed_for_billing` אינה נקראת כלל בפועל, ו-`'no_exposure'` אינו בר-השגה כיום. | VERIFIED-LIVE |
| `reconcile_authorized_set` | SECDEF, `search_path=public`, EXECUTE רק postgres+service_role, `FOR UPDATE` על אותה שורת `campaigns` כמו ה-RPC של החיוב, `funded_cap` fail-closed ל-0. 11 ליטרלים: no_campaign, event_mismatch, not_operational, noop, not_eligible, ceiling_full, added, swapped, pinned_kept, pinned_and_added, removed. גוף זהה ל-`20260902062917`. | VERIFIED-LIVE |
| מערך המורשים | **דינמי, לא מוקפא**: נוצר ב-J5 hold (`snapshotAuthorizedSet`), ומתוחזק אחר כך ע"י `reconcile_authorized_set` בכל מוטציית אורח (add/repoint/delete). שלושה כותבים בלבד (סעיף 6, שאלה 6). | VERIFIED-LIVE + CODE |
| `contacts` | `UNIQUE (event_id, normalized_phone)` חי. אותו טלפון פעמיים באותו אירוע: 0 (בלתי אפשרי). טלפון שמופיע ביותר מאירוע אחד: 2. טלפון שחוצה יותר מבעלים אחד (`events.owner_id`): 1. | VERIFIED-LIVE |
| Drift פונקציות | 8/8 פונקציות **MATCH** את מיגרציית ה-CREATE האחרונה שלהן (גוף, SECDEF, search_path, ACL). אף פונקציה אינה מוגדרת רק ב-DB. | VERIFIED-LIVE + MIGRATION |
| Drift טבלאות | כל העמודות החיות ב-8 הטבלאות ניתנות לעקיבה למיגרציה. אילוצים, אינדקסים ומדיניות RLS תואמים. | VERIFIED-LIVE + MIGRATION |
| **הפתעה 1** | הרשאות טבלה (GRANT) על 7 מתוך 8 הטבלאות הן ברירת המחדל של Supabase: `anon` ו-`authenticated` מחזיקים `INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` על `billed_results`, `campaign_authorized_contacts`, `contact_interactions`, `contacts`, `campaigns`, `webhook_inbox`, `guest_import_staging`. אף מיגרציה מעולם לא ביצעה REVOKE עליהן (בניגוד ל-`webhook_deliveries` החדשה). RLS חוסם DML שורתי (יש רק מדיניות SELECT), אך **TRUNCATE אינו כפוף ל-RLS**. חשיפה מעשית כיום: אפסית (הרולים NOLOGIN, PostgREST לא חושף TRUNCATE) — אבל זו הגנת עומק חסרה על טבלאות כסף. | VERIFIED-LIVE |
| **הפתעה 2** | `billing_outcome` על `contact_interactions` מאוכלס רק מאז הדיפלוי של 2026-09-03: 3 שורות (`not_active`), 63 שורות היסטוריות NULL. | VERIFIED-LIVE |
| **הפתעה 3** | סדר הבדיקות ב-RPC: בדיקת התקרה (`v_count >= v_cap`) קודמת ל-INSERT. לכן קריאה חוזרת על איש קשר **שכבר חויב** בקמפיין שהגיע בדיוק לתקרה תחזיר `'ceiling_reached'` ולא `'already_billed'`. אין השפעה כספית, אבל התווית ב-`billing_outcome` תטעה. | inferred מהגדרה |
| **הפתעה 4** | תחת gate=ON, ב-WhatsApp `exposed_for_billing` טאוטולוגית: הקוד מכניס את שורת ה-inbound (`billable=true, direction='in'`) **לפני** קריאת ה-RPC, וזו בדיוק השורה שהפונקציה מחפשת. המגבלה האפקטיבית תחת gate=ON היא funded cap בלבד. | CODE + VERIFIED-LIVE |
| **הפתעה 5** | `campaign_authorized_contacts.contact_id` הוא `ON DELETE CASCADE` (מיגרציה 0024, לא הוקשח ב-`20260821141118` שהקשיח רק event_id/campaign_id). מחיקת contact מפנה אותו מהמערך בשקט; ההגנה היא בקוד בלבד (`pruneOrphanContact`). | VERIFIED-LIVE + MIGRATION |
| **הפתעה 6** | שני אינדקסים ייחודיים זהים על `campaigns (event_id) WHERE status <> 'cancelled'`: `campaigns_event_noncancelled_uidx` (20260726100000) ו-`campaigns_one_active_per_event` (20260830130737). ה-performance advisor מסמן זאת. | VERIFIED-LIVE |

---

## 1. מתודולוגיה

- כלי: `npx --no-install supabase db query --linked --output json "<sql>"` (רץ כ-`postgres`). כל המטא-דאטה מ-`pg_catalog` (`pg_proc`, `pg_constraint`, `pg_indexes`, `pg_policy`, `pg_trigger`, `pg_attribute`, `pg_class.relacl` דרך `aclexplode`).
- חלון snapshot: 2026-09-03 ~22:20–22:40 UTC (2026-09-04 ~01:20–01:40 שעון ישראל). המערכת חיה: במהלך הביקורת נכנסה הודעת WhatsApp אחת (22:35:43 UTC) ששינתה ספירות ב-1. המספרים בסעיפים 6–7 הם מה-snapshot העקבי האחרון (22:39:30 UTC).
- Diff פונקציות: גוף הפונקציה החי (`pg_get_functiondef`) הושווה לגוף ב-`create or replace function` האחרון בקבצי המיגרציה, אחרי נרמול רווחים והסרת הערות. הכותרות (SECDEF, search_path) הושוו בנפרד. ה-ACL החי הושווה להצהרות REVOKE/GRANT.
- `supabase db advisors --linked` (security + performance) הורץ; אף ממצא security אינו נוגע לאובייקטים המבוקרים. ממצא performance אחד רלוונטי (אינדקסים כפולים, הפתעה 6).

---

## 2. סנכרון מיגרציות

```
npx --no-install supabase migration list --linked
```

VERIFIED-LIVE: כל רשומה מקומית תואמת remote, ללא רשומה חד-צדדית. האחרונה: `20260903214126_webhook_deliveries_and_outcomes.sql`.

---

## 3. פונקציות — הגדרות חיות

שאילתת האיתור (כל פונקציה ב-`public` שגופה נוגע באחת משלוש הטבלאות):

```sql
select p.proname, pg_get_function_identity_arguments(p.oid), p.prosecdef, p.proconfig,
       p.proacl::text, pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and (p.prosrc ilike '%billed_results%'
    or p.prosrc ilike '%campaign_authorized_contacts%'
    or p.prosrc ilike '%contact_interactions%')
order by p.proname;
```

תוצאה: 8 פונקציות. סיכום כותרות ו-ACL (VERIFIED-LIVE):

| פונקציה | SECDEF | search_path | EXECUTE | מיגרציית CREATE אחרונה | גוף |
|---|---|---|---|---|---|
| `try_record_billed_result(uuid,uuid,uuid,campaign_channel,text,text,text)` | כן | `public` | postgres, service_role | `20260902062917_reconcile_funded_cap_floor_included.sql` | MATCHES |
| `exposed_for_billing(uuid,uuid,uuid,campaign_channel)` | כן (STABLE) | `public` | postgres, service_role | `20260712104032_billing_exposure_predicates.sql` | MATCHES |
| `has_service_exposure(uuid,uuid)` | כן (STABLE) | `public` | postgres, service_role | `20260712104032_billing_exposure_predicates.sql` | MATCHES |
| `campaign_billing_summary(uuid)` | כן | `public` | postgres, service_role | `202606290028_billing_backhalf.sql` (ACL: `202606300038_lock_billing_rpcs.sql`) | MATCHES |
| `claim_webhook_events(int)` | כן | `public` | postgres, service_role | `202606300036_webhook_claim_skip_locked.sql` | MATCHES |
| `reconcile_authorized_set(uuid,uuid,text,uuid,uuid,text)` | כן | `public` | postgres, service_role | `20260902062917_reconcile_funded_cap_floor_included.sql` | MATCHES |
| `cancel_campaign(uuid)` | כן | `''` | postgres, service_role | `20260630223635_event_lifecycle_state_model.sql` | MATCHES |
| `campaigns_guard_cancel()` (trigger) | כן | `''` | postgres, service_role | `20260630223635` (ACL: `20260630230249`) | MATCHES |
| `claim_thankyou_recipient(uuid,uuid,uuid)` | **לא** (INVOKER) | `''` | postgres, service_role | `20260712205030_auto_thankyou_schema.sql` | MATCHES |

הערה על `search_path=public` (ולא `''`) בארבע פונקציות הכסף: זה תואם את המיגרציות שלהן. הגוף משתמש בשמות לא-מוסמכים (`campaigns`, `events`, `contacts`, `billed_results`). זה בטוח כל עוד אף רול לא-מיוחס לא יכול ליצור אובייקטים ב-`public`; VERIFIED-LIVE: `has_schema_privilege('anon'|'authenticated'|'service_role','public','CREATE') = false`. עדיין, הקונבנציה הנוכחית של הריפו היא `''` + שמות מוסמכים; המרה היא הקשחה אופציונלית, לא באג.

### 3.1 `public.try_record_billed_result` — verbatim (VERIFIED-LIVE)

```sql
CREATE OR REPLACE FUNCTION public.try_record_billed_result(p_event uuid, p_campaign uuid, p_contact uuid, p_channel campaign_channel, p_attempt text, p_evidence text, p_provider_ref text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text; v_price numeric; v_max int; v_start timestamptz; v_close timestamptz;
  v_count int; v_removed boolean; v_event_id uuid; v_event_date timestamptz;
  v_auth numeric; v_gate boolean; v_cap int; v_base numeric; v_included int;
begin
  -- Authoritative event comes from the campaign, not the caller.
  select event_id, status::text, price_per_reached, max_contacts, start_at, close_at, auth_amount, base_price, included_reached
    into v_event_id, v_status, v_price, v_max, v_start, v_close, v_auth, v_base, v_included
    from campaigns where id=p_campaign for update;
  if not found then return 'no_campaign'; end if;
  if p_event is distinct from v_event_id then return 'event_mismatch'; end if;
  if v_status not in ('active','paused') then return 'not_active'; end if;  -- D2: paused still bills inbound
  if v_start is not null and now() < v_start then return 'before_window'; end if;
  if v_close is not null and now() > v_close then return 'closed_window'; end if;
  -- L2: never bill for an event whose calendar day has already passed (Israel).
  select event_date into v_event_date from events where id = v_event_id;
  if v_event_date is not null
     and (now() at time zone 'Asia/Jerusalem')::date
           > (v_event_date at time zone 'Asia/Jerusalem')::date then
    return 'event_passed';
  end if;
  -- R9: never bill for a campaign whose event is not active.
  if (select status from public.events where id = v_event_id) is distinct from 'active' then
    return 'event_not_active';
  end if;
  select removal_requested into v_removed from contacts where id=p_contact;
  if coalesce(v_removed,false) then return 'removal_requested'; end if;

  v_gate := coalesce((select billing_exposure_gate from public.app_settings limit 1), false);
  -- base/included default to 0 (legacy / gated-off campaigns snapshot 0 there).
  v_base := coalesce(v_base, 0);
  v_included := coalesce(v_included, 0);

  -- Authorization basis. gate OFF (default): frozen-set membership bounds reached
  -- <= covered. gate ON: exposure — a serviced non-member may bill (the P0-1 fix).
  if v_gate then
    if not public.exposed_for_billing(p_campaign, p_contact, v_event_id, p_channel)
      then return 'no_exposure'; end if;
  else
    if not exists (select 1 from public.campaign_authorized_contacts a
                   where a.campaign_id=p_campaign and a.contact_id=p_contact)
      then return 'not_authorized'; end if;
  end if;

  -- Count cap. gate ON -> FUNDED cap (fail-closed to 0 on a missing/invalid money
  -- basis) so captured can never exceed the J5 hold even when covered<full;
  -- gate OFF -> legacy max_contacts (unchanged — set membership already bounds it).
  if v_gate then
    if v_auth is null or v_price is null or v_auth <= 0 or v_price <= 0 then
      v_cap := 0;
    else
      v_cap := least(greatest(v_max, v_included), v_included + floor(greatest(0, v_auth - v_base) / v_price))::int;
    end if;
  else
    v_cap := greatest(v_max, v_included);
  end if;
  select count(*) into v_count from billed_results where campaign_id=p_campaign;
  if v_count >= v_cap then return 'ceiling_reached'; end if;

  insert into billed_results(event_id,campaign_id,contact_id,channel,attempt_id,locked_price,evidence_source,provider_ref)
    values (v_event_id,p_campaign,p_contact,p_channel,p_attempt,v_price,p_evidence,p_provider_ref)
    on conflict (event_id,contact_id) do nothing;
  if not found then return 'already_billed'; end if;
  return 'billed';
end; $function$
```

### 3.2 `public.exposed_for_billing` — verbatim (VERIFIED-LIVE)

```sql
CREATE OR REPLACE FUNCTION public.exposed_for_billing(p_campaign uuid, p_contact uuid, p_event uuid, p_channel campaign_channel)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    -- monotonic: an existing billing row is itself proof of exposure.
    exists (
      select 1
      from public.billed_results br
      where br.event_id = p_event
        and br.contact_id = p_contact
    )
    or (
      p_channel = 'whatsapp'
      and exists (
        select 1
        from public.contact_interactions ci
        where ci.campaign_id = p_campaign
          and ci.contact_id = p_contact
          and ci.billable = true
          -- self-enforcing money gate: only a genuine inbound WhatsApp reply counts,
          -- never a stray/erroneous billable row on an outbound or other-channel record.
          and ci.direction = 'in'
          and ci.channel = 'whatsapp'
      )
    )
    or (
      p_channel = 'call'
      and exists (
        select 1
        from public.outreach_state os
        where os.campaign_id = p_campaign
          and os.contact_id = p_contact
          and os.call_request_count > 0
      )
    );
$function$
```

### 3.3 `public.campaign_billing_summary` — verbatim (VERIFIED-LIVE)

```sql
CREATE OR REPLACE FUNCTION public.campaign_billing_summary(p_campaign uuid)
 RETURNS TABLE(reached_count integer, accrued numeric, ceiling numeric, max_contacts integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(b.*)::int, coalesce(sum(b.locked_price),0), c.max_charge_ceiling, c.max_contacts
  from campaigns c left join billed_results b on b.campaign_id=c.id
  where c.id=p_campaign group by c.id;
$function$
```

### 3.4 `public.claim_webhook_events` — verbatim (VERIFIED-LIVE)

```sql
CREATE OR REPLACE FUNCTION public.claim_webhook_events(_limit integer)
 RETURNS SETOF webhook_inbox
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query
    select *
    from public.webhook_inbox
    where processed_at is null
      and attempts < 5
    order by received_at asc
    limit _limit
    for update skip locked;
end;
$function$
```

### 3.5 הפונקציות הנוספות (תמצית; הגוף המלא זהה למיגרציה)

- **`has_service_exposure(p_campaign, p_contact)`** — משמש את `reconcile_authorized_set` כדי "לנעוץ" חבר במערך שכבר קיבל שירות. חשיפה = כל אינטראקציה in/out בקמפיין, או `outreach_state.call_request_count>0` / `reached_at`, או **שורת `billed_results` לאותו contact ללא סינון לפי קמפיין**. הסעיף האחרון רחב מדי בתיאוריה; בפועל 0 מקרים חוצי-קמפיין (VERIFIED-LIVE: `cross_campaign_pins = 0`), ולפי `campaigns_one_active_per_event` לא יכול להיווצר קמפיין שני לא-מבוטל לאותו אירוע.
- **`reconcile_authorized_set(...)`** — ראו סעיף 3.6 (הגדרה מלאה).
- **`cancel_campaign` / `campaigns_guard_cancel`** — חוסמים ביטול קמפיין שיש לו שורת `billed_results`, hold פעיל או charge_status.
- **`claim_thankyou_recipient`** — INSERT אידמפוטנטי ל-`contact_interactions` (out/template/'thankyou', `billable=false`) עם `ON CONFLICT` על האינדקס החלקי `contact_interactions_thankyou_claim_uq`. SECURITY INVOKER, ניתן להרצה רק ל-service_role.

### 3.6 `public.reconcile_authorized_set` — verbatim (VERIFIED-LIVE)

כותרת ו-ACL (נמדדו שוב 2026-09-03 22:50 UTC): `SECURITY DEFINER`, `VOLATILE`, `SET search_path TO 'public'`, `RETURNS text`, `proacl = {postgres=X/postgres,service_role=X/postgres}` — **רק** `postgres` ו-`service_role` יכולים להריץ; אין רשומת PUBLIC. גוף הפונקציה זהה ל-`20260902062917_reconcile_funded_cap_floor_included.sql`.

```sql
CREATE OR REPLACE FUNCTION public.reconcile_authorized_set(p_event uuid, p_campaign uuid, p_op text, p_contact uuid, p_prev_contact uuid DEFAULT NULL::uuid, p_actor text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_event_id       uuid;
  v_status         text;
  v_max            int;
  v_auth           numeric;
  v_price          numeric;
  v_base           numeric;
  v_included       int;
  v_funded_cap     int;
  v_size           int;
  v_new_member     boolean;
  v_prev_member    boolean;
  v_target_ok      boolean;
begin
  select event_id, status::text, max_contacts, auth_amount, price_per_reached,
         base_price, included_reached
    into v_event_id, v_status, v_max, v_auth, v_price, v_base, v_included
    from public.campaigns
    where id = p_campaign
    for update;
  if not found then
    return 'no_campaign';
  end if;

  if p_event is distinct from v_event_id then
    return 'event_mismatch';
  end if;

  if p_op not in ('add', 'repoint', 'delete') then
    return 'not_operational';
  end if;
  if v_status not in ('approved', 'scheduled', 'active', 'paused') then
    return 'not_operational';
  end if;

  -- funded_cap: FAIL-CLOSED. No money basis (null/non-positive) -> 0, never a
  -- silent fallback to max_contacts (which least() would produce on a NULL).
  -- base/included default to 0 (legacy/gated-off campaigns snapshot 0 there,
  -- but coalesce defends against a null read regardless) so the formula
  -- reduces to the pre-base+overage behavior exactly.
  v_base := coalesce(v_base, 0);
  v_included := coalesce(v_included, 0);
  if v_max is null or v_auth is null or v_price is null
     or v_auth <= 0 or v_price <= 0 then
    v_funded_cap := 0;
  else
    v_funded_cap := least(
      greatest(v_max, v_included),
      v_included + floor(greatest(0, v_auth - v_base) / v_price)
    )::int;
  end if;

  select count(*) into v_size
    from public.campaign_authorized_contacts
    where campaign_id = p_campaign;

  v_new_member := exists (
    select 1 from public.campaign_authorized_contacts
    where campaign_id = p_campaign and contact_id = p_contact
  );
  v_prev_member := p_prev_contact is not null and exists (
    select 1 from public.campaign_authorized_contacts
    where campaign_id = p_campaign and contact_id = p_prev_contact
  );

  -- Admit eligibility of the TARGET contact (p_contact): belongs to this event,
  -- not opted out, referenced by a live guest of the event. absent -> false.
  select (c.event_id = v_event_id
          and c.removal_requested = false
          and exists (select 1 from public.guests g
                      where g.event_id = v_event_id and g.contact_id = p_contact))
    into v_target_ok
    from public.contacts c
    where c.id = p_contact;
  v_target_ok := coalesce(v_target_ok, false);

  -- ADD
  if p_op = 'add' then
    if v_new_member then
      return 'noop';
    end if;
    if not v_target_ok then
      return 'not_eligible';
    end if;
    if v_size >= v_funded_cap then
      return 'ceiling_full';
    end if;
    insert into public.campaign_authorized_contacts (event_id, campaign_id, contact_id)
      values (v_event_id, p_campaign, p_contact)
      on conflict (campaign_id, contact_id) do nothing;
    v_size := v_size + 1;
    insert into public.campaign_authorized_set_audit
      (event_id, campaign_id, contact_id, prev_contact_id, action, reason, actor, resulting_size)
      values (v_event_id, p_campaign, p_contact, null, 'in', 'add', p_actor, v_size);
    return 'added';
  end if;

  -- REPOINT (old = p_prev_contact = A, new = p_contact = B)
  if p_op = 'repoint' then
    if not v_prev_member then
      if v_new_member then
        return 'noop';
      end if;
      if not v_target_ok then
        return 'not_eligible';
      end if;
      if v_size >= v_funded_cap then
        return 'ceiling_full';
      end if;
      insert into public.campaign_authorized_contacts (event_id, campaign_id, contact_id)
        values (v_event_id, p_campaign, p_contact)
        on conflict (campaign_id, contact_id) do nothing;
      v_size := v_size + 1;
      insert into public.campaign_authorized_set_audit
        (event_id, campaign_id, contact_id, prev_contact_id, action, reason, actor, resulting_size)
        values (v_event_id, p_campaign, p_contact, p_prev_contact, 'in', 'repoint', p_actor, v_size);
      return 'added';
    end if;

    if not public.has_service_exposure(p_campaign, p_prev_contact) then
      if not v_new_member and not v_target_ok then
        return 'not_eligible';
      end if;
      delete from public.campaign_authorized_contacts
        where campaign_id = p_campaign and contact_id = p_prev_contact;
      insert into public.campaign_authorized_contacts (event_id, campaign_id, contact_id)
        values (v_event_id, p_campaign, p_contact)
        on conflict (campaign_id, contact_id) do nothing;
      select count(*) into v_size
        from public.campaign_authorized_contacts
        where campaign_id = p_campaign;
      insert into public.campaign_authorized_set_audit
        (event_id, campaign_id, contact_id, prev_contact_id, action, reason, actor, resulting_size)
        values (v_event_id, p_campaign, p_contact, p_prev_contact, 'in', 'repoint', p_actor, v_size);
      return 'swapped';
    end if;

    if v_new_member then
      insert into public.campaign_authorized_set_audit
        (event_id, campaign_id, contact_id, prev_contact_id, action, reason, actor, resulting_size)
        values (v_event_id, p_campaign, p_prev_contact, null, 'kept_exposed', 'repoint', p_actor, v_size);
      return 'pinned_kept';
    end if;
    if not v_target_ok then
      insert into public.campaign_authorized_set_audit
        (event_id, campaign_id, contact_id, prev_contact_id, action, reason, actor, resulting_size)
        values (v_event_id, p_campaign, p_prev_contact, null, 'kept_exposed', 'repoint', p_actor, v_size);
      return 'not_eligible';
    end if;
    if v_size >= v_funded_cap then
      insert into public.campaign_authorized_set_audit
        (event_id, campaign_id, contact_id, prev_contact_id, action, reason, actor, resulting_size)
        values (v_event_id, p_campaign, p_prev_contact, null, 'kept_exposed', 'repoint', p_actor, v_size);
      return 'ceiling_full';
    end if;
    insert into public.campaign_authorized_contacts (event_id, campaign_id, contact_id)
      values (v_event_id, p_campaign, p_contact)
      on conflict (campaign_id, contact_id) do nothing;
    v_size := v_size + 1;
    insert into public.campaign_authorized_set_audit
      (event_id, campaign_id, contact_id, prev_contact_id, action, reason, actor, resulting_size)
      values (v_event_id, p_campaign, p_prev_contact, null, 'kept_exposed', 'repoint', p_actor, v_size);
    insert into public.campaign_authorized_set_audit
      (event_id, campaign_id, contact_id, prev_contact_id, action, reason, actor, resulting_size)
      values (v_event_id, p_campaign, p_contact, p_prev_contact, 'in', 'repoint', p_actor, v_size);
    return 'pinned_and_added';
  end if;

  -- DELETE (target = p_contact = A)
  if p_op = 'delete' then
    if not v_new_member then
      return 'noop';
    end if;
    if public.has_service_exposure(p_campaign, p_contact) then
      insert into public.campaign_authorized_set_audit
        (event_id, campaign_id, contact_id, prev_contact_id, action, reason, actor, resulting_size)
        values (v_event_id, p_campaign, p_contact, null, 'kept_exposed', 'delete', p_actor, v_size);
      return 'pinned_kept';
    end if;
    delete from public.campaign_authorized_contacts
      where campaign_id = p_campaign and contact_id = p_contact;
    v_size := v_size - 1;
    insert into public.campaign_authorized_set_audit
      (event_id, campaign_id, contact_id, prev_contact_id, action, reason, actor, resulting_size)
      values (v_event_id, p_campaign, p_contact, null, 'out', 'delete', p_actor, v_size);
    return 'removed';
  end if;

  return 'not_operational';
end;
$function$
```

ניתוח (מההגדרה החיה):

- **נעילה**: `select ... from public.campaigns where id = p_campaign for update` — אותה שורה ואותו מנעול שבהם משתמש `try_record_billed_result`. לכן reconcile וחיוב לאותו קמפיין מסתדרים בטור זה מול זה; אין מצב שבו חבר נוסף למערך "באמצע" בדיקת החיוב או להפך.
- **`funded_cap`** (זהה נוסחתית ל-gate=ON ב-RPC החיוב): אם `max_contacts`, `auth_amount` או `price_per_reached` הם NULL, או `auth_amount <= 0`, או `price_per_reached <= 0` ⇒ **0** (fail-closed). אחרת `least(greatest(max_contacts, included_reached), included_reached + floor(max(0, auth_amount − base_price) / price_per_reached))`. `base_price`/`included_reached` NULL ⇒ 0. הרצפה ב-`included_reached` (2026-09-02) היא מה שמונע מ-hold של 0 אורחים לנעול את המערך על 0.
- **הבדל אחד מה-RPC של החיוב**: כאן `v_max IS NULL` ⇒ cap 0; ב-`try_record_billed_result` `max_contacts` אינו נבדק ל-NULL (העמודה `NOT NULL` בכל מקרה, אז ההבדל תיאורטי).
- **סטטוסים תפעוליים** שבהם המערך משתנה: `approved, scheduled, active, paused`. ב-`draft`/`closed`/`cancelled` וכו' ⇒ `not_operational`.
- **זכאות יעד** (`v_target_ok`): ה-contact שייך לאירוע, `removal_requested = false`, ויש לו אורח חי (`guests.contact_id`). contact יתום או שהוסר לעולם אינו מתקבל.
- **נעיצה** (`has_service_exposure`): חבר שכבר קיבל שירות (אינטראקציה in/out, בקשת שיחה, או שורת חיוב) אינו מוסר ב-`repoint`/`delete` — נשאר במערך ומתועד `kept_exposed`.
- **ליטרלים מוחזרים** (11, אין `'admitted'`): `no_campaign`, `event_mismatch`, `not_operational`, `noop`, `not_eligible`, `ceiling_full`, `added`, `swapped`, `pinned_kept`, `pinned_and_added`, `removed`.
- **ביקורת**: כל שינוי חברות וכל נעיצה נכתבים ל-`campaign_authorized_set_audit` (action ∈ in / out / kept_exposed; reason ∈ add / repoint / delete; `resulting_size`).

---

## 4. טבלאות — מבנה חי

שאילתות המקור (הורצו פעם אחת על שמונה הטבלאות):

```sql
-- עמודות
select c.relname, a.attnum, a.attname, format_type(a.atttypid,a.atttypmod), a.attnotnull,
       pg_get_expr(d.adbin,d.adrelid)
from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
where n.nspname='public' and c.relname in (...) and a.attnum>0 and not a.attisdropped
order by c.relname, a.attnum;
-- אילוצים
select c.relname, con.conname, con.contype, pg_get_constraintdef(con.oid)
from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in (...);
-- אינדקסים
select tablename, indexname, indexdef from pg_indexes where schemaname='public' and tablename in (...);
-- טריגרים
select c.relname, t.tgname, t.tgenabled, pg_get_triggerdef(t.oid)
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in (...) and not t.tgisinternal;
-- RLS + מדיניות
select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c ... ;
select c.relname, p.polname, p.polcmd, p.polpermissive,
       (select array_agg(rolname) from pg_roles where oid = any(p.polroles)),
       pg_get_expr(p.polqual,p.polrelid), pg_get_expr(p.polwithcheck,p.polrelid)
from pg_policy p join pg_class c on c.oid=p.polrelid ... ;
-- הרשאות טבלה ועמודה
select c.relname, g.grantee::regrole, g.privilege_type from pg_class c, aclexplode(c.relacl) g ... ;
select c.relname, a.attname, g.grantee::regrole, g.privilege_type
from pg_attribute a join pg_class c on c.oid=a.attrelid, aclexplode(a.attacl) g where a.attacl is not null ... ;
```

### 4.1 `billed_results` (VERIFIED-LIVE)

| עמודה | טיפוס | NULL | ברירת מחדל |
|---|---|---|---|
| id | uuid | לא | gen_random_uuid() |
| event_id | uuid | לא | |
| campaign_id | uuid | לא | |
| contact_id | uuid | לא | |
| channel | campaign_channel | לא | |
| attempt_id | text | כן | |
| reached_at | timestamptz | לא | now() |
| locked_price | numeric | לא | |
| evidence_source | text | לא | |
| provider_ref | text | כן | |
| control_status | text | לא | 'confirmed' |
| manual_adjustment | jsonb | כן | |
| created_at | timestamptz | לא | now() |

אילוצים:
- `billed_results_pkey PRIMARY KEY (id)`
- **`billed_results_event_contact_unique UNIQUE (event_id, contact_id)`** — המפתח היחיד נגד חיוב כפול.
- `billed_results_event_id_fkey ... REFERENCES events(id) ON DELETE RESTRICT` (הוקשח ב-`20260821141118`; במקור CASCADE ב-0007)
- `billed_results_campaign_id_fkey ... REFERENCES campaigns(id) ON DELETE RESTRICT` (הוקשח ב-`20260821141118`)
- `billed_results_contact_id_fkey ... REFERENCES contacts(id) ON DELETE RESTRICT` (הוקשח בשלב מוקדם יותר; 0007 יצר CASCADE)

אינדקסים: `billed_results_pkey`, `billed_results_event_contact_unique`, `billed_results_campaign_idx (campaign_id)`.
טריגרים: **אין**. אין טריגר חוסם UPDATE/DELETE (בניגוד לתקדים `campaign_authorized_set_audit`); ההגנה על ה-append-only היא RLS (אין מדיניות UPDATE/DELETE) + כתיבה דרך service_role בלבד.
RLS: מופעל, לא FORCE. מדיניות יחידה: `billed_results_org_select FOR SELECT TO authenticated USING (can_access_event(event_id,'billing','view'))`. אין מדיניות admin (הוסרה ב-`20260720030121`).
GRANT (טבלה): `anon`, `authenticated`, `postgres`, `service_role` — כולם `DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE`. ראו הפתעה 1.

### 4.2 `campaign_authorized_contacts` (VERIFIED-LIVE)

עמודות: `id uuid PK`, `event_id uuid NOT NULL`, `campaign_id uuid NOT NULL`, `contact_id uuid NOT NULL`, `created_at timestamptz NOT NULL default now()`.
אילוצים: PK (id); **`UNIQUE (campaign_id, contact_id)`**; FK event_id → events **RESTRICT**; FK campaign_id → campaigns **RESTRICT**; FK contact_id → contacts **CASCADE** (הפתעה 5).
אינדקסים: pkey, `campaign_authorized_contacts_campaign_contact_unique`, `campaign_authorized_contacts_campaign_idx (campaign_id)`.
טריגרים: אין. RLS: מופעל; מדיניות יחידה `campaign_authorized_contacts_org_select FOR SELECT TO authenticated USING (can_access_event(event_id,'campaigns','view'))`.
GRANT: ברירת מחדל מלאה ל-anon/authenticated (הפתעה 1).

### 4.3 `contact_interactions` (VERIFIED-LIVE)

| עמודה | טיפוס | NULL | ברירת מחדל | מיגרציה |
|---|---|---|---|---|
| id | uuid | לא | gen_random_uuid() | 0007 |
| event_id | uuid | כן | | 0007 |
| campaign_id | uuid | כן | | 0007 |
| contact_id | uuid | כן | | 0007 |
| channel | campaign_channel | לא | | 0007 |
| direction | text | לא | | 0007 |
| kind | text | לא | | 0007 |
| provider_id | text | לא | | 0007 |
| billable | boolean | לא | false | 0007 |
| payload_meta | jsonb | כן | | 0007 |
| created_at | timestamptz | לא | now() | 0007 |
| guest_id | uuid | כן | | (מאוחר יותר) |
| context_message_id | text | כן | | (מאוחר יותר) |
| delivery_status | text | כן | | (מאוחר יותר) |
| delivery_error_code | text | כן | | (מאוחר יותר) |
| message_key | text | כן | | (מאוחר יותר) |
| billing_outcome | text | כן | | `20260903214126` |

אילוצים: PK; **`contact_interactions_provider_unique UNIQUE (channel, provider_id)`**; FK campaign_id → campaigns CASCADE; FK event_id → events CASCADE; FK contact_id → contacts SET NULL; FK guest_id → guests (NO ACTION).
אינדקסים: pkey; `contact_interactions_provider_unique (channel, provider_id)`; `contact_interactions_contact_idx (contact_id)`; `contact_interactions_dedup_idx (campaign_id, contact_id, message_key) WHERE direction='out' AND message_key IS NOT NULL`; `contact_interactions_thankyou_claim_uq UNIQUE (campaign_id, contact_id) WHERE message_key='thankyou' AND direction='out'`.
**אין** אינדקס על `(contact_id, direction, created_at)` ואין אינדקס שמוביל ב-`provider_id` לבדו.
טריגרים: אין. RLS: מופעל; `contact_interactions_org_select FOR SELECT TO authenticated USING (event_id IS NOT NULL AND can_access_event(event_id,'contacts','view'))`.
GRANT: ברירת מחדל מלאה ל-anon/authenticated.

### 4.4 `contacts` (VERIFIED-LIVE)

עמודות: `id`, `event_id NOT NULL`, `normalized_phone text NOT NULL`, `op_status contact_op_status NOT NULL default 'pending_contact'`, `removal_requested boolean NOT NULL default false`, `created_at`, `updated_at`, `whatsapp_consent_at timestamptz`, `call_consent_at timestamptz`.
אילוצים: PK; **`contacts_event_phone_unique UNIQUE (event_id, normalized_phone)`**; FK event_id → events CASCADE.
אינדקסים: pkey, `contacts_event_phone_unique`, `contacts_event_idx (event_id)`.
טריגרים: `contacts_set_updated_at BEFORE UPDATE → set_updated_at()`.
RLS: מופעל; `contacts_org_select FOR SELECT TO authenticated USING (can_access_event(event_id,'contacts','view'))`.
GRANT: ברירת מחדל מלאה ל-anon/authenticated.

### 4.5 `campaigns` (VERIFIED-LIVE, עמודות רלוונטיות לחיוב)

`status campaign_status NOT NULL default 'draft'`, `price_per_reached numeric`, `max_contacts integer NOT NULL`, `max_charge_ceiling numeric`, `allowed_channels campaign_channel[] NOT NULL default '{whatsapp,call}'`, `start_at`, `close_at`, `auth_amount numeric`, `auth_number text`, `authorized_at`, `auth_expires_at`, `capture_status text`, `release_status text`, `charge_status text`, `charged_at`, `final_charge_amount numeric`, `credit_applied numeric NOT NULL default 0`, `base_price numeric`, `included_reached integer`, `billing_route billing_route`, `sumit_customer_id bigint`, שדות מסמכי SUMIT (order/hold/charge), שדות thank-you.
אילוצים: PK; `campaigns_base_overage_nonneg CHECK (base_price >= 0, included_reached >= 0 כשאינם NULL)`; FK event_id → events **CASCADE**; FK template_id → packages.
אינדקסים: pkey; `campaigns_event_noncancelled_uidx UNIQUE (event_id) WHERE status <> 'cancelled'`; `campaigns_one_active_per_event UNIQUE (event_id) WHERE status <> 'cancelled'` (כפול, הפתעה 6); `campaigns_thankyou_due_idx`.
טריגרים: `campaigns_guard_cancel BEFORE UPDATE`; `campaigns_require_active_event BEFORE INSERT OR UPDATE`; `trg_campaigns_updated BEFORE UPDATE → set_updated_at()`.
RLS: מופעל; `camp_org_select FOR SELECT TO authenticated USING (can_access_event(event_id,'campaigns','view'))`. אין מדיניות כתיבה ללקוח.
GRANT: ברירת מחדל מלאה ל-anon/authenticated.

### 4.6 `events` (VERIFIED-LIVE)

עמודות: `id`, `owner_id uuid NOT NULL` (FK → auth.users CASCADE), `name`, `event_type`, `event_date timestamptz`, `venue_*`, `template`, `package_id`, `with_ai_calls`, `status event_status NOT NULL default 'draft'`, `rsvp_deadline date`, `notes`, `created_at`, `updated_at`, `org_id uuid` (FK → organizations), `celebrants jsonb`, `gift_payment_url`, `gift_link_token text NOT NULL UNIQUE`, `invite_image_path`, `show_meal_pref`.
CHECK: `events_gift_payment_url_https`; `events_rsvp_deadline_within_event`.
טריגרים: `events_before_insert`, `events_guard_update` (מכונת מצבים draft→active→closed, נעילת תאריכים, חסימת סגירה עם קמפיין תפעולי), `trg_events_updated`.
RLS: מופעל; `events_org_select` (owner או has_org_permission), `events_org_update` (can_access_event 'edit'), `events_owner_delete` (owner AND status='draft'), `events_owner_insert`.
GRANT: anon/authenticated **ללא** UPDATE ברמת טבלה; UPDATE ברמת עמודה ל-authenticated על 15 עמודות עסקיות בלבד (`celebrants, event_date, event_type, gift_payment_url, invite_image_path, name, notes, package_id, rsvp_deadline, show_meal_pref, template, updated_at, venue_address, venue_name, with_ai_calls`). זו הטבלה היחידה מהשמונה שעברה הקשחת GRANT.

### 4.7 `webhook_inbox` (VERIFIED-LIVE)

עמודות: `id`, `provider text NOT NULL default 'whatsapp'`, `event_kind text NOT NULL`, `dedupe_key text NOT NULL`, `message_id`, `context_message_id`, `phone_number_id`, `event_at`, `payload jsonb NOT NULL`, `received_at NOT NULL default now()`, `processed_at`, `attempts int NOT NULL default 0`, `last_error`, `delivery_id uuid` (FK → webhook_deliveries SET NULL, `20260903214126`).
אילוצים: PK; **`UNIQUE (provider, dedupe_key)`**.
אינדקסים: pkey; unique; `webhook_inbox_received_idx (received_at DESC)`; `webhook_inbox_unprocessed_idx (received_at) WHERE processed_at IS NULL` (משרת את `claim_webhook_events`); `webhook_inbox_delivery_idx (delivery_id) WHERE delivery_id IS NOT NULL`.
טריגרים: אין. RLS: מופעל; `webhook_inbox_admin_all FOR ALL TO authenticated USING/WITH CHECK ((select has_role((select auth.uid()),'admin')))`.
GRANT: ברירת מחדל מלאה ל-anon/authenticated.

### 4.8 `guest_import_staging` (VERIFIED-LIVE)

עמודות: `id`, `event_id NOT NULL` (FK CASCADE), `source text NOT NULL CHECK IN ('whatsapp_document','whatsapp_contacts')`, `sender_phone text NOT NULL`, `file_name`, `rows jsonb NOT NULL`, `row_count int NOT NULL`, `error_rows jsonb NOT NULL default '[]'`, `status text NOT NULL default 'pending' CHECK IN ('pending','confirmed','discarded')`, `created_at`, `resolved_at`, `source_message_id text` (`20260903214126`).
אינדקסים: pkey; `guest_import_staging_event_pending (event_id, created_at DESC) WHERE status='pending'`; `guest_import_staging_source_message_uidx UNIQUE (source_message_id) WHERE source_message_id IS NOT NULL`.
טריגרים: אין. RLS: מופעל; `staging_org_select` (guests/view), `staging_org_update` (guests/create).
GRANT: ברירת מחדל מלאה ל-anon/authenticated.

---

## 5. Enums והגדרות (VERIFIED-LIVE)

```sql
select t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder)
from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_namespace n on n.oid=t.typnamespace
where n.nspname='public' and t.typname in ('campaign_status','event_status','contact_op_status','campaign_channel','billing_route')
group by 1;
```

| enum | תוויות חיות (בסדר) |
|---|---|
| `campaign_status` | draft, pending_approval, approved, scheduled, active, paused, closed, awaiting_invoice, billed, paid, cancelled |
| `event_status` | draft, active, closed |
| `campaign_channel` | whatsapp, call |
| `contact_op_status` | pending_contact, not_eligible, whatsapp_sent, whatsapp_delivered, whatsapp_read, whatsapp_responded, pending_call, call_dialed, no_answer, voicemail, human_interaction_call, wrong_number, removal_requested, reached_billed, not_reached |
| `billing_route` | saved_token, hold_j5 |

`app_settings` (שורה אחת): **`billing_exposure_gate = false`**. עמודות נוספות הקשורות לחיוב/holds: `campaign_holds_enabled boolean`, `close_charge_enabled boolean`, `agr_charge_window_days text`, `agr_hold_release_days text`, `extreme_threshold_contacts integer`, `slack_alert_campaign_billing boolean`. אין טבלה בשם `campaign_holds`; הנתונים על ה-hold יושבים בעמודות `campaigns.*` (auth_amount, capture_status, hold_order_document_*).

---

## 6. תשובות מפורשות לשאלות 1–10

### שאלה 1 — אילו מפתחות UNIQUE מונעים חיוב כפול?

```sql
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid='public.billed_results'::regclass and contype in ('p','u');
```

VERIFIED-LIVE:
- `billed_results_pkey PRIMARY KEY (id)`
- `billed_results_event_contact_unique UNIQUE (event_id, contact_id)` — **זה המפתח היחיד**.
- אין UNIQUE על `(campaign_id, contact_id)`, על `attempt_id`, על `provider_ref`.

בפועל `(campaign_id, contact_id)` ייחודי בעקיפין: `campaigns_one_active_per_event` מבטיח קמפיין לא-מבוטל אחד לאירוע, וקמפיין מבוטל מוחזר `'not_active'` ואינו יכול להיות מבוטל אם יש לו שורת חיוב (`campaigns_guard_cancel`). בדיקת נתונים: כפילויות על (event,contact) = 0, על (campaign,contact) = 0, על provider_ref = 0, על attempt_id = 0.

שכבות אידמפוטנטיות במעלה הזרם (מונעות קריאה כפולה ל-RPC, לא רק כתיבה כפולה): `webhook_inbox UNIQUE (provider, dedupe_key)` ← `contact_interactions UNIQUE (channel, provider_id)` ← שער `fresh` בקוד (`processMessage` קורא ל-`recordReached` רק אם ה-upsert הכניס שורה חדשה).

### שאלה 2 — פנים `try_record_billed_result`

- `FOR UPDATE` על `campaigns`: **כן** — `from campaigns where id=p_campaign for update` (השורה הראשונה בגוף).
- INSERT: **`on conflict (event_id,contact_id) do nothing`**; `if not found then return 'already_billed'`.
- `SECURITY DEFINER`: **כן**; `SET search_path TO 'public'`.
- EXECUTE: `proacl = {postgres=X/postgres,service_role=X/postgres}` — אין רשומת PUBLIC, כלומר `anon`/`authenticated` **אינם** יכולים להריץ (VERIFIED-LIVE; תואם `202606300038` ואת ה-REVOKE החוזר בכל CREATE מאוחר).
- ליטרלים מוחזרים, בסדר הבדיקה:
  1. `'no_campaign'` — הקמפיין לא נמצא
  2. `'event_mismatch'` — `p_event` שונה מ-`campaigns.event_id` (האירוע הסמכותי נלקח מהקמפיין)
  3. `'not_active'` — status לא ב-(active, paused)
  4. `'before_window'` — `now() < start_at`
  5. `'closed_window'` — `now() > close_at`
  6. `'event_passed'` — יום האירוע (Asia/Jerusalem) כבר עבר
  7. `'event_not_active'` — `events.status <> 'active'`
  8. `'removal_requested'` — `contacts.removal_requested = true`
  9. gate=ON: `'no_exposure'` / gate=OFF: `'not_authorized'` (לא חבר ב-`campaign_authorized_contacts`)
  10. `'ceiling_reached'` — `count(billed_results where campaign_id) >= v_cap`
  11. `'already_billed'` — ON CONFLICT לא הכניס
  12. `'billed'`

  חישוב התקרה: gate=OFF → `v_cap = greatest(max_contacts, included_reached)`; gate=ON → `least(greatest(max_contacts, included_reached), included_reached + floor(max(0, auth_amount − base_price) / price_per_reached))`, ו-0 (fail-closed) אם auth_amount/price חסרים או לא חיוביים.

### שאלה 3 — `exposed_for_billing`

הגדרה מלאה בסעיף 3.2. "חשיפה" = אחד משלושה:
1. כבר קיימת שורת `billed_results` ל-(event, contact) — מונוטוני.
2. ערוץ whatsapp: קיימת שורת `contact_interactions` ל-(campaign, contact) עם `billable=true AND direction='in' AND channel='whatsapp'` — כלומר **תגובה נכנסת חייבת-חיוב**. ניסיון יוצא, סטטוס delivered/read או שליחת template **אינם** נחשבים חשיפה.
3. ערוץ call: `outreach_state.call_request_count > 0`.

מצב השער: **OFF**. נמדד פעמיים: `billing_exposure_gate = false` ב-22:20 UTC וב-22:50 UTC (2026-09-03), שורה אחת ב-`app_settings`, `campaign_holds_enabled = true`, `close_charge_enabled = true` (VERIFIED-LIVE). לכן כיום הפונקציה אינה נקראת מתוך ה-RPC, הבסיס לאישור הוא חברות במערך המורשים בלבד, והתקרה היא `greatest(max_contacts, included_reached)`.

**מעגליות בערוץ WhatsApp (הפתעה 4) — כן, תלויה ב-inbound שהקורא זה עתה הכניס.** הסעיף החי הרלוונטי ב-`exposed_for_billing`:

```sql
    or (
      p_channel = 'whatsapp'
      and exists (
        select 1
        from public.contact_interactions ci
        where ci.campaign_id = p_campaign
          and ci.contact_id = p_contact
          and ci.billable = true
          and ci.direction = 'in'
          and ci.channel = 'whatsapp'
      )
    )
```

והסדר בקורא היחיד (`src/lib/data/webhook-processing.ts`, `processMessage`, CODE):

```ts
const fresh = await insertInteraction({
  event_id: resolved.eventId, campaign_id: resolved.campaignId, contact_id: resolved.contactId,
  channel: 'whatsapp', direction: 'in', kind: 'message',
  provider_id: messageId, context_message_id: contextId, billable: true,
});
if (fresh) {
  const outcome = await recordReached({ ... channel: 'whatsapp', ... });   // → try_record_billed_result
```

השורה שמוכנסת ב-`insertInteraction` היא בדיוק (`campaign_id`, `contact_id`, `billable=true`, `direction='in'`, `channel='whatsapp'`) — הפרדיקט של הפונקציה. ה-upsert מבוצע ב-auto-commit דרך service_role לפני קריאת ה-RPC, ולכן ה-RPC (טרנזקציה נפרדת) רואה אותה. תחת gate=ON, לכל הודעת WhatsApp נכנסת שמגיעה ל-RPC הפרדיקט מתקיים **תמיד**; `'no_exposure'` ל-WhatsApp אינו בר-השגה מנתיב ה-webhook. מה שבאמת חוסם תחת gate=ON: (א) הרזולוציה — `resolveByContextId`/`resolveInboundContact` דורשות אינטראקציה **יוצאת** קודמת לאותו contact, כך ש-contact שמעולם לא פנו אליו לא מגיע ל-RPC; (ב) ה-funded cap. ערוץ call אינו מעגלי: הוא בודק `outreach_state.call_request_count > 0`, שנכתב בזמן שליחת בקשת השיחה, לא בזמן התוצאה. אם השער יופעל, מומלץ להחליף את פרדיקט ה-WhatsApp ל-`direction = 'out'` (כמו `has_service_exposure`) — החלטת מוצר, לא בוצע.

### שאלה 4 — `contacts`

```sql
with per_event as (select event_id, normalized_phone, count(*) n from public.contacts group by 1,2),
multi_event as (select normalized_phone from public.contacts group by 1 having count(distinct event_id)>1),
multi_owner as (select c.normalized_phone from public.contacts c join public.events e on e.id=c.event_id
                group by 1 having count(distinct e.owner_id)>1),
multi_org as (select c.normalized_phone from public.contacts c join public.events e on e.id=c.event_id
              group by 1 having count(distinct e.org_id)>1)
select (select count(*) from public.contacts) contacts_total,
       (select count(distinct normalized_phone) from public.contacts) distinct_phones,
       (select count(*) from per_event where n>1) same_phone_twice_in_one_event,
       (select count(*) from multi_event) phones_in_gt1_event,
       (select count(*) from multi_owner) phones_in_gt1_owner,
       (select count(*) from multi_org) phones_in_gt1_org,
       (select count(*) from public.events where org_id is null) events_without_org;
```

VERIFIED-LIVE:

| מדד | ערך |
|---|---|
| `UNIQUE (event_id, normalized_phone)` | קיים (`contacts_event_phone_unique`) |
| אותו טלפון פעמיים באותו אירוע | 0 (בלתי אפשרי באילוץ) |
| contacts סה"כ / טלפונים ייחודיים | 43 / 41 |
| טלפונים ביותר מאירוע אחד | 2 (מקסימום 2 אירועים לטלפון) |
| טלפונים החוצים יותר מבעלים אחד | 1 |
| טלפונים החוצים יותר מארגון אחד | 1 |
| אירועים / בעלים ייחודיים | 6 / 3 |
| אירועים ללא org_id | 0 |

"לקוח" מוגדר כאן כ-`events.owner_id` (FK ל-`auth.users`). `events.org_id` הוא הקונטיינר האישי (B2C) ומאוכלס בכל האירועים; שתי ההגדרות נותנות אותה תוצאה.

### שאלה 5 — `contact_interactions`

- `UNIQUE (channel, provider_id)`: **מאושר** (`contact_interactions_provider_unique`).
- אינדקס על `(contact_id, direction, created_at)` לשאילתת "ה-outbound האחרון" של `resolveInboundContact`: **אין**. קיים רק `contact_interactions_contact_idx (contact_id)`; המיון והסינון על direction/created_at נעשים על התוצאה. בגודל הנוכחי (173 שורות) אין השפעה.
- אינדקס על `provider_id` לבדו: **אין**. `resolveByContextId` מסנן על `provider_id` + `direction` בלי `channel`, ולכן אינו יכול להשתמש באינדקס הייחודי `(channel, provider_id)` (PostgreSQL 17.6, ללא skip-scan). `setDeliveryStatus` ו-`setInteractionBillingOutcome` כן מסננים עם `channel`.

ספירות (snapshot 22:39:30 UTC):

```sql
select channel, direction, billable, count(*), count(context_message_id) from public.contact_interactions group by 1,2,3;
select direction, billable, coalesce(billing_outcome,'<null>'), count(*) from public.contact_interactions group by 1,2,3;
```

| channel | direction | billable | n | עם context_message_id |
|---|---|---|---|---|
| whatsapp | out | false | 105 | 0 |
| whatsapp | in | true | 59 | 30 |
| call | in | true | 7 | 0 |
| call | out | false | 2 | 0 |

`billing_outcome`: 3 שורות `'not_active'` (כולן inbound whatsapp על קמפיין closed, אחרי ה-close_at ואחרי יום האירוע, לאנשי קשר שכבר חויבו), 63 שורות NULL (נכתבו לפני העמודה), 107 שורות out NULL (לא טריגר חיוב).

"סווגו כ-billable אך לא חויבו":

```sql
-- לפי provider_ref (התאמה 1:1 להודעה)
select cp.status, coalesce(ci.billing_outcome,'<null>'), count(*)
from public.contact_interactions ci left join public.campaigns cp on cp.id=ci.campaign_id
where ci.direction='in' and ci.billable
  and not exists (select 1 from public.billed_results br where br.provider_ref=ci.provider_id)
group by 1,2;
-- לפי (event, contact) — האם איש הקשר חויב אי-פעם
... and not exists (select 1 from public.billed_results br where br.event_id=ci.event_id and br.contact_id=ci.contact_id)
```

| מדד | ערך |
|---|---|
| billable inbound סה"כ | 66 |
| ללא `billed_results.provider_ref` תואם | 44 — **כולן** בקמפיינים `closed` (41 עם billing_outcome NULL, 3 `not_active`) |
| מתוכן: איש הקשר **מעולם לא חויב** באירוע | 3 (1 call ב-2026-07-22; 1 whatsapp עם context ב-2026-07-12; 1 whatsapp ללא context ב-2026-09-03), כולן בקמפיינים closed |
| מתוכן: תגובה חוזרת מאיש קשר שכבר חויב | 41 (היו מקבלות `already_billed`) |

מסקנה: אין "חיוב שאבד" בקמפיין חי. שלוש התגובות הלא-מחויבות הגיעו כשהקמפיין כבר לא היה active/paused.

### שאלה 6 — `campaign_authorized_contacts`

- PK `(id)`; **`UNIQUE (campaign_id, contact_id)`**.
- מי כותב (CODE + MIGRATION):
  1. **`snapshotAuthorizedSet`** ב-`src/lib/data/contacts.ts` — upsert דרך service_role עם `onConflict: 'campaign_id,contact_id'`, סמנטיקת REPLACE (מוחק חברים שאינם ב-top-`covered` הנוכחי). נקרא מ-`prepareCampaignHold` ב-`src/lib/data/campaigns.ts` — **בשלב ה-hold (J5), לפני הנחת ה-hold ולפני ה-activation**. המיגרציות: `202606290024_billing_authorized_set.sql` (הטבלה, "snapshot written at the hold step") ו-`202606290029_billing_set_membership.sql` (חברות במערך כתנאי חיוב).
  2. **`reconcile_authorized_set` RPC** (`20260712104117`, עודכן ב-`20260712115459`, `20260830112656`, `20260902062917`) — add/repoint/delete אחרי מוטציית אורח, תחת אותו FOR UPDATE, עד funded_cap. מופעל מ-`reconcileCampaignSetForContact` (kill-switch `RECONCILE_AUTHORIZED_SET_ENABLED`, חי מאז 2026-07-21 לפי הערות הקוד).
  3. `seedOutreachState` ב-`outreach-engine.ts` **קורא** מהמערך ב-activation וזורע `outreach_state`; אינו כותב למערך.
- "מוקפא ב-activation?" — **לא**. המערך נוצר ב-**J5 hold** (לא ב-activation) ומאז `20260712104117` הוא **מתוחזק דינמית** ע"י `reconcile_authorized_set` בכל מוטציית אורח, עד `funded_cap`. אין טריגר משתמש על הטבלה (רק 6 טריגרי RI פנימיים של ה-FK-ים, VERIFIED-LIVE), אין אילוץ שאוכף הקפאה, ו-RLS מאפשר ללקוח SELECT בלבד; כל שינוי עובר דרך service_role.

**רשימת הכותבים המלאה** (DB + קוד, VERIFIED-LIVE + MIGRATION + CODE):

| # | כותב | פעולה | טריגר עסקי | מקור |
|---|---|---|---|---|
| 1 | `snapshotAuthorizedSet` (`src/lib/data/contacts.ts`) | `delete ... not in (fresh)` ואז `upsert ... onConflict campaign_id,contact_id ignoreDuplicates` (REPLACE) | `prepareCampaignHold` (`src/lib/data/campaigns.ts:707`) — שלב J5 לפני הנחת ה-hold | CODE |
| 2 | RPC `reconcile_authorized_set` (סעיף 3.6) | `insert ... on conflict do nothing` / `delete` | `reconcileCampaignSetForContact` (`contacts.ts`) — נקרא מ: `guests-actions.ts` (add/repoint/delete באורח בודד), `guests.ts:567` (delete), `guests.ts:847` (add), `import/import-actions.ts:286` (add ב-bulk import), `import/whatsapp/actions.ts:158` (add ב-import מ-WhatsApp) | CODE + MIGRATION |
| 3 | FK `campaign_authorized_contacts_contact_id_fkey ON DELETE CASCADE` | מחיקה שקטה של חבר כשה-contact נמחק | כל DELETE על `contacts` (בקוד: `pruneOrphanContact` מסרב למחוק חבר במערך כשה-kill-switch פעיל) | VERIFIED-LIVE |
| — | `seedOutreachState`, `resolveSendableContacts`, `countAuthorizedContacts`, `try_record_billed_result` | **קריאה בלבד** | | CODE |

אין כותב נוסף: grep על `insert into|delete from|update ... campaign_authorized_contacts` בכל המיגרציות מחזיר רק את גרסאות `reconcile_authorized_set` (`20260712104117`, `20260712115459`, `20260830112656`, `20260902062917`); grep על `.from('campaign_authorized_contacts')` ב-`src`, `worker`, `scripts` מחזיר כתיבה רק ב-`contacts.ts` (שורות 461, 479).

Kill-switch של #2: `RECONCILE_AUTHORIZED_SET_ENABLED === 'true'` (env, נקרא בכל קריאה; `src/lib/data/reconcile-config.ts`). לפי ההערה בקובץ הוא `true` בפרודקשן מאז 2026-07-21 (אומת 2026-08-30) — **CODE**, לא נמדד כאן (משתני סביבה אינם בתחום ביקורת ה-DB). `campaign_authorized_set_audit` חי: 3 שורות (2 `in/add`, 1 `out/delete`) — ראיה שה-RPC אכן רץ בפרודקשן.

```sql
select c.status, count(*) campaigns,
       count(*) filter (where not exists (select 1 from public.campaign_authorized_contacts a where a.campaign_id=c.id)) empty_set
from public.campaigns c group by 1;
```

| status | קמפיינים | מערך ריק |
|---|---|---|
| active | 2 | **1** |
| approved | 1 | 1 |
| closed | 2 | 0 |

הקמפיין ה-active עם מערך ריק שייך לאירוע עם 0 contacts. שני ה-active: `max_contacts = 0`, `included_reached = 200`, `base_price` קיים, `auth_amount` קיים ⇒ `funded_cap = 200` ו-gate-OFF cap = 200. עם מערך ריק כל inbound יחזיר `not_authorized` (fail-closed, התנהגות נכונה). יום האירוע לא עבר בשניהם.

### שאלה 7 — נתוני `billed_results` (אגרגט)

```sql
select br.evidence_source, br.channel, cp.status, br.control_status, count(*),
       count(br.provider_ref), count(br.attempt_id), min(br.reached_at), max(br.reached_at),
       min(br.locked_price), max(br.locked_price)
from public.billed_results br join public.campaigns cp on cp.id=br.campaign_id group by 1,2,3,4;
```

| evidence_source | channel | campaign status | control_status | n | provider_ref | attempt_id | reached_at | locked_price |
|---|---|---|---|---|---|---|---|---|
| whatsapp_inbound_message | whatsapp | closed | confirmed | 21 | 21 | 21 | 2026-07-07 11:22 → 2026-07-10 11:51 UTC | 4 |
| voximplant_call_completed | call | closed | confirmed | 1 | 1 | 1 | 2026-07-22 01:12 UTC | 4 |

בדיקות שלמות (VERIFIED-LIVE, כולן 0): `campaigns.event_id <> billed_results.event_id`; כפילות (event_id, contact_id); כפילות (campaign_id, contact_id); כפילות provider_ref; כפילות attempt_id; `contacts.event_id <> billed_results.event_id`; שורת חיוב לאיש קשר שאינו במערך המורשים; `manual_adjustment` לא NULL.

הצלבה לקמפיינים הסגורים: reached 21 ו-1, accrued 84 ו-4, `credit_applied` 84 ו-4 ⇒ `charge_status = 'nothing_to_charge'`, `final_charge_amount = 0`. הזיכויים כיסו את מלוא הסכום; זה עקבי ולא אנומליה (סביר שקמפייני QA).

### שאלה 8 — מקביליות

**לא הורצה** טרנזקציית dry-run (המרוץ דורש שתי סשנים ואינו ניתן לשחזור בהצהרה אחת; הביקורת read-only). הנימוק מההגדרה (inferred):

- `select ... from campaigns where id=p_campaign for update` נועל את שורת הקמפיין לכל אורך הטרנזקציה. שתי קריאות לאותו קמפיין — לאותו contact או לשני contacts שונים — **מסתדרות בטור**: השנייה חוסמת עד commit הראשונה. ב-READ COMMITTED, אחרי השחרור השנייה קוראת מחדש את השורה הנעולה, וכל הצהרה שאחריה (ה-`count(*)`, ה-INSERT) מקבלת snapshot חדש שכולל את השורה שהראשונה הכניסה.
- אותו (campaign, contact): הראשונה → `'billed'`; השנייה → `'already_billed'` דרך ON CONFLICT (event_id, contact_id) — **אלא אם** הראשונה מילאה בדיוק את התקרה, ואז השנייה נעצרת קודם ב-`'ceiling_reached'` (הפתעה 3; אין הבדל כספי).
- שני contacts שונים על גבול התקרה (`v_count = v_cap − 1`): הראשונה עוברת ומכניסה; השנייה רואה `v_count = v_cap` ומחזירה `'ceiling_reached'`. **לא** ייתכן ששתיהן יעברו.
- שני קמפיינים שונים לאותו אירוע: אינו אפשרי עבור קמפיינים לא-מבוטלים (`campaigns_one_active_per_event`), וקמפיין מבוטל נופל על `'not_active'`.
- בנוסף, ב-webhook flow קריאה כפולה ל-RPC על אותה הודעה נמנעת עוד קודם ע"י `UNIQUE (channel, provider_id)` + שער `fresh`.

### שאלה 9 — Drift

| אובייקט | מצב | פרטים |
|---|---|---|
| `try_record_billed_result` | **MATCHES** `20260902062917` | גוף, SECDEF, search_path=public, ACL service_role בלבד |
| `exposed_for_billing` | **MATCHES** `20260712104032` | |
| `has_service_exposure` | **MATCHES** `20260712104032` | |
| `campaign_billing_summary` | **MATCHES** `202606290028` + ACL `202606300038` | |
| `claim_webhook_events` | **MATCHES** `202606300036` | |
| `reconcile_authorized_set` | **MATCHES** `20260902062917` | |
| `cancel_campaign`, `campaigns_guard_cancel` | **MATCHES** `20260630223635` (+ACL `20260630230249`) | |
| `claim_thankyou_recipient` | **MATCHES** `20260712205030` | |
| `billed_results` | **MATCHES** | 0007 (מבנה, UNIQUE, אינדקס) + `20260821141118` (FK RESTRICT ל-event/campaign) + `20260705115539` (מדיניות org_select) + `20260720030121` (הסרת admin_all) |
| `campaign_authorized_contacts` | **MATCHES** | 0024 + `20260821141118` + `20260705115539`; `contact_id` CASCADE כמו במקור |
| `contact_interactions` | **MATCHES** | 0007 + עמודות מאוחרות + `20260903214126` (billing_outcome) |
| `contacts` | **MATCHES** | 0007 + consent columns |
| `campaigns` | **MATCHES**, עם אינדקס כפול | `campaigns_event_noncancelled_uidx` (`20260726100000`) ו-`campaigns_one_active_per_event` (`20260830130737`) זהים |
| `events` | **MATCHES** | GRANT ברמת עמודה (תיקון event-edit) |
| `webhook_inbox` | **MATCHES** | `202606290035` + `delivery_id` (`20260903214126`) |
| `guest_import_staging` | **MATCHES** | `20260705170319` + `source_message_id` (`20260903214126`) |
| **GRANT-ים על 7 הטבלאות** | **DEFINED ONLY IN DB** (ברירת מחדל) | אף מיגרציה לא ביצעה `revoke ... on <table> from anon, authenticated` על אף אחת מהן; ה-ACL החי הוא תוצר `pg_default_acl` (`arwdDxtm` ל-anon/authenticated/service_role). ראו סעיף 7. |

אין פונקציה, טבלה, אילוץ, אינדקס או מדיניות שקיימים רק ב-DB. אין אובייקט מהמיגרציות שחסר ב-DB.

### שאלה 10 — 21 שורות ה-WhatsApp המחויבות

```sql
select (ci.context_message_id is not null) resolved_via_context,
       (select count(distinct k2.event_id) from public.contacts k2
         where k2.normalized_phone=k.normalized_phone and k2.created_at <= br.reached_at) events_with_phone_at_billing_time,
       (select count(distinct k2.event_id) from public.contacts k2 where k2.normalized_phone=k.normalized_phone) events_with_phone_now,
       count(*)
from public.billed_results br
join public.contact_interactions ci on ci.provider_id=br.provider_ref and ci.channel='whatsapp'
join public.contacts k on k.id=br.contact_id
where br.channel='whatsapp' group by 1,2,3;
```

| רזולוציה | אירועים עם הטלפון בזמן החיוב | אירועים עם הטלפון היום | n |
|---|---|---|---|
| context (`context.id`) | 1 | 1 | 18 |
| context | 1 | 2 | 1 |
| **phone fallback** | **1** | 1 | **2** |

- 19 נפתרו דרך context, 2 דרך fallback טלפוני.
- עבור שתי שורות ה-fallback, הטלפון היה קיים **באירוע אחד בלבד** בזמן החיוב (ועדיין) — אין אפשרות לייחוס שגוי.
- לכל 21 השורות הייתה אינטראקציה יוצאת קודמת לאותו contact **באותו קמפיין** (VERIFIED-LIVE).
- שורה אחת שנפתרה דרך context: הטלפון שלה נוסף מאז לאירוע שני — ללא השפעה (הרזולוציה לא הייתה תלויה בטלפון).

---

## 7. ממצאים והמלצות (לא בוצע דבר; כל שינוי דורש אישור מפורש)

1. **הקשחת GRANT על טבלאות הכסף (הפתעה 1)** — VERIFIED-LIVE. `anon` ו-`authenticated` מחזיקים `INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER` על `billed_results`, `campaign_authorized_contacts`, `contact_interactions`, `contacts`, `campaigns`, `webhook_inbox`, `guest_import_staging`. RLS חוסם DML שורתי (יש רק מדיניות SELECT ללקוח, ומדיניות admin ALL רק על `webhook_inbox`), אבל `TRUNCATE` אינו כפוף ל-RLS. חשיפה מעשית היום: אפסית (`rolcanlogin=false` לשני הרולים, PostgREST אינו חושף TRUNCATE, `service_role` הוא הכותב היחיד). זו הגנת עומק חסרה, לא פרצה פתוחה. הצעה: מיגרציה אחת של `revoke insert, update, delete, truncate, references, trigger on <table> from anon, authenticated` + `grant select to authenticated` (אותו תבנית כמו `webhook_deliveries` ב-`20260903214126`). לפני כן: **auth-authz-guardian** לאשר שאין נתיב כתיבה עם cookie client לאף אחת מהטבלאות (לפי RLS החי — אין, אבל יש לאמת בקוד). ל-`webhook_inbox` להשאיר ALL ל-authenticated בגלל `webhook_inbox_admin_all` (מדיניות ה-inspector).
2. **`billing_outcome` היסטורי ריק (הפתעה 2)** — 63 שורות inbound שלפני 2026-09-03 ללא outcome. ה-inspector לא יוכל להבחין בהן בין billed ל-refused. אפשרות: backfill חד-פעמי `'billed'` היכן שקיים `billed_results.provider_ref = provider_id` (22 שורות) — נתונים, לא סכימה; דורש אישור בעלים.
3. **תווית `ceiling_reached` במקום `already_billed` (הפתעה 3)** — להעביר את בדיקת התקרה אחרי בדיקת קיום שורה ל-(event, contact), או לבדוק `exists` לפני התקרה. שינוי RPC; לא דחוף.
4. **`exposed_for_billing` טאוטולוגית ל-WhatsApp תחת gate=ON (הפתעה 4)** — אם השער יופעל, יש להחליט האם "חשיפה" צריכה להיות outbound קודם (מה ש-`has_service_exposure` בודק) ולא ה-inbound עצמו. החלטת מוצר; **לא** לשנות עכשיו.
5. **`campaign_authorized_contacts.contact_id ON DELETE CASCADE` (הפתעה 5)** — לשקול RESTRICT, בעקבות `billed_results.contact_id`. הקוד כבר מונע מחיקה של חבר במערך (`pruneOrphanContact`), אבל האילוץ הוא ההגנה האחרונה. דורש בדיקה שאין נתיב מחיקת contacts לגיטימי שמסתמך על CASCADE.
6. **אינדקס כפול על `campaigns` (הפתעה 6)** — להסיר את `campaigns_event_noncancelled_uidx` (הישן) או את `campaigns_one_active_per_event`; לתאם עם ההערה ב-`20260726100000` שמזכירה את הראשון כ-rollback. ביצועים בלבד.
7. **אינדקסים לרזולוציה** — `(channel, provider_id, direction)` כבר מכוסה חלקית; אם `contact_interactions` יגדל, להוסיף `(contact_id, created_at desc) WHERE direction='out'` ל-`resolveInboundContact` ולשקול לסנן `channel='whatsapp'` ב-`resolveByContextId` כדי להשתמש באינדקס הייחודי הקיים. לא דחוף ב-173 שורות.
8. **`has_service_exposure` לא מסונן לפי קמפיין בסעיף `billed_results`** — 0 השפעה חיה; לתקן בהזדמנות (`and br.campaign_id = p_campaign`).
9. **אין טריגר tamper-evidence על `billed_results`** — הטבלה append-only לפי כוונה, אך אין חסימת UPDATE/DELETE ברמת DB (בניגוד ל-`campaign_authorized_set_audit`). `service_role` יכול לערוך. שיקול הקשחה בלבד; `control_status`/`manual_adjustment` מרמזים שעדכון מבוקר הוא חלק מהעיצוב, ולכן טריגר חוסם-מלא כנראה אינו רצוי — אולי חסימת DELETE בלבד.

---

## 8. נספח — מצב תפעולי נוסף שנמדד (VERIFIED-LIVE)

- `webhook_inbox`: 798 שורות, 0 לא-מעובדות, 0 dead-letter (`attempts >= 5`), שורה אחת עם `last_error`. פילוח לפי ספק/סוג: whatsapp status 623, whatsapp message 86 (33 עם context, 3 עם delivery_id), voximplant call_result 33 / call_rsvp 16 / call_owner_note 5, resend 17, elevenlabs 6, graph 4, whatsapp business_username_updates 3 / security 3 / template_quality 1 / template_status 1.
- `guest_import_staging`: 11 שורות (5 confirmed, 3 discarded, 3 pending), כולן `whatsapp_contacts`, אף אחת עם `source_message_id` (העמודה חדשה).
- אירועים: 3 active, 2 closed, 1 draft. קמפיינים: 2 active, 1 approved, 2 closed.
- `supabase db advisors --type security`: 38 ממצאים, אף אחד לא נוגע לאובייקטים שבמסמך זה (7 `security_definer_view` על views של הקונסול, 22 `authenticated_security_definer_function_executable`, 9 `function_search_path_mutable` על פונקציות אחרות).
- PostgreSQL 17.6 (aarch64).
