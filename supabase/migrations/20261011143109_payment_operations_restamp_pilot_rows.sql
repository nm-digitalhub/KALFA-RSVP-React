-- Restamp the four CardCom pilot rows of 7.10.2026 that the ledger records as SUMIT.
--
-- WHAT WAS WRONG (measured 11.10.2026):
--   * The rows 01a117b4, 01a1180f, 01a11811 (failed) and 01a11814 (succeeded, ₪200, CardCom document 15935) were taken by
--     CardCom: meta.provider = 'cardcom', each has a cardcom_payment_sessions row, and 01a11814 carries CardCom's
--     SiteCustomerOrder document. Their `provider` column says 'sumit' and `provider_terminal` is NULL.
--   * Cause: payment_operations.provider got `default 'sumit'` in 20261004105957_payment_operations_expand.sql. The CardCom
--     purchase passed no provider until ad639e82 (8.10.2026 08:36), so the database default named them SUMIT. Every CardCom
--     row written after that commit is stamped correctly. The default itself is removed separately, after the deploy of the
--     code that passes the provider on every new row (the SUMIT purchase passed none either).
--   * Which terminal: test terminal 1000. activity_log `admin.cardcom_config.saved` shows terminal 1000 from 7.10 18:44 UTC
--     until the first save of 172204 on 8.10 17:59 UTC; the four rows were written 7.10 18:51–20:35 UTC. Asked read-only on
--     11.10, the real terminal 172204 answers ResponseCode 5096 ("not found") for all four sessions.
--   * Refunds were never misrouted: purchaseProviderOf reads meta.provider. The wrong column misled the reports.
--
-- OWNER DECISION 11.10.2026: stamp the four as CardCom on terminal 1000. That makes them test money (is_test), so the ₪200
-- leaves revenue — this replaces the 8.10 ruling that kept it in.
--
-- HOW: provider, provider_terminal and is_test are frozen by payment_operations_guard_update, so that one trigger is disabled
-- for the duration of this transaction only (ALTER TABLE takes an exclusive lock, so no other write can slip through) and
-- enabled again before commit. is_test is computed by the same function the insert trigger uses. The rows have no children
-- (0 refunds or releases point at them, measured 11.10), so no child stamp can disagree.
--
-- ROLLBACK (same trigger dance): set provider = 'sumit', provider_terminal = null, is_test = false on the four ids.

set local lock_timeout = '5s';

alter table public.payment_operations disable trigger payment_operations_guard_update;

update public.payment_operations
   set provider = 'cardcom',
       provider_terminal = 1000,
       is_test = public.payment_is_test_terminal(1000)
 where id in (
         '01a117b4-84d2-7791-9738-d0ef735386b7',
         '01a1180f-0f21-700c-b26e-40987ecb1278',
         '01a11811-6cc4-7eb4-b109-aec9e86cb3b1',
         '01a11814-1edf-7425-9487-262f7f8d13b8'
       )
   and provider = 'sumit'
   and provider_terminal is null
   and meta ->> 'provider' = 'cardcom';

alter table public.payment_operations enable trigger payment_operations_guard_update;

-- Verification: refuse the whole migration unless exactly these four rows now read CardCom / 1000 / test, nothing else is
-- stamped SUMIT while its meta says CardCom, and the guard is back on.
do $$
declare v_fixed integer; v_left integer; v_guard char;
begin
  select count(*) into v_fixed from public.payment_operations
   where id in ('01a117b4-84d2-7791-9738-d0ef735386b7', '01a1180f-0f21-700c-b26e-40987ecb1278',
                '01a11811-6cc4-7eb4-b109-aec9e86cb3b1', '01a11814-1edf-7425-9487-262f7f8d13b8')
     and provider = 'cardcom' and provider_terminal = 1000 and is_test;
  select count(*) into v_left from public.payment_operations where provider = 'sumit' and meta ->> 'provider' = 'cardcom';
  select tgenabled into v_guard from pg_trigger
   where tgrelid = 'public.payment_operations'::regclass and tgname = 'payment_operations_guard_update';
  if v_fixed <> 4 or v_left <> 0 or v_guard <> 'O' then
    raise exception 'restamp verification failed: fixed %, still mislabeled %, guard %', v_fixed, v_left, v_guard;
  end if;
end $$;
