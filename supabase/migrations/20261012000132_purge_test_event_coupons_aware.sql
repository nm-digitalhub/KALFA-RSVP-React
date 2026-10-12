-- personal-coupons task 1.4 — the purge path meets the pricing rounds.
--
-- MEASURED GAP (12.10.2026, live): purge_test_event deletes public.events and relies on CASCADE to remove the
-- campaigns — but campaign_pricing.campaign_id and approval_requests.campaign_id now reference campaigns with
-- ON DELETE RESTRICT, and since phase 1 EVERY priced campaign has a pricing row. Unfixed, any purge of a priced
-- test campaign fails mid-way (fail closed — no data loss, but the purge is broken). 0 unpurged test events exist
-- right now, so nothing is waiting on this.
--
-- THE RULE (D6): a LOCKED pricing row is immutable history and can never be deleted — so an event whose campaign
-- was EVER approved cannot be purged. The blocker now says that early and clearly ('approved_terms') instead of
-- erroring mid-delete. Unapproved (unlocked) pricing rows are deleted by the purge; a bound benefit is freed on
-- the assignment side only (D17) and stays with its customer.
--
-- ROLLBACK: re-create both functions from 20260928231226 / 20261011190351 (their previous definitions).

set local lock_timeout = '5s';

create or replace function public.test_event_purge_blocker(p_event uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select case
    -- personal-coupons: an ever-approved campaign has a LOCKED pricing round, which is undeletable history (D6).
    when exists (
      select 1 from public.campaign_pricing p
      join public.campaigns c on c.id = p.campaign_id
      where c.event_id = p_event and p.locked_at is not null
    ) then 'approved_terms'
    when exists (
      select 1 from public.campaigns c
      where c.event_id = p_event
        and c.status::text in ('billed', 'paid', 'awaiting_invoice')
    ) then 'financial_activity'
    when exists (
      select 1 from public.payment_operations o where o.event_id = p_event
    ) then 'financial_activity'
    when exists (
      select 1 from public.event_cancellation_requests r
      where r.event_id = p_event
        and (r.sumit_document_id is not null or coalesce(r.resolution_amount, 0) > 0)
    ) then 'financial_activity'
    else null
  end;
$fn$;

CREATE OR REPLACE FUNCTION public.purge_test_event(p_event uuid, p_actor uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- Return the blocker's own value: 'approved_terms' (locked pricing — D6) or 'financial_activity'.
  declare v_blocker text;
  begin
    v_blocker := public.test_event_purge_blocker(p_event);
    if v_blocker is not null then
      return v_blocker;
    end if;
  end;

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

  -- personal-coupons (12.10.2026): campaign_pricing / approval_requests reference campaigns with ON DELETE RESTRICT,
  -- so they must go before the events delete. A LOCKED pricing row never reaches here — the blocker returns
  -- 'approved_terms' first. A benefit bound to a purged campaign is freed on the assignment side only (D17):
  -- the assignment belongs to the customer, not to the event.
  insert into public.coupon_assignment_events (assignment_id, action, actor_user_id, reason)
    select a.id, 'released', p_actor, 'test event purged'
      from public.coupon_assignments a
     where a.bound_campaign_id = any(v_campaigns);
  update public.coupon_assignments
     set state = case when expires_at <= now() then 'void' else 'assigned' end,
         bound_campaign_id = null
   where bound_campaign_id = any(v_campaigns);
  delete from public.approval_requests where campaign_id = any(v_campaigns);
  delete from public.campaign_pricing where campaign_id = any(v_campaigns);
  perform set_config('kalfa.purge_test_event', 'off', true);

  delete from public.events where id = p_event;  -- CASCADE removes campaigns, guests, contacts, …

  -- Nothing referencing the event may survive (fail closed: raise → the whole purge rolls back).
  select (select count(*) from public.billed_results where event_id = p_event or campaign_id = any(v_campaigns) or contact_id = any(v_contacts))
       + (select count(*) from public.campaign_authorized_contacts where event_id = p_event or campaign_id = any(v_campaigns))
       + (select count(*) from public.campaign_authorized_set_audit where event_id = p_event or campaign_id = any(v_campaigns))
       + (select count(*) from public.inbound_agent_attempts where event_id = p_event or guest_id = any(v_guests) or contact_id = any(v_contacts))
       + (select count(*) from public.campaigns where event_id = p_event)
       + (select count(*) from public.campaign_pricing where campaign_id = any(v_campaigns))
       + (select count(*) from public.approval_requests where campaign_id = any(v_campaigns))
       + (select count(*) from public.coupon_assignments where bound_campaign_id = any(v_campaigns))
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
$function$
;
