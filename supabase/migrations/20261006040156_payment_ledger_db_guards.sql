-- The four database functions that still look for payments ONLY in the old payment columns of public.campaigns now
-- also look in the payment ledger (public.payment_operations). Expand step of the move: the old columns are still
-- read, nothing is dropped, and a campaign that was paid the old way is judged exactly as before.
--
-- Why this cannot wait for the package model: a campaign paid by the package purchase has capture_status = NULL and
-- charge_status = NULL (its money exists only as ledger rows). campaigns_guard_cancel and cancel_campaign look at
-- those two columns and at billed_results, so today they would let a PAID package campaign be cancelled with no
-- refund; test_event_purge_blocker would let a test event with payments be purged (and then fail on the ledger's
-- ON DELETE RESTRICT); owner_agent_billing_sums would leave package revenue out of the owner's reports.
--
--   1. campaigns_guard_cancel / cancel_campaign  — a campaign with money activity in the ledger (an operation whose
--      effect is not 'none' and that succeeded, is pending, or is in review) cannot be cancelled. A failed attempt
--      does not block: no money moved. Both read the same predicate, public.campaign_has_payment_activity, so the
--      trigger and the RPC cannot drift apart. cancel_campaign has already locked the campaign row FOR UPDATE, and
--      the ledger's own insert trigger locks that row too, so a payment and a cancellation are serialised.
--   2. test_event_purge_blocker — ANY ledger row of the event blocks the purge, whatever its outcome: a failed
--      payment attempt is still a financial record, and the ledger's foreign keys are ON DELETE RESTRICT anyway.
--      (The purge refuses; it does not delete ledger rows. Owner can decide otherwise later.)
--   3. owner_agent_billing_sums — charged_amount and credit_applied_amount add the ledger to the old columns without
--      counting a campaign twice: a campaign that has ANY ledger row is read from the ledger only, one that has none
--      is read from the old columns. charged_amount is NET: succeeded collects minus succeeded returns, each in the
--      window of its own date. (Today there are no returns, so nothing changes; before this, a refund lowered the
--      original charge in place.) The two credit columns (billing_credits) are untouched.
--
-- create or replace restates SECURITY DEFINER / search_path where the function had them: it does NOT keep them.
-- Signatures and return types are unchanged, so every grant and the trigger stay as they are.
--
-- Rollback: re-create the four functions from their previous definitions (20260630223635_event_lifecycle_state_model,
-- 20260929001415_test_event_purge, 20260927011338_owner_agent_capabilities) and drop campaign_has_payment_activity.

-- ── the one predicate ──
create or replace function public.campaign_has_payment_activity(p_campaign uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
      from public.payment_operations o
      join public.payment_operation_kinds k on k.kind = o.kind
     where o.campaign_id = p_campaign
       and k.effect <> 'none'
       and o.outcome in ('succeeded', 'pending', 'review')
  )
$$;
revoke execute on function public.campaign_has_payment_activity(uuid) from public, anon, authenticated;
grant execute on function public.campaign_has_payment_activity(uuid) to service_role;

-- ── 1a. the trigger ──
create or replace function public.campaigns_guard_cancel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status='cancelled' and old.status is distinct from 'cancelled' then
    if not ( old.status in ('draft','pending_approval','approved')
      and old.capture_status is distinct from 'authorized'
      and old.capture_status is distinct from 'pending'
      and old.capture_status is distinct from 'hold_review'
      and old.charge_status is null
      and not exists (select 1 from public.billed_results b where b.campaign_id=new.id)
      and not public.campaign_has_payment_activity(new.id) ) then
      raise exception 'campaign cannot be cancelled: financial commitment or wrong state' using errcode='check_violation';
    end if;
  end if;
  return new;
end; $$;

