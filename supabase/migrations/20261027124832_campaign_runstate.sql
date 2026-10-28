-- A staff change of an event's RSVP run state (pause, revive, close) happens in ONE database transaction, with its evidence.
-- Plan: openspec/changes/permissions-macro-to-micro, design D5 (with D6), task 3.3. Owner decisions: C-O5 no and C-O10 yes
-- (2026-10-27).
--
-- WHY
--   Today the application changes campaigns.status itself (transitionCampaignStatus, src/lib/data/campaign-transition.ts) and
--   writes the evidence afterwards, as a second write: the console route's recordStaffAccess, and a best-effort logActivity on
--   revival. Two writes are not atomic, so a failure between them leaves a change without a record. And a cancellation resolve
--   by the billing clerk cannot close the service at all: the close needs campaigns.runstate, which that role does not hold.
--
-- WHAT IT DOES
--   1. public.support_access_log gets three nullable columns:
--      - via (text): the channel ('web', 'bearer' or 'cancellation_request');
--      - action (text): what was done ('pause', 'revive', 'close', and 'cancel' from cancel_campaign);
--      - details (jsonb): this function writes { statusBefore }.
--      There is no CHECK constraint and no enum type: the functions that write these columns validate the values.
--   2. public.campaign_runstate(p_campaign, p_action, p_actor, p_via, p_cancellation_request, p_reason) returns text:
--      - It validates p_action ('pause', 'revive', 'close') and p_via. Only 'close' goes through 'cancellation_request', and
--        only with a request id. A bad value raises 22023, because it is a caller bug and not an answer.
--      - It checks the actor's key BEFORE any state is read. The key is manage_billing for a close through
--        'cancellation_request' (C-O5 no) and campaigns.runstate for everything else. A NULL or keyless actor gets
--        'forbidden'.
--      - It locks the campaign row (no row: 'no_campaign'). If the campaign is already in the target state it answers
--        'already_<state>' and writes nothing; this covers a resolve retried after its close succeeded.
--      - Through 'cancellation_request', the request is locked FOR SHARE after the campaign, which is the same lock order as
--        cancel and the ledger trigger. It must be pending ('request_not_pending' otherwise, and also for an unknown id)
--        and must belong to the campaign's event ('request_mismatch').
--      - It applies the guarded move, with from and to fixed here: pause active -> paused; revive paused -> active; close
--        active, paused, approved or scheduled -> closed. Any other current status answers 'not_allowed_from_<status>'.
--      - It writes the evidence in the same transaction, then answers 'done':
--        - one support_access_log row: staff_id = p_actor, permission = the key, subject campaign, owner_id and
--          event_id, reason = p_reason, via, action, details;
--        - one activity_log row (C-O10 yes): user_id NULL, so the event's readers do not see who did it. The action is
--          campaign.paused, campaign.revived or campaign.closed, and meta is { campaignId, statusBefore, via }. Revival
--          is campaign.revived and not campaign.activated, because the first-start repair keys on campaign.activated
--          (src/lib/payments/activate-paid-package.ts).
--   3. It is SECURITY INVOKER with search_path ''. EXECUTE is granted to service_role only. The application calls it with
--      the service_role client after its own gate, and service_role holds every privilege the function uses (asserted below).
--
-- WHAT IT DOES NOT DO
--   - Nothing calls the function until task 3.5 wires pauseCampaign, reviveCampaign and closeCampaign to it, so pushing this
--     file changes no live behavior. The new columns stay NULL on existing rows.
--   - The first start after a payment (approved -> active, the system actor in campaign-transition.ts) is not here.
--     Cancel is cancel_campaign, amended in the next migration (20261027124834).
--   - The triggers on campaigns are untouched. campaigns_require_active_event still re-checks the event on every move to
--     active, so a revive of a campaign whose event is not active raises from that trigger. The application's revival
--     guards (past event, active event, package funding) run before the call (design D5, "What stays in TS").
--   - It adds no policy and no index, and edits no row. authenticated keeps SELECT only on support_access_log, and only the
--     owner role reads it (support_access_log_owner_select).
--
-- EVENT DELETION AND THE NO ACTION FOREIGN KEY (support_access_log.event_id -> events, MEASURED 2026-10-27)
--   A support_access_log row blocks deleting its event. The paths that delete an event:
--   - purge_test_event: it sets support_access_log.event_id to NULL before it deletes (live text checked 2026-10-27), so
--     it is unaffected;
--   - deleting an auth user: events_owner_id_fkey is ON DELETE CASCADE, so an owner's event that carries a staff row now
--     blocks it. payment_operations, billed_results and event_cancellation_requests (all ON DELETE RESTRICT) already
--     block it for most such events;
--   - src/lib/testing/local-integration.ts:560 deletes events directly and does not clear support_access_log. The local-it
--     tests of this function write staff rows, so that cleanup must null or delete them first (task 3.3's verify).
--
-- house assumption (same as 20261008040027): `supabase db push` applies a migration file as ONE transaction, so the
-- verification block at the end rolls the whole file back if any check fails.
--
-- reviewed against the supabase-postgres-best-practices rules: security-privileges (revoke from public, anon and
-- authenticated; grant service_role only; invoker; search_path ''), security-rls-basics (no policy added; the writes are
-- made by service_role, which bypasses RLS), lock-short-transactions (lock_timeout and statement_timeout; no external call),
-- lock-deadlock-prevention (campaign row first, then the request, as cancel and the ledger trigger do), schema-data-types
-- (text, jsonb), schema-lowercase-identifiers.
--
-- DRY RUN (owner, one transaction, rolled back; nothing is kept): the script delivered with this file. It applies this
-- file, switches to service_role and checks the action x status x via matrix: one support_access_log row and one
-- activity_log row per 'done', none on a refusal or an already_<state>; a keyless actor gets 'forbidden' before any read;
-- the cancellation branch (pending, resolved, another event's request, an unknown id, a non-close action); anon and
-- authenticated cannot execute it.
--
-- APPLIED-ON-LIVE CHECK (after the owner's db push):
--   select p.prosecdef, p.proconfig, p.proacl from pg_proc p
--    where p.oid = 'public.campaign_runstate(uuid,text,uuid,text,uuid,text)'::regprocedure;
--   -- expected: false, {search_path=""}, {postgres=X/postgres,service_role=X/postgres}
--   select column_name, data_type, is_nullable from information_schema.columns
--    where table_schema = 'public' and table_name = 'support_access_log' and column_name in ('via', 'action', 'details');
--
-- ROLLBACK (manual, and only before task 3.5 wires a caller to it):
--   drop function public.campaign_runstate(uuid, text, uuid, text, uuid, text);
--   alter table public.support_access_log drop column details, drop column action, drop column via;
--   (dropping the columns deletes what was written in them; cancel_campaign from 20261027124834 writes them too, so that
--    migration is rolled back first.)

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- ── 1. the evidence columns ──
alter table public.support_access_log
  add column via text,
  add column action text,
  add column details jsonb;

comment on column public.support_access_log.via is
  'The channel of a staff run-state action: web, bearer or cancellation_request. Written by campaign_runstate and cancel_campaign, which validate it; NULL on rows of other staff access.';
comment on column public.support_access_log.action is
  'The staff run-state action: pause, revive, close or cancel. Written by campaign_runstate and cancel_campaign, which validate it; NULL on rows of other staff access.';
comment on column public.support_access_log.details is
  'Facts of a staff run-state action: statusBefore, and for cancel hadSucceededPayment and testMoneyOnly. NULL on rows of other staff access.';

-- ── 2. campaign_runstate ──
CREATE FUNCTION public.campaign_runstate(
  p_campaign uuid,
  p_action text,
  p_actor uuid,
  p_via text,
  p_cancellation_request uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
declare
  v          public.campaigns;
  v_key      text;
  v_target   public.campaign_status;
  v_from     public.campaign_status[];
  v_req      record;
  v_owner    uuid;
  v_activity text;
begin
  -- The action and the channel are validated here: no enum type or CHECK constraint holds them (design D5).
  if p_action is null or p_action not in ('pause', 'revive', 'close') then
    raise exception 'campaign_runstate: unknown action %', p_action using errcode = '22023';
  end if;
  if p_via is null or p_via not in ('web', 'bearer', 'cancellation_request') then
    raise exception 'campaign_runstate: unknown channel %', p_via using errcode = '22023';
  end if;
  if p_via = 'cancellation_request' then
    if p_action <> 'close' then
      raise exception 'campaign_runstate: only close goes through a cancellation request' using errcode = '22023';
    end if;
    if p_cancellation_request is null then
      raise exception 'campaign_runstate: a close through a cancellation request names the request' using errcode = '22023';
    end if;
  elsif p_cancellation_request is not null then
    raise exception 'campaign_runstate: a cancellation request is passed only with via cancellation_request' using errcode = '22023';
  end if;

  -- 1. The actor's key, before any state is read. A close that resolves a cancellation request needs only the authority
  --    to resolve cancellations (C-O5 no, 2026-10-27); every other action needs the run-state authority.
  v_key := case when p_via = 'cancellation_request' then 'manage_billing' else 'campaigns.runstate' end;
  if p_actor is null or not public.has_platform_permission_for_user(p_actor, v_key) then
    return 'forbidden';
  end if;

  -- From and to are fixed here, never passed in.
  v_target := case p_action
    when 'pause'  then 'paused'::public.campaign_status
    when 'revive' then 'active'::public.campaign_status
    else 'closed'::public.campaign_status
  end;
  v_from := case p_action
    when 'pause'  then array['active']::public.campaign_status[]
    when 'revive' then array['paused']::public.campaign_status[]
    else array['active', 'paused', 'approved', 'scheduled']::public.campaign_status[]
  end;

  -- 2. The campaign row, locked first (the same order as cancel_campaign and the ledger insert trigger).
  select * into v from public.campaigns where id = p_campaign for update;
  if not found then return 'no_campaign'; end if;

  -- 3. Already there: no write and no evidence. This is the retry of a resolve whose close succeeded and whose own record
  --    failed.
  if v.status = v_target then return 'already_' || v_target::text; end if;

  -- 4. Through a cancellation request: the request is locked after the campaign, must still be pending, and must belong
  --    to the campaign's event.
  if p_via = 'cancellation_request' then
    select r.status, r.event_id into v_req
      from public.event_cancellation_requests r
     where r.id = p_cancellation_request
       for share;
    if not found or v_req.status <> 'pending' then return 'request_not_pending'; end if;
    if v_req.event_id <> v.event_id then return 'request_mismatch'; end if;
  end if;

  -- 5. The guarded move.
  if not (v.status = any (v_from)) then return 'not_allowed_from_' || v.status::text; end if;
  update public.campaigns set status = v_target where id = v.id;

  -- 6. The evidence, in the same transaction: if a row cannot be written the move is rolled back with it.
  select e.owner_id into v_owner from public.events e where e.id = v.event_id;
  insert into public.support_access_log
    (staff_id, permission, subject_type, subject_id, owner_id, event_id, reason, via, action, details)
  values
    (p_actor, v_key, 'campaign', v.id, v_owner, v.event_id, p_reason, p_via, p_action,
     jsonb_build_object('statusBefore', v.status));
  -- The event's own row (C-O10 yes): no staff id, so the event's readers do not learn who did it.
  v_activity := case p_action when 'pause' then 'campaign.paused' when 'revive' then 'campaign.revived' else 'campaign.closed' end;
  insert into public.activity_log (user_id, event_id, action, meta)
  values (null, v.event_id, v_activity, jsonb_build_object('campaignId', v.id, 'statusBefore', v.status, 'via', p_via));

  return 'done';
end; $function$;

revoke execute on function public.campaign_runstate(uuid, text, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.campaign_runstate(uuid, text, uuid, text, uuid, text) to service_role;

comment on function public.campaign_runstate(uuid, text, uuid, text, uuid, text) is
  'Staff run-state change of an event''s RSVP service: pause (active->paused), revive (paused->active), close (active, paused, approved or scheduled -> closed). Checks the actor''s key first (campaigns.runstate; manage_billing for a close through a pending cancellation request of the same event), then locks the campaign, moves it, and writes one support_access_log row (via, action, details.statusBefore) and one activity_log row (user_id NULL) in the same transaction. Answers done, forbidden, no_campaign, already_<state>, not_allowed_from_<status>, request_not_pending or request_mismatch; a bad action or channel raises 22023. Security invoker: service_role only.';

-- ── 3. verification: aborts, and rolls back whole, when any of these fails ──
do $$
declare
  v_bad     integer;
  v_def     text;
  v_snippet text;
  v_fn      constant regprocedure := 'public.campaign_runstate(uuid,text,uuid,text,uuid,text)'::regprocedure;
begin
  -- exactly one campaign_runstate
  select count(*) into v_bad from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'campaign_runstate';
  if v_bad <> 1 then
    raise exception 'campaign_runstate: expected exactly one campaign_runstate, found %', v_bad;
  end if;

  -- security invoker and the empty search_path
  select count(*) into v_bad
    from pg_proc p
   where p.oid = v_fn
     and (p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'], false));
  if v_bad > 0 then
    raise exception 'campaign_runstate: the function is security definer or lost its empty search_path';
  end if;

  -- who may execute it: the owner and service_role, nobody else (a NULL ACL means PUBLIC may)
  if (select p.proacl from pg_proc p where p.oid = v_fn) is null then
    raise exception 'campaign_runstate: the function still has the default ACL (PUBLIC can execute it)';
  end if;
  select count(*) into v_bad
    from pg_proc p
   cross join lateral aclexplode(p.proacl) a
   where p.oid = v_fn
     and a.privilege_type = 'EXECUTE'
     and a.grantee not in (p.proowner, 'service_role'::regrole::oid);
  if v_bad > 0 then
    raise exception 'campaign_runstate: % unexpected grantee(s) can execute the function', v_bad;
  end if;
  if has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('authenticated', v_fn, 'execute') then
    raise exception 'campaign_runstate: anon or authenticated can execute the function';
  end if;

  -- security invoker: service_role must itself hold every privilege the function uses (FOR SHARE needs UPDATE)
  if not (    has_schema_privilege('service_role', 'public', 'usage')
          and has_table_privilege('service_role', 'public.campaigns', 'select')
          and has_table_privilege('service_role', 'public.campaigns', 'update')
          and has_table_privilege('service_role', 'public.events', 'select')
          and has_table_privilege('service_role', 'public.event_cancellation_requests', 'select')
          and has_table_privilege('service_role', 'public.event_cancellation_requests', 'update')
          and has_table_privilege('service_role', 'public.support_access_log', 'insert')
          and has_table_privilege('service_role', 'public.activity_log', 'insert')
          and has_function_privilege('service_role', 'public.has_platform_permission_for_user(uuid,text)', 'execute')) then
    raise exception 'campaign_runstate: service_role lacks a privilege the security-invoker function needs';
  end if;

  -- the two keys exist. has_platform_permission_for_user answers true to the owner role for ANY key, so a misspelt key
  -- would pass every test run by the owner and refuse everyone else.
  select count(*) into v_bad
    from unnest(array['campaigns.runstate', 'manage_billing']) k(key)
   where not exists (select 1 from public.platform_permission_definitions d where d.key = k.key);
  if v_bad > 0 then
    raise exception 'campaign_runstate: % key(s) the function checks are missing from platform_permission_definitions', v_bad;
  end if;

  -- the evidence columns: nullable, of the planned types, with no CHECK constraint on them
  select count(*) into v_bad
    from (values ('via', 'text'), ('action', 'text'), ('details', 'jsonb')) c(name, type)
   where not exists (select 1 from information_schema.columns ic
                      where ic.table_schema = 'public' and ic.table_name = 'support_access_log'
                        and ic.column_name = c.name and ic.data_type = c.type and ic.is_nullable = 'YES');
  if v_bad > 0 then
    raise exception 'campaign_runstate: % support_access_log evidence column(s) missing or wrong', v_bad;
  end if;

  -- the campaign triggers this function relies on are still attached and enabled
  select count(*) into v_bad
    from unnest(array['campaigns_require_active_event', 'campaigns_guard_cancel']) t(name)
   where not exists (select 1 from pg_trigger g
                      where g.tgrelid = 'public.campaigns'::regclass and g.tgname = t.name
                        and g.tgenabled = 'O' and not g.tgisinternal);
  if v_bad > 0 then
    raise exception 'campaign_runstate: % campaigns trigger(s) missing or disabled', v_bad;
  end if;

  -- the key check comes before the lock, and both evidence rows are in
  v_def := pg_get_functiondef(v_fn);
  if position('has_platform_permission_for_user(p_actor, v_key)' in v_def) = 0
     or position('for update' in v_def) = 0
     or position('has_platform_permission_for_user(p_actor, v_key)' in v_def) > position('for update' in v_def) then
    raise exception 'campaign_runstate: the key check is missing or comes after the campaign lock';
  end if;
  foreach v_snippet in array array[
    $s$'manage_billing'$s$,
    $s$'campaigns.runstate'$s$,
    $s$insert into public.support_access_log$s$,
    $s$insert into public.activity_log$s$,
    $s$for share$s$
  ] loop
    if position(v_snippet in v_def) = 0 then
      raise exception 'campaign_runstate: the function lost %', v_snippet;
    end if;
  end loop;
end $$;
