-- Constrain the three campaign money-state columns to the values the code writes.
--
-- capture_status / charge_status / release_status are free text with no default. On 2026-09-29 a manual
-- dashboard edit stored release_status = 'released' + a trailing newline; holdBadge
-- (campaign-hold-badge.ts) compares with ===, so two released holds kept rendering as "תפוס — ממתין לשחרור".
-- These CHECKs reject any value the code does not write, so a typo fails loudly instead of becoming a state
-- nobody recognizes.
--
-- Allowed sets = every value written today (mapped 2026-09-29, code + live function bodies):
--   capture_status: pending (lockCampaignForHold), authorized (recordCampaignHold),
--                   hold_failed / hold_review (markCampaignHoldFailed, authorize/route.ts)
--   charge_status:  pending (lockCampaignForCharge), charged (recordCampaignCharge),
--                   nothing_to_charge / charge_failed / charge_review (markCampaignChargeOutcome)
--   release_status: released (sumit-hold-reconcile.ts)
-- NULL stays allowed and stays the default: it means "no result for that step yet". Never default to
-- 'released' — that would claim a release that never happened.
-- Adding a new status value in code requires extending the matching CHECK in a migration first.
--
-- Rollback:
--   alter table public.campaigns
--     drop constraint campaigns_capture_status_valid,
--     drop constraint campaigns_charge_status_valid,
--     drop constraint campaigns_release_status_valid;

alter table public.campaigns
  add constraint campaigns_capture_status_valid
    check (capture_status is null
           or capture_status in ('pending', 'authorized', 'hold_failed', 'hold_review')),
  add constraint campaigns_charge_status_valid
    check (charge_status is null
           or charge_status in ('pending', 'charged', 'nothing_to_charge', 'charge_failed', 'charge_review')),
  add constraint campaigns_release_status_valid
    check (release_status is null
           or release_status in ('released'));
