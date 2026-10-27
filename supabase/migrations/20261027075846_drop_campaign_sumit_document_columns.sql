-- Drop campaigns.sumit_order_document_id and campaigns.sumit_charge_document_id (the SUMIT documents of the retired
-- pay-per-result model).
--
-- Measured 27.10.2026 on the live database: both columns are NULL in all 9 campaigns; no function or view names them
-- (prosrc and pg_views); nothing depends on them (pg_depend); no application code reads or writes them (src, worker,
-- scripts, supabase/functions, voxfiles — the only mention is the legacy-column finder script's search list). Payment
-- documents live in the payment ledger (payment_operations.provider_document_*).
--
-- The other SUMIT-era columns that are still on campaigns (card_* and sumit_customer_id) are NOT dropped here: the SUMIT
-- test page and scripts/sumit-doc-check.ts still read them (retire-sumit-campaign-columns, Open Question 2).
--
-- After this is applied: npm run gen:types.
--
-- ROLLBACK (no data is lost — both columns were empty):
--   alter table public.campaigns add column sumit_order_document_id integer, add column sumit_charge_document_id integer;

alter table public.campaigns
  drop column sumit_order_document_id,
  drop column sumit_charge_document_id;
