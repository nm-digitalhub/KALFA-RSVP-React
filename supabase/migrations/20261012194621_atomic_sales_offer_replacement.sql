-- D23: release, void, insert frozen options and re-bind in one RPC transaction.
-- Only service_role may invoke. No table/column changes and no external side effects.
create or replace function public.replace_sales_coupon_assignment(
  _old_assignment_id uuid, _call_attempt_id uuid, _phone_e164 text,
  _offer_id uuid, _objection_reason text, _options jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.coupon_assignments%rowtype;
  v_offer public.offers%rowtype;
  v_campaign_id uuid;
  v_round public.campaign_pricing%rowtype;
  v_new_id uuid;
  v_option record;
  v_price numeric;
  v_value numeric;
  v_discount numeric;
  v_promised numeric;
  v_improves boolean := false;
  v_count integer;
  v_result text;
begin
  if _old_assignment_id is null or _call_attempt_id is null or _offer_id is null
     or _phone_e164 is null or _phone_e164 !~ '^\+[0-9]{8,15}$'
     or _objection_reason is null or length(trim(_objection_reason)) not between 1 and 300
     or _options is null or jsonb_typeof(_options) <> 'array' then
    raise exception 'replacement: invalid arguments';
  end if;
  if jsonb_array_length(_options) not between 1 and 50 then
    raise exception 'replacement: invalid options';
  end if;
  if not exists (select 1 from public.sales_call_attempts
                 where id = _call_attempt_id and token_expires_at > now()) then
    raise exception 'replacement: call unavailable';
  end if;

  -- Discover binding without locking it; then lock campaign -> current round -> assignment.
  select bound_campaign_id into v_campaign_id
    from public.coupon_assignments where id = _old_assignment_id;
  if not found then raise exception 'replacement: assignment not found'; end if;
  if v_campaign_id is not null then
    perform 1 from public.campaigns where id = v_campaign_id for update;
    if not found then raise exception 'replacement: campaign not found'; end if;
    select * into v_round from public.campaign_pricing
      where campaign_id = v_campaign_id and superseded_at is null for update;
    if not found or v_round.locked_at is not null then
      raise exception 'replacement: pricing unavailable or locked';
    end if;
    if exists (select 1 from public.payment_operations
               where campaign_id = v_campaign_id and kind = 'package_purchase'
                 and outcome in ('pending', 'review', 'succeeded')) then
      raise exception 'replacement: held by payment';
    end if;
  end if;
  select * into v_old from public.coupon_assignments where id = _old_assignment_id for update;
  if not found or v_old.state not in ('assigned', 'bound') or v_old.expires_at <= now()
     or v_old.phone_e164 is distinct from _phone_e164
     or v_old.bound_campaign_id is distinct from v_campaign_id then
    raise exception 'replacement: assignment changed or unavailable';
  end if;
  if exists (select 1 from public.coupon_assignments where sales_call_attempt_id = _call_attempt_id) then
    raise exception 'replacement: call already has an assignment';
  end if;
  select * into v_offer from public.offers where id = _offer_id for share;
  if not found or not v_offer.is_active or not v_offer.allow_agent or not v_offer.may_replace
     or v_offer.id = v_old.offer_id then
    raise exception 'replacement: offer unavailable';
  end if;
  if cardinality(v_offer.agent_objections) > 0 and not exists (
    select 1 from unnest(v_offer.agent_objections) as objections(value)
    where length(trim(value)) > 0 and (
      position(lower(trim(value)) in lower(trim(_objection_reason))) > 0
      or position(lower(trim(_objection_reason)) in lower(trim(value))) > 0
    )
  ) then raise exception 'replacement: objection does not match'; end if;

  -- Hold allowed rows and current package prices through commit, in UUID order.
  perform 1 from public.offer_packages where offer_id = _offer_id order by package_id for share;
  perform 1 from public.packages
    where id in (select package_id from public.offer_packages where offer_id = _offer_id)
    order by id for share;
  select count(*) into v_count from public.offer_packages where offer_id = _offer_id;
  if v_count <> jsonb_array_length(_options) or v_count = 0
     or (select count(distinct item.package_id)
         from jsonb_to_recordset(_options) as item(package_id uuid)) <> v_count then
    raise exception 'replacement: package set changed';
  end if;
  for v_option in select * from jsonb_to_recordset(_options)
      as item(package_id uuid, list_price numeric, discount_amount numeric, final_price numeric)
  loop
    select p.price_with_vat, coalesce(op.value_override, v_offer.value)
      into v_price, v_value
      from public.offer_packages op join public.packages p on p.id = op.package_id
      where op.offer_id = _offer_id and op.package_id = v_option.package_id;
    if not found then raise exception 'replacement: package not allowed'; end if;
    v_discount := round(case when v_offer.kind = 'percent' then v_price * v_value / 100 else v_value end, 2);
    if v_option.list_price is distinct from v_price
       or v_option.discount_amount is distinct from v_discount
       or v_option.final_price is distinct from round(v_price - v_discount, 2)
       or v_option.final_price <= 0 then
      raise exception 'replacement: price changed or invalid';
    end if;
    select final_price into v_promised from public.coupon_assignment_options
      where assignment_id = v_old.id and package_id = v_option.package_id;
    if found then
      if v_option.final_price > v_promised then raise exception 'replacement: price would worsen'; end if;
      if v_option.final_price < v_promised then v_improves := true; end if;
    end if;
  end loop;
  if not v_improves then raise exception 'replacement: no shared package improves'; end if;

  -- A failure in ANY following statement rolls back ALL preceding mutations in this call.
  if v_campaign_id is not null then
    perform public.release_coupon_assignment(v_old.id, 'replaced by escalation (D23)');
  end if;
  update public.coupon_assignments set state = 'void', bound_campaign_id = null where id = v_old.id;
  insert into public.coupon_assignment_events(assignment_id, action, reason)
    values (v_old.id, 'voided', 'escalation_replaced');
  insert into public.coupon_assignments(
    offer_id, sales_call_attempt_id, phone_e164, user_id, claimed_at,
    kind, value, expires_at, idempotency_key
  ) values (
    v_offer.id, _call_attempt_id, _phone_e164, v_old.user_id, v_old.claimed_at,
    v_offer.kind, v_offer.value, now() + v_offer.validity_days * interval '1 day', _call_attempt_id::text
  ) returning id into v_new_id;
  insert into public.coupon_assignment_options(assignment_id, package_id, list_price, discount_amount, final_price)
    select v_new_id, item.package_id, item.list_price, item.discount_amount, item.final_price
    from jsonb_to_recordset(_options)
      as item(package_id uuid, list_price numeric, discount_amount numeric, final_price numeric);
  insert into public.coupon_assignment_events(assignment_id, action, reason)
    values (v_new_id, 'assigned', _objection_reason);
  if v_campaign_id is not null then
    v_result := public.bind_coupon_assignment(v_new_id, v_campaign_id);
    if v_result <> 'bound' then
      raise exception 'replacement: campaign package has no replacement option';
    end if;
  end if;
  return v_new_id;
end $$;

revoke all on function public.replace_sales_coupon_assignment(uuid, uuid, text, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_sales_coupon_assignment(uuid, uuid, text, uuid, text, jsonb)
  to service_role;
