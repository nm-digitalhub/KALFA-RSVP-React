# תיקון עריכת פרמטרי-אירוע ע"י חבר-ארגון — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** לאפשר לחבר-ארגון עם `events.edit` (שאינו ה-`owner_id` של האירוע) לשמור את פרמטרי האירוע, ולתקן את כשל ה-42501 שחוסם כרגע כל שמירת-פרמטרים בטופס — גם לבעלים.

**Architecture:** שני תיקונים בלתי-תלויים. (1) מיגרציה שמוסיפה `GRANT UPDATE (show_meal_pref)` שנשכח כשהעמודה נוספה — פער column-grant מול מודל Phase 3. (2) הסרת מסנן `.eq('owner_id', user.id)` מה-UPDATE ב-`updateEvent`, שהוא שריד מלפני Phase 3 וסותר את מודל השיתוף org-aware (השער `requireEventAccess` + RLS `events_org_update` + column-grants כבר אוכפים הרשאה ובעלוּת).

**Tech Stack:** Next.js App Router · TypeScript · Supabase (Postgres + RLS + column-level GRANTs) · Vitest · supabase CLI.

## Global Constraints

- **מצב:** תכנון בלבד. אין לבצע שינוי קוד, מיגרציה, `db push`, deploy, restart, commit או push לפני אישור מפורש.
- אין להחזיר UPDATE רוחבי על `public.events`. שמור על מודל column-level GRANTs של Phase 3.
- אין לתת UPDATE ל-`owner_id`, `org_id`, `status`, `gift_link_token` (טוקן server-generated — deliberately NOT granted, מתועד ב-`20260705120408`).
- ה-GRANT היחיד שמתווסף: `show_meal_pref`, ל-`authenticated` בלבד (לא `anon`).
- ב-`updateEvent`: להשאיר `requireUser()` (session guard) ולהשאיר `requireEventAccess(eventId,'events','edit')` כשער ראשון; להשאיר את ה-patch כ-allow-list מפורש; **אין** להשתמש ב-service-role לתיקון זה.
- מנעולי "קמפיין-חי" ומנעולי lifecycle חייבים להישאר ללא שינוי (ראה §"Regression — must stay green").

---

## Confirmed evidence (live DB, project `cklpaxihpyjbhymqtduv`)

- אירוע `294d23e1…` "ברית הבן של נטלי קלפה" · `status=active` · `owner_id=1bbe74dc` (Netanel) · `org_id=748d73f4`.
- יעקב (`d41ab7e0`, yaakov7676@gmail.com) חבר בארגון `748d73f4` בתפקיד **owner** → `has_events_edit=true`, `has_events_view=true`. אינו ה-`owner_id` של האירוע.
- `has_column_privilege('authenticated','events',<col>,'UPDATE')`: `show_meal_pref=**false**`; כל שאר העמודות ש-`updateEvent` כותב (`name,event_type,venue_name,venue_address,celebrants,gift_payment_url,invite_image_path,event_date,rsvp_deadline`) = `true`; `owner_id/org_id/status/gift_link_token=false`.
- פרוֹבּים (התחזות ל-`authenticated`, כולם עטופים ב-`RAISE`→rollback, אפס שינוי נתונים):
  - Netanel, SET מלא (כולל `show_meal_pref`) → **42501 permission denied**.
  - Netanel, SET בלי `show_meal_pref` → **ok, 1 שורה**.
  - יעקב, SET בלי `show_meal_pref`, **עם** `owner_id=יעקב` → ok, **0 שורות**.
  - יעקב, SET בלי `show_meal_pref`, **בלי** מסנן owner_id (RLS בלבד) → **ok, 1 שורה**.
- `updateEvent` נקרא רק מ-`updateEventAction` (actions.ts:138). אין caller אחר.

**⚠️ חומרה:** כרגע `updateEvent` **תמיד** כותב `show_meal_pref` ב-SET, ולכן כשל 42501 חוסם **כל** שמירת-פרמטרים בטופס — לכל המשתמשים, כולל הבעלים — לא רק ליעקב. Task 1 הוא hotfix עצמאי לתקלה חיה זו. Task 2 נחוץ בנוסף כדי לשחרר את יעקב (חבר לא-בעלים).

