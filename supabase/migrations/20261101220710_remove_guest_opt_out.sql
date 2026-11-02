-- Remove the guest opt-out ("removal request") entirely.
--
-- WHY
--   Owner decision, 01.11.2026: RSVP outreach (invitations, reminders, calls, thank-you) is not marketing, so there is
--   no removal request in this product. A guest can appear in several events, and a per-contact opt-out only made the
--   lists inconsistent. The voice agent's mark_dnc tool was already removed (ElevenLabs agent, merged to Main
--   01.11.2026) and the application code of this change no longer reads or writes the flag. Read on the linked project
--   01.11.2026: no contact has removal_requested = true, no call_dispatch_status row carries 'removal_requested' or
--   'dnc_listed', and no contact_interactions.billing_outcome is 'removal_requested'.
--
-- WHAT IT DOES
--   1. public.try_record_billed_result stops refusing a reach for a contact with removal_requested (its
--      'removal_requested' verdict is gone).
--   2. public.admit_contacts_by_order, public.fill_authorized_set and public.reconcile_authorized_set stop excluding
--      such contacts from the campaign's authorized list.
--   3. public.console_event_guests: `dialable` is now "the guest has a normalized phone".
--   Each of the four functions and the view is the live text with only the removal lines taken out (read back from the
--   linked project 01.11.2026; md5 of pg_get_functiondef / pg_get_viewdef matched the local database). Same
--   signatures and the same column list, so CREATE OR REPLACE keeps every grant, comment and option.
--   4. call_dispatch_status reason CHECK: 'removal_requested' and 'dnc_listed' are removed. The RSVP call dispatcher
--      checks neither an opt-out nor the local Do-Not-Call list any more. Recreated verbatim minus those two values
--      (the same approach as 20261101134148); call-dispatch-status.test.ts reads THIS file as the live contract.
--   5. Drops contacts.removal_requested.
--   6. Verifies the end state; any failed check rolls the whole file back.
--
-- WHAT IT DOES NOT DO
--   - The contact_op_status enum keeps its (never-written) 'removal_requested' value; unused op_status values are a
--     separate cleanup.
--   - The call_dnc_list table and the DNC registry gate are untouched: the sales, meeting-confirmation, call-me-now and
--     console dial paths still use them.
--   - No other function, view, index or policy references the column (pg_proc / pg_views / pg_indexes / pg_policies
--     searched on the linked project 01.11.2026).
--
-- DEPLOY ORDER — push this AFTER the application code of the same change is deployed, BOTH processes:
--   - the web app (kalfa-beta), and
--   - the pg-boss worker (kalfa-worker, a separate bundle: dist/worker.cjs). `npm run deploy` rebuilds and restarts it
--     through scripts/worker-build-restart.mjs (the bundle changes with this change, so it restarts).
--   The old code selects and filters on contacts.removal_requested (guest list, campaign delivery, contact reads, the
--   send step) and can write the two removed dispatch reasons; against this schema those reads fail. The new code
--   references none of it, so it works against both the old schema and this one.
--   After the push: `npm run gen:types`, then `npm run types:check` (types.generated.ts is generated from the linked
--   project, so it can only drop the column once it is gone there).

