-- Per-grant VOID (soft reversal) for billing_credits.
--
-- WHY: billing_credits is append-only (grantBillingCredit only ever INSERTs) and
-- there is no way to cancel a grant entered by mistake. A hard DELETE would
-- destroy the audit trail and, if the credit was already folded into a settled
-- campaign's credit_applied snapshot, break the pool invariant (granted >=
-- consumed). Soft-void keeps the original immutable row and records who voided
-- it, when, and why. Application math (getCampaignCreditTotal, getUserDetail
-- ledger) excludes voided rows; a settled campaign is never re-costed
-- (close-charge is terminal-guarded), so voiding never rewrites a completed
-- charge.

alter table public.billing_credits
  add column if not exists voided_at   timestamptz,
  add column if not exists voided_by   uuid,          -- matches created_by: bare uuid, no FK
  add column if not exists void_reason text;

comment on column public.billing_credits.voided_at is
  'When this credit was voided (soft reversal). NULL = active/available. A voided '
  'credit is excluded from the event credit pool and the admin ledger, but the row '
  'is preserved for audit. Never hard-delete a credit.';

-- The event-level pool query filters (event_id, campaign_id IS NULL) and now also
-- (voided_at IS NULL); this partial index serves it and was missing entirely
-- (only a campaign_id index existed).
create index if not exists billing_credits_event_active_idx
  on public.billing_credits (event_id)
  where voided_at is null;
