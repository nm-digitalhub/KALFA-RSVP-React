-- Dry run of public.close_event_retiring_setup (migration 20261027211431, design D7, task 2.2).
--
-- Run by the owner AFTER `supabase db push --linked`, as one request in the SQL editor (role postgres).
-- Everything happens inside ONE transaction that ends in ROLLBACK: the fixtures, the calls and their effects are
-- never kept. Any failed check raises "DRY RUN FAILED: ..." and the transaction is rolled back with it.
-- Success ends with the notice "DRY RUN PASSED".
--
-- The calls run as service_role, the role the application's admin client really uses. The fixtures are owned by a
-- platform staff account, because R10 (one event per customer account) exempts staff. Who may close is decided before the
-- call, by the application gate (can_access_event, events.close); the function records p_actor and holds the business
-- rules, so the results are the same as for a customer.
--
-- Checks:
--    1  an unknown event -> not_found
--    2  pending_approval -> closed, the campaign cancelled, ONE audit row (event.closed, the owner, retiredCampaignId,
--       statusBefore), no campaign.cancelled row and no staff access row
--    3  approved with a declined payment -> closed; the declined payment row and the locked pricing round still exist
--    4  payment pending -> blocked_money, nothing changes
--    5  payment in review -> blocked_money, nothing changes
--    6  real money succeeded -> blocked_paid, nothing changes
--    7  test money succeeded -> blocked_paid, nothing changes
--    8  a running (active) service -> blocked_paid, nothing changes
--    9  no service -> closed, audit meta empty; a second call -> already_closed, no second audit row
--   10  a draft event with a draft campaign -> closed and retired
--   11  approved with a bound benefit -> closed; the benefit is back to assigned and unbound, a release event names the
--       owner, and the locked pricing round is unchanged
--   12  anon and authenticated cannot execute the function; service_role can
--   13  events.close is protected: every organization's owner role holds it, and granting it to another role is refused

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function pg_temp.dr_event(p_owner uuid, p_active boolean)
returns uuid
language plpgsql
as $f$
declare
  v uuid;
begin
  insert into public.events (owner_id, name, event_date)
  values (p_owner, 'dry run close_event_retiring_setup', now() + interval '30 days')
  returning id into v;

  if p_active then
    update public.events set status = 'active' where id = v;
  end if;

  return v;
end
$f$;

-- A campaign in the given status. A non-draft one gets a pricing round, so `approved` locks it as in production.
create function pg_temp.dr_campaign(p_event uuid, p_status public.campaign_status, p_assignment uuid default null)
returns uuid
language plpgsql
as $f$
declare
  v uuid;
begin
  insert into public.campaigns (event_id, max_contacts, status)
  values (p_event, 10, case when p_status = 'approved' then 'pending_approval'::public.campaign_status else p_status end)
  returning id into v;

  if p_status <> 'draft' then
    insert into public.campaign_pricing (campaign_id, list_price, discount_amount, package_price, coupon_assignment_id)
    values (v, 100, case when p_assignment is null then 0 else 10 end,
            case when p_assignment is null then 100 else 90 end, p_assignment);
  end if;

  if p_status = 'approved' then
    update public.campaigns set status = 'approved' where id = v;
  end if;

  return v;
end
$f$;

create function pg_temp.dr_pay(p_campaign uuid, p_outcome public.payment_operation_outcome, p_test boolean)
returns void
language plpgsql
as $f$
begin
  insert into public.payment_operations (campaign_id, event_id, kind, outcome, amount, provider, provider_terminal)
  select c.id, c.event_id, 'package_purchase', p_outcome, 100,
         case when p_test then 'cardcom' else 'sumit' end,
         case when p_test then 1000 else null end
    from public.campaigns c
   where c.id = p_campaign;
end
$f$;

create function pg_temp.dr_call(p_event uuid, p_actor uuid)
returns text
language plpgsql
as $f$
declare
  r text;
begin
  set local role service_role;
  r := public.close_event_retiring_setup(p_event, p_actor);
  reset role;
  return r;
end
$f$;

create function pg_temp.dr_check(p_ok boolean, p_label text)
returns void
language plpgsql
as $f$
begin
  if p_ok is distinct from true then
    raise exception 'DRY RUN FAILED: %', p_label;
  end if;
  raise notice 'ok: %', p_label;
end
$f$;

-- A refusal: the given result, the event still open and the campaign still in its status, and no audit row.
create function pg_temp.dr_refused(p_event uuid, p_campaign uuid, p_actor uuid, p_expected text, p_label text)
returns void
language plpgsql
as $f$
declare
  v_status_before public.campaign_status := (select status from public.campaigns where id = p_campaign);
  v_event_before  public.event_status    := (select status from public.events where id = p_event);
  r text;
