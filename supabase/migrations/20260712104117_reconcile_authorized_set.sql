-- P0-1 (A4): reconcile_authorized_set — single writer of the authorized set.
-- Runs under the same campaigns FOR UPDATE lock as the billing RPC. Admit
-- eligibility + funded_cap are FAIL-CLOSED. Pin decision via has_service_exposure.
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
