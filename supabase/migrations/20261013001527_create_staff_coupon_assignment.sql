-- personal-coupons-admin-panel ד.2 (AD9): staff-assignment creation becomes ONE database
-- transaction — the assignment, every frozen option and the 'assigned' event commit
-- together, the CONFIRMED preview terms are validated in here against live offer/prices
-- under locks, idempotency is bound to the original request, and the duplicate rule
-- (keep the later-expiring identical assignment) runs inside the same transaction. The
-- TS delete-on-partial-failure compensation is retired by the caller.
--
-- Lock order: offer+packages FOR SHARE (price stability through commit) → the new row's
-- writes. No campaign/round locks are needed here (nothing binds at create time), so the
-- canonical campaign→round→assignment order is not in play. Rounding matches
-- computeOfferOption (decimal.js ROUND_HALF_UP ≡ numeric round() for positives) — the
-- same equivalence verified for replace_sales_coupon_assignment.
--
-- Returns the assignment to SHOW: jsonb { assignment_id, kept_assignment_id, outcome
-- ('created'|'existing'), duplicate_voided ('none'|'new'|'previous'), expires_at }.
-- service_role-only.
--
-- ROLLBACK: drop function public.create_staff_coupon_assignment(uuid, uuid, uuid, text, jsonb);

create or replace function public.create_staff_coupon_assignment(
  _staff_id uuid,
  _user_id uuid,
  _offer_id uuid,
  _idempotency_key text,
  _confirmed_options jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer      public.offers%rowtype;
  v_existing   public.coupon_assignments%rowtype;
  v_option     record;
  v_price      numeric;
  v_value      numeric;
  v_discount   numeric;
  v_final      numeric;
  v_count      integer;
  v_new_id     uuid;
  v_expires_at timestamptz;
  v_dup        record;
  v_dup_voided text := 'none';
  v_kept_id    uuid;
begin
  if _staff_id is null or _user_id is null or _offer_id is null
     or _idempotency_key is null or length(trim(_idempotency_key)) not between 1 and 120
     or _confirmed_options is null or jsonb_typeof(_confirmed_options) <> 'array'
     or jsonb_array_length(_confirmed_options) not between 1 and 50 then
    raise exception 'assign: invalid arguments';
  end if;
  if not exists (select 1 from auth.users where id = _user_id) then
    raise exception 'assign: account not found';
  end if;

  -- Idempotency bound to the REQUEST: the same key answers the stored assignment; a
  -- replay carrying a different target or offer is refused, never an "existing success".
  select * into v_existing from public.coupon_assignments
   where assigned_by = _staff_id and idempotency_key = _idempotency_key;
  if found then
    if v_existing.user_id is distinct from _user_id or v_existing.offer_id is distinct from _offer_id then
      raise exception 'assign: key already used for a different request';
    end if;
    return jsonb_build_object(
      'assignment_id', v_existing.id,
      'kept_assignment_id', v_existing.id,
      'outcome', 'existing',
      'duplicate_voided', 'none',
      'expires_at', v_existing.expires_at
    );
  end if;

  select * into v_offer from public.offers where id = _offer_id for share;
  if not found or not v_offer.is_active then raise exception 'assign: offer unavailable'; end if;
  if not v_offer.allow_staff then raise exception 'assign: offer is not staff-assignable'; end if;

  -- Hold the allowed rows and the current package prices through commit, in id order.
  perform 1 from public.offer_packages where offer_id = _offer_id order by package_id for share;
  perform 1 from public.packages
    where id in (select package_id from public.offer_packages where offer_id = _offer_id)
    order by id for share;

  select count(*) into v_count from public.offer_packages where offer_id = _offer_id;
  if v_count = 0 then raise exception 'assign: offer has no packages'; end if;
  if v_count <> jsonb_array_length(_confirmed_options)
     or (select count(distinct item.package_id)
         from jsonb_to_recordset(_confirmed_options) as item(package_id uuid)) <> v_count then
    raise exception 'assign: terms changed';
  end if;

  -- The CONFIRMED preview must equal the terms about to be frozen — recomputed HERE from
  -- live prices under the share locks; any drift refuses with nothing persisted.
  for v_option in select * from jsonb_to_recordset(_confirmed_options)
      as item(package_id uuid, list_price numeric, discount_amount numeric, final_price numeric)
  loop
    select p.price_with_vat, coalesce(op.value_override, v_offer.value)
      into v_price, v_value
      from public.offer_packages op join public.packages p on p.id = op.package_id
      where op.offer_id = _offer_id and op.package_id = v_option.package_id;
    if not found then raise exception 'assign: terms changed'; end if;
    v_discount := round(case when v_offer.kind = 'percent' then v_price * v_value / 100 else v_value end, 2);
    v_final := round(v_price - v_discount, 2);
    if v_option.list_price is distinct from v_price
       or v_option.discount_amount is distinct from v_discount
       or v_option.final_price is distinct from v_final
       or v_final <= 0 then
      raise exception 'assign: terms changed';
    end if;
  end loop;

  v_expires_at := now() + v_offer.validity_days * interval '1 day';

  insert into public.coupon_assignments (offer_id, assigned_by, user_id, kind, value, expires_at, idempotency_key)
    values (v_offer.id, _staff_id, _user_id, v_offer.kind, v_offer.value, v_expires_at, _idempotency_key)
    returning id into v_new_id;

  insert into public.coupon_assignment_options (assignment_id, package_id, list_price, discount_amount, final_price)
    select v_new_id, item.package_id, item.list_price, item.discount_amount, item.final_price
    from jsonb_to_recordset(_confirmed_options)
      as item(package_id uuid, list_price numeric, discount_amount numeric, final_price numeric);

  insert into public.coupon_assignment_events (assignment_id, action, actor_user_id, reason)
    values (v_new_id, 'assigned', _staff_id, null);

  -- D18's duplicate rule, INSIDE the same transaction: an identical option set (same
  -- packages, same final prices in whole agorot) may not stay twice on the account —
  -- the sooner-expiring ASSIGNED one is voided with an audited reason. Bound duplicates
  -- are left alone (their campaign relies on them).
  v_kept_id := v_new_id;
  select a.id, a.expires_at into v_dup
  from public.coupon_assignments a
  where a.user_id = _user_id and a.state = 'assigned' and a.id <> v_new_id
    and a.expires_at > now()
    and not exists (
      select 1 from (
        select o.package_id, round(o.final_price * 100) as agorot
        from public.coupon_assignment_options o where o.assignment_id = a.id
        union all
        select item.package_id, round(item.final_price * 100)
        from jsonb_to_recordset(_confirmed_options)
          as item(package_id uuid, final_price numeric)
      ) sides
      group by sides.package_id, sides.agorot
      having count(*) <> 2
    )
    and (select count(*) from public.coupon_assignment_options o where o.assignment_id = a.id)
        = jsonb_array_length(_confirmed_options)
  order by a.created_at asc
  limit 1;
  if found then
    if v_expires_at >= v_dup.expires_at then
      update public.coupon_assignments set state = 'void' where id = v_dup.id and state = 'assigned';
      insert into public.coupon_assignment_events (assignment_id, action, actor_user_id, reason)
        values (v_dup.id, 'voided', _staff_id, 'duplicate');
      v_dup_voided := 'previous';
    else
      update public.coupon_assignments set state = 'void' where id = v_new_id;
      insert into public.coupon_assignment_events (assignment_id, action, actor_user_id, reason)
        values (v_new_id, 'voided', _staff_id, 'duplicate');
      v_dup_voided := 'new';
      v_kept_id := v_dup.id;
    end if;
  end if;

  return jsonb_build_object(
    'assignment_id', v_new_id,
    'kept_assignment_id', v_kept_id,
    'outcome', 'created',
    'duplicate_voided', v_dup_voided,
    'expires_at', v_expires_at
  );
end $$;

revoke all on function public.create_staff_coupon_assignment(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_staff_coupon_assignment(uuid, uuid, uuid, text, jsonb)
  to service_role;
