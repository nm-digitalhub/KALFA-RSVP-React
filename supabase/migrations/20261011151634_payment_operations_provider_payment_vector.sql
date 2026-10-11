-- payment_operations.provider_payment_vector — the channel CardCom says a payment went through (ExternalPaymentVector).
--
-- WHY: GetLpResult's top-level ExternalPaymentVector is CardCom's "External source of the transaction": NoneOrUnknown,
-- _3DS (3-D Secure), ApplePay, GooglePay, PayPal, Bit variants, physical PIN pads (docs/cardcom/response (2).md). Measured
-- 11.10.2026 on terminal 172204: the 18:02 payment answered NoneOrUnknown, the 18:13 one `_3DS`. It is the only field that
-- tells whether a payment passed 3DS, and the settle code dropped it — against the owner's 8.10.2026 rule that every field
-- CardCom returns is kept. Owner decision 11.10.2026: keep it.
--
-- WHAT: one nullable text column, written on completion with the other provider facts (cardcom-payment-facts.ts). Rows
-- written before it stay NULL: the ledger does not rewrite completed rows.
--
-- ROLLBACK:
--   alter table public.payment_operations drop column if exists provider_payment_vector;

alter table public.payment_operations
  add column provider_payment_vector text;

comment on column public.payment_operations.provider_payment_vector is
  'CardCom GetLpResult ExternalPaymentVector: the channel the payment went through (NoneOrUnknown, _3DS, ApplePay, GooglePay, PayPal, Bit...). NULL for SUMIT and for rows written before 11.10.2026.';