-- 1. try_record_billed_result without the removal refusal.
CREATE OR REPLACE FUNCTION public.try_record_billed_result(p_event uuid, p_campaign uuid, p_contact uuid, p_channel campaign_channel, p_attempt text, p_evidence text, p_provider_ref text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text; v_start timestamptz; v_close timestamptz;
  v_event_id uuid; v_event_date timestamptz;
  v_gate boolean;
begin
  -- Authoritative event comes from the campaign, not the caller.
  select event_id, status::text, start_at, close_at
    into v_event_id, v_status, v_start, v_close
    from campaigns where id=p_campaign for update;
  if not found then return 'no_campaign'; end if;
  if p_event is distinct from v_event_id then return 'event_mismatch'; end if;
  if v_status not in ('active','paused') then return 'not_active'; end if;  -- D2: a paused campaign still records inbound
  if v_start is not null and now() < v_start then return 'before_window'; end if;
  if v_close is not null and now() > v_close then return 'closed_window'; end if;
  -- L2: never record a reach for an event whose calendar day has already passed (Israel).
  select event_date into v_event_date from events where id = v_event_id;
  if v_event_date is not null
     and (now() at time zone 'Asia/Jerusalem')::date
           > (v_event_date at time zone 'Asia/Jerusalem')::date then
    return 'event_passed';
  end if;
  -- R9: never record a reach for a campaign whose event is not active.
  if (select status from public.events where id = v_event_id) is distinct from 'active' then
    return 'event_not_active';
  end if;

  v_gate := coalesce((select billing_exposure_gate from public.app_settings limit 1), false);

  -- Authorization basis. gate OFF (default): membership of the campaign's authorized set. gate ON: exposure — a
  -- serviced non-member may be recorded (the P0-1 fix).
  if v_gate then
    if not public.exposed_for_billing(p_campaign, p_contact, v_event_id, p_channel)
      then return 'no_exposure'; end if;
  else
    if not exists (select 1 from public.campaign_authorized_contacts a
                   where a.campaign_id=p_campaign and a.contact_id=p_contact)
      then return 'not_authorized'; end if;
  end if;

  -- One reach per contact per event, across channels. No price: a package is paid once at purchase.
  insert into billed_results(event_id,campaign_id,contact_id,channel,attempt_id,evidence_source,provider_ref)
    values (v_event_id,p_campaign,p_contact,p_channel,p_attempt,p_evidence,p_provider_ref)
    on conflict (event_id,contact_id) do nothing;
  if not found then return 'already_billed'; end if;
  return 'billed';
end; $function$;

-- 2. The authorized-list writers without the removal exclusion.
CREATE OR REPLACE FUNCTION public.admit_contacts_by_order(p_event uuid, p_campaign uuid, p_limit integer, p_size integer, p_reason text, p_actor text, p_prev_for uuid DEFAULT NULL::uuid, p_prev uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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

CREATE OR REPLACE FUNCTION public.fill_authorized_set(p_event uuid, p_campaign uuid, p_actor text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Admit eligibility of the TARGET contact (p_contact): belongs to this event and
  -- is referenced by a live guest of the event. absent -> false.
  select (c.event_id = v_event_id
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

-- 3. console_event_guests: dialable = has a normalized phone.
create or replace view public.console_event_guests as
 SELECT g.id AS guest_id,
    g.event_id,
    g.full_name AS guest_name,
    c.normalized_phone IS NOT NULL AS dialable,
        CASE
            WHEN has_platform_permission('view_customer_data'::text) THEN c.normalized_phone
            ELSE NULL::text
        END AS phone,
    g.status::text AS rsvp_status,
    (EXISTS ( SELECT 1
           FROM campaigns cp
          WHERE cp.event_id = g.event_id AND cp.status = 'active'::campaign_status)) AS has_active_campaign,
    br.reached_at,
    cb.callback_scheduled_at,
    br.reached_at IS NULL AND cb.callback_scheduled_at IS NULL AS can_start_outreach_call,
        CASE
            WHEN br.reached_at IS NOT NULL THEN 'already_reached'::text
            WHEN cb.callback_scheduled_at IS NOT NULL THEN 'callback_scheduled'::text
            ELSE NULL::text
        END AS call_block_reason
   FROM guests g
     LEFT JOIN contacts c ON c.id = g.contact_id
     LEFT JOIN LATERAL ( SELECT b.reached_at
           FROM billed_results b
          WHERE b.event_id = g.event_id AND b.contact_id = g.contact_id) br ON true
     LEFT JOIN LATERAL ( SELECT min(ca.callback_iso) AS callback_scheduled_at
           FROM call_attempts ca
          WHERE ca.event_id = g.event_id AND ca.contact_id = g.contact_id AND ca.callback_iso IS NOT NULL AND ca.callback_dispatched_at IS NULL) cb ON true
  WHERE is_console_agent() AND console_event_in_scope(g.event_id);

-- 4. call_dispatch_status reason CHECK, minus 'removal_requested' and 'dnc_listed'.
alter table public.call_dispatch_status drop constraint call_dispatch_status_reason_check;
alter table public.call_dispatch_status add constraint call_dispatch_status_reason_check
  check (reason is null or reason in (
    'already_reached', 'outside_dial_window', 'campaign_not_active', 'event_closed', 'concurrent_owner',
    'max_concurrency', 'campaign_hour_cap', 'outreach_disabled', 'config_missing', 'live_calls_disabled',
    'balance_below_reserve', 'already_dispatched', 'already_concluded', 'failed_to_start', 'start_unknown',
    'temporary_dispatch_failure', 'waiting_for_quota'));

-- 5. Drop the column (no view, index, policy or function depends on it after steps 1-3).
alter table public.contacts drop column removal_requested;

-- 6. Verify the end state.
do $verify$
declare
  v_names text;
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'contacts' and column_name = 'removal_requested') then
    raise exception 'contacts.removal_requested still exists';
  end if;

  select string_agg(p.proname, ', ' order by p.proname) into v_names
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and pg_get_functiondef(p.oid) ilike '%removal_requested%';
  if v_names is not null then
    raise exception 'functions still reference removal_requested: %', v_names;
  end if;

  if exists (select 1 from pg_views where schemaname = 'public' and definition ilike '%removal_requested%') then
    raise exception 'a view still references removal_requested';
  end if;

  if pg_get_constraintdef((select oid from pg_constraint where conname = 'call_dispatch_status_reason_check'
                                                        and conrelid = 'public.call_dispatch_status'::regclass))
       ~ '(removal_requested|dnc_listed)' then
    raise exception 'call_dispatch_status_reason_check still allows a removed reason';
  end if;
end;
$verify$;