---

## File Structure

- **Create:** `supabase/migrations/<timestamp>_grant_show_meal_pref_update.sql` — GRANT יחיד. אחריות: לסגור את פער ה-column-grant.
- **Modify:** `src/lib/data/events.ts` (`updateEvent`, ~שורות 314–329 ו-397–403) — הסרת מסנן owner_id + רענון תיעוד.
- **Modify (tests):** `src/lib/data/events.test.ts` (describe `updateEvent`) — היפוך האסרשן על owner_id + שתי בדיקות חדשות.
- **ללא שינוי:** `actions.ts`, `edit-event-form.tsx`, `page.tsx`, `permissions.ts`, `publishEvent`/`closeEvent`.

---

## Task 1: מיגרציית GRANT ל-`show_meal_pref`

**Files:**
- Create: `supabase/migrations/<timestamp>_grant_show_meal_pref_update.sql`

**Interfaces:**
- Consumes: הטבלה `public.events` עם העמודה `show_meal_pref` (נוספה ב-`20260706165113`).
- Produces: `UPDATE` privilege ל-`authenticated` על `show_meal_pref` בלבד.

- [ ] **Step 1: אימות שהפער קיים (failing state)**

Run:
```sql
select has_column_privilege('authenticated','public.events','show_meal_pref','UPDATE');
```
Expected: `false` (הפער שאנחנו סוגרים).

- [ ] **Step 2: יצירת קובץ המיגרציה**

Run: `supabase migration new grant_show_meal_pref_update`
(ה-CLI מייצר חותמת-זמן > `20260708140000`, אז הקובץ ממוין אחרון.)

- [ ] **Step 3: כתיבת ה-SQL** (התוכן המלא של הקובץ)

```sql
-- events.show_meal_pref got its column added in 20260706165113 but — unlike the
-- sibling gift/media migration (20260705120408) — that migration forgot the
-- matching column GRANT. Under the Phase-3 column-scoped UPDATE model
-- (20260705115539 revoked table-wide UPDATE + re-granted an explicit list),
-- authenticated therefore lacks UPDATE on show_meal_pref, so the cookie-client
-- updateEvent (which ALWAYS writes show_meal_pref) fails with 42501 for every
-- user — owner included. This grants the single missing column, nothing more.
--
-- Deliberately NOT granted (server-managed / pinned, unchanged here):
-- owner_id, org_id, status, gift_link_token.
grant update (show_meal_pref) on public.events to authenticated;
```

- [ ] **Step 4: החלה — approval-gated (לא לבצע לפני אישור)**

Run: `supabase db push --linked`
(מתאים לתקדים האחרון בפרויקט — מיגרציה `20260708140000` הוחלה כך; history 1:1.)

- [ ] **Step 5: אימות (passing state)**

Run:
```sql
select
  has_column_privilege('authenticated','public.events','show_meal_pref','UPDATE') as smp_now_true,
  has_column_privilege('authenticated','public.events','owner_id','UPDATE')       as owner_id_still_false,
  has_column_privilege('authenticated','public.events','org_id','UPDATE')         as org_id_still_false,
  has_column_privilege('authenticated','public.events','status','UPDATE')         as status_still_false,
  has_column_privilege('authenticated','public.events','gift_link_token','UPDATE') as gift_token_still_false;
```
Expected: `smp_now_true=true`, וכל השאר `false`.

- [ ] **Step 6: אימות שאין UPDATE רוחבי חדש**

Run:
```sql
select privilege_type, count(*) as granted_cols
from information_schema.column_privileges
where table_schema='public' and table_name='events'
  and grantee='authenticated' and privilege_type='UPDATE'
group by privilege_type;
```
Expected: מספר עמודות מוגבל (allow-list + `show_meal_pref`), **לא** כלל-העמודות; ולוודא ש-`owner_id/org_id/status/gift_link_token` אינם ברשימה (ניתן `\dp public.events` כחלופה).

