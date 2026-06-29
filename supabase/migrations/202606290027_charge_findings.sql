-- Apply the empirically-validated SUMIT capture findings + complete the
-- charge-side persistence (columns recordCampaignCharge referenced were never
-- applied to the live DB). Additive + reversible. All gated behind payments config.
--
-- Validated working capture: charge the saved CreditCard_Token FRESH (no
-- CreditCardAuthNumber — capturing a stale J5 auth is declined), with
-- PaymentMethod.{Token, ExpirationMonth, ExpirationYear, CitizenID, Type:1}, and
-- WITHOUT an explicit VATRate (the company default balances the document). The
-- charge response carries DocumentID / DocumentNumber / DocumentDownloadURL /
-- Payment.AuthNumber / Payment.ID — persisted for the receipt + reconciliation.

-- Card holder's CitizenID (ת.ז) — SUMIT requires it on the saved-token charge.
-- PII; retention is anchored in the signed agreement (admin-managed). Stored at
-- the J5 hold (read from the authorize response).
alter table public.campaigns
  add column if not exists card_citizen_id text;

-- Charge lifecycle (referenced by recordCampaignCharge / markCampaignChargeOutcome
-- but missing from the live schema).
alter table public.campaigns
  add column if not exists charge_status text;
alter table public.campaigns
  add column if not exists charged_at timestamptz;

-- The charge receipt document + reconciliation fields from the charge response.
alter table public.campaigns
  add column if not exists sumit_charge_document_id integer; -- Data.DocumentID
alter table public.campaigns
  add column if not exists charge_document_number integer;   -- Data.DocumentNumber
alter table public.campaigns
  add column if not exists charge_document_url text;         -- Data.DocumentDownloadURL (receipt link)
alter table public.campaigns
  add column if not exists charge_auth_number text;          -- Data.Payment.AuthNumber
alter table public.campaigns
  add column if not exists charge_payment_id integer;        -- Data.Payment.ID
