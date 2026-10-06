-- Test-event purge: explicit marking + one authorized, atomic purge path.
-- Plan: docs/superpowers/plans/2026-09-29-test-event-purge.md (incl. review round 1).
--
-- Replaces the implicit BEFORE DELETE trigger from 20260928231226. That trigger purged billing rows for any
-- event owned by a platform_staff member, and events_owner_delete lets an owner delete their own event through
-- the Data API — so any staff member could wipe billing of their own (possibly real) event. After this migration
-- a DELETE on events (API or dashboard) behaves as before 2026-09-28: blocked by the RESTRICT references.
--
--   test_events            marker + history; no FK to events so it survives the purge; no grants to
--                          anon/authenticated (hidden from customers and from GraphQL introspection).
--   mark_test_event        \
--   unmark_test_event       } service_role only; the app gates them with requirePlatformPermission
--   purge_test_event       /  ('events.mark_test' / 'events.purge_test'). All three lock the events row first,
--                             then the test_events row (one lock order).
--   purge_test_event       refuses on ANY financial activity (purge_blockers), snapshots the money / legal rows
--                          into test_events.snapshot, deletes every RESTRICT / NO ACTION reference by every FK
--                          column (event, campaigns, contacts, guests), detaches support_access_log, deletes the
--                          event (CASCADE does the rest), then asserts nothing referencing it is left.
--   grants                 anon/authenticated lose UPDATE/DELETE/TRUNCATE on the four money tables. RLS already
--                          denies UPDATE/DELETE there (SELECT/INSERT policies only; every app write uses the
--                          service-role client), but TRUNCATE is not subject to RLS. service_role keeps the
--                          Supabase defaults (owner decision 2026-09-25).
-- New functions use search_path = '' and fully qualified names (Supabase guidance for SECURITY DEFINER).
-- campaign_authorized_set_audit_no_mutate keeps the GUC gate from 20260928231226; the GUC is only a guard
-- against accidental mutation — authorization is EXECUTE + the app permission check.
--
-- Rollback:
--   drop function if exists public.purge_test_event(uuid, uuid);
--   drop function if exists public.unmark_test_event(uuid, uuid);
--   drop function if exists public.mark_test_event(uuid, uuid);
--   drop function if exists public.test_event_purge_blocker(uuid);
--   drop table if exists public.test_events;
--   delete from public.platform_permission_definitions where key in ('events.mark_test','events.purge_test');
--   grant update, delete, truncate on public.billed_results, public.campaign_authorized_contacts,
--     public.campaign_authorized_set_audit, public.event_cancellation_requests to anon, authenticated;
--   (the dropped trigger is intentionally not restored)

-- 1. Retire the implicit trigger path ---------------------------------------------------------------------
drop trigger if exists events_purge_staff_test_dependents on public.events;
drop function if exists public.purge_staff_test_event_dependents();

-- 2. Marker + history table --------------------------------------------------------------------------------
create table public.test_events (
  event_id  uuid primary key,            -- no FK: the row outlives the purged event
  marked_by uuid not null,
  marked_at timestamptz not null default now(),
  purged_by uuid,
  purged_at timestamptz,
  snapshot  jsonb                         -- record of the money / legal rows removed (not a restore)
);
alter table public.test_events enable row level security;  -- no policies: service_role only
revoke all on table public.test_events from public, anon, authenticated;

-- 3. Financial-activity check (shared by the purge and, later, the admin page) ------------------------------
create function public.test_event_purge_blocker(p_event uuid)
 returns text
 language sql
 stable
 security definer
 set search_path = ''
as $function$
  select case
    when exists (
      select 1 from public.campaigns c
      where c.event_id = p_event
        and (   c.charge_status in ('charged', 'pending', 'charge_review')
             or c.sumit_charge_document_id is not null
             or c.charge_payment_id is not null
             or c.status::text in ('billed', 'paid', 'awaiting_invoice')
             or coalesce(c.final_charge_amount, 0) > 0
             or c.capture_status in ('pending', 'hold_review')
             or (c.capture_status = 'authorized' and c.release_status is null))
    ) then 'financial_activity'
    when exists (
      select 1 from public.event_cancellation_requests r
      where r.event_id = p_event
        and (r.sumit_document_id is not null or coalesce(r.resolution_amount, 0) > 0)
    ) then 'financial_activity'
    else null
  end;
