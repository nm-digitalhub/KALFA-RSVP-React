-- Drop the last SUMIT card columns of the retired pay-per-result model from public.campaigns: card_token_ref,
-- card_exp_month, card_exp_year, card_citizen_id and sumit_customer_id. Their column comments go with them.
--
-- retire-sumit-campaign-columns, task 5.2 (the card_* and sumit_customer_id groups). Their last readers were the
-- /admin/sumit-test page (src/lib/data/admin/sumit-test.ts) and scripts/sumit-doc-check.ts, both removed after the owner
-- retired the SUMIT diagnostics (Open Question 2, owner, 27.10.2026). Measured in the repo on 27.10.2026 with
-- scripts/find-legacy-campaign-payment-columns.mjs: no other code reads or writes these columns of campaigns. The
-- same-named columns of payment_operations (card_token_ref, card_exp_month, card_exp_year) and of sumit_customers
-- (sumit_customer_id) are NOT touched.
--
-- NOT dropped here: max_contacts, start_at and close_at (in use); tos_version, approved_at and approved_by
-- (20261027082307); sumit_order_document_id and sumit_charge_document_id (20261027075846).
--
-- PUSH ONLY AFTER the code release that removes /admin/sumit-test and scripts/sumit-doc-check.ts is deployed, and after
-- checking that no consumer outside the repo (saved SQL, reports, automation) reads these columns — the pre-push queries
-- below.
--
-- WHAT IS LOST. Measured 11.10.2026 (openspec/changes/retire-sumit-campaign-columns/comparison-5-1.md — a snapshot; the
-- block below re-measures at push time):
--   - card values on 2 campaigns, both SUMIT holds released with nothing charged. The card token and the citizen id are
--     NOT in the ledger and are gone for good — the owner's card exception (11.10.2026; spec "The owner's card exception
--     is limited"). The card expiry is also in those campaigns' ledger `authorize` rows (owner, 11.10.2026: leave it).
--   - sumit_customer_id on 1 campaign. It was copied to that campaign's ledger `authorize` row
--     (meta.sumit_customer_id, 20261011161441), so nothing is lost.
-- Nothing is copied before the drop, by design: no card value goes to a backup table, a log or a notice.
--
-- Supabase runs this file in one transaction and records it only if every statement succeeds. The checks and the drop
-- are a single DO block, so a failed check leaves every column in place even if the file is ever run outside that
-- transaction.
--
-- ROLLBACK (schema): alter table public.campaigns add column card_token_ref text, add column card_exp_month smallint,
--   add column card_exp_year smallint, add column card_citizen_id text, add column sumit_customer_id bigint;
-- Data: sumit_customer_id from payment_operations.meta ->> 'sumit_customer_id' of the campaign's succeeded authorize row;
-- card_exp_month/card_exp_year from the same row. The card token and the citizen id cannot be restored.

set local lock_timeout = '5s';

do $$
declare
  v_readers text;
  v_card_outside integer;
  v_customer_missing integer;
  v_card_rows integer;
  v_customer_rows integer;
  v_left integer;