---

## Task 2: הסרת מסנן `owner_id` מ-`updateEvent` (org-aware write)

**Files:**
- Modify: `src/lib/data/events.ts:324` (`updateEvent`)
- Test: `src/lib/data/events.test.ts` (describe `updateEvent`)

**Interfaces:**
- Consumes: `requireEventAccess(eventId,'events','edit')` (org-aware gate, ללא שינוי) · `requireUser()` · RLS `events_org_update` · column-grants של Phase 3 (כולל Task 1).
- Produces: `updateEvent(eventId, input)` שכותב **בלי** מסנן `owner_id`; חתימה וסוג-החזרה (`Promise<EventDetail>`) ללא שינוי.

- [ ] **Step 1: היפוך האסרשן הקיים לכשל (failing test)**

ב-`src/lib/data/events.test.ts`, בבדיקה `on a non-draft event, with NEITHER date key present, omits both keys from the patch (not null)` — החלף את השורה:
```ts
    expect(builder.eq).toHaveBeenCalledWith('owner_id', USER_ID);
```
ב:
```ts
    expect(builder.eq).not.toHaveBeenCalledWith('owner_id', expect.anything());
```

- [ ] **Step 2: הוספת בדיקה — חבר לא-בעלים עם events.edit יכול לשמור**

הוסף בתוך `describe('updateEvent', …)`:
```ts
  it('org member (not the owner) with events.edit can save — the write is NOT owner_id-scoped; RLS + the gate authorize it', async () => {
    // Non-owner member: the events.edit gate (can_access_event) passes and RLS
    // (events_org_update) permits the write. The data layer must NOT re-add an
    // app-side owner_id filter (the pre-Phase-3 leftover that matched 0 rows).
    const row = detailRow({ status: 'active', event_type: 'birthday' });
    const { client, builder } = createMockSupabase<EventDetail>({ data: row, error: null });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    client.rpc.mockResolvedValue({ data: true, error: null }); // can_access_event('edit') = true
    mockReads(builder, owned({ status: 'active' }), NO_LIVE_CAMPAIGN, { data: row, error: null });

    const result = await updateEvent('event-1', baseInput);

    expect(builder.update).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith('id', 'event-1');
    expect(builder.eq).not.toHaveBeenCalledWith('owner_id', expect.anything());
    expect(result).toEqual(row);
  });
```

- [ ] **Step 3: הוספת בדיקה — השער חוסם חבר בלי events.edit (404)**

```ts
  it('rejects via the events.edit gate (404) when can_access_event returns false — a viewer without events.edit cannot save', async () => {
    const { client, builder } = createMockSupabase<EventDetail>({ data: detailRow(), error: null });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    // requireEventAccess: the event is visible (SELECT returns a row) but the
    // edit-permission RPC denies → notFound() before any write.
    vi.spyOn(builder, 'then').mockImplementationOnce((f) =>
      (f as (v: unknown) => unknown)({ data: detailRow(), error: null }),
    );
    client.rpc.mockResolvedValue({ data: false, error: null }); // can_access_event('edit') = false

    await expect(updateEvent('event-1', baseInput)).rejects.toThrow('NEXT_NOT_FOUND');
    expect(builder.update).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });
```

- [ ] **Step 4: הרצת הבדיקות — לוודא כשל לפני היישום**

Run: `npx vitest run src/lib/data/events.test.ts -t updateEvent`
Expected: FAIL — Step 1 נכשל (הקוד עדיין קורא `.eq('owner_id', …)`), Step 2 נכשל (owner_id עדיין נקרא).

- [ ] **Step 5: יישום — הסרת מסנן ה-owner_id + רענון תיעוד**

