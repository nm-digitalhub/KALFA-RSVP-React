-- A refund can never return more than the card paid.
-- (docs/superpowers/plans/2026-10-06-package-cancel-refund.md, "הקשחה"; owner, 6.10.2026: build the package refund.)
--
-- The application checks this before it asks the provider for a credit, and once more after its PENDING row is held
-- (src/lib/payments/package-refund.ts). This is the database's own check, for the moments the application cannot see:
-- two refunds of one campaign racing each other, or a row written by anything other than that module.
--
-- The rule is the one src/lib/payments/status.ts (refundableAmount) already applies on the application side:
--     sum(amount of the 'collect' operations that succeeded)
--       - sum(amount of the 'return' operations that did not fail)   must never go below zero.
-- A return that is still pending or in review counts as already gone: the provider may have paid it.
--
-- Scope, on purpose:
--   * only the application's own refunds are checked (source = 'app'). A row with source provider_sync or
--     manual_backfill records something that ALREADY happened at the provider; refusing to write it down would hide
--     the money movement instead of preventing it.
--   * only the INSERT is checked. Completing a row (pending -> succeeded / failed / review) never raises its amount in
--     the application, and a failed row leaves the sum.
--   * the 'release' kind (a guarantee ending, effect void) moves no money and is not touched.
--
-- Concurrency: payment_operations_before_insert already locks the campaign row (FOR UPDATE) for every insert. The same
-- lock is taken again here, so this check does not depend on the order two triggers happen to run in. Under READ
-- COMMITTED the sum below is a fresh statement after the lock, so it sees every refund a previous transaction of the
-- same campaign committed.
--
-- Expand only: no column, no data and no existing function changes.
--
-- Rollback:
--   drop trigger payment_operations_check_refund_cap on public.payment_operations;
--   drop function public.payment_operations_check_refund_cap();

create or replace function public.payment_operations_check_refund_cap()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_effect text; v_collected numeric; v_returned numeric;
begin
  if new.source <> 'app' or new.outcome not in ('pending', 'review', 'succeeded') then
    return new;
  end if;
  select k.effect into v_effect from public.payment_operation_kinds k where k.kind = new.kind;
  if v_effect is distinct from 'return' then
    return new;
  end if;
  perform 1 from public.campaigns c where c.id = new.campaign_id for update;
  select coalesce(sum(o.amount) filter (where k.effect = 'collect' and o.outcome = 'succeeded'), 0),
         coalesce(sum(o.amount) filter (where k.effect = 'return' and o.outcome in ('pending', 'review', 'succeeded')), 0)
    into v_collected, v_returned
    from public.payment_operations o
    join public.payment_operation_kinds k on k.kind = o.kind
   where o.campaign_id = new.campaign_id;
  if v_returned + new.amount > v_collected then
    raise exception 'payment_operations: a refund of % would return more than the card paid (paid %, already returned %)',
      new.amount, v_collected, v_returned using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- Alphabetically after payment_operations_before_insert, which runs first; the lock above makes the order irrelevant.
create trigger payment_operations_check_refund_cap before insert on public.payment_operations
  for each row execute function public.payment_operations_check_refund_cap();

-- Verification: aborts, and rolls back whole, when any of these fails.
do $$
declare v_bad integer;
begin
  -- the rule already holds for every campaign that exists, so the trigger starts from a true statement
  select count(*) into v_bad from (
    select o.campaign_id
      from public.payment_operations o
      join public.payment_operation_kinds k on k.kind = o.kind
     group by o.campaign_id
    having coalesce(sum(o.amount) filter (where k.effect = 'return' and o.outcome in ('pending', 'review', 'succeeded')), 0)
         > coalesce(sum(o.amount) filter (where k.effect = 'collect' and o.outcome = 'succeeded'), 0)
  ) s;
  if v_bad > 0 then
    raise exception 'payment_refund_cap: % campaign(s) have already returned more than the card paid', v_bad;
  end if;

  -- exactly one such trigger, enabled (origin mode 'O'), and the function is invoker-rights with an empty search_path
  if (select count(*) from pg_trigger t
       where not t.tgisinternal and t.tgname = 'payment_operations_check_refund_cap' and t.tgenabled = 'O') <> 1 then
    raise exception 'payment_refund_cap: the trigger is missing or not enabled';
  end if;
  if exists (select 1 from pg_proc p
              where p.oid = 'public.payment_operations_check_refund_cap()'::regprocedure
                and (p.prosecdef or p.proconfig is null or not ('search_path=""' = any (p.proconfig)))) then
    raise exception 'payment_refund_cap: the function must be security invoker with an empty search_path';
  end if;
end $$;

-- ── DRY RUN (6.10.2026, live database, one DO block ending in a rollback; fixture: a campaign with no money activity) ──
-- All nine scenarios passed, and the verification block above passed on the live data. Six deliberate breakages of the
-- function (>= instead of >, review not counted, failed counted, the source rule dropped, any collect counted, the
-- effect filter dropped) each made a scenario fail:
-- a) a 100 succeeded purchase, then a 100 refund -> accepted; a 100.01 refund -> check_violation
-- b) a 60 succeeded refund, then a pending 40 -> accepted; a pending 40.01 -> check_violation
-- c) a FAILED refund of any size is accepted and does not count: a failed 100 refund, then a pending 100 -> accepted
-- d) a refund in REVIEW counts: a 60 review refund, then a pending 41 -> check_violation, 40 -> accepted
-- e) a campaign with no collected money: a pending refund of 0.01 -> check_violation (other campaigns do not lend theirs)
-- f) source 'provider_sync' / 'manual_backfill' are not checked: a succeeded 500 refund -> accepted
-- g) a 'release' (void) and a 'package_purchase' (collect) are untouched by the check
-- h) the function takes the campaign row lock itself (pg_get_functiondef contains FOR UPDATE)
-- i) only a collect that SUCCEEDED is money the card paid: a failed / pending / review purchase of 100, then a refund of 1
--    -> check_violation
-- Not testable from one connection: two refunds of one campaign at the same instant. That relies on the campaign row
-- lock, the same mechanism payment_operations_before_insert already uses and 20261004105957 step (h) examined.
