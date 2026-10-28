-- pgTAP test for public.close_event_retiring_setup.
-- Run locally:
--   npx supabase test db --local supabase/tests/database/close_event_retiring_setup_test.sql
--
-- The test creates temporary fixtures and rolls back the entire transaction.
-- It is not a migration and must not be placed in supabase/migrations.

begin;

create extension if not exists pgtap with schema extensions;

select plan(33);

-- A temporary platform staff actor. The owner role is seeded by the migrations.
insert into auth.users (id, email)
values (
  '00000000-0000-4000-8000-00000000d901',
  'close-event-d901@test.invalid'
);

insert into public.platform_staff (user_id, role_id, granted_by)
select
  '00000000-0000-4000-8000-00000000d901',
  r.id,
  '00000000-0000-4000-8000-00000000d901'
from public.platform_roles r
where r.name = 'owner';

-- Fixture helper: create an event owned by the test staff actor.
create function pg_temp.dr_event(p_owner uuid, p_active boolean)
returns uuid
language plpgsql
as $f$
declare
  v uuid;
begin
  insert into public.events (owner_id, name, event_date)
  values (p_owner, 'pgTAP close_event_retiring_setup', now() + interval '30 days')
  returning id into v;

  if p_active then
    update public.events
       set status = 'active'
     where id = v;
  end if;

  return v;
end
$f$;

-- Fixture helper: create a campaign. Non-draft campaigns get a pricing round.
create function pg_temp.dr_campaign(p_event uuid, p_status public.campaign_status)
returns uuid
language plpgsql
as $f$
declare
  v uuid;
begin
  insert into public.campaigns (event_id, max_contacts, status)
  values (
    p_event,
    10,
    case
      when p_status = 'approved' then 'pending_approval'::public.campaign_status
      else p_status
    end
  )
  returning id into v;

  if p_status <> 'draft' then
    insert into public.campaign_pricing
      (campaign_id, list_price, discount_amount, package_price)
    values (v, 100, 0, 100);
  end if;

  if p_status = 'approved' then
    update public.campaigns
       set status = 'approved'
     where id = v;
  end if;

  return v;
end
$f$;

-- Fixture helper: add a payment operation to a campaign.
create function pg_temp.dr_pay(
  p_campaign uuid,
  p_outcome public.payment_operation_outcome,
  p_test boolean
)
returns void
language plpgsql
as $f$
begin
  insert into public.payment_operations
    (campaign_id, event_id, kind, outcome, amount, provider, provider_terminal)
  select
    c.id,
    c.event_id,
    'package_purchase',
    p_outcome,
    100,
    case when p_test then 'cardcom' else 'sumit' end,
    case when p_test then 1000 else null end
  from public.campaigns c
  where c.id = p_campaign;
end
$f$;

-- Call the invoker function with the same database role as the admin client.
create function pg_temp.dr_call(p_event uuid, p_actor uuid)
returns text
language plpgsql
as $f$
declare
  v_role text := current_user;
  r text;
begin
  perform set_config('role', 'service_role', true);
  r := public.close_event_retiring_setup(p_event, p_actor);
  perform set_config('role', v_role, true);
  return r;
end
$f$;

-- A refusal must return the expected answer and leave the event, campaign,
-- and activity log unchanged.
create function pg_temp.dr_refused(
  p_event uuid,
  p_campaign uuid,
  p_actor uuid,
  p_expected text,
  p_label text
)
returns setof text
language plpgsql
as $f$
declare
  v_status_before public.campaign_status;
  v_event_before public.event_status;
  r text;
begin
  select c.status into v_status_before
    from public.campaigns c
   where c.id = p_campaign;

  select e.status into v_event_before
    from public.events e
   where e.id = p_event;

  r := pg_temp.dr_call(p_event, p_actor);

  return next is(
    r,
    p_expected,
    p_label || ': returns ' || p_expected
  );

  return next ok(
    (select e.status from public.events e where e.id = p_event) = v_event_before
    and
    (select c.status from public.campaigns c where c.id = p_campaign) = v_status_before
    and not exists (
      select 1
        from public.activity_log a
       where a.event_id = p_event
         and a.action = 'event.closed'
    ),
    p_label || ': leaves rows and activity log unchanged'
  );
end
$f$;

-- Execute the scenarios and return pgTAP assertions.
create function pg_temp.dr_run()
returns setof text
language plpgsql
as $f$
declare
  v_owner uuid := '00000000-0000-4000-8000-00000000d901';
  e uuid;
  c uuid;
  v_offer uuid;
  v_asg uuid;
  r text;
  v_sqlstate text;
  v_message text;
