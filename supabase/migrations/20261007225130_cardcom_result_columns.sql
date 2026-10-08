-- CardCom pilot: map what CardCom's GetLpResult returns onto the payment row itself, field by field, instead of keeping a
-- verbatim copy in a table of its own (owner 8.10.2026: "save them all" — and "why another table? we have the ledger").
--
-- 1. Retire cardcom_transaction_results (20261007215824): it never received a row (the code that wrote to it was never deployed
--    and has been removed). The DO block refuses to drop it if that has changed, so no data can be lost by this file.
-- 2. Add the columns the payment row had no place for. Every one is nullable: a SUMIT payment, a payment that is still pending
--    and an old row simply have none. No CHECK constraints on purpose: the application checks each value on its own and leaves
--    an unusable one empty, so that a value the database would refuse can never stop a confirmed payment from being recorded.
--
-- The privileges need no change: payment_operations is closed to every client role, and service_role holds table-level rights
-- (20261004105957), so the new columns are writable by the server and by nobody else. The guard trigger forbids changing only
-- id, campaign_id, event_id, kind, parent_operation_id, recorded_at, source, once_slot and parent_slot, so the completion UPDATE
-- (pending -> succeeded) may set these.
--
-- Already mapped before this file: provider_status(+_description), provider_payment_id, provider_auth_ref, provider_document_*,
-- card_last4, card_exp_month, card_exp_year, card_brand, card_issuer, card_token_ref, citizen_id_secret, occurred_at, amount.

do $$
begin
  if exists (select 1 from public.cardcom_transaction_results) then
    raise exception 'cardcom_transaction_results holds rows: it is not dropped by this migration';
  end if;
end $$;

drop table public.cardcom_transaction_results;

alter table public.payment_operations
  -- The cardholder, as the provider recorded the payment (personal data: the table is server-only).
  add column card_owner_name  text,
  add column card_owner_email text,
  add column card_owner_phone text,
  -- The card.
  add column card_name         text,      -- the card's product name as the provider prints it (e.g. a gold Visa)
  add column card_info         text,      -- the card's origin class (e.g. Israeli)
  add column card_first_digits text,      -- first six digits; text so that nothing is lost to a number type
  add column card_is_abroad    boolean,
  -- The payment.
  add column number_of_payments integer,
  -- The provider's own references for this payment.
  add column provider_coupon_number    text,   -- the voucher number; the provider says it is used for reconciliation
  add column provider_unique_id        text,   -- the provider's unique transaction identifier (Uid)
  add column provider_rrn              text,   -- the retrieval reference number at the card company
  add column provider_acquirer         text,
  add column provider_payment_type     text,
  add column provider_entry_mode       text,
  add column provider_deal_type        text,
  add column provider_account_id       integer, -- the provider's customer-card id, when one was opened or matched
  add column provider_auth_description text;    -- the issuer's authorization description

comment on column public.payment_operations.card_owner_name  is 'Cardholder name as the provider recorded the payment. Personal data; server-only.';
comment on column public.payment_operations.card_owner_email is 'Cardholder e-mail as the provider recorded the payment. Personal data; server-only.';
comment on column public.payment_operations.card_owner_phone is 'Cardholder phone as the provider recorded the payment. Personal data; server-only.';
comment on column public.payment_operations.provider_unique_id is 'The provider''s unique transaction identifier (CardCom: TranzactionInfo.Uid).';

-- ── DRY RUN (owner, one transaction ending in ROLLBACK) ──
-- a) select count(*) from information_schema.columns where table_schema='public' and table_name='payment_operations'
--      and column_name in ('card_owner_name','card_owner_email','card_owner_phone','card_name','card_info','card_first_digits',
--      'card_is_abroad','number_of_payments','provider_coupon_number','provider_unique_id','provider_rrn','provider_acquirer',
--      'provider_payment_type','provider_entry_mode','provider_deal_type','provider_account_id','provider_auth_description');  -- 17
-- b) select to_regclass('public.cardcom_transaction_results');  -- null
-- c) existing rows untouched: select count(*) from public.payment_operations where card_owner_name is not null;  -- 0
-- d) the table-level rights cover the new columns: select has_column_privilege('service_role','public.payment_operations','card_owner_name','update'),
--      has_column_privilege('anon','public.payment_operations','card_owner_name','select');  -- t, f
-- ROLLBACK (manual, only while no row has these values): alter table public.payment_operations drop column card_owner_name, drop column ...;
--   and re-create cardcom_transaction_results from 20261007215824.
