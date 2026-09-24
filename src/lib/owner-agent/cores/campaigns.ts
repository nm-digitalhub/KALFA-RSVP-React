import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';
import type { CampaignStatus } from '@/lib/data/campaign-status';
import { rangeStartIso, type OwnerAgentRange } from '@/lib/owner-agent/range';

// Request-free CORE for campaign status counts (owner-agent tool 2,
// campaigns_status_summary; plan §5). Takes a service-role client and returns
// numbers only.
//
// It owns the two predicates the admin wind-down surface is built on, so the
// /admin/campaigns list (admin/campaigns.ts listCampaignsForAdmin), the sidebar
// badge (nav-counts.ts) and the owner agent all read the SAME definition of
// "needs attention" and cannot drift. Authorization is the caller's:
// manage_billing, checked by admin/campaigns.ts and nav-counts.ts, and by the
// owner agent's server-side permission resolution (plan §3.2).
//
// No imports of the DAL or of request-scoped Next APIs (enforced by the
// `owner-agent-request-free` rule in .dependency-cruiser.cjs).
//
// Privacy: head-only counts. The admin list carries the event NAME and the
// hold-order document URL; neither is read here (decision 9.7: answers contain
// no event names — counts only).
//
// Errors THROW; the admin nav's fail-soft 0 lives in its adapter.

type AdminClient = ReturnType<typeof createAdminClient>;

// Statuses that may still need a wind-down action (close/pause/settle/cancel).
// Terminal states (billed/paid/cancelled) are excluded — nothing left to do.
export const WINDDOWN_STATUSES: readonly CampaignStatus[] = [
  'active',
  'paused',
  'closed',
];

// A campaign whose hold never went through never leaves status='approved'
// (activateCampaign requires capture_status='authorized' — campaigns.ts:889),
// so on its own it would never satisfy WINDDOWN_STATUSES above and would stay
// permanently invisible on the admin screen. These are exactly the states an
// admin needs to see: a stuck lock (pending, e.g. a crash between the hold
// request and its outcome), a declined hold, or an ambiguous/needs-manual-
// reconciliation outcome. Matches the same three values markCampaignHoldFailed/
// lockCampaignForHold already use (campaigns.ts / authorize/route.ts).
export const STUCK_CAPTURE_STATUSES = ['pending', 'hold_failed', 'hold_review'] as const;

// The PostgREST `or` filter behind the admin wind-down list: a wind-down
// status, OR approved with a stuck hold. listCampaignsForAdmin() filters by
// this exact string and needsAttention below counts by it, so the agent's
// number is the length of the admin list by construction.
export const ADMIN_ATTENTION_FILTER = `status.in.(${WINDDOWN_STATUSES.join(',')}),and(status.eq.approved,capture_status.in.(${STUCK_CAPTURE_STATUSES.join(',')}))`;

function head(client: AdminClient) {
  return client.from('campaigns').select('id', { count: 'exact', head: true });
}

function countOf(result: { count: number | null; error: unknown }, code: string): number {
  if (result.error) throw new Error(code);
  return result.count ?? 0;
}

// The sidebar badge's number (nav-counts.ts).
export async function countWinddownCampaigns(client: AdminClient): Promise<number> {
  return countOf(await head(client).in('status', [...WINDDOWN_STATUSES]), 'count_winddown_failed');
}

export interface CampaignsStatusSummary {
  // Current state (not range-bound).
  active: number;
  paused: number;
  closed: number;
  // active + paused + closed, as ONE query — the sidebar badge's number.
  winddown: number;
  // approved with a stuck hold (STUCK_CAPTURE_STATUSES).
  stuckHolds: number;
  // Rows on the /admin/campaigns list: winddown OR stuck hold.
  needsAttention: number;
  // Campaigns created within the range.
  createdInRange: number;
}

export async function getCampaignsStatusSummary(
  client: AdminClient,
  range: OwnerAgentRange,
  nowMs: number = Date.now(),
): Promise<CampaignsStatusSummary> {
  const sinceIso = rangeStartIso(range, nowMs);
  const [active, paused, closed, winddown, stuckHolds, needsAttention, createdInRange] =
    await Promise.all([
      head(client).eq('status', 'active'),
      head(client).eq('status', 'paused'),
      head(client).eq('status', 'closed'),
      countWinddownCampaigns(client),
      head(client).eq('status', 'approved').in('capture_status', [...STUCK_CAPTURE_STATUSES]),
      head(client).or(ADMIN_ATTENTION_FILTER),
      head(client).gte('created_at', sinceIso),
    ]);
  return {
    active: countOf(active, 'count_active_failed'),
    paused: countOf(paused, 'count_paused_failed'),
    closed: countOf(closed, 'count_closed_failed'),
    winddown,
    stuckHolds: countOf(stuckHolds, 'count_stuck_holds_failed'),
    needsAttention: countOf(needsAttention, 'count_attention_failed'),
    createdInRange: countOf(createdInRange, 'count_created_failed'),
  };
}