ב-`src/lib/data/events.ts`, בלוק התיעוד מעל `updateEvent` (השורות שמתחילות ב-"Update an event the current user owns…") — החלף את שלושת השורות הראשונות:
```ts
// Update an event the current user owns. The ownership gate runs first (404 if
// not owned); the update is additionally scoped by owner_id, and the patch is
// built from an explicit allow-list so id/owner_id can never be changed here.
```
ב:
```ts
// Update an event the current user may edit — the OWNER or an org member holding
// events.edit. The org-aware gate (requireEventAccess → can_access_event) runs
// first (404 otherwise); the write itself is authorized by RLS (events_org_update,
// USING+WITH CHECK can_access_event('events','edit')) and by the Phase-3 column
// grants, which pin id/owner_id/org_id/status/gift_link_token so a member can
// never re-tenant, hijack, or change lifecycle here. The patch is an explicit
// allow-list. There is deliberately NO app-side owner_id filter on the write — that
// pre-Phase-3 leftover matched 0 rows for any non-owner member with events.edit and
// defeated org sharing; RLS + the column grants are the authority.
```

בגוף הפונקציה, החלף:
```ts
  const cur = await requireEventAccess(eventId, 'events', 'edit');
  const user = await requireUser();
  const supabase = await createClient();
```
ב (משאירים `requireUser()` כ-session guard, בלי הקשירה למשתנה שאינו בשימוש עוד):
```ts
  const cur = await requireEventAccess(eventId, 'events', 'edit');
  await requireUser();
  const supabase = await createClient();
```

והחלף את בלוק הכתיבה:
```ts
  const { data, error } = await supabase
    .from('events')
    .update(update)
    .eq('id', eventId)
    .eq('owner_id', user.id)
    .select(EVENT_DETAIL_COLUMNS)
    .single();
```
ב:
```ts
  const { data, error } = await supabase
    .from('events')
    .update(update)
    .eq('id', eventId)
    .select(EVENT_DETAIL_COLUMNS)
    .single();
```

- [ ] **Step 6: הרצת הבדיקות — לוודא ירוק**

Run: `npx vitest run src/lib/data/events.test.ts`
Expected: PASS (כל בדיקות `updateEvent`, כולל מנעולי הקמפיין/תאריכים הקיימים).

- [ ] **Step 7: Commit (approval-gated)**

```bash
git add src/lib/data/events.ts src/lib/data/events.test.ts
git commit -m "fix(events): org member with events.edit can save event params (drop pre-Phase-3 owner_id write filter)"
```

---

## Regression — must stay green (ללא שינוי קוד)

הבדיקות הקיימות הבאות מגִנות על ההתנהגות שאסור לשבור; יש לוודא שהן עוברות אחרי Task 2:
- `active campaign` עדיין חוסם שינוי `event_type` (`EVENT_TYPE_LOCKED_ERROR`).
- `active campaign` עדיין חוסם `celebrants` חסרים (`CELEBRANTS_LOCKED_ERROR`).
- `active campaign` עדיין חוסם `venue_name` ריק (`VENUE_REQUIRED_WHILE_CAMPAIGN_ERROR`).
- אירוע non-draft עדיין דוחה מפתח `event_date`/`rsvp_deadline` (forged-request reject).
- ה-patch לעולם לא מכיל `status`/`owner_id`/`id`.
- שינוי ערכים **מלאים** של `celebrants`/`host_composition`/`venue_name` מותר (nמנעול הוא "אסור להשאיר חסר", לא "אסור לשנות").
- `publishEvent`/`closeEvent` נשארים owner-only (service-role, `.eq('owner_id', …)`), לא נגענו בהם.

---

## DB verification — non-destructive smoke test (rollback מלא)

הרץ לאחר Task 1 + Task 2, כאימות end-to-end שהשמירה עוברת בפועל. כל בלוק נגמר ב-`RAISE` → כל השינויים מתגלגלים לאחור, אפס שינוי בנתוני לקוח.

