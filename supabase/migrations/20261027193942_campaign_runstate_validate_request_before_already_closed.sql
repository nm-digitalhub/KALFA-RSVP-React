begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.campaign_runstate(
  p_campaign uuid,
  p_action text,
  p_actor uuid,
  p_via text,
  p_cancellation_request uuid default null,
  p_reason text default null
)
returns text
language plpgsql
security invoker
set search_path to ''
as $function$
declare
  v          public.campaigns;
  v_key      text;
  v_target   public.campaign_status;
  v_from     public.campaign_status[];
  v_req      record;
  v_owner    uuid;
  v_activity text;
begin
  -- Validate the action and channel before reading any state.
  if p_action is null or p_action not in ('pause', 'revive', 'close') then
    raise exception 'campaign_runstate: unknown action %', p_action using errcode = '22023';
  end if;

  if p_via is null or p_via not in ('web', 'bearer', 'cancellation_request') then
    raise exception 'campaign_runstate: unknown channel %', p_via using errcode = '22023';
  end if;

  if p_via = 'cancellation_request' then
    if p_action <> 'close' then
      raise exception 'campaign_runstate: only close goes through a cancellation request' using errcode = '22023';
    end if;

    if p_cancellation_request is null then
      raise exception 'campaign_runstate: a close through a cancellation request names the request' using errcode = '22023';
    end if;
  elsif p_cancellation_request is not null then
    raise exception 'campaign_runstate: a cancellation request is passed only with via cancellation_request'
      using errcode = '22023';
  end if;

  -- A cancellation-request close needs manage_billing.
  -- Other run-state actions need campaigns.runstate.
  v_key := case
    when p_via = 'cancellation_request' then 'manage_billing'
    else 'campaigns.runstate'
  end;

  if p_actor is null or not public.has_platform_permission_for_user(p_actor, v_key) then
    return 'forbidden';
  end if;

  v_target := case p_action
    when 'pause'  then 'paused'::public.campaign_status
    when 'revive' then 'active'::public.campaign_status
    else 'closed'::public.campaign_status
  end;

  v_from := case p_action
    when 'pause'  then array['active']::public.campaign_status[]
    when 'revive' then array['paused']::public.campaign_status[]
    else array['active', 'paused', 'approved', 'scheduled']::public.campaign_status[]
  end;

  -- Lock the campaign first, matching the existing lock order.
  select *
    into v
    from public.campaigns
   where id = p_campaign
   for update;

  if not found then
    return 'no_campaign';
  end if;

  -- Validate and lock the cancellation request BEFORE the already-closed
  -- response. A closed campaign must not bypass the request checks.
  if p_via = 'cancellation_request' then
    select r.status, r.event_id
      into v_req
      from public.event_cancellation_requests r
     where r.id = p_cancellation_request
       for share;

    if not found or v_req.status <> 'pending' then
      return 'request_not_pending';
    end if;

    if v_req.event_id <> v.event_id then
      return 'request_mismatch';
    end if;
  end if;

  -- A valid pending request may retry after the campaign close succeeded
  -- but a later step in the resolve flow failed.
  if v.status = v_target then
    return 'already_' || v_target::text;
  end if;

  if not (v.status = any (v_from)) then
    return 'not_allowed_from_' || v.status::text;
  end if;

  update public.campaigns
     set status = v_target
   where id = v.id;

  select e.owner_id
    into v_owner
    from public.events e
   where e.id = v.event_id;

  insert into public.support_access_log
    (staff_id, permission, subject_type, subject_id, owner_id, event_id, reason, via, action, details)
  values
    (p_actor, v_key, 'campaign', v.id, v_owner, v.event_id, p_reason, p_via, p_action,
     jsonb_build_object('statusBefore', v.status));

  v_activity := case p_action
    when 'pause' then 'campaign.paused'
    when 'revive' then 'campaign.revived'
    else 'campaign.closed'
  end;

  insert into public.activity_log (user_id, event_id, action, meta)
  values (
    null,
    v.event_id,
    v_activity,
    jsonb_build_object('campaignId', v.id, 'statusBefore', v.status, 'via', p_via)
  );

  return 'done';
end;
$function$;

revoke execute on function public.campaign_runstate(uuid, text, uuid, text, uuid, text)
  from public, anon, authenticated;

grant execute on function public.campaign_runstate(uuid, text, uuid, text, uuid, text)
  to service_role;

do $$
declare
  v_fn            constant regprocedure :=
    'public.campaign_runstate(uuid,text,uuid,text,uuid,text)'::regprocedure;
  v_def           text;
  v_request_check integer;
  v_already_check integer;
begin
  select pg_get_functiondef(v_fn) into v_def;
  v_def := lower(regexp_replace(v_def, '\s+', ' ', 'g'));

  if (select p.prosecdef from pg_proc p where p.oid = v_fn) then
    raise exception 'campaign_runstate repair: function must remain SECURITY INVOKER';
  end if;

  if not coalesce(
    (select p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = v_fn),
    false
  ) then
    raise exception 'campaign_runstate repair: function search_path must remain empty';
  end if;

  v_request_check := position('select r.status, r.event_id' in v_def);
  v_already_check := position('if v.status = v_target then return' in v_def);

  if v_request_check = 0 or v_already_check = 0 or v_request_check > v_already_check then
    raise exception 'campaign_runstate repair: request validation must precede the already-state return';
  end if;

  if has_function_privilege('anon', v_fn, 'execute')
     or has_function_privilege('authenticated', v_fn, 'execute') then
    raise exception 'campaign_runstate repair: anon or authenticated can execute the function';
  end if;

  if not has_function_privilege('service_role', v_fn, 'execute') then
    raise exception 'campaign_runstate repair: service_role cannot execute the function';
  end if;
end
$$;

commit;
