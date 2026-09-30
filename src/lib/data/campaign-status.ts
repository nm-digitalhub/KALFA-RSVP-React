import type { Enums } from '@/lib/supabase/types';
export type CampaignStatus = Enums<'campaign_status'>;

// TypeScript-level shared definition of the OPERATIONAL (non-terminal) campaign
// statuses: a campaign in any of these remains operational for lifecycle and
// outreach-policy purposes, so it blocks closing the
// event (R7) AND keys the event-edit locks while an operational campaign exists.
// NOT a system-wide SSOT — the DB trigger events_guard_update hardcodes the same
// 6 statuses independently (a hand-synced copy that can drift). `cancelled`
// (retired) and any post-run terminal status are excluded. `satisfies` makes a
// typo or a renamed enum value a COMPILE error here, not a silent miss.
export const OPERATIONAL_CAMPAIGN_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'scheduled',
  'active',
  'paused',
] as const satisfies readonly CampaignStatus[];

// O(1) membership set. Typed against CampaignStatus so the predicate below can't
// take a free string — if an external path holds a raw string, validate it at
// that boundary (narrow to CampaignStatus) rather than weakening this policy fn.
const operationalCampaignStatusSet = new Set<CampaignStatus>(
  OPERATIONAL_CAMPAIGN_STATUSES,
);

export function isOperationalCampaignStatus(status: CampaignStatus): boolean {
  return operationalCampaignStatusSet.has(status);
}

// The ∃-operational decision shared by BOTH UI surfaces (event-close block +
// event-edit field locks) and matching the server (updateEvent's
// `.in(OPERATIONAL…).limit(1)`) and the DB trigger (events_guard_update's
// `count(*) … in (…) > 0`): "does the event have AT LEAST ONE operational
// (non-terminal) campaign?". Typed against CampaignStatus — never a free string —
// so only a real campaign row shape can be passed. Note this decides the SET/
// quantifier only; the field-lock invariant itself is enforced solely in
// updateEvent (no DB backstop), so this is NOT a system-wide SSOT.
export function hasAnyOperationalCampaign(
  campaigns: readonly { status: CampaignStatus }[],
): boolean {
  return campaigns.some((c) => isOperationalCampaignStatus(c.status));
}

// When a campaign may still be CANCELLED (cancelCampaign → cancel_campaign RPC).
// Cancel is a pre-money wind-down only: once a card hold, a charge or a billed
// reach exists, money has to be settled or refunded instead (the cancellation-
// request flow), never erased by flipping the status. This mirrors the RPC's own
// predicate (migration 20260630223635) so the staff button is shown exactly when
// the RPC would accept it — before 2026-09-29 the button also showed on active,
// paused, scheduled and closed campaigns, where every click failed with
// "לא ניתן לבטל קמפיין זה". campaign-status.test.ts pins the parity.
export const CANCELLABLE_CAMPAIGN_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
] as const satisfies readonly CampaignStatus[];

const BLOCKING_CAPTURE_STATUSES = new Set(['authorized', 'pending', 'hold_review']);

export function isCampaignCancellable(
  campaign: {
    status: CampaignStatus;
    capture_status: string | null;
    charge_status: string | null;
  },
  reachedCount: number,
): boolean {
  return (
    (CANCELLABLE_CAMPAIGN_STATUSES as readonly CampaignStatus[]).includes(campaign.status) &&
    !BLOCKING_CAPTURE_STATUSES.has(campaign.capture_status ?? '') &&
    campaign.charge_status === null &&
    reachedCount === 0
  );
}
