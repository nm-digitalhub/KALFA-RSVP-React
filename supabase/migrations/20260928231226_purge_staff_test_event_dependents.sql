-- Allow deleting a STAFF-OWNED (test) event even after it billed, by clearing the rows that block the delete.
--
-- Deleting an event cascades to campaigns, guests, contacts, … but the delete is blocked (verified live
-- 2026-09-29) by RESTRICT / NO ACTION references:
--   billed_results               -> events, campaigns, contacts   (RESTRICT)
--   campaign_authorized_contacts -> events, campaigns             (RESTRICT)
--   campaign_authorized_set_audit-> events, campaigns             (RESTRICT + append-only trigger)
--   event_cancellation_requests  -> events                        (RESTRICT)
--   inbound_agent_attempts       -> events, guests, contacts      (RESTRICT)
--   contact_interactions         -> guests                        (NO ACTION)
--   support_access_log           -> events                        (NO ACTION, event_id nullable)
-- A foreign key's ON DELETE action cannot be conditional, so a BEFORE DELETE row trigger on events clears
-- these first (a BEFORE trigger runs before the referential checks of the delete).
--
-- Condition: the event owner is in platform_staff (the same source is_staff() reads). The event name is NOT
-- used — any customer can name an event "טסט". A customer-owned event is untouched: the trigger returns
-- and the delete stays blocked exactly as before.
-- Refused: an event with a campaign in charge_status 'charged' — a real SUMIT receipt exists and deleting
-- our record would break reconciliation.
-- Kept: support_access_log rows are detached (event_id -> NULL), never deleted. The purge itself is logged
-- to activity_log with event_id NULL (an event-scoped row would be cascaded away with the event).
-- Not touched: SUMIT. Open J5 holds must be released in the SUMIT dashboard; deleting here does not.
--
-- campaign_authorized_set_audit stays append-only for everything else: its guard now allows DELETE only
-- while the transaction-local setting kalfa.purge_test_event = 'on', which only this trigger sets and
-- resets before returning.
--
-- Rollback:
--   drop trigger if exists events_purge_staff_test_dependents on public.events;
--   drop function if exists public.purge_staff_test_event_dependents();
--   create or replace function public.campaign_authorized_set_audit_no_mutate() returns trigger
--     language plpgsql set search_path to 'public' as $$
--   begin
--     raise exception 'campaign_authorized_set_audit is append-only (% blocked)', tg_op;
--   end; $$;

CREATE OR REPLACE FUNCTION public.campaign_authorized_set_audit_no_mutate()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'DELETE' and current_setting('kalfa.purge_test_event', true) = 'on' then
    return old;
  end if;
  raise exception 'campaign_authorized_set_audit is append-only (% blocked)', tg_op;
end;
$function$;

CREATE OR REPLACE FUNCTION public.purge_staff_test_event_dependents()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_campaigns uuid[];
begin
  if not exists (select 1 from public.platform_staff s where s.user_id = old.owner_id) then
    return old;  -- customer event: nothing cleared, the FKs block the delete as before
  end if;

  if exists (select 1 from public.campaigns c
             where c.event_id = old.id and c.charge_status = 'charged') then
    raise exception 'event % has a charged campaign; it cannot be purged', old.id;
  end if;

  select coalesce(array_agg(c.id), '{}') into v_campaigns
    from public.campaigns c where c.event_id = old.id;

  perform set_config('kalfa.purge_test_event', 'on', true);

  delete from public.billed_results where event_id = old.id;
  delete from public.campaign_authorized_contacts where event_id = old.id;
  delete from public.campaign_authorized_set_audit where event_id = old.id;
  delete from public.event_cancellation_requests where event_id = old.id;
  delete from public.inbound_agent_attempts
    where event_id = old.id
       or guest_id in (select g.id from public.guests g where g.event_id = old.id);
  delete from public.contact_interactions
    where event_id = old.id
       or guest_id in (select g.id from public.guests g where g.event_id = old.id);
  update public.support_access_log set event_id = null where event_id = old.id;

  perform set_config('kalfa.purge_test_event', 'off', true);

  insert into public.activity_log (user_id, event_id, action, meta)
    values (auth.uid(), null, 'event.test_purged',
            jsonb_build_object('event_id', old.id, 'owner_id', old.owner_id,
                               'campaign_ids', to_jsonb(v_campaigns)));

  return old;
end;
$function$;

revoke all on function public.purge_staff_test_event_dependents() from public, anon, authenticated;

create trigger events_purge_staff_test_dependents
  before delete on public.events
  for each row execute function public.purge_staff_test_event_dependents();
