-- personal-coupons-admin-panel ד.1 (spec acceptance 20): release_coupon_assignment locked
-- assignment → campaign → round, the OPPOSITE of bind_coupon_assignment and
-- replace_sales_coupon_assignment (campaign → round → assignment) — a deadlock pair under
-- concurrency. Re-created with the canonical order, using the proven discover-then-lock
-- technique: read the binding without a lock, take the locks in order, then verify the
-- binding did not move. Behavior is otherwise unchanged (same refusals, same writes).
--
-- ROLLBACK: restore the previous definition from 20261011232647_coupons_operations_and_phase1.sql.

create or replace function public.release_coupon_assignment(
  _assignment_id uuid, _reason text, _actor_user_id uuid default null::uuid
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_asg         public.coupon_assignments%rowtype;
  v_pricing     public.campaign_pricing%rowtype;
  v_status      text;
  v_campaign_id uuid;
begin
  -- Discover the binding WITHOUT locking, then lock campaign -> round -> assignment.
  select bound_campaign_id into v_campaign_id
    from public.coupon_assignments where id = _assignment_id;
  if not found then raise exception 'release: assignment not found'; end if;

  if v_campaign_id is not null then
    select status into v_status from public.campaigns where id = v_campaign_id for update;
    select * into v_pricing from public.campaign_pricing
     where campaign_id = v_campaign_id and superseded_at is null for update;
  end if;

  select * into v_asg from public.coupon_assignments where id = _assignment_id for update;
  if v_asg.state <> 'bound' then raise exception 'release: assignment is not bound'; end if;
  if v_asg.bound_campaign_id is distinct from v_campaign_id then
    raise exception 'release: assignment changed';
  end if;

  if public.campaign_has_payment_activity(v_asg.bound_campaign_id) then
    raise exception 'release: the campaign has money movement';
  end if;

  if v_pricing.id is not null and v_pricing.locked_at is null then
    update public.campaign_pricing
       set discount_amount = 0, package_price = list_price, coupon_assignment_id = null
     where id = v_pricing.id;
  elsif v_pricing.id is not null and v_pricing.locked_at is not null and v_status <> 'cancelled' then
    -- A locked price is released only when its campaign was cancelled (D17); anything else is refused.
    raise exception 'release: pricing is locked';
  end if;

  update public.coupon_assignments
     set state = case when expires_at <= now() then 'void' else 'assigned' end,
         bound_campaign_id = null
   where id = _assignment_id;
  insert into public.coupon_assignment_events (assignment_id, action, actor_user_id, reason)
    values (_assignment_id, 'released', _actor_user_id, _reason);
end $$;
