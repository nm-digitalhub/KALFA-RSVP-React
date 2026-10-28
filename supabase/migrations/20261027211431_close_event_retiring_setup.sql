-- A customer closes an event, and an RSVP service that was never paid for is retired in the same operation.
-- Change: openspec/changes/separate-event-setup-from-management, design D7, tasks 2.1-2.2.
--
-- WHY
--   An owner whose service is chosen or approved but not paid could not close the event: the event trigger (R7, inside
--   events_guard_update) refuses a close while a campaign is draft, pending_approval or approved, and only staff may cancel a
--   campaign (cancel_campaign needs campaigns.runstate since 20261027124834). The owner was left asking staff to cancel
--   something nobody paid for. The customer may not borrow the staff function: a customer action gets its own path
--   (owner, 27.10.2026: "לא מערבבים הרשאות צוות ומשתמשים בהם עבור לקוח"), authorized by the CUSTOMER permission system
--   (owner, 27.10.2026), not by a second, hand-written ownership check.
--
-- WHAT IT DOES
--   1. A new customer permission, events.close ("אירועים — סגירה"), system_protected: only the organization's owner role
--      holds it and it cannot be delegated to another role (org_role_permissions_protect_system refuses that). It is added
--        - to the template (role_permissions), which create_organization copies into every new organization;
--        - to the owner role of every existing organization (organization_role_permissions).
--      The event's own owner passes can_access_event by ownership in any case; events.close decides whether ANOTHER member
--      of the organization may close it.
--   2. A new function, public.close_event_retiring_setup(p_event, p_actor). The application calls it only after its gate
--      (requireEventAccess(event, 'events', 'close'), i.e. can_access_event on the caller's own session) has passed, and
--      passes the signed-in user as p_actor, never a value from the request. The function holds the business rules, in ONE
--      transaction:
--        1. locks the event; returns not_found, or already_closed;
--        2. locks the event's live campaign (campaigns_event_noncancelled_uidx allows at most one);
--        3. a campaign in draft, pending_approval or approved:
--             - any succeeded payment, test money included              -> blocked_paid  (nothing changes)
--             - a payment pending or in review, or a billed result      -> blocked_money (nothing changes)
--             - otherwise it is set to cancelled (campaigns_guard_cancel re-checks the same rule), and a benefit bound to it
--               is released through public.release_coupon_assignment, exactly as a staff cancellation releases it;
--           a campaign in scheduled, active or paused is a paid, running service -> blocked_paid (nothing changes);
--        4. sets events.status = 'closed' (R7 still guards it: a campaign that is still operational raises);
--        5. writes ONE activity_log row: action event.closed, user_id = p_actor,
--           meta = { retiredCampaignId, statusBefore } (empty when nothing was retired); returns closed.
--      Every refusal returns BEFORE the first write, so a refusal changes nothing.
--      Security invoker, search_path '', executable by service_role only: the application's admin client is the only
--      caller, so no browser-context role gains a way to change an event's status (the intent of M1).
--
-- WHAT IT DOES NOT DO
--   - It checks no permission itself: the access decision stays in one place, can_access_event, behind the application gate.
--     No staff key is read and no support_access_log row is written: this is the customer's own action.
--   - cancel_campaign, campaign_runstate, the triggers and the staff paths (adminCloseEvent, closeEventAfterSettlement) are
--     untouched.
--   - It deletes nothing. The cancelled campaign, its pricing rounds, its approval and every payment row (a declined attempt
--     included) stay as they are; a LOCKED pricing round is left untouched by the benefit release (D17).
--   - Settled test money is NOT reset here. Resetting a test run stays a staff action (cancel_campaign).
--   - No table, policy or index is added. The only rows written by this file are the permission rows of section 1.
--
-- LOCK ORDER
--   The event row first (for update: no campaign can be created for it meanwhile), then the campaign row, then, inside
--   release_coupon_assignment, the campaign again (already held), its pricing round and the assignment - the order that
--   function and the ledger insert trigger already use for the campaign and below. No path locks a campaign and then waits
--   on its event row.
--
-- house rule (owner, 20261027193942): the file carries its own begin/commit, and the verification block rolls the whole
-- file back when a check fails.
--
-- reviewed against the supabase-postgres-best-practices rules: security-privileges (revoke from public, anon,
-- authenticated; grant service_role only; invoker; search_path ''), security-rls-basics (no policy added; service_role
-- bypasses RLS and the access decision is the application gate), lock-short-transactions (lock_timeout,
-- statement_timeout, no external call), lock-deadlock-prevention (above), query indexes (campaigns_event_noncancelled_uidx,
-- payment_operations_campaign_idx, coupon_assignments_campaign_idx).
--
-- DRY RUN (owner, after db push, one transaction, rolled back): openspec/changes/separate-event-setup-from-management/
-- dry-run-close-event-retiring-setup.sql.
--
-- ROLLBACK (manual, together with reverting closeEvent in src/lib/data/events.ts):
--   drop function public.close_event_retiring_setup(uuid, uuid);
--   delete from public.role_permissions rp using public.permission_definitions p
--    where p.id = rp.permission_id and p.resource = 'events' and p.action = 'close';
--   the owner-role rows in organization_role_permissions are protected against deletion (org_role_permissions_protect_owner);
--   removing them needs that trigger disabled for the statement, by the owner, then:
--   delete from public.permission_definitions where resource = 'events' and action = 'close';
--   (activity_log and organization_role_audit_log rows already written stay; they are history.)

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- ── 1. the customer permission events.close, owner role only ──
insert into public.permission_definitions (resource, action, label, sort_order, system_protected)
values ('events', 'close', 'אירועים — סגירה', 14, true);

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.org_roles r
 cross join public.permission_definitions p
 where r.is_owner_role
   and p.resource = 'events'
   and p.action = 'close';

insert into public.organization_role_permissions (organization_id, role_id, permission_id)
select o.id, r.id, p.id
  from public.organizations o
 cross join public.org_roles r
 cross join public.permission_definitions p
 where r.is_owner_role
   and p.resource = 'events'
   and p.action = 'close';

-- ── 2. the close itself ──
create or replace function public.close_event_retiring_setup(p_event uuid, p_actor uuid)
returns text
language plpgsql
security invoker
set search_path to ''
as $function$
declare
  v_event_status public.event_status;
  v              public.campaigns;
  v_has_live     boolean;
  v_retired      uuid;
  v_before       public.campaign_status;
  v_assignment   uuid;
begin
  if p_event is null or p_actor is null then
    return 'not_found';
  end if;

  -- 1. The event. Who may close it was decided by the application gate (can_access_event, events.close).
  select e.status
    into v_event_status
    from public.events e
   where e.id = p_event
     for update;

  if not found then
    return 'not_found';
  end if;

  if v_event_status = 'closed' then
    return 'already_closed';
  end if;

  -- 2. The live campaign: at most one per event (campaigns_event_noncancelled_uidx).
  select *
    into v
    from public.campaigns c
   where c.event_id = p_event
     and c.status <> 'cancelled'
     for update;
  v_has_live := found;

  -- 3. Decide every refusal before the first write.
  if v_has_live and v.status in ('scheduled', 'active', 'paused') then
    -- A running service has been paid for; it ends through a cancellation request, not here.
    return 'blocked_paid';
  end if;

  if v_has_live and v.status in ('draft', 'pending_approval', 'approved') then
    -- Any succeeded payment, TEST money included: closing must not silently reset a test run.
    if exists (
      select 1
        from public.payment_operations o
        join public.payment_operation_kinds k on k.kind = o.kind
       where o.campaign_id = v.id
         and o.outcome = 'succeeded'
         and k.effect <> 'none'
    ) then
      return 'blocked_paid';
    end if;

    -- Money in flight (pending, review) or a billed result.
    if exists (select 1 from public.billed_results b where b.campaign_id = v.id)
       or public.campaign_has_payment_activity(v.id) then
      return 'blocked_money';
    end if;

    -- Retire the unpaid service. campaigns_guard_cancel re-checks the same rule on this update.
    update public.campaigns
       set status = 'cancelled'
     where id = v.id;

    v_retired := v.id;
    v_before  := v.status;

    -- The benefit bound to it goes back to its owner, as on a staff cancellation. After the cancel: a locked pricing
    -- round is left as it is only once its campaign is cancelled.
    select a.id
      into v_assignment
      from public.coupon_assignments a
     where a.bound_campaign_id = v.id
       and a.state = 'bound';

    if found then
      perform public.release_coupon_assignment(v_assignment, 'campaign_cancelled', p_actor);
    end if;
  end if;

  -- 4. Close. R7 (events_guard_update) still refuses while any campaign is operational.
  update public.events
     set status = 'closed'
   where id = p_event;

  -- 5. The one audit row, in the same transaction.
  insert into public.activity_log (user_id, event_id, action, meta)
  values (
    p_actor,
    p_event,
    'event.closed',
    jsonb_strip_nulls(jsonb_build_object('retiredCampaignId', v_retired, 'statusBefore', v_before))
  );

  return 'closed';
end;
$function$;

revoke execute on function public.close_event_retiring_setup(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.close_event_retiring_setup(uuid, uuid)
  to service_role;

comment on function public.close_event_retiring_setup(uuid, uuid) is
  'Closes an event for a customer the application already authorized (can_access_event, events.close). An unpaid RSVP service (draft, pending_approval or approved, with no succeeded payment, test money included, no payment in flight and no billed result) is cancelled in the same transaction and its bound benefit released. Writes one activity_log row (event.closed, user_id = p_actor, meta retiredCampaignId, statusBefore). Returns not_found, already_closed, blocked_paid, blocked_money or closed; a refusal changes nothing. Security invoker: service_role only.';

-- ── verification: aborts, and rolls the whole file back, when any of these fails ──
do $$
declare
  v_fn      constant regprocedure := 'public.close_event_retiring_setup(uuid,uuid)'::regprocedure;
  v_perm    uuid;
  v_def     text;
  v_bad     integer;
  v_snippet text;
begin
  -- the permission: one row, protected
  select p.id
    into v_perm
    from public.permission_definitions p
   where p.resource = 'events' and p.action = 'close' and p.system_protected;

  if v_perm is null then
    raise exception 'close_event_retiring_setup: events.close is missing or not system_protected';
  end if;

  -- the template gives it to the owner role, and to no other role
  if not exists (select 1 from public.role_permissions rp join public.org_roles r on r.id = rp.role_id
                  where rp.permission_id = v_perm and r.is_owner_role) then
    raise exception 'close_event_retiring_setup: the template does not give events.close to the owner role';
  end if;

  if exists (select 1 from public.role_permissions rp join public.org_roles r on r.id = rp.role_id
              where rp.permission_id = v_perm and not r.is_owner_role)
     or exists (select 1 from public.organization_role_permissions orp join public.org_roles r on r.id = orp.role_id
                 where orp.permission_id = v_perm and not r.is_owner_role) then
    raise exception 'close_event_retiring_setup: a non-owner role holds events.close';
  end if;

  -- every existing organization's owner role holds it
  select count(*)
    into v_bad
    from public.organizations o
   where not exists (select 1 from public.organization_role_permissions orp
                       join public.org_roles r on r.id = orp.role_id
                      where orp.organization_id = o.id and orp.permission_id = v_perm and r.is_owner_role);

  if v_bad > 0 then
    raise exception 'close_event_retiring_setup: % organization(s) lack events.close on the owner role', v_bad;
  end if;

  -- the function
  select pg_get_functiondef(v_fn) into v_def;
  v_def := lower(regexp_replace(v_def, '\s+', ' ', 'g'));

  if (select p.prosecdef from pg_proc p where p.oid = v_fn) then
    raise exception 'close_event_retiring_setup: function must be SECURITY INVOKER';
  end if;

  if not coalesce(
    (select p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = v_fn),
    false
  ) then
    raise exception 'close_event_retiring_setup: function search_path must be empty';
  end if;

  -- who may execute it: the owner and service_role, nobody else (a NULL ACL means PUBLIC may)
  if (select p.proacl from pg_proc p where p.oid = v_fn) is null then
    raise exception 'close_event_retiring_setup: the function still has the default ACL';
  end if;

  select count(*)
    into v_bad
    from pg_proc p
   cross join lateral aclexplode(p.proacl) a
   where p.oid = v_fn
     and a.privilege_type = 'EXECUTE'
     and a.grantee not in (p.proowner, 'service_role'::regrole::oid);

  if v_bad > 0 then
    raise exception 'close_event_retiring_setup: % unexpected grantee(s) can execute the function', v_bad;
  end if;

  if has_function_privilege('anon', v_fn, 'execute')
     or has_function_privilege('authenticated', v_fn, 'execute') then
    raise exception 'close_event_retiring_setup: anon or authenticated can execute the function';
  end if;

  -- security invoker: service_role must itself hold every privilege the body uses
  if not (    has_function_privilege('service_role', v_fn, 'execute')
          and has_schema_privilege('service_role', 'public', 'usage')
          and has_table_privilege('service_role', 'public.events', 'select')
          and has_table_privilege('service_role', 'public.events', 'update')
          and has_table_privilege('service_role', 'public.campaigns', 'select')
          and has_table_privilege('service_role', 'public.campaigns', 'update')
          and has_table_privilege('service_role', 'public.payment_operations', 'select')
          and has_table_privilege('service_role', 'public.payment_operation_kinds', 'select')
          and has_table_privilege('service_role', 'public.billed_results', 'select')
          and has_table_privilege('service_role', 'public.coupon_assignments', 'select')
          and has_table_privilege('service_role', 'public.activity_log', 'insert')
          and has_function_privilege('service_role', 'public.campaign_has_payment_activity(uuid)', 'execute')
          and has_function_privilege('service_role', 'public.release_coupon_assignment(uuid,text,uuid)', 'execute')) then
    raise exception 'close_event_retiring_setup: service_role lacks a privilege the security-invoker function needs';
  end if;

  -- the two guards the body relies on are attached and enabled
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.campaigns'::regclass and t.tgname = 'campaigns_guard_cancel'
                    and t.tgenabled = 'O' and not t.tgisinternal) then
    raise exception 'close_event_retiring_setup: campaigns_guard_cancel is missing or disabled';
  end if;

  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.events'::regclass and t.tgname = 'events_guard_update'
                    and t.tgenabled = 'O' and not t.tgisinternal) then
    raise exception 'close_event_retiring_setup: events_guard_update is missing or disabled';
  end if;

  -- the body keeps its rules
  foreach v_snippet in array array[
    'and o.outcome = ''succeeded''',
    'public.campaign_has_payment_activity(v.id)',
    'public.release_coupon_assignment(v_assignment, ''campaign_cancelled'', p_actor)',
    '''event.closed'''
  ] loop
    if position(v_snippet in v_def) = 0 then
      raise exception 'close_event_retiring_setup: the function lost %', v_snippet;
    end if;
  end loop;

  -- order: cancel the campaign, then release its benefit, then close the event
  if not (    position('update public.campaigns set status = ''cancelled''' in v_def)
            < position('perform public.release_coupon_assignment' in v_def)
          and position('perform public.release_coupon_assignment' in v_def)
            < position('update public.events set status = ''closed''' in v_def)) then
    raise exception 'close_event_retiring_setup: cancel, release and close are out of order';
  end if;

  -- a call that touches nothing: an unknown event is not_found
  if public.close_event_retiring_setup(gen_random_uuid(), gen_random_uuid()) <> 'not_found' then
    raise exception 'close_event_retiring_setup: an unknown event is not reported as not_found';
  end if;
end
$$;

commit;
