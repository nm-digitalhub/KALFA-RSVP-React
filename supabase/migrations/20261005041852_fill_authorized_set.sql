-- fill_authorized_set: the FIRST fill of a quota campaign's authorized list, in order of addition.
-- Plan: docs/superpowers/plans/2026-10-04-package-activation-plan.md Task 1.
--
-- A package campaign has no card-hold step, so the list that every send reads (campaign_authorized_contacts)
-- is empty until something fills it. This function admits the first eligible contacts by guests.seq up to
-- campaigns.contact_quota. It only TOPS UP: it never removes a member, so a swap the customer made through
-- reconcile_authorized_set (repoint) before activation is kept, and a member that already has service exposure
-- is never touched. Re-running it is a no-op unless room appeared (a guest was deleted).
--
-- Eligibility is the one reconcile_authorized_set uses for ADD (v_target_ok), so the two writers agree on who
-- may be on the list. The campaign row is locked FOR UPDATE, which serialises this with every reconcile call.
--
-- Rank of a contact = the smallest guests.seq among its guests (order of addition; created_at is shared by a
-- bulk import and cannot order). Audit rows use reason 'snapshot' (the closed vocabulary of
-- campaign_authorized_set_audit_reason_check; no constraint change).
--
-- Depends on 20261005041849_guests_seq_order.sql (guests.seq).
--
-- ROLLBACK: drop function public.fill_authorized_set(uuid, uuid, text);

create or replace function public.fill_authorized_set(
  p_event    uuid,
  p_campaign uuid,
  p_actor    text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_event_id uuid;
  v_status   text;
  v_quota    int;
  v_size     int;
  v_room     int;
  v_admitted int := 0;
  v_waiting  int;
  r          record;
begin
  select event_id, status::text, contact_quota
    into v_event_id, v_status, v_quota
    from public.campaigns
    where id = p_campaign
    for update;
  if not found then
    return jsonb_build_object('verdict', 'no_campaign');
  end if;
  if p_event is distinct from v_event_id then
    return jsonb_build_object('verdict', 'event_mismatch');
  end if;
  if v_status not in ('approved', 'scheduled', 'active', 'paused') then
    return jsonb_build_object('verdict', 'not_operational');
  end if;
  if v_quota is null then
    return jsonb_build_object('verdict', 'no_quota');
  end if;

  select count(*) into v_size
    from public.campaign_authorized_contacts
    where campaign_id = p_campaign;
  v_room := greatest(v_quota - v_size, 0);

  for r in
    select c.id as contact_id
      from public.contacts c
      cross join lateral (
        select min(g.seq) as first_seq
          from public.guests g
          where g.event_id = v_event_id and g.contact_id = c.id
      ) fg
      where c.event_id = v_event_id
        and c.removal_requested = false
        and fg.first_seq is not null
        and not exists (
          select 1 from public.campaign_authorized_contacts a
          where a.campaign_id = p_campaign and a.contact_id = c.id
        )
      order by fg.first_seq, c.id
      limit v_room
  loop
    insert into public.campaign_authorized_contacts (event_id, campaign_id, contact_id)
      values (v_event_id, p_campaign, r.contact_id)
      on conflict (campaign_id, contact_id) do nothing;
    v_size := v_size + 1;
    v_admitted := v_admitted + 1;
    insert into public.campaign_authorized_set_audit
      (event_id, campaign_id, contact_id, prev_contact_id, action, reason, actor, resulting_size)
      values (v_event_id, p_campaign, r.contact_id, null, 'in', 'snapshot', p_actor, v_size);
  end loop;

  -- Eligible contacts that did not get a seat: they WAIT (visible to the owner later; an upgrade admits them).
  select count(*) into v_waiting
    from public.contacts c
    where c.event_id = v_event_id
      and c.removal_requested = false
      and exists (select 1 from public.guests g where g.event_id = v_event_id and g.contact_id = c.id)
      and not exists (
        select 1 from public.campaign_authorized_contacts a
        where a.campaign_id = p_campaign and a.contact_id = c.id
      );

  return jsonb_build_object(
    'verdict', 'filled',
    'admitted', v_admitted,
    'size', v_size,
    'quota', v_quota,
    'waiting', v_waiting
  );
end;
$function$;

revoke all on function public.fill_authorized_set(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.fill_authorized_set(uuid, uuid, text) to service_role;
