-- P0-1 follow-up (addresses the PR #2 automated review, Gemini "Critical Financial
-- Invariant Violation"). FORWARD-ONLY create-or-replace — does NOT edit any applied
-- migration. Two changes, both inert while app_settings.billing_exposure_gate=false:
--
-- (1) try_record_billed_result — close the money-leak the review flagged. With the
--     exposure gate ON, set membership no longer bounds `reached`, so the ceiling
--     COUNT cap must fall back from max_contacts to the FUNDED cap
--     (least(max_contacts, floor(auth_amount/price))) — the amount the J5 hold
--     actually covers — so captured can never exceed the hold when covered<full.
--     NOTE: the review's suggested fix (always require set membership) is rejected —
--     it would defeat P0-1's goal of billing a serviced contact that was repointed
--     OUT of the frozen set. The funded-cap count bound is the correct guard.
--     Gate OFF path is byte-identical to the prior body (legacy max_contacts cap).
--
-- (2) reconcile_authorized_set — fast-path a same-contact repoint
--     (p_contact = p_prev_contact) to 'noop', avoiding a redundant delete/insert and
--     a misleading self-referential audit row.

-- ---------------------------------------------------------------------
-- (1) try_record_billed_result — funded-cap count bound under the exposure gate.
-- ---------------------------------------------------------------------
create or replace function public.try_record_billed_result(p_event uuid, p_campaign uuid, p_contact uuid, p_channel public.campaign_channel, p_attempt text, p_evidence text, p_provider_ref text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_status text; v_price numeric; v_max int; v_start timestamptz; v_close timestamptz;
  v_count int; v_removed boolean; v_event_id uuid; v_event_date timestamptz;
  v_auth numeric; v_gate boolean; v_cap int;
begin
  -- Authoritative event comes from the campaign, not the caller.
  select event_id, status::text, price_per_reached, max_contacts, start_at, close_at, auth_amount
    into v_event_id, v_status, v_price, v_max, v_start, v_close, v_auth
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
      v_cap := least(v_max, floor(v_auth / v_price))::int;
    end if;
  else
    v_cap := v_max;
  end if;
  select count(*) into v_count from billed_results where campaign_id=p_campaign;
  if v_count >= v_cap then return 'ceiling_reached'; end if;

  insert into billed_results(event_id,campaign_id,contact_id,channel,attempt_id,locked_price,evidence_source,provider_ref)
    values (v_event_id,p_campaign,p_contact,p_channel,p_attempt,v_price,p_evidence,p_provider_ref)
    on conflict (event_id,contact_id) do nothing;
  if not found then return 'already_billed'; end if;
  return 'billed';
end; $function$;

revoke all on function public.try_record_billed_result(uuid, uuid, uuid, public.campaign_channel, text, text, text) from public, anon, authenticated;
grant execute on function public.try_record_billed_result(uuid, uuid, uuid, public.campaign_channel, text, text, text) to service_role;

-- ---------------------------------------------------------------------
-- (2) reconcile_authorized_set — same-contact repoint fast-path (noop).
-- ---------------------------------------------------------------------
create or replace function public.reconcile_authorized_set(
  p_event        uuid,
  p_campaign     uuid,
  p_op           text,
  p_contact      uuid,
  p_prev_contact uuid default null,
  p_actor        text default null
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_event_id       uuid;
  v_status         text;
  v_max            int;
  v_auth           numeric;
  v_price          numeric;
  v_funded_cap     int;
  v_size           int;
  v_new_member     boolean;
  v_prev_member    boolean;
  v_target_ok      boolean;
begin
  select event_id, status::text, max_contacts, auth_amount, price_per_reached
    into v_event_id, v_status, v_max, v_auth, v_price
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
  if v_max is null or v_auth is null or v_price is null
     or v_auth <= 0 or v_price <= 0 then
    v_funded_cap := 0;
  else
    v_funded_cap := least(v_max, floor(v_auth / v_price))::int;
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
    -- Fast-path: a repoint to the SAME contact is a no-op (avoids a redundant
    -- delete/insert and a self-referential audit row).
    if p_prev_contact is not null and p_contact = p_prev_contact then
      return 'noop';
    end if;

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
$$;

revoke all on function public.reconcile_authorized_set(uuid, uuid, text, uuid, uuid, text) from public;
revoke all on function public.reconcile_authorized_set(uuid, uuid, text, uuid, uuid, text) from anon;
revoke all on function public.reconcile_authorized_set(uuid, uuid, text, uuid, uuid, text) from authenticated;
grant execute on function public.reconcile_authorized_set(uuid, uuid, text, uuid, uuid, text) to service_role;
