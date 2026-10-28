-- Cancelling a campaign requires a verified staff actor, re-checks its key, and writes the staff evidence in the same transaction.
-- Plan: openspec/changes/permissions-macro-to-micro, design D5 ("cancel_campaign gets the same contract"), task 3.4. Owner
-- decisions: C-O26 yes and C-O10 yes (2026-10-27).
--
-- WHY
--   cancel_campaign (live text, MEASURED 2026-10-27) takes p_actor DEFAULT NULL, re-checks no key, records no channel, and
--   writes its only evidence into activity_log. That table is not evidence: al_owner_insert lets any signed-in user insert any
--   action under their own id, and its rows cascade with the event. It also names the staff member to the event's readers
--   through the Data API (user_id = p_actor).
--
-- WHAT IT CHANGES
--   1. The signature becomes (p_campaign uuid, p_actor uuid, p_via text DEFAULT 'web'). p_actor has no default. The deployed
--      call rpc('cancel_campaign', { p_campaign, p_actor }) (src/lib/data/campaigns.ts:701-704) still resolves, with
--      via 'web'.
--   2. Before any state is read, a NULL actor, or one without campaigns.runstate (Event.cancel_rsvp), makes it RAISE with
--      errcode 42501. It does not answer 'forbidden': the deployed caller treats any answer other than an error,
--      'no_campaign' or 'not_cancellable' as success and then releases the campaign's benefit (campaigns.ts:705-720), so a
--      new answer would release a benefit without a cancellation. p_via must be 'web' or 'bearer', and any other value
--      raises 22023.
--   3. The staff evidence (C-O26 yes): one support_access_log row in the same transaction. staff_id = p_actor, permission
--      campaigns.runstate, subject campaign, owner_id, event_id, via, action 'cancel', and details { statusBefore,
--      hadSucceededPayment, testMoneyOnly }. The payment facts stay in the staff row whatever happens to the customer row.
--   4. The customer row (C-O10 yes): the activity_log row keeps today's meta and adds via, but its user_id is NULL, so the
--      event's readers no longer see which staff member cancelled.
--   5. It stays SECURITY INVOKER with search_path ''. EXECUTE is granted to service_role only.
--
-- WHAT IT DOES NOT CHANGE
--   - The rule for WHEN a campaign may be cancelled. The text from the campaign lock through the gate is the live text
--     byte for byte (after 20261011190351 removed the capture/charge conditions), and so are the four answers: no_campaign,
--     already_cancelled, not_cancellable and cancelled. The guard trigger campaigns_guard_cancel is untouched.
--   - It adds no table, policy or index, and edits no row. The support_access_log evidence columns come from 20261027124832.
--
-- LIVE EFFECT ON PUSH (unlike 20261027124832, this one changes behavior immediately)
--   - The only caller is cancelCampaign (MEASURED: no database function calls cancel_campaign; one call site in src). It
--     passes staff.id after requirePlatformAction('runstate', 'Campaign'), so its call keeps working.
--   - A cancellation's activity_log row now has user_id NULL, and a support_access_log row is added. Only the owner role
--     reads that table (support_access_log_owner_select). The billing clerk (view_activity_log) therefore no longer sees,
--     in /admin/activity, who cancelled (C-O26).
--   - CONFLICT WITH A SIBLING PLAN: openspec/changes/separate-event-setup-from-management design D7 plans
--     close_event_retiring_setup to call public.cancel_campaign(v.id, p_owner) with the CUSTOMER as the actor. After this
--     file that call raises 42501, because a customer holds no staff key. D7 needs its own path, for example a cancel
--     branch for the event's owner, before it is built.
--
-- house assumption (same as 20261008040027): `supabase db push` applies a migration file as ONE transaction, so the
-- verification block at the end rolls the whole file back if any check fails.
--
-- reviewed against the supabase-postgres-best-practices rules: security-privileges (revoke from public, anon and
-- authenticated; grant service_role only; invoker; search_path ''), security-rls-basics (no policy added; the writes are
-- made by service_role), lock-short-transactions (lock_timeout and statement_timeout), lock-deadlock-prevention (the
-- campaign row first, as before), schema-data-types, schema-lowercase-identifiers.
--
-- DRY RUN (owner, one transaction, rolled back; nothing is kept): the script delivered with this file. It applies both
-- files, switches to service_role and checks:
--   - a NULL or keyless actor raises 42501 and writes nothing;
--   - the deployed named call { p_campaign, p_actor } resolves and records via 'web';
--   - the gate still refuses an active campaign and an unknown id, with no record, and a direct UPDATE to cancelled is
--     still refused by campaigns_guard_cancel;
--   - a second call answers already_cancelled and writes no second row;
--   - exactly one cancel_campaign exists.
--   The ledger cases (real succeeded money refused; settled test money recorded as hadSucceededPayment and testMoneyOnly
--   true in the staff row) are covered by task 3.4's local-it suite, not by the dry run.
--
-- APPLIED-ON-LIVE CHECK (after the owner's db push):
--   select p.prosecdef, p.proconfig, p.proacl, pg_get_function_identity_arguments(p.oid) from pg_proc p
--    where p.pronamespace = 'public'::regnamespace and p.proname = 'cancel_campaign';
--   -- expected: one row; false, {search_path=""}, {postgres=X/postgres,service_role=X/postgres},
--   --           p_campaign uuid, p_actor uuid, p_via text
--
-- ROLLBACK (manual): drop function public.cancel_campaign(uuid, uuid, text); then recreate the pre-change function from
-- the verbatim text at the bottom of this file, and
--   revoke execute on function public.cancel_campaign(uuid, uuid) from public, anon, authenticated;
--   grant  execute on function public.cancel_campaign(uuid, uuid) to service_role;
-- (rows already written stay; they are history.)

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- ── 1. cancel_campaign: the live gate, a required actor with its key, and the staff evidence ──
-- DROPPED, not replaced: a new argument list next to the old one would leave two overloads, and the named call the
-- application makes would then be ambiguous.
drop function public.cancel_campaign(uuid, uuid);

CREATE FUNCTION public.cancel_campaign(p_campaign uuid, p_actor uuid, p_via text DEFAULT 'web')
 RETURNS text
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
declare v public.campaigns;
        v_paid boolean; v_test_only boolean; -- [audit]
        v_owner uuid; -- [actor]
begin
  -- [actor] The channel and the actor, before any state is read. A refusal RAISES: the deployed caller treats any answer
  -- other than an error, no_campaign or not_cancellable as success (and then releases the campaign's benefit).
  if p_via is null or p_via not in ('web', 'bearer') then
    raise exception 'cancel_campaign: unknown channel %', p_via using errcode = '22023';
  end if;
  if p_actor is null or not public.has_platform_permission_for_user(p_actor, 'campaigns.runstate') then
    raise exception 'cancel_campaign: the actor may not cancel a campaign' using errcode = '42501';
  end if;
  select * into v from public.campaigns where id=p_campaign for update;
  if not found then return 'no_campaign'; end if;
  if v.status='cancelled' then return 'already_cancelled'; end if;
  -- Predicate is ALWAYS evaluated here too — never assumed true for 'draft' or
  -- any other state; this re-check (separate from the trigger above) is what
  -- lets the RPC return a precise outcome instead of a raw constraint error.
  if not ( v.status in ('draft','pending_approval','approved')
    and not exists (select 1 from public.billed_results b where b.campaign_id=v.id)
    and not public.campaign_has_payment_activity(v.id) ) then
    return 'not_cancellable';
  end if;
  -- [audit] What this cancellation erases. The gate above lets a SUCCEEDED payment row through only when it is test money,
  -- so a true v_paid always comes with a true v_test_only; both are recorded so that a reader never has to infer it.
  -- Same effect filter as campaign_has_payment_activity, so the record describes exactly the rows the gate waved through.
  select count(*) > 0, coalesce(bool_and(o.is_test), false) into v_paid, v_test_only
    from public.payment_operations o
    join public.payment_operation_kinds k on k.kind = o.kind
   where o.campaign_id = v.id and o.outcome = 'succeeded' and k.effect <> 'none';
  update public.campaigns set status='cancelled' where id=p_campaign;
  -- [actor] The staff evidence, in the SAME transaction: if it cannot be written the cancellation is rolled back with it.
  select e.owner_id into v_owner from public.events e where e.id = v.event_id;
  insert into public.support_access_log
    (staff_id, permission, subject_type, subject_id, owner_id, event_id, via, action, details)
  values
    (p_actor, 'campaigns.runstate', 'campaign', v.id, v_owner, v.event_id, p_via, 'cancel',
     jsonb_build_object('statusBefore', v.status,
                        'hadSucceededPayment', v_paid, 'testMoneyOnly', v_paid and v_test_only));
  -- [audit] The event's own row (C-O10 yes): today's meta plus via, and no staff id.
  insert into public.activity_log (user_id, event_id, action, meta)
  values (null, v.event_id, 'campaign.cancelled',
          jsonb_build_object('campaignId', v.id, 'statusBefore', v.status,
                             'hadSucceededPayment', v_paid, 'testMoneyOnly', v_paid and v_test_only,
                             'via', p_via));
  return 'cancelled';
end; $function$;

revoke execute on function public.cancel_campaign(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_campaign(uuid, uuid, text) to service_role;

comment on function public.cancel_campaign(uuid, uuid, text) is
  'Cancels a campaign that holds no real money (draft, pending approval or approved; no billed result, and no pending, review or real succeeded payment). The actor is required and must hold campaigns.runstate, else it raises 42501 before any read; p_via is web or bearer. In the same transaction it writes one support_access_log row (via, action cancel, details: statusBefore, hadSucceededPayment, testMoneyOnly) and one activity_log row (campaign.cancelled, user_id NULL, the same facts plus via). Returns no_campaign, already_cancelled, not_cancellable or cancelled. Security invoker: service_role only.';

-- ── 2. verification: aborts, and rolls back whole, when any of these fails ──
do $$
declare
  v_bad     integer;
  v_def     text;
  v_snippet text;
  v_fn      constant regprocedure := 'public.cancel_campaign(uuid,uuid,text)'::regprocedure;
begin
  -- exactly one cancel_campaign, the three-argument one (an old overload next to it would make every call ambiguous)
  select count(*) into v_bad from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'cancel_campaign';
  if v_bad <> 1 then
    raise exception 'cancel_campaign_actor_and_audit: expected exactly one cancel_campaign, found %', v_bad;
  end if;

  -- security invoker and the empty search_path (create function does not inherit what is not restated)
  select count(*) into v_bad
    from pg_proc p
   where p.oid = v_fn
     and (p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'], false));
  if v_bad > 0 then
    raise exception 'cancel_campaign_actor_and_audit: cancel_campaign is security definer or lost its empty search_path';
  end if;

  -- who may execute it: the owner and service_role, nobody else (a NULL ACL means PUBLIC may)
  if (select p.proacl from pg_proc p where p.oid = v_fn) is null then
    raise exception 'cancel_campaign_actor_and_audit: cancel_campaign still has the default ACL (PUBLIC can execute it)';
  end if;
  select count(*) into v_bad
    from pg_proc p
   cross join lateral aclexplode(p.proacl) a
   where p.oid = v_fn
     and a.privilege_type = 'EXECUTE'
     and a.grantee not in (p.proowner, 'service_role'::regrole::oid);
  if v_bad > 0 then
    raise exception 'cancel_campaign_actor_and_audit: % unexpected grantee(s) can execute cancel_campaign', v_bad;
  end if;

  -- security invoker: service_role must itself hold every privilege the function uses
  if not (    has_schema_privilege('service_role', 'public', 'usage')
          and has_table_privilege('service_role', 'public.campaigns', 'select')
          and has_table_privilege('service_role', 'public.campaigns', 'update')
          and has_table_privilege('service_role', 'public.events', 'select')
          and has_table_privilege('service_role', 'public.billed_results', 'select')
          and has_table_privilege('service_role', 'public.payment_operations', 'select')
          and has_table_privilege('service_role', 'public.payment_operation_kinds', 'select')
          and has_table_privilege('service_role', 'public.support_access_log', 'insert')
          and has_table_privilege('service_role', 'public.activity_log', 'insert')
          and has_function_privilege('service_role', 'public.campaign_has_payment_activity(uuid)', 'execute')
          and has_function_privilege('service_role', 'public.has_platform_permission_for_user(uuid,text)', 'execute')) then
    raise exception 'cancel_campaign_actor_and_audit: service_role lacks a privilege the security-invoker function needs';
  end if;

  -- the key exists (the owner role passes has_platform_permission_for_user for ANY key, so a misspelt key would pass every
  -- owner-run test and refuse everyone else)
  if not exists (select 1 from public.platform_permission_definitions d where d.key = 'campaigns.runstate') then
    raise exception 'cancel_campaign_actor_and_audit: campaigns.runstate is missing from platform_permission_definitions';
  end if;

  -- the evidence columns from 20261027124832 exist
  select count(*) into v_bad
    from unnest(array['via', 'action', 'details']) c(name)
   where not exists (select 1 from information_schema.columns ic
                      where ic.table_schema = 'public' and ic.table_name = 'support_access_log' and ic.column_name = c.name);
  if v_bad > 0 then
    raise exception 'cancel_campaign_actor_and_audit: % support_access_log evidence column(s) missing (apply 20261027124832 first)', v_bad;
  end if;

  -- the guard trigger that re-checks every cancellation is still attached and enabled
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.campaigns'::regclass and t.tgname = 'campaigns_guard_cancel'
                    and t.tgenabled = 'O' and not t.tgisinternal) then
    raise exception 'cancel_campaign_actor_and_audit: campaigns_guard_cancel is missing or disabled';
  end if;

  -- the actor check comes before the lock; the gate is the live text; both evidence rows are in
  v_def := pg_get_functiondef(v_fn);
  if position($s$has_platform_permission_for_user(p_actor, 'campaigns.runstate')$s$ in v_def) = 0
     or position($s$has_platform_permission_for_user(p_actor, 'campaigns.runstate')$s$ in v_def) > position('for update' in v_def) then
    raise exception 'cancel_campaign_actor_and_audit: the actor check is missing or comes after the campaign lock';
  end if;
  foreach v_snippet in array array[
    $s$errcode = '42501'$s$,
    $s$v.status in ('draft','pending_approval','approved')$s$,
    $s$not exists (select 1 from public.billed_results b where b.campaign_id=v.id)$s$,
    $s$not public.campaign_has_payment_activity(v.id)$s$,
    $s$insert into public.support_access_log$s$,
    $s$insert into public.activity_log$s$
  ] loop
    if position(v_snippet in v_def) = 0 then
      raise exception 'cancel_campaign_actor_and_audit: the function lost %', v_snippet;
    end if;
  end loop;
end $$;

-- ═════════ ROLLBACK REFERENCE (pre-change text, verbatim from pg_get_functiondef on 2026-10-27; not executed) ═════════
-- ACL before: {postgres=X/postgres,service_role=X/postgres}
-- CREATE OR REPLACE FUNCTION public.cancel_campaign(p_campaign uuid, p_actor uuid DEFAULT NULL::uuid)
--  RETURNS text
--  LANGUAGE plpgsql
--  SET search_path TO ''
-- AS $function$
-- declare v public.campaigns;
--         v_paid boolean; v_test_only boolean; -- [audit]
-- begin
--   select * into v from public.campaigns where id=p_campaign for update;
--   if not found then return 'no_campaign'; end if;
--   if v.status='cancelled' then return 'already_cancelled'; end if;
--   -- Predicate is ALWAYS evaluated here too — never assumed true for 'draft' or
--   -- any other state; this re-check (separate from the trigger above) is what
--   -- lets the RPC return a precise outcome instead of a raw constraint error.
--   if not ( v.status in ('draft','pending_approval','approved')
--     and not exists (select 1 from public.billed_results b where b.campaign_id=v.id)
--     and not public.campaign_has_payment_activity(v.id) ) then
--     return 'not_cancellable';
--   end if;
--   -- [audit] What this cancellation erases. The gate above lets a SUCCEEDED payment row through only when it is test money,
--   -- so a true v_paid always comes with a true v_test_only; both are recorded so that a reader never has to infer it.
--   -- Same effect filter as campaign_has_payment_activity, so the record describes exactly the rows the gate waved through.
--   select count(*) > 0, coalesce(bool_and(o.is_test), false) into v_paid, v_test_only
--     from public.payment_operations o
--     join public.payment_operation_kinds k on k.kind = o.kind
--    where o.campaign_id = v.id and o.outcome = 'succeeded' and k.effect <> 'none';
--   update public.campaigns set status='cancelled' where id=p_campaign;
--   -- [audit] Who and when, in the SAME transaction: if this row cannot be written the status change is rolled back with it, so a
--   -- cancellation without a record does not happen. p_actor is the staff member the application verified; NULL = the caller did
--   -- not pass one (old application code).
--   insert into public.activity_log (user_id, event_id, action, meta)
--   values (p_actor, v.event_id, 'campaign.cancelled',
--           jsonb_build_object('campaignId', v.id, 'statusBefore', v.status,
--                              'hadSucceededPayment', v_paid, 'testMoneyOnly', v_paid and v_test_only));
--   return 'cancelled';
-- end; $function$