begin
  r := pg_temp.dr_call(p_event, p_actor);
  perform pg_temp.dr_check(r = p_expected, format('%s -> %s (got %s)', p_label, p_expected, r));
  perform pg_temp.dr_check(
    (select status from public.events where id = p_event) = v_event_before
      and (select status from public.campaigns where id = p_campaign) = v_status_before
      and not exists (select 1 from public.activity_log a where a.event_id = p_event and a.action = 'event.closed'),
    p_label || ': nothing changed');
end
$f$;

do $$
declare
  v_owner   uuid;
  e         uuid;
  c         uuid;
  v_offer   uuid;
  v_asg     uuid;
  r         text;
  v_refused boolean := false;
begin
  select s.user_id into v_owner from public.platform_staff s order by s.user_id limit 1;
  perform pg_temp.dr_check(v_owner is not null, 'a staff account exists to own the fixtures');

  -- 1
  r := pg_temp.dr_call(gen_random_uuid(), v_owner);
  perform pg_temp.dr_check(r = 'not_found', '1 an unknown event -> not_found (got ' || r || ')');

  -- 2
  e := pg_temp.dr_event(v_owner, true);
  c := pg_temp.dr_campaign(e, 'pending_approval');
  r := pg_temp.dr_call(e, v_owner);
  perform pg_temp.dr_check(r = 'closed', '2 pending_approval -> closed (got ' || r || ')');
  perform pg_temp.dr_check((select status from public.events where id = e) = 'closed', '2 event closed');
  perform pg_temp.dr_check((select status from public.campaigns where id = c) = 'cancelled', '2 campaign cancelled');
  perform pg_temp.dr_check(
    (select count(*) from public.activity_log a
      where a.event_id = e and a.action = 'event.closed' and a.user_id = v_owner
        and a.meta = jsonb_build_object('retiredCampaignId', c, 'statusBefore', 'pending_approval')) = 1
    and (select count(*) from public.activity_log a where a.event_id = e) = 1,
    '2 exactly one audit row, naming the owner, the service and its prior status');
  perform pg_temp.dr_check(
    not exists (select 1 from public.support_access_log l where l.event_id = e),
    '2 no staff access row');

  -- 3
  e := pg_temp.dr_event(v_owner, true);
  c := pg_temp.dr_campaign(e, 'approved');
  perform pg_temp.dr_pay(c, 'failed', false);
  r := pg_temp.dr_call(e, v_owner);
  perform pg_temp.dr_check(r = 'closed', '3 declined payment -> closed (got ' || r || ')');
  perform pg_temp.dr_check((select status from public.campaigns where id = c) = 'cancelled', '3 campaign cancelled');
  perform pg_temp.dr_check(
    exists (select 1 from public.payment_operations o where o.campaign_id = c and o.outcome = 'failed')
    and exists (select 1 from public.campaign_pricing p where p.campaign_id = c and p.locked_at is not null),
    '3 the declined payment and the locked pricing round are kept');

  -- 4
  e := pg_temp.dr_event(v_owner, true);
  c := pg_temp.dr_campaign(e, 'approved');
  perform pg_temp.dr_pay(c, 'pending', false);
  perform pg_temp.dr_refused(e, c, v_owner, 'blocked_money', '4 payment pending');

  -- 5
  e := pg_temp.dr_event(v_owner, true);
  c := pg_temp.dr_campaign(e, 'approved');
  perform pg_temp.dr_pay(c, 'review', false);
  perform pg_temp.dr_refused(e, c, v_owner, 'blocked_money', '5 payment in review');

  -- 6
  e := pg_temp.dr_event(v_owner, true);
  c := pg_temp.dr_campaign(e, 'approved');
  perform pg_temp.dr_pay(c, 'succeeded', false);
  perform pg_temp.dr_refused(e, c, v_owner, 'blocked_paid', '6 real money succeeded');

  -- 7
  e := pg_temp.dr_event(v_owner, true);
  c := pg_temp.dr_campaign(e, 'approved');
  perform pg_temp.dr_pay(c, 'succeeded', true);
  perform pg_temp.dr_check(
    (select bool_and(o.is_test) from public.payment_operations o where o.campaign_id = c),
    '7 the fixture payment is classified as test money');
  perform pg_temp.dr_refused(e, c, v_owner, 'blocked_paid', '7 test money succeeded');

  -- 8
  e := pg_temp.dr_event(v_owner, true);
  c := pg_temp.dr_campaign(e, 'active');
  perform pg_temp.dr_refused(e, c, v_owner, 'blocked_paid', '8 a running service');

  -- 9
  e := pg_temp.dr_event(v_owner, true);
  r := pg_temp.dr_call(e, v_owner);
  perform pg_temp.dr_check(r = 'closed', '9 no service -> closed (got ' || r || ')');
  perform pg_temp.dr_check(
    (select count(*) from public.activity_log a
      where a.event_id = e and a.action = 'event.closed' and a.user_id = v_owner and a.meta = '{}'::jsonb) = 1,
    '9 one audit row with empty meta');
  r := pg_temp.dr_call(e, v_owner);
  perform pg_temp.dr_check(r = 'already_closed', '9 second call -> already_closed (got ' || r || ')');
  perform pg_temp.dr_check(
    (select count(*) from public.activity_log a where a.event_id = e) = 1,
    '9 no second audit row');

  -- 10
  e := pg_temp.dr_event(v_owner, false);
  c := pg_temp.dr_campaign(e, 'draft');
  r := pg_temp.dr_call(e, v_owner);
  perform pg_temp.dr_check(r = 'closed', '10 draft event with a draft campaign -> closed (got ' || r || ')');
  perform pg_temp.dr_check((select status from public.campaigns where id = c) = 'cancelled', '10 draft campaign cancelled');

  -- 11
  insert into public.offers (title, kind, value, validity_days)
  values ('dry run close_event_retiring_setup', 'amount', 10, 30)
  returning id into v_offer;

  e := pg_temp.dr_event(v_owner, true);
  -- The campaign first, then the assignment bound to it, then its pricing round with the discount.
  insert into public.campaigns (event_id, max_contacts, status)
  values (e, 10, 'pending_approval')
  returning id into c;

  insert into public.coupon_assignments
    (offer_id, assigned_by, user_id, kind, value, expires_at, idempotency_key, state, bound_campaign_id)
  values
    (v_offer, v_owner, v_owner, 'amount', 10, now() + interval '30 days',
     'dry-run-close-' || gen_random_uuid()::text, 'bound', c)
  returning id into v_asg;

  insert into public.campaign_pricing (campaign_id, list_price, discount_amount, package_price, coupon_assignment_id)
  values (c, 100, 10, 90, v_asg);

  update public.campaigns set status = 'approved' where id = c;

  r := pg_temp.dr_call(e, v_owner);
  perform pg_temp.dr_check(r = 'closed', '11 bound benefit -> closed (got ' || r || ')');
  perform pg_temp.dr_check(
    (select a.state = 'assigned' and a.bound_campaign_id is null from public.coupon_assignments a where a.id = v_asg),
    '11 the benefit is assigned again and unbound');
  perform pg_temp.dr_check(
    exists (select 1 from public.coupon_assignment_events x
             where x.assignment_id = v_asg and x.action = 'released'
               and x.actor_user_id = v_owner and x.reason = 'campaign_cancelled'),
    '11 a release event names the owner');
  perform pg_temp.dr_check(
    (select p.locked_at is not null and p.discount_amount = 10 and p.package_price = 90
            and p.coupon_assignment_id = v_asg
       from public.campaign_pricing p where p.campaign_id = c and p.superseded_at is null),
    '11 the locked pricing round is unchanged');

  -- 12
  perform pg_temp.dr_check(
    not has_function_privilege('anon', 'public.close_event_retiring_setup(uuid,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.close_event_retiring_setup(uuid,uuid)', 'execute')
    and has_function_privilege('service_role', 'public.close_event_retiring_setup(uuid,uuid)', 'execute'),
    '12 only service_role can execute');

  -- 13
  perform pg_temp.dr_check(
    (select p.system_protected from public.permission_definitions p where p.resource = 'events' and p.action = 'close')
    and not exists (
      select 1 from public.organizations o
       where not exists (select 1 from public.organization_role_permissions orp
                           join public.org_roles ro on ro.id = orp.role_id
                           join public.permission_definitions p on p.id = orp.permission_id
                          where orp.organization_id = o.id and ro.is_owner_role
                            and p.resource = 'events' and p.action = 'close')),
    '13 events.close is protected and every owner role holds it');
  begin
    insert into public.organization_role_permissions (organization_id, role_id, permission_id)
    select o.id, ro.id, p.id
      from public.organizations o
     cross join public.org_roles ro
     cross join public.permission_definitions p
     where not ro.is_owner_role and p.resource = 'events' and p.action = 'close'
     limit 1;
  exception when others then
    v_refused := true;
  end;
  perform pg_temp.dr_check(v_refused, '13 granting events.close to a non-owner role is refused');

  raise notice 'DRY RUN PASSED';
end
$$;

rollback;
