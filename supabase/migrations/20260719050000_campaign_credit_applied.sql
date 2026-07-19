-- credit_applied: snapshot of the billing_credits actually consumed by this
-- campaign's close-charge (event-level + campaign-level combined). Overwritten
-- idempotently by recordCampaignCharge / markCampaignChargeOutcome on each
-- attempt — never incremented. Remaining pool for an event =
--   Σ billing_credits(event) − Σ campaigns.credit_applied(event).
alter table public.campaigns
  add column if not exists credit_applied numeric not null default 0;

comment on column public.campaigns.credit_applied is
  'Credit consumed by the final close-charge (₪, gross). Snapshot written with the terminal charge outcome; capped at min(accrued, ceiling) — a larger granted credit leaves the remainder available at the event level.';
