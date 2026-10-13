-- personal-coupons-admin-panel ד.3 (AD8; spec §9): the staff void becomes ONE database
-- transaction — live re-checks under locks in the canonical campaign → round → assignment
-- order (release_coupon_assignment was aligned in 20261013001452), then release + state
-- change + the void event commit together. The staff reason is REQUIRED and stored in the
-- event's meta.staff_reason; the operational reason code stays 'staff_void'. A no-op never
-- answers success, and a repeat void writes no second event.
--
-- Refusal codes (display maps them): already_ended (consumed/void/expired), held_by_payment
-- (pending), held_by_review, held_by_approved_terms (locked round), needs_investigation
-- (money movement on the campaign, or a succeeded payment on THIS assignment's rounds while
-- it is not consumed — the consumption exception; no bypass path).
--
-- ROLLBACK: drop function public.void_staff_coupon_assignment(uuid, uuid, text);

create or replace function public.void_staff_coupon_assignment(
  _staff_id uuid,
  _assignment_id uuid,
  _staff_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asg         public.coupon_assignments%rowtype;
  v_campaign_id uuid;
  v_state       text;
  v_round       public.campaign_pricing%rowtype;
  v_open        text;
begin
  if _staff_id is null or _assignment_id is null
     or _staff_reason is null or length(trim(_staff_reason)) not between 1 and 500 then
    raise exception 'void: invalid arguments';
  end if;

  -- Discover without locking, then lock campaign -> round -> assignment (canonical order).
  select bound_campaign_id, state into v_campaign_id, v_state
    from public.coupon_assignments where id = _assignment_id;
  if not found then raise exception 'void: assignment not found'; end if;
  if v_state in ('consumed', 'void') then
    return jsonb_build_object('outcome', 'refused', 'reason', 'already_ended');
  end if;

  if v_campaign_id is not null then
    perform 1 from public.campaigns where id = v_campaign_id for update;
    select * into v_round from public.campaign_pricing
      where campaign_id = v_campaign_id and superseded_at is null for update;
  end if;

  select * into v_asg from public.coupon_assignments where id = _assignment_id for update;
  if v_asg.state in ('consumed', 'void') then
    return jsonb_build_object('outcome', 'refused', 'reason', 'already_ended');
  end if;
  if v_asg.bound_campaign_id is distinct from v_campaign_id then
    raise exception 'void: assignment changed';
  end if;
  -- An expired row needs no operational void (spec §9) — nothing is written for display.
  if v_asg.expires_at <= now() then
    return jsonb_build_object('outcome', 'refused', 'reason', 'already_ended');
  end if;

  -- The consumption exception: a succeeded payment attributed to THIS assignment's rounds
  -- while it is not consumed — no bypass; refer to investigation.
  if exists (
    select 1 from public.campaign_pricing p
    join public.payment_operations po on po.pricing_round_id = p.id
    where p.coupon_assignment_id = _assignment_id
      and po.kind = 'package_purchase' and po.outcome = 'succeeded'
  ) then
    return jsonb_build_object('outcome', 'refused', 'reason', 'needs_investigation');
  end if;

  if v_campaign_id is not null then
    select po.outcome into v_open
      from public.payment_operations po
      where po.campaign_id = v_campaign_id and po.kind = 'package_purchase'
        and po.outcome in ('pending', 'review')
      order by case po.outcome when 'pending' then 0 else 1 end
      limit 1;
    if v_open = 'pending' then
      return jsonb_build_object('outcome', 'refused', 'reason', 'held_by_payment');
    elsif v_open = 'review' then
      return jsonb_build_object('outcome', 'refused', 'reason', 'held_by_review');
    end if;
    if public.campaign_has_payment_activity(v_campaign_id) then
      return jsonb_build_object('outcome', 'refused', 'reason', 'needs_investigation');
    end if;
    if v_round.id is not null and v_round.locked_at is not null then
      return jsonb_build_object('outcome', 'refused', 'reason', 'held_by_approved_terms');
    end if;

    -- Bound on an unlocked, unblocked round: the release runs INSIDE this transaction
    -- (locks already held in the same order), so release + void + event are one commit.
    perform public.release_coupon_assignment(_assignment_id, 'voided_by_staff', _staff_id);
  end if;

  update public.coupon_assignments set state = 'void'
    where id = _assignment_id and state in ('assigned', 'bound');
  if not found then
    raise exception 'void: assignment changed';
  end if;

  insert into public.coupon_assignment_events (assignment_id, action, actor_user_id, reason, meta)
    values (
      _assignment_id, 'voided', _staff_id, 'staff_void',
      jsonb_build_object('staff_reason', trim(_staff_reason))
    );

  return jsonb_build_object('outcome', 'voided');
end $$;

revoke all on function public.void_staff_coupon_assignment(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.void_staff_coupon_assignment(uuid, uuid, text)
  to service_role;
