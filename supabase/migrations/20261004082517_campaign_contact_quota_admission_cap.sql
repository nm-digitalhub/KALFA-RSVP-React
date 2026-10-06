-- Contact-quota package, step 3: the quota caps who is ADMITTED to the authorized list.
--
-- Plan: docs/superpowers/plans/2026-09-30-contact-quota-package.md (§4.2, §4.3.1, §4.3.2, §5 step 3).
-- Follows 20261004055310 (campaigns.contact_quota) and 20261004081706 (the seat gate).
--
-- reconcile_authorized_set is the function that adds, replaces and removes a contact on a
-- campaign's authorized list after the list exists. A seat is membership of that list, so
-- capping admission here is what makes "the first N guests are in, the rest wait" true for
-- every guest added by hand, by CSV import or by WhatsApp import (all three call it).
--
-- WHAT CHANGES: a campaign whose contact_quota is NOT NULL and whose list already holds that
-- many contacts no longer admits another. The function returns the new verdict 'quota_full'
-- and writes nothing (except the kept_exposed audit row of an exposed contact in the
-- repoint-with-pin case, as its not_eligible sibling does). Three places can grow the list
-- by one and each is capped: ADD, REPOINT where the old contact was not on the list, and
-- REPOINT where the old contact is exposed and therefore stays. A REPOINT that swaps the old
-- contact OUT keeps the size constant and is not capped; DELETE is not capped.
--
-- WHAT DOES NOT CHANGE: a campaign with contact_quota NULL (every campaign today) behaves
-- exactly as before; no other branch, verdict, audit row or lock is touched. The campaign row
-- is already locked FOR UPDATE at the top, which is what serialises two concurrent admissions
-- at the boundary. The function stays SECURITY DEFINER with search_path 'public'; CREATE OR
-- REPLACE keeps its owner and ACL.
--
-- A waiting guest needs no new table: he is an eligible contact of the event who is not on the
-- list. Stage 4 (upgrade) admits the waiting ones in order; stage 5 shows them to the owner.
--
-- BASE: the body below is the live definition, compared on 2026-10-04 with the one in
-- 20260925003335_retire_funded_cap.sql (identical), with ONLY the quota edits added.
--
-- NOT COVERED HERE: snapshotAuthorizedSet (TypeScript, runs once at the old card-hold step) still
-- fills the list without a cap. The hold step leaves the package model (owner, 2026-10-04), so
-- the first fill belongs at activation and is a separate step.
--
-- NOT TESTED AUTOMATICALLY: the integration suite needs a dedicated test database and is skipped
-- today. Verify by reading the diff against 20260925003335 and with the read-only checks in the
-- plan after applying.
--
-- ROLLBACK: re-apply the reconcile_authorized_set definition from
-- 20260925003335_retire_funded_cap.sql (CREATE OR REPLACE; nothing else depends on this change).

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
      -- The old contact was never on the list, so this adds one: same cap as ADD.
      if v_quota is not null and v_size >= v_quota then
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
    return 'removed';
  end if;

  return 'not_operational';
end;
$function$;
