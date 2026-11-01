-- A package campaign's outreach list admits by order of addition, atomically.
-- OpenSpec change package-outreach-admission-safety, task 4.1 and design D1.
--
-- WHY
--   For a campaign with a package quota (campaigns.contact_quota), a guest reaches the outreach list
--   (campaign_authorized_contacts) when the guest is added. Two gaps break the order of addition:
--   - a `delete` that removes a member commits and returns 'removed' without admitting anyone, so the freed seat goes to the
--     next guest ADDED, ahead of guests who were already waiting;
--   - an `add` inserts the added contact when there is room, even when an earlier guest is waiting (a missed admission).
--   Filling from the application after 'removed' would be a second transaction, and a concurrent add could take the seat in
--   between. So the admission happens inside the RPC, under the campaign row lock it already takes (FOR UPDATE).
--
-- WHAT IT DOES
--   1. public.admit_contacts_by_order — ONE internal definition of eligibility and rank, the rules fill_authorized_set
--      already used: a contact of the event, not removal_requested, referenced by a live guest, not on the list; ranked by the
--      smallest guests.seq among its guests (then id). It admits up to p_limit of them and writes one 'in' audit row each.
--      Internal: SECURITY INVOKER, executable by its owner only. It runs inside the two SECURITY DEFINER functions below,
--      which already hold the campaign row lock.
--   2. public.reconcile_authorized_set — same signature, same return values, same grants. For a campaign WITH a quota:
--      - `add`, and a `repoint` whose old contact was not on the list: the free seats go to the waiting contacts by order of
--        addition (reason 'add' / 'repoint'). It answers 'added' only if p_contact is on the list afterwards, 'quota_full'
--        otherwise — an earlier waiter may have taken the last seat;
--      - a `delete` that removes a member: in the same transaction, the first waiting contact takes the freed seat
--        (an 'in' / 'delete' audit row after the 'out' / 'delete' one).
--      Every branch for a campaign WITHOUT a quota (pay-per-result), and every other branch (no-op, not_eligible, the swap,
--      the exposed/pinned cases, an exposed member's delete), is the live text unchanged.
--   3. public.fill_authorized_set — same signature, result and grants; its admission loop is replaced by the shared function.
--
-- WHAT IT DOES NOT DO
--   - No table, column, index, policy or constraint changes. The audit `reason` vocabulary stays add / repoint / delete /
--     snapshot (campaign_authorized_set_audit_reason_check).
--   - It edits no row. Records written by admissions are history.
--
-- The two replaced functions start from their live text, read back from the linked project on 01.11.2026: the md5 of
-- pg_get_functiondef matched the local database built from 20261015094022 (reconcile_authorized_set) and 20261005041852
-- (fill_authorized_set). Changed lines are marked "[order]".
--
-- house assumption (same as 20261008040027): `supabase db push` applies a migration file as ONE transaction, so the
-- verification block at the end rolls the whole file back if any check fails.
--
-- DRY RUN (owner, one request, rolled back; never on the live database by me): scripts/sql/reconcile-admit-by-order-dry-run.sql
-- (task 4.2).
--
-- ROLLBACK (manual, with the application left as it is — it calls the same signatures):
--   1. re-create public.reconcile_authorized_set from supabase/migrations/20261015094022_restore_reconcile_same_contact_noop.sql;
--   2. re-create public.fill_authorized_set from supabase/migrations/20261005041852_fill_authorized_set.sql;
--   3. drop function public.admit_contacts_by_order(uuid, uuid, integer, integer, text, text, uuid, uuid);
--   Records written by admissions stay as history.

set local lock_timeout = '10s';

-- 1. The shared admission ---------------------------------------------------------------------------------------------

create or replace function public.admit_contacts_by_order(
  p_event    uuid,
  p_campaign uuid,
  p_limit    integer,
  p_size     integer,
  p_reason   text,
  p_actor    text,
  p_prev_for uuid default null,
  p_prev     uuid default null
)
returns integer
language plpgsql
set search_path to 'public'
as $function$
-- Admits up to p_limit waiting contacts of the event to the campaign's list, by order of addition, and returns how many it
-- admitted. p_size is the list size before the call (each audit row carries the size after its admission). The audit row of
-- the contact p_prev_for carries p_prev as its previous contact (a repoint's old contact). The caller holds the campaign
-- row lock (FOR UPDATE) and has checked the campaign and the quota.
declare
  v_size     integer := p_size;
  v_admitted integer := 0;
  r          record;
begin
  if p_limit is null or p_limit <= 0 then
    return 0;
  end if;

  for r in
    select c.id as contact_id
      from public.contacts c
      cross join lateral (
        select min(g.seq) as first_seq
          from public.guests g
          where g.event_id = p_event and g.contact_id = c.id
      ) fg
      where c.event_id = p_event
        and c.removal_requested = false
        and fg.first_seq is not null
        and not exists (
          select 1 from public.campaign_authorized_contacts a
          where a.campaign_id = p_campaign and a.contact_id = c.id
        )
      order by fg.first_seq, c.id
      limit p_limit
  loop
    insert into public.campaign_authorized_contacts (event_id, campaign_id, contact_id)
      values (p_event, p_campaign, r.contact_id)
      on conflict (campaign_id, contact_id) do nothing;
    v_size := v_size + 1;
    v_admitted := v_admitted + 1;
    insert into public.campaign_authorized_set_audit
      (event_id, campaign_id, contact_id, prev_contact_id, action, reason, actor, resulting_size)
      values (p_event, p_campaign, r.contact_id,
              case when r.contact_id = p_prev_for then p_prev end,
              'in', p_reason, p_actor, v_size);
  end loop;

  return v_admitted;
end;
$function$;

revoke all on function public.admit_contacts_by_order(uuid, uuid, integer, integer, text, text, uuid, uuid)
  from public, anon, authenticated, service_role;

-- 2. reconcile_authorized_set ------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reconcile_authorized_set(p_event uuid, p_campaign uuid, p_op text, p_contact uuid, p_prev_contact uuid DEFAULT NULL::uuid, p_actor text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_event_id       uuid;
  v_status         text;
  v_size           int;
  v_new_member     boolean;
  v_prev_member    boolean;
  v_target_ok      boolean;
  v_quota          int;
begin
  select event_id, status::text, contact_quota
    into v_event_id, v_status, v_quota
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
    -- Contact-quota cap: a campaign with a quota admits at most contact_quota contacts. The
    -- guest is not lost, he WAITS (an eligible contact outside the list); an upgrade admits him.
    if v_quota is not null and v_size >= v_quota then
      return 'quota_full';
    end if;
    -- [order] With a quota, the free seats go to the waiting contacts by order of addition: an earlier waiter goes
    -- before p_contact, and p_contact is 'added' only if a seat reached it.
    if v_quota is not null then
      perform public.admit_contacts_by_order(v_event_id, p_campaign, v_quota - v_size, v_size, 'add', p_actor);
      if exists (select 1 from public.campaign_authorized_contacts
                 where campaign_id = p_campaign and contact_id = p_contact) then
        return 'added';
      end if;
      return 'quota_full';
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
      -- The old contact was never on the list, so this adds one: same cap as ADD.
      if v_quota is not null and v_size >= v_quota then
        return 'quota_full';
      end if;
      -- [order] With a quota, the same admission by order of addition as ADD; p_contact's audit row keeps the old contact.
      if v_quota is not null then
        perform public.admit_contacts_by_order(v_event_id, p_campaign, v_quota - v_size, v_size, 'repoint', p_actor,
                                               p_contact, p_prev_contact);
        if exists (select 1 from public.campaign_authorized_contacts
                   where campaign_id = p_campaign and contact_id = p_contact) then
          return 'added';
        end if;
        return 'quota_full';
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
    -- The exposed old contact stays (it cannot be removed) AND the new one would be added, so
    -- the list would grow by one: same cap. The old contact's kept_exposed row is still
    -- written, exactly as the not_eligible branch above does. A swap that REMOVES the old
    -- contact (branch above) keeps the size constant and needs no cap.
    if v_quota is not null and v_size >= v_quota then
      insert into public.campaign_authorized_set_audit
        (event_id, campaign_id, contact_id, prev_contact_id, action, reason, actor, resulting_size)
        values (v_event_id, p_campaign, p_prev_contact, null, 'kept_exposed', 'repoint', p_actor, v_size);
      return 'quota_full';
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
    -- [order] With a quota, the freed seat goes to the first waiting contact by order of addition, in this transaction.
    if v_quota is not null then
      perform public.admit_contacts_by_order(v_event_id, p_campaign, greatest(v_quota - v_size, 0), v_size, 'delete', p_actor);
    end if;
    return 'removed';
  end if;

  return 'not_operational';
end;
$function$;

revoke all on function public.reconcile_authorized_set(uuid, uuid, text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reconcile_authorized_set(uuid, uuid, text, uuid, uuid, text) to service_role;

-- 3. fill_authorized_set -----------------------------------------------------------------------------------------------

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

  -- [order] The shared admission: the same eligibility and rank as before, one definition for both writers.
  v_admitted := public.admit_contacts_by_order(v_event_id, p_campaign, v_room, v_size, 'snapshot', p_actor);
  v_size := v_size + v_admitted;

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

-- Verification: refuse the whole file unless the three functions have their signatures and results, both RPCs use the
-- shared admission, the RPCs are service_role only, and the shared admission is executable by no API role.
do $$
declare
  v_admit     constant regprocedure := 'public.admit_contacts_by_order(uuid,uuid,integer,integer,text,text,uuid,uuid)'::regprocedure;
  v_reconcile constant regprocedure := 'public.reconcile_authorized_set(uuid,uuid,text,uuid,uuid,text)'::regprocedure;
  v_fill      constant regprocedure := 'public.fill_authorized_set(uuid,uuid,text)'::regprocedure;
begin
  if pg_get_function_result(v_admit) <> 'integer'
     or pg_get_function_result(v_reconcile) <> 'text'
     or pg_get_function_result(v_fill) <> 'jsonb'
     or (select prosrc from pg_proc where oid = v_reconcile) !~ 'admit_contacts_by_order'
     or (select prosrc from pg_proc where oid = v_fill) !~ 'admit_contacts_by_order'
     or not (select prosecdef from pg_proc where oid = v_reconcile)
     or not (select prosecdef from pg_proc where oid = v_fill)
     or (select prosecdef from pg_proc where oid = v_admit)
     or has_function_privilege('anon', v_reconcile, 'execute')
     or has_function_privilege('authenticated', v_reconcile, 'execute')
     or not has_function_privilege('service_role', v_reconcile, 'execute')
     or has_function_privilege('anon', v_fill, 'execute')
     or has_function_privilege('authenticated', v_fill, 'execute')
     or not has_function_privilege('service_role', v_fill, 'execute')
     or has_function_privilege('anon', v_admit, 'execute')
     or has_function_privilege('authenticated', v_admit, 'execute')
     or has_function_privilege('service_role', v_admit, 'execute') then
    raise exception 'reconcile_admit_by_order: verification failed (signatures, shared admission or grants)';
  end if;
end $$;
