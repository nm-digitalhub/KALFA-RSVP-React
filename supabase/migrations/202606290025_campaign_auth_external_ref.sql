-- Fix the J5 hold -> capture flow: persist the SUMIT Customer.ExternalIdentifier.
--
-- Bug: authorize/route.ts generates `authRef = crypto.randomUUID()` and passes it
-- to SUMIT as Customer.ExternalIdentifier (the anchor a later capture references),
-- but recordCampaignHold only saved the returned CreditCard_Token into
-- `card_token_ref`. The ExternalIdentifier was DISCARDED -> no saved hold could
-- ever be captured (capture.ts: "passing the raw CreditCard_Token was verified to
-- fail"; the only working mechanism is referencing the same ExternalIdentifier).
--
-- Fix: persist the ExternalIdentifier here; recordCampaignHold writes it,
-- getCampaignForCharge reads it, close-charge passes it as customerRef.
-- card_token_ref is retained for audit/reconciliation. Additive + reversible.

alter table public.campaigns
  add column if not exists auth_external_ref text;