$function$;
revoke all on function public.test_event_purge_blocker(uuid) from public, anon, authenticated;
grant execute on function public.test_event_purge_blocker(uuid) to service_role;

-- 4. Mark / unmark -------------------------------------------------------------------------------------------
create function public.mark_test_event(p_event uuid, p_actor uuid)
 returns text
 language plpgsql
 security definer
 set search_path = ''
as $function$
begin
  if not exists (select 1 from public.platform_staff s where s.user_id = p_actor) then
    return 'not_staff';
  end if;
  perform 1 from public.events where id = p_event for update;
  if not found then return 'no_event'; end if;

  insert into public.test_events (event_id, marked_by)
    values (p_event, p_actor)
    on conflict (event_id) do nothing;
  if not found then return 'already_marked'; end if;

  insert into public.activity_log (user_id, event_id, action, meta)
    values (p_actor, null, 'event.test_marked', jsonb_build_object('event_id', p_event));
  return 'marked';
end;
$function$;

create function public.unmark_test_event(p_event uuid, p_actor uuid)
 returns text
 language plpgsql
 security definer
 set search_path = ''
as $function$
begin
  if not exists (select 1 from public.platform_staff s where s.user_id = p_actor) then
    return 'not_staff';
  end if;
  perform 1 from public.events where id = p_event for update;
  if not found then return 'no_event'; end if;

  delete from public.test_events where event_id = p_event and purged_at is null;
  if not found then return 'not_marked'; end if;

  insert into public.activity_log (user_id, event_id, action, meta)
    values (p_actor, null, 'event.test_unmarked', jsonb_build_object('event_id', p_event));
  return 'unmarked';
end;
$function$;

