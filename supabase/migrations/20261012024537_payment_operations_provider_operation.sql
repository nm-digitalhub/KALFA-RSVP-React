-- personal-coupons / card-on-file groundwork (owner, 12.10.2026: "למה לדחות... קוד קשיח" — the requested CardCom
-- Operation becomes DATA on the row, not a constant in code; the planned package UPGRADE will request
-- ChargeAndCreateToken and the same settle gate will hold).
--
-- provider_operation: the operation this payment's session was ASKED to perform (CardCom: ChargeOnly today;
-- ChargeAndCreateToken when a flow that saves a card for upgrades requests it). Written at birth like the provider
-- and terminal stamps; NULL on rows born earlier, read as ChargeOnly. Settlement compares CardCom's answered
-- Operation against THIS, so an answer we did not ask for — in either direction — parks in review.
--
-- ROLLBACK: alter table public.payment_operations drop column provider_operation;

alter table public.payment_operations
  add column provider_operation text;

comment on column public.payment_operations.provider_operation is
  'The operation the provider session was ASKED to perform (CardCom: ChargeOnly / ChargeAndCreateToken). Stamped at birth; null = ChargeOnly (rows born before 12.10.2026). Settlement matches the answer against this.';
