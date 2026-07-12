-- P0-1 (A2): Harden try_record_billed_result. Verbatim live body with EXACTLY ONE
-- block changed: the not_authorized set-membership check is wrapped in a toggle on
-- app_settings.billing_exposure_gate (default false = legacy behavior).
create or replace function public.try_record_billed_result(p_event uuid, p_campaign uuid, p_contact uuid, p_channel public.campaign_channel, p_attempt text, p_evidence text, p_provider_ref text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_status text; v_price numeric; v_max int; v_start timestamptz; v_close timestamptz;
  v_count int; v_removed boolean; v_event_id uuid; v_event_date timestamptz;
begin
  -- Authoritative event comes from the campaign, not the caller.
  select event_id, status::text, price_per_reached, max_contacts, start_at, close_at
    into v_event_id, v_status, v_price, v_max, v_start, v_close
    from campaigns where id=p_campaign for update;
  if not found then return 'no_campaign'; end if;
  -- L2: the caller-supplied event must match the campaign's event (defensive;
  -- the insert below uses v_event_id regardless).
  if p_event is distinct from v_event_id then return 'event_mismatch'; end if;
  if v_status not in ('active','paused') then return 'not_active'; end if;  -- D2: paused still bills inbound
  if v_start is not null and now() < v_start then return 'before_window'; end if;
  if v_close is not null and now() > v_close then return 'closed_window'; end if;
  -- L2: never bill for an event whose day has already passed (Israel calendar) —
  -- independent of close_at (NULL-window) and of the L1 stepGate (inbound path).
  select event_date into v_event_date from events where id = v_event_id;
  if v_event_date is not null
     and (now() at time zone 'Asia/Jerusalem')::date
           > (v_event_date at time zone 'Asia/Jerusalem')::date then
    return 'event_passed';
  end if;
  -- R9: never bill for a campaign whose event is not active. public.-qualified
  -- (round-2 completion) regardless of the function's own search_path.
  if (select status from public.events where id = v_event_id) is distinct from 'active' then
    return 'event_not_active';
  end if;
  select removal_requested into v_removed from contacts where id=p_contact;
  if coalesce(v_removed,false) then return 'removal_requested'; end if;
  -- Phase 2 BINDING CAP: the frozen authorized SET caps `reached` by construction.
  -- A contact not in the snapshot NEVER bills (fail-closed: empty set → bills nobody).
  -- P0-1 (A2): behind the billing_exposure_gate toggle, derive billing authorization from
  -- real billing-exposure instead of set membership (default false = legacy behavior).
  if coalesce((select billing_exposure_gate from public.app_settings limit 1), false) then
    if not public.exposed_for_billing(p_campaign, p_contact, v_event_id, p_channel)
      then return 'no_exposure'; end if;
  else
    if not exists (select 1 from public.campaign_authorized_contacts a
                   where a.campaign_id=p_campaign and a.contact_id=p_contact)
      then return 'not_authorized'; end if;
  end if;
  -- Secondary defense (count cap): set membership already bounds reached at |set|.
  select count(*) into v_count from billed_results where campaign_id=p_campaign;
  if v_count >= v_max then return 'ceiling_reached'; end if;
  insert into billed_results(event_id,campaign_id,contact_id,channel,attempt_id,locked_price,evidence_source,provider_ref)
    values (v_event_id,p_campaign,p_contact,p_channel,p_attempt,v_price,p_evidence,p_provider_ref)
    on conflict (event_id,contact_id) do nothing;
  if not found then return 'already_billed'; end if;
  return 'billed';
end; $function$;

revoke all on function public.try_record_billed_result(uuid, uuid, uuid, public.campaign_channel, text, text, text) from public, anon, authenticated;
grant execute on function public.try_record_billed_result(uuid, uuid, uuid, public.campaign_channel, text, text, text) to service_role;
