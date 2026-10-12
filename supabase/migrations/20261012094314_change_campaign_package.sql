-- personal-coupons task 5.3 — the package change before approval (D5/D17), in ONE transaction.
--
-- The customer may change the chosen package while the campaign is still pending_approval. The spec's rule
-- (coupon-assignments, "The customer switches package before approval"): the pricing moves to the new package's
-- option in one transaction, and no second assignment is created. The move itself is bind_coupon_assignment's job
-- (D17: "inside bind_coupon_assignment, never by hand") — this function updates the campaign and its CURRENT,
-- UNLOCKED pricing row to the new package, then hands the already-bound assignment back to bind_coupon_assignment
-- in the SAME transaction: the benefit lands on the new package's frozen option, or is unbound when the new
-- package has no option (D5 — the price returns to the new list price).
--
-- Locks in the D6 order: campaign → pricing → assignment (bind_coupon_assignment takes the assignment lock).
-- A locked round is refused — past approval the only path is the supersede operation (D21/D22).
--
-- ROLLBACK: drop function public.change_campaign_package(uuid, uuid, numeric, integer, public.campaign_channel[], jsonb, uuid);

set local lock_timeout = '5s';

create or replace function public.change_campaign_package(
  _campaign_id uuid,
  _template_id uuid,
  _list_price numeric,
  _contact_quota integer,
  _allowed_channels public.campaign_channel[],
  _outreach_schedule jsonb,
  _actor_user_id uuid default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign    record;
  v_pricing     public.campaign_pricing%rowtype;
  v_assignment  uuid;
  v_bind        text := 'none';
begin
  select id, status, template_id into v_campaign
    from public.campaigns where id = _campaign_id for update;
  if not found then raise exception 'change_package: campaign not found'; end if;
  if v_campaign.status <> 'pending_approval' then
    raise exception 'change_package: campaign status is %', v_campaign.status;
  end if;

  select * into v_pricing from public.campaign_pricing
   where campaign_id = _campaign_id and superseded_at is null for update;
  if not found then raise exception 'change_package: no current pricing row'; end if;
  if v_pricing.locked_at is not null then
    raise exception 'change_package: pricing is locked';
  end if;

  if v_campaign.template_id = _template_id then return 'unchanged'; end if;

  v_assignment := v_pricing.coupon_assignment_id;

  update public.campaigns
     set template_id = _template_id,
         contact_quota = _contact_quota,
         allowed_channels = _allowed_channels,
         outreach_schedule = _outreach_schedule
   where id = _campaign_id;

  -- The new package's list price, no discount; the mirror keeps campaigns.package_price equal in this same
  -- transaction. bind_coupon_assignment below overwrites these with the option's FROZEN prices when one exists.
  update public.campaign_pricing
     set list_price = _list_price,
         discount_amount = 0,
         package_price = _list_price,
         coupon_assignment_id = null
   where id = v_pricing.id;

  -- D5/D17: the bound benefit follows the package change in the SAME transaction — to the new package's option,
  -- or back to assigned when the new package has no option. No second assignment is ever created here.
  if v_assignment is not null then
    -- An EXPIRED bound benefit must not fail the package change (bind would raise): it is released to void here
    -- (the same expiry rule release_coupon_assignment applies), and the new list price stands.
    perform 1 from public.coupon_assignments
      where id = v_assignment and expires_at <= now() for update;
    if found then
      update public.coupon_assignments
         set state = 'void', bound_campaign_id = null
       where id = v_assignment;
      insert into public.coupon_assignment_events (assignment_id, action, actor_user_id, reason)
        values (v_assignment, 'released', _actor_user_id, 'package changed; assignment expired');
      v_bind := 'expired_released';
    else
      -- bind reads the round's coupon_assignment_id (cleared above) and the campaign's NEW template_id.
      -- 'bound' (an option exists — the discount moved) or 'no_option' (unbound; list price stands). A consumed or
      -- void state raises inside bind and rolls the whole change back — such an assignment can never sit on an
      -- unlocked round, so that raise marks data damage, not a user path.
      v_bind := public.bind_coupon_assignment(v_assignment, _campaign_id, _actor_user_id);
    end if;
  end if;

  return v_bind;
end $$;

revoke all on function public.change_campaign_package(uuid, uuid, numeric, integer, public.campaign_channel[], jsonb, uuid) from public, anon, authenticated;
grant execute on function public.change_campaign_package(uuid, uuid, numeric, integer, public.campaign_channel[], jsonb, uuid) to service_role;