begin
  -- `set local` above has no effect outside a transaction block; refusing here proves the file runs as one transaction.
  if current_setting('lock_timeout') <> '5s' then
    raise exception 'campaign card columns: not running inside one transaction (lock_timeout is %)',
      current_setting('lock_timeout');
  end if;

  -- No function may still read a column (views, policies, triggers and indexes are caught by RESTRICT below). The names
  -- also exist on other tables, so one function is excluded by name: payment_operations_guard_update reads
  -- payment_operations.card_token_ref, its own table's column (last defined in 20261008033521). Any other match stops
  -- the drop and is listed by name for review.
  select string_agg(p.proname, ', ' order by p.proname) into v_readers
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosrc ~ '\m(card_token_ref|card_exp_month|card_exp_year|card_citizen_id|sumit_customer_id)\M'
     and p.proname <> 'payment_operations_guard_update';
  if v_readers is not null then
    raise exception 'campaign card columns: function(s) to review before the drop: %', v_readers;
  end if;

  -- The card exception covers ONLY campaigns whose SUMIT hold was released with nothing charged: a succeeded SUMIT
  -- release, a succeeded SUMIT charge of 0, and no money taken on the campaign at all. A card value anywhere else stops
  -- the drop (spec: "Another campaign holds a card value").
  select count(*) into v_card_outside
    from public.campaigns c
   where (c.card_token_ref is not null or c.card_exp_month is not null or c.card_exp_year is not null
          or c.card_citizen_id is not null)
     and not (
       exists (select 1 from public.payment_operations o
                where o.campaign_id = c.id and o.provider = 'sumit' and o.kind = 'release' and o.outcome = 'succeeded')
       and exists (select 1 from public.payment_operations o
                    where o.campaign_id = c.id and o.provider = 'sumit' and o.kind = 'charge' and o.outcome = 'succeeded'
                      and o.amount = 0)
       and not exists (select 1 from public.payment_operations o
                        where o.campaign_id = c.id and o.outcome = 'succeeded'
                          and o.kind in ('charge', 'package_purchase', 'package_upgrade') and o.amount > 0));
  if v_card_outside <> 0 then
    raise exception 'campaign card columns: % campaign(s) outside the card exception hold a card value', v_card_outside;
  end if;

  -- sumit_customer_id is outside the card exception: every value must already be in the ledger.
  select count(*) into v_customer_missing
    from public.campaigns c
   where c.sumit_customer_id is not null
     and not exists (select 1 from public.payment_operations o
                      where o.campaign_id = c.id and o.meta ->> 'sumit_customer_id' = c.sumit_customer_id::text);
  if v_customer_missing <> 0 then
    raise exception 'campaign card columns: % campaign(s) hold a sumit_customer_id the ledger does not', v_customer_missing;
  end if;

  select count(*) filter (where card_token_ref is not null or card_exp_month is not null or card_exp_year is not null
                                or card_citizen_id is not null),
         count(*) filter (where sumit_customer_id is not null)
    into v_card_rows, v_customer_rows
    from public.campaigns;
  raise notice 'campaign card columns: % campaign(s) lose card values, % lose a sumit_customer_id kept in the ledger',
    v_card_rows, v_customer_rows;

  alter table public.campaigns
    drop column card_token_ref restrict,
    drop column card_exp_month restrict,
    drop column card_exp_year restrict,
    drop column card_citizen_id restrict,
    drop column sumit_customer_id restrict;

  select count(*) into v_left
    from information_schema.columns
   where table_schema = 'public' and table_name = 'campaigns'
     and column_name in ('card_token_ref', 'card_exp_month', 'card_exp_year', 'card_citizen_id', 'sumit_customer_id');
  if v_left <> 0 then
    raise exception 'campaign card columns: % column(s) still present after the drop', v_left;
  end if;
end $$;

-- VERIFICATION (read-only; counts and names only — never select a card value).
--
-- Before the push, on the linked project:
--   select count(*) filter (where card_token_ref is not null or card_exp_month is not null or card_exp_year is not null
--                                 or card_citizen_id is not null) as card_rows,
--          count(*) filter (where sumit_customer_id is not null) as sumit_customer_rows
--     from public.campaigns;                                                      -- 11.10.2026: 2 and 1
--   select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.prosrc ~ '\m(card_token_ref|card_exp_month|card_exp_year|card_citizen_id|sumit_customer_id)\M';
--                                                                                 -- expect only payment_operations_guard_update
--   select count(*) from public.payment_operations where meta ? 'sumit_customer_id';           -- note the number
--
-- After the push:
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'campaigns'
--      and column_name in ('card_token_ref', 'card_exp_month', 'card_exp_year', 'card_citizen_id', 'sumit_customer_id');
--                                                                                 -- expect no rows
--   select count(*) from public.payment_operations where meta ? 'sumit_customer_id';           -- expect the same number
--   select version from supabase_migrations.schema_migrations where version = '20261027092539';  -- expect one row
-- Then: npm run gen:types, npm run typecheck, npm test.