- [ ] **יעקב (חבר לא-בעלים) — SET מלא כולל `show_meal_pref`, בלי מסנן owner_id → צפוי ok, 1 שורה**
```sql
do $$
declare v_touched int; v_state text; v_msg text; v_ok boolean := false;
begin
  perform set_config('request.jwt.claims','{"sub":"d41ab7e0-cfba-4ada-aa43-14ab620f3969","role":"authenticated"}', true);
  perform set_config('request.jwt.claim.sub','d41ab7e0-cfba-4ada-aa43-14ab620f3969', true);
  set local role authenticated;
  begin
    update public.events
      set name=name, event_type=event_type, venue_name=venue_name,
          gift_payment_url=gift_payment_url, show_meal_pref=show_meal_pref,
          venue_address=venue_address, celebrants=celebrants
    where id='294d23e1-6be9-4b4f-ad79-4d10f4a6e31b';   -- NO owner_id filter (matches the fixed app path)
    get diagnostics v_touched = row_count; v_ok := true;
  exception when others then v_state:=sqlstate; v_msg:=sqlerrm; end;
  if v_ok then raise exception 'YAAKOV_POSTFIX: ok, rows=%', v_touched;
  else raise exception 'YAAKOV_POSTFIX: sqlstate=% msg=%', v_state, v_msg; end if;
end $$;
```
Expected: `YAAKOV_POSTFIX: ok, rows=1`.

- [ ] **Netanel (בעלים) — SET מלא כולל `show_meal_pref` → צפוי ok, 1 שורה**
(אותו בלוק עם `sub=1bbe74dc-5721-48e9-9092-fd9e3c6e6b21`.) Expected: `ok, rows=1`.

- [ ] **בקרת-שלילה — משתמש ללא הרשאה/מחוץ לארגון (RLS) → צפוי 0 שורות** (בחר `sub` של משתמש שאינו חבר בארגון `748d73f4`). Expected: `ok, rows=0` (RLS מסנן; אין 42501). זה מאשש ש-RLS לבדו אוכף את הגבול לאחר הסרת מסנן ה-app.

---

## Verification gates

- [ ] `npx tsc --noEmit`
- [ ] `npm run lint`
- [ ] `npx vitest run src/lib/data/events.test.ts src/app/\(customer\)/app/events/\[id\]/actions.test.ts`
- [ ] `npm run test` (full vitest — אם שינוי הבדיקות התרחב)
- [ ] `git diff --check`

---

## Deliverables סיכום

1. **מיגרציה מוצעת** — `grant update (show_meal_pref) on public.events to authenticated;` (Task 1, Step 3).
2. **Diff צפוי ב-`updateEvent`** — הסרת שורת `.eq('owner_id', user.id)` + `const user =` → `await requireUser();` + רענון תיעוד (Task 2, Step 5).
3. **Diff צפוי בבדיקות** — היפוך אסרשן owner_id + 2 בדיקות חדשות (Task 2, Steps 1–3).
4. **Smoke test עם rollback** — פרוֹבּי impersonation ליעקב + Netanel + בקרת-שלילה (§DB verification).
5. **עצירה לפני יישום** — כל צעד עם commit/`db push`/deploy מסומן approval-gated.

---

## Self-review

- **כיסוי ספֶק:** (1) GRANT ל-show_meal_pref ✓ Task 1. (2) הסרת מסנן owner_id ✓ Task 2. אילוצי "אין UPDATE רוחבי / אין grant ל-owner_id·org_id·status·gift_link_token" ✓ (מיגרציה עמודה-בודדת + אימות Step 5–6). "השאר requireUser + requireEventAccess + allow-list + לא service-role" ✓ Step 5. מנעולי קמפיין/lifecycle ✓ §Regression. כל בדיקות ה-spec ✓ (unit → Task 2; db_verification → §DB verification).
- **Placeholder scan:** אין TBD/"handle errors" — כל צעד מכיל SQL/קוד/פקודה מדויקים.
- **עקביות טיפוסים:** חתימת `updateEvent(eventId, input): Promise<EventDetail>` ללא שינוי; שמות `requireEventAccess`/`can_access_event`/`show_meal_pref` עקביים לאורך.
- **סיכון פתוח לציון בביקורת:** Task 1 מתקן תקלה חיה שמשפיעה על כל המשתמשים (לא רק יעקב) — ניתן לשקול להחילו כ-hotfix עצמאי לפני Task 2.
