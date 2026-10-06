-- Contact-quota package, step 2 support (no behaviour change on its own).
--
-- Plan: docs/superpowers/plans/2026-09-30-contact-quota-package.md (§4.1, §4.3.3).
-- Follows 20261004055310_campaign_contact_quota_foundation.sql.
--
--   1. packages.contact_quota
--      The package CATALOG carries the quota (owner, 2026-10-04: the customer picks a package
--      from the catalog that comes from the packages table). createCampaign will copy it onto
--      campaigns.contact_quota at creation, exactly as it already snapshots price and terms.
--      NULL = a package without a quota, i.e. every package that exists today (the outcome
--      model). Nothing reads this column yet.
--
--   2. call_dispatch_status reason 'waiting_for_quota'
--      dispatchOutreachCall gains a gate: when the campaign has a quota and the contact does
--      not hold a seat, the call is refused and settles as status='skipped',
--      reason='waiting_for_quota'. The reason vocabulary is a CLOSED list pinned by a CHECK
--      (and by call-dispatch-status.test.ts, which reads the newest migration that redefines
--      it); without this change the settlement INSERT would violate the CHECK at runtime.
--      The gate only fires for a campaign with a quota, and no campaign has one, so nothing
--      refuses today.
--
-- Same recreate-verbatim-plus-one-value approach as
-- 20260907152244_dispatch_reason_outside_dial_window.sql.
--
-- ROLLBACK:
--   alter table public.call_dispatch_status drop constraint call_dispatch_status_reason_check;
--   alter table public.call_dispatch_status add constraint call_dispatch_status_reason_check
--     check (reason is null or reason in
--       ('already_reached', 'outside_dial_window', 'no_call_consent', 'dnc_listed',
--        'campaign_not_active', 'event_closed', 'concurrent_owner',
--        'max_concurrency', 'campaign_hour_cap', 'outreach_disabled',
--        'config_missing', 'live_calls_disabled', 'balance_below_reserve',
--        'already_dispatched', 'already_concluded', 'failed_to_start',
--        'start_unknown', 'temporary_dispatch_failure'));
--   (first make sure no row carries 'waiting_for_quota')
--   alter table public.packages drop constraint if exists packages_contact_quota_nonneg;
--   alter table public.packages drop column if exists contact_quota;

-- 1. The catalog column --------------------------------------------------------------------
alter table public.packages
  add column if not exists contact_quota integer;

alter table public.packages
  add constraint packages_contact_quota_nonneg
  check (contact_quota is null or contact_quota >= 0);

comment on column public.packages.contact_quota is
  'How many contacts a campaign created from this package may approach (answered or not). Copied onto campaigns.contact_quota at creation. NULL = a package without a quota (the outcome-billing packages that predate the package model).';

-- 2. The new dispatch reason ----------------------------------------------------------------
alter table public.call_dispatch_status
  drop constraint call_dispatch_status_reason_check;

alter table public.call_dispatch_status
  add constraint call_dispatch_status_reason_check
  check (reason is null or reason in
    ('already_reached', 'outside_dial_window', 'no_call_consent', 'dnc_listed',
     'campaign_not_active', 'event_closed', 'concurrent_owner',
     'max_concurrency', 'campaign_hour_cap', 'outreach_disabled',
     'config_missing', 'live_calls_disabled', 'balance_below_reserve',
     'already_dispatched', 'already_concluded', 'failed_to_start',
     'start_unknown', 'temporary_dispatch_failure', 'waiting_for_quota'));
