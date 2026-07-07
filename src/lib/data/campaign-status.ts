import type { Database } from '@/lib/supabase/types';

export type CampaignStatus = Database['public']['Enums']['campaign_status'];

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