-- ── 1b. the RPC ──
create or replace function public.cancel_campaign(p_campaign uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v public.campaigns;
begin
  select * into v from public.campaigns where id=p_campaign for update;
  if not found then return 'no_campaign'; end if;
  if v.status='cancelled' then return 'already_cancelled'; end if;
  -- Predicate is ALWAYS evaluated here too — never assumed true for 'draft' or
  -- any other state; this re-check (separate from the trigger above) is what
  -- lets the RPC return a precise outcome instead of a raw constraint error.
  if not ( v.status in ('draft','pending_approval','approved')
    and v.capture_status is distinct from 'authorized'
    and v.capture_status is distinct from 'pending'
    and v.capture_status is distinct from 'hold_review'
    and v.charge_status is null
    and not exists (select 1 from public.billed_results b where b.campaign_id=v.id)
    and not public.campaign_has_payment_activity(v.id) ) then
    return 'not_cancellable';
  end if;
  update public.campaigns set status='cancelled' where id=p_campaign;
  return 'cancelled';
end; $$;

-- ── 2. the test-event purge blocker ──
create or replace function public.test_event_purge_blocker(p_event uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.campaigns c
      where c.event_id = p_event
        and (   c.charge_status in ('charged', 'pending', 'charge_review')
             or c.sumit_charge_document_id is not null
             or c.charge_payment_id is not null
             or c.status::text in ('billed', 'paid', 'awaiting_invoice')
             or coalesce(c.final_charge_amount, 0) > 0
             or c.capture_status in ('pending', 'hold_review')
             or (c.capture_status = 'authorized' and c.release_status is null))
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
$$;

-- ── 3. the owner agent's revenue sums ──
create or replace function public.owner_agent_billing_sums(_since timestamptz, _until timestamptz default null)
returns table(charged_amount numeric, credit_applied_amount numeric, unvoided_credit_amount numeric, credit_granted_amount numeric)
language sql
stable
set search_path = ''
as $$
  select
    -- charged: campaigns with no ledger row (the old columns) + the ledger, net of returns
    coalesce((
      select sum(c.final_charge_amount)
      from public.campaigns c
      where c.charge_status = 'charged'
        and c.charged_at >= _since
        and (_until is null or c.charged_at < _until)
        and not exists (select 1 from public.payment_operations o where o.campaign_id = c.id)
    ), 0)
    + coalesce((
      select sum(case k.effect when 'collect' then o.amount else -o.amount end)
      from public.payment_operations o
      join public.payment_operation_kinds k on k.kind = o.kind
      where o.outcome = 'succeeded'
        and k.effect in ('collect', 'return')
        and o.occurred_at >= _since
        and (_until is null or o.occurred_at < _until)
    ), 0),
    -- credit applied: the same split
    coalesce((
      select sum(c.credit_applied)
      from public.campaigns c
      where c.charge_status in ('charged', 'nothing_to_charge')
        and c.charged_at >= _since
        and (_until is null or c.charged_at < _until)
        and not exists (select 1 from public.payment_operations o where o.campaign_id = c.id)
    ), 0)
    + coalesce((
      select sum(o.credit_applied)
      from public.payment_operations o
      join public.payment_operation_kinds k on k.kind = o.kind
      where o.outcome = 'succeeded'
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
$$;

-- ── verification: aborts, and rolls back whole, when any of these fails ──
do $$
declare v_bad integer;
begin
  -- the old columns and the ledger agree for every campaign that has both (so reading the ledger for those campaigns
  -- changes no number): charged amount and credit
  select count(*) into v_bad
    from public.campaigns c
    join lateral (
      select coalesce(sum(case k.effect when 'collect' then o.amount else -o.amount end) filter (where k.effect in ('collect','return')), 0) as net,
             coalesce(sum(o.credit_applied) filter (where k.effect = 'collect'), 0) as credit
        from public.payment_operations o
        join public.payment_operation_kinds k on k.kind = o.kind
       where o.campaign_id = c.id and o.outcome = 'succeeded'
      having count(*) > 0
    ) l on true
   where c.charge_status in ('charged', 'nothing_to_charge')
     and (coalesce(c.final_charge_amount, 0) <> l.net or coalesce(c.credit_applied, 0) <> l.credit);
  if v_bad > 0 then
    raise exception 'payment_ledger_db_guards: % campaign(s) disagree between the old columns and the ledger', v_bad;
  end if;

  -- the functions kept their security properties (create or replace does not keep what is not restated)
  select count(*) into v_bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and ((p.proname in ('campaigns_guard_cancel', 'cancel_campaign', 'test_event_purge_blocker') and not p.prosecdef)
       or (p.proname = 'owner_agent_billing_sums' and p.prosecdef)
       or (p.proname in ('campaigns_guard_cancel', 'cancel_campaign', 'test_event_purge_blocker', 'owner_agent_billing_sums', 'campaign_has_payment_activity')
           and not coalesce(p.proconfig @> array['search_path=""'], false)));
  if v_bad > 0 then
    raise exception 'payment_ledger_db_guards: % function(s) lost their security definer / search_path settings', v_bad;
  end if;

  -- the helper is not callable by the browser roles
  if has_function_privilege('anon', 'public.campaign_has_payment_activity(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.campaign_has_payment_activity(uuid)', 'execute') then
    raise exception 'payment_ledger_db_guards: campaign_has_payment_activity is executable by a browser role';
  end if;

  -- the cancel trigger is still attached
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.campaigns'::regclass and t.tgname = 'campaigns_guard_cancel' and not t.tgisinternal and t.tgenabled = 'O') then
    raise exception 'payment_ledger_db_guards: the campaigns_guard_cancel trigger is missing or disabled';
  end if;
end $$;