begin
  if not exists (
    select 1
      from public.platform_staff s
     where s.user_id = v_owner
  ) then
    raise exception 'pgTAP fixture setup failed: the test actor is not platform staff';
  end if;

  -- 1. Unknown event.
  return next is(
    pg_temp.dr_call(gen_random_uuid(), v_owner),
    'not_found',
    '1 unknown event returns not_found'
  );

  -- 2. pending_approval: close event, retire campaign, write one audit row.
  e := pg_temp.dr_event(v_owner, true);
  c := pg_temp.dr_campaign(e, 'pending_approval');
  r := pg_temp.dr_call(e, v_owner);

  return next is(r, 'closed', '2 pending_approval returns closed');

  return next ok(
    (select status from public.events where id = e) = 'closed',
    '2 event is closed'
  );

  return next ok(
    (select status from public.campaigns where id = c) = 'cancelled',
    '2 campaign is cancelled'
  );

  return next ok(
    (select count(*) from public.activity_log a
      where a.event_id = e
        and a.action = 'event.closed'
        and a.user_id = v_owner
        and a.meta = jsonb_build_object(
          'retiredCampaignId', c,
          'statusBefore', 'pending_approval'
        )
    ) = 1
    and
    (select count(*) from public.activity_log a where a.event_id = e) = 1,
    '2 exactly one activity row records actor, campaign, and prior status'
  );

  return next ok(
    not exists (
      select 1
        from public.support_access_log l
       where l.event_id = e
    ),
    '2 no staff access row is written'
  );

  -- 3. A declined payment does not block closing; its history and locked price remain.
  e := pg_temp.dr_event(v_owner, true);
  c := pg_temp.dr_campaign(e, 'approved');
  perform pg_temp.dr_pay(c, 'failed', false);
  r := pg_temp.dr_call(e, v_owner);

  return next is(r, 'closed', '3 declined payment returns closed');

  return next ok(
    (select status from public.campaigns where id = c) = 'cancelled',
    '3 campaign with declined payment is cancelled'
  );

  return next ok(
    exists (
      select 1
        from public.payment_operations o
       where o.campaign_id = c
         and o.outcome = 'failed'
    )
    and exists (
      select 1
        from public.campaign_pricing p
       where p.campaign_id = c
         and p.locked_at is not null
    ),
    '3 declined payment and locked pricing round are retained'
  );

  -- 4. Payment pending.
  e := pg_temp.dr_event(v_owner, true);
  c := pg_temp.dr_campaign(e, 'approved');
  perform pg_temp.dr_pay(c, 'pending', false);

  return query
    select *
      from pg_temp.dr_refused(e, c, v_owner, 'blocked_money', '4 payment pending');

  -- 5. Payment in review.
  e := pg_temp.dr_event(v_owner, true);
  c := pg_temp.dr_campaign(e, 'approved');
  perform pg_temp.dr_pay(c, 'review', false);

  return query
    select *
      from pg_temp.dr_refused(e, c, v_owner, 'blocked_money', '5 payment in review');

  -- 6. Real payment succeeded.
  e := pg_temp.dr_event(v_owner, true);
  c := pg_temp.dr_campaign(e, 'approved');
  perform pg_temp.dr_pay(c, 'succeeded', false);

  return query
    select *
      from pg_temp.dr_refused(e, c, v_owner, 'blocked_paid', '6 real payment succeeded');

  -- 7. Test payment succeeded; test money also blocks customer close.
  e := pg_temp.dr_event(v_owner, true);
  c := pg_temp.dr_campaign(e, 'approved');
  perform pg_temp.dr_pay(c, 'succeeded', true);

  return next ok(
    (select bool_and(o.is_test) from public.payment_operations o where o.campaign_id = c),
    '7 fixture payment is classified as test money'
  );

  return query
    select *
      from pg_temp.dr_refused(e, c, v_owner, 'blocked_paid', '7 test payment succeeded');

  -- 8. Running service.
  e := pg_temp.dr_event(v_owner, true);
  c := pg_temp.dr_campaign(e, 'active');

  return query
    select *
      from pg_temp.dr_refused(e, c, v_owner, 'blocked_paid', '8 active service');

  -- 9. No service: close once, then answer already_closed without another audit row.
  e := pg_temp.dr_event(v_owner, true);
  r := pg_temp.dr_call(e, v_owner);

  return next is(r, 'closed', '9 no service returns closed');

  return next ok(
    (select count(*) from public.activity_log a
      where a.event_id = e
        and a.action = 'event.closed'
        and a.user_id = v_owner
        and a.meta = '{}'::jsonb
    ) = 1,
    '9 one activity row has empty metadata'
  );

  r := pg_temp.dr_call(e, v_owner);

  return next is(r, 'already_closed', '9 second call returns already_closed');

  return next is(
    (select count(*) from public.activity_log a where a.event_id = e),
    1::bigint,
    '9 second call writes no additional activity row'
  );

  -- 10. Draft event with draft campaign.
  e := pg_temp.dr_event(v_owner, false);
  c := pg_temp.dr_campaign(e, 'draft');
  r := pg_temp.dr_call(e, v_owner);

  return next is(r, 'closed', '10 draft event with draft campaign returns closed');

  return next ok(
    (select status from public.campaigns where id = c) = 'cancelled',
    '10 draft campaign is retired'
  );

  -- 11. A bound benefit is released and the locked pricing round is retained.
  insert into public.offers (title, kind, value, validity_days)
  values ('pgTAP close_event_retiring_setup', 'amount', 10, 30)
  returning id into v_offer;

  e := pg_temp.dr_event(v_owner, true);

  insert into public.campaigns (event_id, max_contacts, status)
  values (e, 10, 'pending_approval')
  returning id into c;

  insert into public.coupon_assignments
    (offer_id, assigned_by, user_id, kind, value, expires_at, idempotency_key, state, bound_campaign_id)
  values
    (v_offer, v_owner, v_owner, 'amount', 10, now() + interval '30 days',
     'pgtap-close-event-' || gen_random_uuid()::text, 'bound', c)
  returning id into v_asg;

  insert into public.campaign_pricing
    (campaign_id, list_price, discount_amount, package_price, coupon_assignment_id)
  values (c, 100, 10, 90, v_asg);

  update public.campaigns
     set status = 'approved'
   where id = c;

  r := pg_temp.dr_call(e, v_owner);

  return next is(r, 'closed', '11 bound benefit returns closed');

  return next ok(
    (select a.state = 'assigned' and a.bound_campaign_id is null
       from public.coupon_assignments a
      where a.id = v_asg),
    '11 benefit is released and unbound'
  );

  return next ok(
    exists (
      select 1
        from public.coupon_assignment_events x
       where x.assignment_id = v_asg
         and x.action = 'released'
         and x.actor_user_id = v_owner
         and x.reason = 'campaign_cancelled'
    ),
    '11 release event records actor and reason'
  );

  return next ok(
    (select p.locked_at is not null
        and p.discount_amount = 10
        and p.package_price = 90
        and p.coupon_assignment_id = v_asg
       from public.campaign_pricing p
      where p.campaign_id = c
        and p.superseded_at is null),
    '11 locked pricing round is unchanged'
  );

  -- 12. EXECUTE is limited to service_role.
  return next ok(
    not has_function_privilege(
      'anon',
      'public.close_event_retiring_setup(uuid,uuid)',
      'execute'
    )
    and not has_function_privilege(
      'authenticated',
      'public.close_event_retiring_setup(uuid,uuid)',
      'execute'
    )
    and has_function_privilege(
      'service_role',
      'public.close_event_retiring_setup(uuid,uuid)',
      'execute'
    ),
    '12 only service_role can execute the close function'
  );

  -- 13. The permission is system-protected, every organization owner role has it,
  -- and no non-owner role holds it.
  return next ok(
    coalesce(
      (select p.system_protected
         from public.permission_definitions p
        where p.resource = 'events'
          and p.action = 'close'),
      false
    )
    and not exists (
      select 1
        from public.organizations o
       where not exists (
         select 1
           from public.organization_role_permissions orp
           join public.org_roles ro on ro.id = orp.role_id
           join public.permission_definitions p on p.id = orp.permission_id
          where orp.organization_id = o.id
            and ro.is_owner_role
            and p.resource = 'events'
            and p.action = 'close'
       )
    )
    and not exists (
      select 1
        from public.organization_role_permissions orp
        join public.org_roles ro on ro.id = orp.role_id
        join public.permission_definitions p on p.id = orp.permission_id
       where p.resource = 'events'
         and p.action = 'close'
         and not ro.is_owner_role
    ),
    '13 events.close is protected, every owner role has it, and no non-owner role holds it'
  );

  -- Delegation must be refused by org_role_permissions_protect_system, for that reason
  -- only: any other error (a duplicate, a missing row) must not count as a pass.
  -- A fixture organization makes the check run on an empty database too (a local
  -- database has none). It is created after the state check above, which it would
  -- otherwise fail: it never received the owner-role grants.
  insert into public.organizations (name, created_by)
  values ('pgTAP close_event_retiring_setup', v_owner);

  if exists (select 1 from public.org_roles where not is_owner_role) then
    begin
      insert into public.organization_role_permissions
        (organization_id, role_id, permission_id)
      select o.id, ro.id, p.id
        from public.organizations o
       cross join public.org_roles ro
       cross join public.permission_definitions p
       where not ro.is_owner_role
         and p.resource = 'events'
         and p.action = 'close'
         and not exists (
           select 1
             from public.organization_role_permissions existing
            where existing.organization_id = o.id
              and existing.role_id = ro.id
              and existing.permission_id = p.id
         )
       limit 1;
    exception when others then
      get stacked diagnostics
        v_sqlstate = returned_sqlstate,
        v_message = message_text;
    end;

    return next ok(
      v_sqlstate = 'P0001'
        and v_message = 'הרשאה זו מוגנת ואינה ניתנת להאצלה מעבר לבעלים',
      '13 protected permission rejects delegation for the expected reason'
    );
  else
    return next skip(
      '13 no non-owner role is available for the delegation test'
    );
  end if;
end
$f$;

select * from pg_temp.dr_run();

select * from finish();

rollback;
