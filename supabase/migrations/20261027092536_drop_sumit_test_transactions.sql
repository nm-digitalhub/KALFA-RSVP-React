-- Drop public.sumit_test_transactions, the store of the retired /admin/sumit-test diagnostic page.
--
-- retire-sumit-campaign-columns, Open Question 2 — owner, 27.10.2026: the SUMIT diagnostics are retired; SUMIT stays the
-- backup provider of the package purchase and refund. The page, its API route and the helpers that wrote and read this
-- table were removed in the same change; no code in src, worker, scripts or supabase/functions names it any more (only
-- the generated types, until gen:types runs after this push).
--
-- PUSH ONLY AFTER (in this order):
--   1. the code release that removes /admin/sumit-test and /api/admin/sumit-test is deployed — until then the live page
--      still writes here;
--   2. no consumer outside the repo reads the table (saved SQL, reports, automation) — the pre-push queries below;
--   3. the owner has confirmed with the tax advisor that the local rows need not be kept: three of them are real ₪1 SUMIT
--      charges whose receipts exist only in SUMIT and were never in the ledger
--      (docs/superpowers/plans/2026-10-08-test-money-terminal-stamp-plan.md §11).
--
-- WHAT IS LOST. Every row. On 18.10.2026 there were 6 (3 charge, 2 capture, 1 hold; the last on 6.10 —
-- docs/sumit-dependency-map-2026-10-18.md); that is a snapshot, and the block below counts again at push time. A row holds
-- the full SUMIT response of a diagnostic charge, including the saved card token and citizen id SUMIT returned. Nothing is
-- copied anywhere before the drop, by design. The documents themselves stay in SUMIT.
--
-- Supabase runs this file in one transaction and records it only if every statement succeeds. The checks and the drop
-- are a single DO block, so a failed check leaves the table in place even if the file is ever run outside that transaction.
--
-- ROLLBACK (schema only): re-run the body of 20260929172136_sumit_test_transactions.sql. The rows cannot be restored
-- except from a database backup.

set local lock_timeout = '5s';

do $$
declare
  v_readers text;
  v_foreign_refs integer;
  v_rows integer;
begin
  -- `set local` above has no effect outside a transaction block; refusing here proves the file runs as one transaction.
  if current_setting('lock_timeout') <> '5s' then
    raise exception 'sumit_test_transactions: not running inside one transaction (lock_timeout is %)',
      current_setting('lock_timeout');
  end if;

  -- No function may still read or write the table (views, policies and foreign keys are caught by RESTRICT below).
  select string_agg(p.proname, ', ' order by p.proname) into v_readers
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc ~ '\msumit_test_transactions\M';
  if v_readers is not null then
    raise exception 'sumit_test_transactions: function(s) still name the table: %', v_readers;
  end if;

  -- Only the table's own parent_id may reference it.
  select count(*) into v_foreign_refs
    from pg_constraint
   where contype = 'f'
     and confrelid = 'public.sumit_test_transactions'::regclass
     and conrelid <> 'public.sumit_test_transactions'::regclass;
  if v_foreign_refs <> 0 then
    raise exception 'sumit_test_transactions: % foreign key(s) from another table reference it', v_foreign_refs;
  end if;

  select count(*) into v_rows from public.sumit_test_transactions;
  raise notice 'sumit_test_transactions: dropping % row(s)', v_rows;

  drop table public.sumit_test_transactions restrict;

  if to_regclass('public.sumit_test_transactions') is not null then
    raise exception 'sumit_test_transactions: still present after the drop';
  end if;
end $$;

-- VERIFICATION (read-only; counts and names only — never select a row's content).
--
-- Before the push, on the linked project:
--   select count(*) as rows, max(created_at) as last_row from public.sumit_test_transactions;
--   select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.prosrc ~ '\msumit_test_transactions\M';                    -- expect no rows
--   select conrelid::regclass from pg_constraint
--    where contype = 'f' and confrelid = 'public.sumit_test_transactions'::regclass;            -- expect only itself
--   select c.relname from pg_depend d join pg_rewrite r on r.oid = d.objid join pg_class c on c.oid = r.ev_class
--    where d.refobjid = 'public.sumit_test_transactions'::regclass and c.oid <> d.refobjid;     -- views: expect no rows
--
-- After the push:
--   select to_regclass('public.sumit_test_transactions');                                      -- expect null
--   select version from supabase_migrations.schema_migrations where version = '20261027092536';  -- expect one row
-- Then: npm run gen:types, npm run typecheck, npm test.
