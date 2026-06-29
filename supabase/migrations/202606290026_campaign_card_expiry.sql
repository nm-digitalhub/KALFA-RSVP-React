-- Mechanism A capture: persist the card expiry returned by the J5 authorize.
--
-- SUMIT charges a saved CreditCard_Token only when the request ALSO carries the
-- card's CreditCard_ExpirationMonth/Year (a structural requirement validated
-- before token lookup). The hold form strips card fields before submit (only the
-- og-token reaches us), so the expiry must be read from the SUMIT authorize
-- RESPONSE and stored here for the later capture. Month/year only — never the
-- PAN or CVV. Additive + reversible.

alter table public.campaigns
  add column if not exists card_exp_month smallint;
alter table public.campaigns
  add column if not exists card_exp_year smallint;
