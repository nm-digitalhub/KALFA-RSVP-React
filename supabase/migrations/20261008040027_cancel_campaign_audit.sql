-- Cancelling a campaign leaves a record of who did it and whether it erased test money.
-- Plan: docs/superpowers/plans/2026-10-08-test-money-terminal-stamp-plan.md, section 6 (stage 2).
--
-- WHY
--   Migration 20261008033521 lets a campaign whose only money is test money (terminal 1000) be cancelled and paid again. A change
--   like that must leave a trail of who did it and when (project rule: preserve auditability of administrator actions). Today a
--   cancellation leaves none, and the application cannot write one reliably: logActivity (src/lib/data/activity.ts) runs under the
--   caller's own session, is best-effort by design (a failure only prints a generic line), and the table's insert policy
--   al_owner_insert (with check user_id = auth.uid()) lets ANY signed-in user write a row with any action, so a row written
--   there proves nothing. A row written by the database function, in the same transaction, does.
--
-- WHAT IT DOES
--   1. cancel_campaign gets a second, OPTIONAL argument p_actor (the staff member the application verified). It writes one
--      public.activity_log row, action 'campaign.cancelled', in the SAME transaction as the status change: if the row cannot be
--      written the cancellation does not happen. meta = { campaignId, statusBefore, hadSucceededPayment, testMoneyOnly }.
--   2. The function becomes SECURITY INVOKER (it was SECURITY DEFINER). Its only caller is the server's service_role client, which
--      already holds every privilege the function uses (asserted below), so the elevation was unnecessary. search_path stays ''.
--   3. Same access as before: the owner and service_role may execute it; PUBLIC, anon and authenticated may not.
--
-- WHAT IT DOES NOT DO
--   - The rule for WHEN a campaign may be cancelled, the four return values (no_campaign, already_cancelled, not_cancellable,
--     cancelled) and the guard trigger campaigns_guard_cancel are untouched. The text from "begin" through the gate is the live
--     text byte for byte (the dry run compares it with the function it replaces).
--   - Old application code keeps working: rpc('cancel_campaign', { p_campaign }) resolves to the new function with p_actor NULL and
--     writes the row with user_id NULL. The one-argument function is dropped because an overload next to it would make that very
--     call ambiguous.
--   - It adds no table, no policy, no index and edits no row. (activity_log has no index on its two foreign keys, event_id and
--     user_id; that is older than this file and is listed in the plan, section 11.)
--
-- The function below was generated from pg_get_functiondef of the linked project on 2026-10-08 and differs from the live text ONLY by
-- the signature (p_actor), the security line, and the lines marked "[audit]".
--
-- house assumption (same as 20261006040156 and 20261008033521): `supabase db push` applies a migration file as ONE transaction, so
-- the verification block at the end rolls the whole file back if any check fails.
--
-- reviewed against the supabase-postgres-best-practices rules: security-privileges (revoke from public, anon, authenticated; grant
-- service_role only; invoker; search_path ''), security-rls-basics (activity_log keeps its RLS and policies; the write is made by
-- service_role, which bypasses RLS, and no policy is added), lock-short-transactions (lock_timeout and statement_timeout; the
-- function makes no external call and holds the campaign row lock only for its own statement), lock-deadlock-prevention (it locks the
-- campaign row first, exactly as the ledger insert trigger does, then only inserts), schema-foreign-key-indexes (no foreign key
-- added), schema-data-types (uuid, boolean, jsonb, text), query indexes (the one new read is by payment_operations.campaign_id,
-- served by payment_operations_campaign_idx), schema-lowercase-identifiers.
--
-- DRY RUN (owner, one request; nothing is kept): see the dry-run script delivered with this file. It applies this file's statements,
-- switches to service_role (the role that really calls the function) and checks:
--   1  the text from "begin" through the gate is identical to the live function it replaces
--   2  states the gate must still refuse, with no record written: a closed campaign, a campaign holding real succeeded money,
--      an unknown campaign
--   3  the call the application makes TODAY (p_campaign only) on a clean campaign: cancelled; record with user_id NULL,
--      statusBefore, hadSucceededPayment false; a second call says already_cancelled and writes no second record
--   4  the call with an actor: the record carries that user
--   5  a PENDING test payment blocks the cancellation; once it SUCCEEDED the cancellation goes through and the record says
--      hadSucceededPayment true, testMoneyOnly true
--   6  a REAL succeeded payment blocks it, and a direct UPDATE to cancelled is still refused by campaigns_guard_cancel
--   7  an actor that is not a user is refused (23503) and the status change is rolled back with it
--   8  anon and authenticated cannot execute it; service_role can
--
-- ROLLBACK (manual, and only together with reverting the application change that passes p_actor):
--   drop function public.cancel_campaign(uuid, uuid);
--   then recreate the one-argument function from the pre-change text at the bottom of this file, and
--   revoke execute on function public.cancel_campaign(uuid) from public, anon, authenticated;
--   grant  execute on function public.cancel_campaign(uuid) to service_role;
--   (rows already written to activity_log stay; they are history.)

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- ── 1. cancel_campaign: the live text, a second optional argument, security invoker, and the lines marked [audit] ──
-- The one-argument function is DROPPED, not replaced: create or replace with a new argument list would leave both overloads,
-- and the named-argument call the application makes today would then be ambiguous.
drop function public.cancel_campaign(uuid);

