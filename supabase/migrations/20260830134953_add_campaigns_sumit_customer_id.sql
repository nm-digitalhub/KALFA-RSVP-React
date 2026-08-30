-- Real gap found + verified live 2026-08-30: capture.ts's close-charge sends
-- ONLY Customer.ExternalIdentifier (never Accounting_Typed_Customer.ID —
-- "leave empty to create a new entity or search by other fields when
-- applicable"), and authorize.ts never captured the numeric SUMIT customer id
-- from the hold to pass forward. Concretely reproduced today: a saved-token
-- charge WITHOUT Customer.ID created a brand-new SUMIT customer instead of
-- reusing the existing one from the hold, even with the SAME card token.
-- No real (non-test) campaign has completed both a hold and a charge yet
-- (verified: 0 rows with capture_status='authorized' AND charge_status=
-- 'charged'), so this has not silently duplicated a real customer — but it
-- would have on the first one.
alter table public.campaigns
  add column sumit_customer_id bigint;

comment on column public.campaigns.sumit_customer_id is
  'SUMIT numeric Customer.ID captured at the J5 hold (Data.CustomerID, top-level — NOT Data.Payment.CustomerID, which is 0 on a hold). Passed back as Customer.ID at close-charge so the final charge reuses the SAME SUMIT customer instead of creating a new one.';
