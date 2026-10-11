-- Keep the one SUMIT customer id in the payment ledger before campaigns.sumit_customer_id is dropped.
--
-- WHY: openspec/changes/personal-coupons D10 retires the SUMIT-era columns of `campaigns` into payment_operations.
-- Measured 11.10.2026: one campaign holds a sumit_customer_id. Its ledger has authorize, release and charge rows
-- (all provider 'sumit', succeeded); none carries the customer id.
--
-- OWNER DECISION 11.10.2026 (D-open 8): copy the SUMIT customer id; do NOT copy the card token, expiry or citizen ID.
--
-- WHERE: meta.sumit_customer_id on that campaign's authorize row, the row that opened the SUMIT customer relationship.
-- provider_account_id is not used: it is `integer`, and the value does not fit it (sumit_customer_id is bigint).
-- The authorize row's meta already carries the earlier backfill from campaigns (backfill_key, auth_external_ref).
--
-- HOW: the row is succeeded → succeeded, which payment_operations_guard_update refuses, so that one trigger is disabled
-- for this transaction only (ALTER TABLE takes an exclusive lock) and enabled again before commit, as in
-- 20261011143109_payment_operations_restamp_pilot_rows.sql. Only `meta` changes. The value is copied by join, never
-- written into this file.
--
-- ROLLBACK (same trigger dance): update the row set meta = meta - 'sumit_customer_id'.

set local lock_timeout = '5s';

alter table public.payment_operations disable trigger payment_operations_guard_update;

update public.payment_operations p
   set meta = coalesce(p.meta, '{}'::jsonb) || jsonb_build_object('sumit_customer_id', c.sumit_customer_id)
  from public.campaigns c
 where p.campaign_id = c.id
   and c.sumit_customer_id is not null
   and p.kind = 'authorize'
   and p.provider = 'sumit'
   and p.outcome = 'succeeded'
   and not coalesce(p.meta, '{}'::jsonb) ? 'sumit_customer_id';

alter table public.payment_operations enable trigger payment_operations_guard_update;

-- Verification: refuse the whole migration unless every campaign with a SUMIT customer id has exactly one succeeded SUMIT
-- authorize row carrying the same value, no other row carries the key, and the guard is back on.
do $$
declare v_campaigns integer; v_matched integer; v_keyed integer; v_guard char;
begin
  select count(*) into v_campaigns from public.campaigns where sumit_customer_id is not null;
  select count(*) into v_matched
    from public.campaigns c
    join public.payment_operations p on p.campaign_id = c.id
   where c.sumit_customer_id is not null
     and p.kind = 'authorize' and p.provider = 'sumit' and p.outcome = 'succeeded'
     and (p.meta ->> 'sumit_customer_id')::bigint = c.sumit_customer_id;
  select count(*) into v_keyed from public.payment_operations where meta ? 'sumit_customer_id';
  select tgenabled into v_guard from pg_trigger
   where tgrelid = 'public.payment_operations'::regclass and tgname = 'payment_operations_guard_update';
  if v_campaigns <> 1 or v_matched <> 1 or v_keyed <> 1 or v_guard <> 'O' then
    raise exception 'sumit customer id copy failed: campaigns %, matched %, rows keyed %, guard %',
      v_campaigns, v_matched, v_keyed, v_guard;
  end if;
end $$;