CREATE FUNCTION public.cancel_campaign(p_campaign uuid, p_actor uuid DEFAULT NULL)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
declare v public.campaigns;
        v_paid boolean; v_test_only boolean; -- [audit]
begin
  select * into v from public.campaigns where id=p_campaign for update;
  if not found then return 'no_campaign'; end if;
  if v.status='cancelled' then return 'already_cancelled'; end if;
  -- Predicate is ALWAYS evaluated here too — never assumed true for 'draft' or
  -- any other state; this re-check (separate from the trigger above) is what
  -- lets the RPC return a precise outcome instead of a raw constraint error.
  if not ( v.status in ('draft','pending_approval','approved')
    and v.capture_status is distinct from 'authorized'
    and v.capture_status is distinct from 'pending'
    and v.capture_status is distinct from 'hold_review'
    and v.charge_status is null
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
  -- [audit] Who and when, in the SAME transaction: if this row cannot be written the status change is rolled back with it, so a
  -- cancellation without a record does not happen. p_actor is the staff member the application verified; NULL = the caller did
  -- not pass one (old application code).
  insert into public.activity_log (user_id, event_id, action, meta)
  values (p_actor, v.event_id, 'campaign.cancelled',
          jsonb_build_object('campaignId', v.id, 'statusBefore', v.status,
                             'hadSucceededPayment', v_paid, 'testMoneyOnly', v_paid and v_test_only));
  return 'cancelled';
end; $function$;

revoke execute on function public.cancel_campaign(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_campaign(uuid, uuid) to service_role;

comment on function public.cancel_campaign(uuid, uuid) is
  'Cancels a campaign that holds no real money (draft, pending approval or approved; no hold, charge or billed result, and no pending, review or real succeeded payment) and, in the same transaction, writes one activity_log row: action campaign.cancelled, user_id = p_actor (NULL when the caller passed none), meta = campaignId, statusBefore, hadSucceededPayment, testMoneyOnly. Returns no_campaign, already_cancelled, not_cancellable or cancelled. Security invoker: service_role only, which holds every privilege it uses.';

-- ── 2. verification: aborts, and rolls back whole, when any of these fails ──
do $$
declare
  v_bad     integer;
  v_def     text;
  v_snippet text;
begin
  -- exactly one cancel_campaign, and it is the two-argument one (an old overload next to it would make every call ambiguous)
  select count(*) into v_bad from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'cancel_campaign';
  if v_bad <> 1 then
    raise exception 'cancel_campaign_audit: expected exactly one cancel_campaign, found %', v_bad;
  end if;
  if to_regprocedure('public.cancel_campaign(uuid,uuid)') is null then
    raise exception 'cancel_campaign_audit: cancel_campaign(uuid, uuid) is missing';
  end if;

  -- settings: security invoker and the empty search_path (create function does not inherit what is not restated)
  select count(*) into v_bad
    from pg_proc p
   where p.oid = 'public.cancel_campaign(uuid,uuid)'::regprocedure
     and (p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'], false));
  if v_bad > 0 then
    raise exception 'cancel_campaign_audit: cancel_campaign is security definer or lost its empty search_path';
  end if;

  -- who may execute it: the owner and service_role, nobody else (PUBLIC shows up as grantee 0; a NULL ACL means PUBLIC may)
  if (select p.proacl from pg_proc p where p.oid = 'public.cancel_campaign(uuid,uuid)'::regprocedure) is null then
    raise exception 'cancel_campaign_audit: cancel_campaign still has the default ACL (PUBLIC can execute it)';
  end if;
  select count(*) into v_bad
    from pg_proc p
   cross join lateral aclexplode(p.proacl) a
   where p.oid = 'public.cancel_campaign(uuid,uuid)'::regprocedure
     and a.privilege_type = 'EXECUTE'
     and a.grantee not in (p.proowner, 'service_role'::regrole::oid);
  if v_bad > 0 then
    raise exception 'cancel_campaign_audit: % unexpected grantee(s) can execute cancel_campaign', v_bad;
  end if;
  if not has_function_privilege('service_role', 'public.cancel_campaign(uuid,uuid)', 'execute') then
    raise exception 'cancel_campaign_audit: service_role cannot execute cancel_campaign';
  end if;

  -- security invoker: service_role must itself hold every privilege the function uses
  if not (    has_schema_privilege('service_role', 'public', 'usage')
          and has_table_privilege('service_role', 'public.campaigns', 'select')
          and has_table_privilege('service_role', 'public.campaigns', 'update')
          and has_table_privilege('service_role', 'public.billed_results', 'select')
          and has_table_privilege('service_role', 'public.payment_operations', 'select')
          and has_table_privilege('service_role', 'public.payment_operation_kinds', 'select')
          and has_table_privilege('service_role', 'public.activity_log', 'insert')
          and has_function_privilege('service_role', 'public.campaign_has_payment_activity(uuid)', 'execute')) then
    raise exception 'cancel_campaign_audit: service_role lacks a privilege the security-invoker function needs';
  end if;

  -- the guard trigger that re-checks every cancellation is still attached and enabled
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.campaigns'::regclass and t.tgname = 'campaigns_guard_cancel'
                    and t.tgenabled = 'O' and not t.tgisinternal) then
    raise exception 'cancel_campaign_audit: campaigns_guard_cancel is missing or disabled';
  end if;

  -- the gate is the live text (the application and its tests pin these fragments), and the audit row is in
  v_def := pg_get_functiondef('public.cancel_campaign(uuid,uuid)'::regprocedure);
  foreach v_snippet in array array[
    $s$v.status in ('draft','pending_approval','approved')$s$,
    $s$v.capture_status is distinct from 'authorized'$s$,
    $s$v.capture_status is distinct from 'pending'$s$,
    $s$v.capture_status is distinct from 'hold_review'$s$,
    $s$v.charge_status is null$s$,
    $s$not public.campaign_has_payment_activity(v.id)$s$,
    $s$insert into public.activity_log$s$
  ] loop
    if position(v_snippet in v_def) = 0 then
      raise exception 'cancel_campaign_audit: the function lost %', v_snippet;
    end if;
  end loop;
end $$;

-- ═════════ ROLLBACK REFERENCE (pre-change text, verbatim; not executed) ═════════
-- ACL before: {postgres=X/postgres,service_role=X/postgres}
-- cancel_campaign(uuid) (pre-change text, verbatim)
-- CREATE OR REPLACE FUNCTION public.cancel_campaign(p_campaign uuid)
--  RETURNS text
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO ''
-- AS $function$
-- declare v public.campaigns;
-- begin
--   select * into v from public.campaigns where id=p_campaign for update;
--   if not found then return 'no_campaign'; end if;
--   if v.status='cancelled' then return 'already_cancelled'; end if;
--   -- Predicate is ALWAYS evaluated here too — never assumed true for 'draft' or
--   -- any other state; this re-check (separate from the trigger above) is what
--   -- lets the RPC return a precise outcome instead of a raw constraint error.
--   if not ( v.status in ('draft','pending_approval','approved')
--     and v.capture_status is distinct from 'authorized'
--     and v.capture_status is distinct from 'pending'
--     and v.capture_status is distinct from 'hold_review'
--     and v.charge_status is null
--     and not exists (select 1 from public.billed_results b where b.campaign_id=v.id)
--     and not public.campaign_has_payment_activity(v.id) ) then
--     return 'not_cancellable';
--   end if;
--   update public.campaigns set status='cancelled' where id=p_campaign;
--   return 'cancelled';
-- end; $function$
-- ;