revoke all on function public.mark_test_event(uuid, uuid) from public, anon, authenticated;
revoke all on function public.unmark_test_event(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mark_test_event(uuid, uuid) to service_role;
grant execute on function public.unmark_test_event(uuid, uuid) to service_role;

-- 5. Purge ------------------------------------------------------------------------------------------------------
create function public.purge_test_event(p_event uuid, p_actor uuid)
 returns text
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_campaigns uuid[];
  v_contacts  uuid[];
  v_guests    uuid[];
  v_snapshot  jsonb;
  v_left      int;
begin
  if not exists (select 1 from public.platform_staff s where s.user_id = p_actor) then
    return 'not_staff';
  end if;

  -- Lock order: events row, then the marker row (same as mark/unmark).
  perform 1 from public.events where id = p_event for update;
  if not found then return 'no_event'; end if;
  perform 1 from public.test_events where event_id = p_event and purged_at is null for update;
  if not found then return 'not_marked'; end if;

  if public.test_event_purge_blocker(p_event) is not null then
    return 'financial_activity';
  end if;

  select coalesce(array_agg(id), '{}') into v_campaigns from public.campaigns where event_id = p_event;
  select coalesce(array_agg(id), '{}') into v_contacts  from public.contacts  where event_id = p_event;
  select coalesce(array_agg(id), '{}') into v_guests    from public.guests    where event_id = p_event;

  -- Record of what is removed. signed_agreements: identifiers, version, hash and dates only — no IP,
  -- user agent, verified phone or evidence refs.
  v_snapshot := jsonb_build_object(
    'purged_at', now(),
    'campaign_ids', to_jsonb(v_campaigns),
    'billed_results', coalesce((select jsonb_agg(to_jsonb(b)) from public.billed_results b
        where b.event_id = p_event or b.campaign_id = any(v_campaigns) or b.contact_id = any(v_contacts)), '[]'),
    'campaign_authorized_contacts', coalesce((select jsonb_agg(to_jsonb(a)) from public.campaign_authorized_contacts a
        where a.event_id = p_event or a.campaign_id = any(v_campaigns)), '[]'),
    'campaign_authorized_set_audit', coalesce((select jsonb_agg(to_jsonb(a)) from public.campaign_authorized_set_audit a
        where a.event_id = p_event or a.campaign_id = any(v_campaigns)), '[]'),
    'event_cancellation_requests', coalesce((select jsonb_agg(to_jsonb(r)) from public.event_cancellation_requests r
        where r.event_id = p_event), '[]'),
    'billing_credits', coalesce((select jsonb_agg(to_jsonb(c)) from public.billing_credits c
        where c.event_id = p_event or c.campaign_id = any(v_campaigns)), '[]'),
    'signed_agreements', coalesce((select jsonb_agg(jsonb_build_object(
          'id', s.id, 'campaign_id', s.campaign_id, 'signer_user_id', s.signer_user_id,
          'agreement_version', s.agreement_version, 'content_hash', s.content_hash,
          'signed_at', s.signed_at, 'otp_verified_at', s.otp_verified_at))
        from public.signed_agreements s where s.event_id = p_event or s.campaign_id = any(v_campaigns)), '[]'),
    'counts', jsonb_build_object(
      'campaigns', cardinality(v_campaigns),
      'contacts', cardinality(v_contacts),
      'guests', cardinality(v_guests),
      'contact_interactions', (select count(*) from public.contact_interactions
          where event_id = p_event or campaign_id = any(v_campaigns) or guest_id = any(v_guests)),
      'support_access_log_detached', (select count(*) from public.support_access_log where event_id = p_event))
  );

  -- Remove every blocking reference, by every FK column that can point into this event.
  perform set_config('kalfa.purge_test_event', 'on', true);
  delete from public.billed_results
    where event_id = p_event or campaign_id = any(v_campaigns) or contact_id = any(v_contacts);
  delete from public.campaign_authorized_contacts
    where event_id = p_event or campaign_id = any(v_campaigns);
  delete from public.campaign_authorized_set_audit
    where event_id = p_event or campaign_id = any(v_campaigns);
  delete from public.event_cancellation_requests where event_id = p_event;
  delete from public.inbound_agent_attempts
    where event_id = p_event or guest_id = any(v_guests) or contact_id = any(v_contacts);
  delete from public.contact_interactions where guest_id = any(v_guests);
  update public.support_access_log set event_id = null where event_id = p_event;
  perform set_config('kalfa.purge_test_event', 'off', true);

  delete from public.events where id = p_event;  -- CASCADE removes campaigns, guests, contacts, …

  -- Nothing referencing the event may survive (fail closed: raise → the whole purge rolls back).
  select (select count(*) from public.billed_results where event_id = p_event or campaign_id = any(v_campaigns) or contact_id = any(v_contacts))
       + (select count(*) from public.campaign_authorized_contacts where event_id = p_event or campaign_id = any(v_campaigns))
       + (select count(*) from public.campaign_authorized_set_audit where event_id = p_event or campaign_id = any(v_campaigns))
       + (select count(*) from public.inbound_agent_attempts where event_id = p_event or guest_id = any(v_guests) or contact_id = any(v_contacts))
       + (select count(*) from public.campaigns where event_id = p_event)
    into v_left;
  if v_left > 0 then
    raise exception 'purge_test_event: % referencing rows left for event %', v_left, p_event;
  end if;

  update public.test_events
    set purged_by = p_actor, purged_at = now(), snapshot = v_snapshot
    where event_id = p_event;

  insert into public.activity_log (user_id, event_id, action, meta)
    values (p_actor, null, 'event.test_purged',
            jsonb_build_object('event_id', p_event, 'campaign_ids', to_jsonb(v_campaigns)));
  return 'purged';
end;
$function$;
revoke all on function public.purge_test_event(uuid, uuid) from public, anon, authenticated;
grant execute on function public.purge_test_event(uuid, uuid) to service_role;

-- 6. Staff permissions (seeded to the owner role; grant further in the roles UI) --------------------------------
insert into public.platform_permission_definitions (key, label, category, sort_order)
values
  ('events.mark_test',  'סימון אירוע כאירוע בדיקה', 'ops', 76),
  ('events.purge_test', 'מחיקת אירוע בדיקה',        'ops', 77)
on conflict (key) do nothing;

insert into public.platform_role_permissions (role_id, permission_id)
select r.id, d.id
from public.platform_roles r
cross join public.platform_permission_definitions d
where r.is_owner_role
  and d.key in ('events.mark_test', 'events.purge_test')
on conflict do nothing;

-- 7. Least privilege on the money tables -------------------------------------------------------------------------
revoke update, delete, truncate on table
  public.billed_results,
  public.campaign_authorized_contacts,
  public.campaign_authorized_set_audit,
  public.event_cancellation_requests
from anon, authenticated;
