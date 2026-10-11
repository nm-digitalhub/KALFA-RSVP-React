import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';
import type { CampaignStatus } from '@/lib/data/campaign-status';
import { rangeStartIso, type OwnerAgentRange } from '@/lib/owner-agent/range';

import { upTo, type CoreWindow } from './window';

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
// Privacy: head-only counts. The admin list carries the event NAME, which is
// never read here (decision 9.7: answers contain no event names — counts only).
//
// Errors THROW; the admin nav's fail-soft 0 lives in its adapter.

type AdminClient = ReturnType<typeof createAdminClient>;

// Statuses that may still need a wind-down action (close/pause/cancel).
// Terminal states (billed/paid/cancelled) are excluded — nothing left to do.
export const WINDDOWN_STATUSES: readonly CampaignStatus[] = [
  'active',
  'paused',
  'closed',
];

// The PostgREST filter behind the admin wind-down list. listCampaignsForAdmin() filters by this exact string and
// needsAttention below counts by it, so the agent's number is the length of the admin list by construction.
export const ADMIN_ATTENTION_FILTER = `status.in.(${WINDDOWN_STATUSES.join(',')})`;

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
  // Rows on the /admin/campaigns list.
  needsAttention: number;
  // Campaigns created within the range.
  createdInRange: number;
}

export async function getCampaignsStatusSummary(
  client: AdminClient,
  range: OwnerAgentRange,
  nowMs: number = Date.now(),
  window?: CoreWindow,
): Promise<CampaignsStatusSummary> {
  // `window` (cores/window.ts) bounds createdInRange only.
  const sinceIso = window?.sinceIso ?? rangeStartIso(range, nowMs);
  const [active, paused, closed, winddown, needsAttention, createdInRange] =
    await Promise.all([
      head(client).eq('status', 'active'),
      head(client).eq('status', 'paused'),
      head(client).eq('status', 'closed'),
      countWinddownCampaigns(client),
      head(client).or(ADMIN_ATTENTION_FILTER),
      upTo(head(client).gte('created_at', sinceIso), 'created_at', window),
    ]);
  return {
    active: countOf(active, 'count_active_failed'),
    paused: countOf(paused, 'count_paused_failed'),
    closed: countOf(closed, 'count_closed_failed'),
    winddown,
    needsAttention: countOf(needsAttention, 'count_attention_failed'),
    createdInRange: countOf(createdInRange, 'count_created_failed'),
  };
}
