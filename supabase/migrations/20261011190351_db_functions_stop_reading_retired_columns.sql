-- Four database functions stop reading the retired pay-per-result columns of `campaigns`; payment facts come from the
-- payment ledger (payment_operations) only.
--
-- WHY: openspec/changes/retire-sumit-campaign-columns task 4.1 (D4). capture_status, charge_status, release_status,
-- final_charge_amount, charged_at, charge_payment_id and sumit_charge_document_id are to be dropped (task 5.2), and no
-- database object may read them first.
--
-- MEASURED 11.10.2026 (live, read-only):
--   - The only objects in public that read a retired column of campaigns, packages or app_settings are these four
--     functions plus try_record_billed_result and campaign_billing_summary (20261011190349), and the CHECK constraints
--     on the columns themselves (they go with the columns). exposed_for_billing, has_service_exposure and
--     purge_test_event read none.
--   - Campaigns without a package: 3. Two are closed SUMIT campaigns, each with succeeded authorize (₪152, ₪200),
--     release and charge (₪0, credit ₪84 and ₪200) rows in payment_operations. One is cancelled with no money.
--   - Package campaigns: 4, none holding a value in capture_status, charge_status, release_status,
--     final_charge_amount, charge_payment_id or sumit_charge_document_id.
--
-- WHAT:
--   - campaigns_guard_cancel, cancel_campaign: the capture_status / charge_status conditions are removed. A package
--     campaign never holds them; the two SUMIT campaigns are closed, which the status condition already refuses. Money
--     is still checked through campaign_has_payment_activity (the ledger) and billed_results.
--   - owner_agent_billing_sums: the two branches that summed campaigns.final_charge_amount / credit_applied for a
--     campaign with NO ledger row are removed. Every campaign that was charged has ledger rows, so those branches
--     summed nothing.
--   - test_event_purge_blocker: the conditions on the retired columns are removed. Money on an event is found through
--     payment_operations (both SUMIT campaigns' events are blocked by it), the status condition stays.
--   Everything else in each function is unchanged, including its grants (CREATE OR REPLACE keeps them).
--
-- SAFETY: every result is captured before the change and compared after it, in this transaction. The migration is
-- refused if any campaign's cancellability, any event's purge blocker, or any billing sum would differ.
--
-- DEPLOY ORDER: either. No application code reads the removed conditions.
--
-- ROLLBACK: re-run the previous definitions — campaigns_guard_cancel and test_event_purge_blocker from
-- 20261006040156_payment_ledger_db_guards.sql, owner_agent_billing_sums from 20261008033521_ledger_money_source_stamp.sql,
-- cancel_campaign from 20261008040027_cancel_campaign_audit.sql.

set local lock_timeout = '5s';

-- ── Before ──────────────────────────────────────────────────────────────────────────────────────────────────────────
create temp table _before_cancellable on commit drop as
  select c.id,
         ( c.status in ('draft','pending_approval','approved')
           and c.capture_status is distinct from 'authorized'
           and c.capture_status is distinct from 'pending'
           and c.capture_status is distinct from 'hold_review'
           and c.charge_status is null
           and not exists (select 1 from public.billed_results b where b.campaign_id = c.id)
           and not public.campaign_has_payment_activity(c.id) ) as cancellable
    from public.campaigns c;

create temp table _before_purge on commit drop as
  select e.id, public.test_event_purge_blocker(e.id) as blocker from public.events e;

create temp table _before_sums on commit drop as
  select w.label, s.*
    from (values ('all', '-infinity'::timestamptz), ('this_year', date_trunc('year', now()))) as w(label, since)
    cross join lateral public.owner_agent_billing_sums(w.since) s;

-- ── Change ──────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.campaigns_guard_cancel()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if new.status='cancelled' and old.status is distinct from 'cancelled' then
    if not ( old.status in ('draft','pending_approval','approved')
      and not exists (select 1 from public.billed_results b where b.campaign_id=new.id)
      and not public.campaign_has_payment_activity(new.id) ) then
      raise exception 'campaign cannot be cancelled: financial commitment or wrong state' using errcode='check_violation';
    end if;
  end if;
  return new;
end; $function$;

create or replace function public.cancel_campaign(p_campaign uuid, p_actor uuid default null::uuid)
 returns text
 language plpgsql
 set search_path to ''
as $function$
declare v public.campaigns;
        v_paid boolean; v_test_only boolean; -- [audit]
begin
  select * into v from public.campaigns where id=p_campaign for update;
  if not found then return 'no_campaign'; end if;
  if v.status='cancelled' then return 'already_cancelled'; end if;
  -- Predicate is ALWAYS evaluated here too — never assumed true for 'draft' or
  -- any other state; this re-check (separate from the trigger above) is what
  -- lets the RPC return a precise outcome instead of a raw constraint error.
  if not ( v.status in ('draft','pending_approval','approved')
    and not exists (select 1 from public.billed_results b where b.campaign_id=v.id)
    and not public.campaign_has_payment_activity(v.id) ) then
    return 'not_cancellable';
  end if;
  -- [audit] What this cancellation erases. The gate above lets a SUCCEEDED payment row through only when it is test money,
  -- so a true v_paid always comes with a true v_test_only; both are recorded so that a reader never has to infer it.
  -- Same effect filter as campaign_has_payment_activity, so the record describes exactly the rows the gate waved through.
  select count(*) > 0, coalesce(bool_and(o.is_test), false) into v_paid, v_test_only
    from public.payment_operations o
    join public.payment_operation_kinds k on k.kind = o.kind
   where o.campaign_id = v.id and o.outcome = 'succeeded' and k.effect <> 'none';
  update public.campaigns set status='cancelled' where id=p_campaign;
  -- [audit] Who and when, in the SAME transaction: if this row cannot be written the status change is rolled back with it, so a
  -- cancellation without a record does not happen. p_actor is the staff member the application verified; NULL = the caller did
  -- not pass one (old application code).
  insert into public.activity_log (user_id, event_id, action, meta)
  values (p_actor, v.event_id, 'campaign.cancelled',
          jsonb_build_object('campaignId', v.id, 'statusBefore', v.status,
                             'hadSucceededPayment', v_paid, 'testMoneyOnly', v_paid and v_test_only));
  return 'cancelled';
end; $function$;

create or replace function public.owner_agent_billing_sums(
  _since timestamp with time zone, _until timestamp with time zone default null::timestamp with time zone)
 returns table(charged_amount numeric, credit_applied_amount numeric, unvoided_credit_amount numeric, credit_granted_amount numeric)
 language sql
 stable
 set search_path to ''
as $function$
  select
    -- charged: the ledger, net of returns
    coalesce((
      select sum(case k.effect when 'collect' then o.amount else -o.amount end)
      from public.payment_operations o
      join public.payment_operation_kinds k on k.kind = o.kind
      where o.outcome = 'succeeded'
        and not o.is_test -- [stamp]
        and k.effect in ('collect', 'return')
        and o.occurred_at >= _since
        and (_until is null or o.occurred_at < _until)
    ), 0),
    -- credit applied: the ledger
    coalesce((
      select sum(o.credit_applied)
      from public.payment_operations o
      join public.payment_operation_kinds k on k.kind = o.kind
      where o.outcome = 'succeeded'
        and not o.is_test -- [stamp]
        and k.effect = 'collect'
        and o.occurred_at >= _since
        and (_until is null or o.occurred_at < _until)
    ), 0),
    coalesce((
      select sum(b.amount)
      from public.billing_credits b
      where b.voided_at is null
    ), 0),
    coalesce((
      select sum(b.amount)
      from public.billing_credits b
      where b.voided_at is null
        and b.created_at >= _since
        and (_until is null or b.created_at < _until)
    ), 0);
$function$;

create or replace function public.test_event_purge_blocker(p_event uuid)
 returns text
 language sql
 stable security definer
 set search_path to ''
as $function$
  select case
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
$function$;

-- ── After: nothing may differ ───────────────────────────────────────────────────────────────────────────────────────
do $$
declare v_cancel integer; v_purge integer; v_sums integer; v_reads integer;
begin
  -- The predicate the two cancel functions now evaluate.
  select count(*) into v_cancel
    from _before_cancellable b
    join public.campaigns c on c.id = b.id
   where b.cancellable is distinct from
         ( c.status in ('draft','pending_approval','approved')
           and not exists (select 1 from public.billed_results r where r.campaign_id = c.id)
           and not public.campaign_has_payment_activity(c.id) );

  select count(*) into v_purge
    from _before_purge b
   where b.blocker is distinct from public.test_event_purge_blocker(b.id);

  select count(*) into v_sums
    from _before_sums b
    cross join lateral public.owner_agent_billing_sums(
      case b.label when 'all' then '-infinity'::timestamptz else date_trunc('year', now()) end) a
   where (b.charged_amount, b.credit_applied_amount, b.unvoided_credit_amount, b.credit_granted_amount)
         is distinct from (a.charged_amount, a.credit_applied_amount, a.unvoided_credit_amount, a.credit_granted_amount);

  -- No function in public reads a retired campaigns column any more.
  select count(*) into v_reads
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosrc ~ '\m(capture_status|charge_status|release_status|final_charge_amount|charged_at|charge_payment_id|sumit_charge_document_id|price_per_reached|max_charge_ceiling)\M';

  if v_cancel <> 0 or v_purge <> 0 or v_sums <> 0 or v_reads <> 0 then
    raise exception 'retired-column functions migration changed a result: cancellable %, purge blockers %, billing sums %, functions still reading %',
      v_cancel, v_purge, v_sums, v_reads;
  end if;
end $$;
