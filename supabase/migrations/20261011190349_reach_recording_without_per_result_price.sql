-- Reach recording stops reading the per-result price, and the reach summary returns the reach count only.
--
-- WHY: openspec/changes/retire-sumit-campaign-columns task 3.1 (D3). Package campaigns keep recording reached contacts
-- (billed_results, contact status reached_billed), but the per-result price is retired with the pay-per-result model.
-- Until now try_record_billed_result copied campaigns.price_per_reached into billed_results.locked_price (NOT NULL),
-- which is the only reason createCampaign still writes 0 into the old price columns of every package campaign.
--
-- MEASURED 11.10.2026 (live, read-only):
--   - billed_results: 23 rows, all on the two pay-per-result campaigns; none on a package campaign. Their locked_price
--     values are history and stay as they are.
--   - campaign_billing_summary is read for reached_count only (getCampaignBillingSummary → the campaign page). accrued,
--     ceiling and max_contacts have had no reader since the charge at close was removed.
--   - both functions: EXECUTE for postgres and service_role only.
--
-- WHAT:
--   1. billed_results.locked_price may be NULL: a reach recorded for a package campaign has no per-result price.
--   2. try_record_billed_result: the same checks, in the same order, with the same outcomes; it no longer reads
--      price_per_reached and writes no locked_price.
--   3. campaign_billing_summary returns reached_count only. A changed result shape needs DROP + CREATE, so the grants are
--      set again: service_role only, as before.
--
-- DEPLOY ORDER: this migration BEFORE the application code of the same change. That code stops writing
-- price_per_reached = 0 on a new campaign; against the old try_record_billed_result, which copies it into a NOT NULL
-- locked_price, the first reach of such a campaign would fail to record. The current code works with this migration:
-- it reads the summary row through `Number(row.x ?? 0)` and still writes the 0, which nothing reads any more.
--
-- ROLLBACK:
--   - campaign_billing_summary: drop it, re-run its definition from 202606290028_billing_backhalf.sql, then
--     `revoke all ... from public, anon, authenticated` and `grant execute ... to service_role`.
--   - try_record_billed_result: re-run its definition from 20260925003335_retire_funded_cap.sql.
--   - locked_price: `alter column locked_price set not null` succeeds only while no row is NULL; a NULL row is a package
--     reach recorded after this migration.

set local lock_timeout = '5s';

alter table public.billed_results alter column locked_price drop not null;

create or replace function public.try_record_billed_result(
  p_event uuid, p_campaign uuid, p_contact uuid, p_channel campaign_channel, p_attempt text, p_evidence text,
  p_provider_ref text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_status text; v_start timestamptz; v_close timestamptz;
  v_removed boolean; v_event_id uuid; v_event_date timestamptz;
  v_gate boolean;
begin
  -- Authoritative event comes from the campaign, not the caller.
  select event_id, status::text, start_at, close_at
    into v_event_id, v_status, v_start, v_close
    from campaigns where id=p_campaign for update;
  if not found then return 'no_campaign'; end if;
  if p_event is distinct from v_event_id then return 'event_mismatch'; end if;
  if v_status not in ('active','paused') then return 'not_active'; end if;  -- D2: a paused campaign still records inbound
  if v_start is not null and now() < v_start then return 'before_window'; end if;
  if v_close is not null and now() > v_close then return 'closed_window'; end if;
  -- L2: never record a reach for an event whose calendar day has already passed (Israel).
  select event_date into v_event_date from events where id = v_event_id;
  if v_event_date is not null
     and (now() at time zone 'Asia/Jerusalem')::date
           > (v_event_date at time zone 'Asia/Jerusalem')::date then
    return 'event_passed';
  end if;
  -- R9: never record a reach for a campaign whose event is not active.
  if (select status from public.events where id = v_event_id) is distinct from 'active' then
    return 'event_not_active';
  end if;
  select removal_requested into v_removed from contacts where id=p_contact;
  if coalesce(v_removed,false) then return 'removal_requested'; end if;

  v_gate := coalesce((select billing_exposure_gate from public.app_settings limit 1), false);

  -- Authorization basis. gate OFF (default): membership of the campaign's authorized set. gate ON: exposure — a
  -- serviced non-member may be recorded (the P0-1 fix).
  if v_gate then
    if not public.exposed_for_billing(p_campaign, p_contact, v_event_id, p_channel)
      then return 'no_exposure'; end if;
  else
    if not exists (select 1 from public.campaign_authorized_contacts a
                   where a.campaign_id=p_campaign and a.contact_id=p_contact)
      then return 'not_authorized'; end if;
  end if;

  -- One reach per contact per event, across channels. No price: a package is paid once at purchase.
  insert into billed_results(event_id,campaign_id,contact_id,channel,attempt_id,evidence_source,provider_ref)
    values (v_event_id,p_campaign,p_contact,p_channel,p_attempt,p_evidence,p_provider_ref)
    on conflict (event_id,contact_id) do nothing;
  if not found then return 'already_billed'; end if;
  return 'billed';
end; $function$;

drop function public.campaign_billing_summary(uuid);

create function public.campaign_billing_summary(p_campaign uuid)
 returns table(reached_count integer)
 language sql
 security definer
 set search_path to 'public'
as $function$
  select count(b.*)::int
  from campaigns c left join billed_results b on b.campaign_id=c.id
  where c.id=p_campaign group by c.id;
$function$;

revoke all on function public.campaign_billing_summary(uuid) from public, anon, authenticated;
grant execute on function public.campaign_billing_summary(uuid) to service_role;

-- Verification: refuse the whole migration unless the column is nullable, neither function reads a per-result price,
-- the summary has its new shape and still counts every campaign's reaches, and both functions are service_role only.
do $$
declare v_nullable text; v_record_src text; v_summary_result text; v_mismatch integer;
begin
  select is_nullable into v_nullable from information_schema.columns
   where table_schema = 'public' and table_name = 'billed_results' and column_name = 'locked_price';
  select p.prosrc into v_record_src from pg_proc p
   where p.oid = 'public.try_record_billed_result(uuid,uuid,uuid,campaign_channel,text,text,text)'::regprocedure;
  select pg_get_function_result('public.campaign_billing_summary(uuid)'::regprocedure) into v_summary_result;
  select count(*) into v_mismatch
    from public.campaigns c
   where (select s.reached_count from public.campaign_billing_summary(c.id) s)
         is distinct from (select count(*)::int from public.billed_results b where b.campaign_id = c.id);
  if v_nullable <> 'YES'
     or v_record_src ~ '\m(price_per_reached|locked_price)\M'
     or v_summary_result <> 'TABLE(reached_count integer)'
     or v_mismatch <> 0
     or has_function_privilege('anon', 'public.campaign_billing_summary(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.campaign_billing_summary(uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.campaign_billing_summary(uuid)', 'execute')
     or has_function_privilege('anon', 'public.try_record_billed_result(uuid,uuid,uuid,campaign_channel,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.try_record_billed_result(uuid,uuid,uuid,campaign_channel,text,text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.try_record_billed_result(uuid,uuid,uuid,campaign_channel,text,text,text)', 'execute') then
    raise exception 'reach recording migration failed: nullable %, summary %, count mismatches %',
      v_nullable, v_summary_result, v_mismatch;
  end if;
end $$;
