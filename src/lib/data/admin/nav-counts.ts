import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { hasPlatformPermission, requirePlatformStaff } from '@/lib/auth/dal';
import {
  countNewCallbackRequests,
  countOpenContacts,
} from '@/lib/owner-agent/cores/inquiries';
import { countWinddownCampaigns as countWinddownCampaignsCore } from '@/lib/owner-agent/cores/campaigns';

// Sidebar nav badges: how many items in each domain are actionable right now.
// Modeled directly on getDashboardCounts() (./dashboard.ts) — same fail-soft,
// count-only, per-domain-permission-gated shape. Each predicate matches the
// domain's own "needs handling" definition exactly (contacts/callbacks:
// status='new'; campaigns: the same WINDDOWN_STATUSES listCampaignsForAdmin()
// filters by; fleet: status='pending', the same predicate the fleet page
// already surfaces inline as "ממתינות למענה (N)"), so the badge number always
// matches what the destination page itself calls "needs attention".

export interface AdminNavCounts {
  contacts: number | null;
  callbacks: number | null;
  campaigns: number | null;
  fleet: number | null;
}

type AdminClient = ReturnType<typeof createAdminClient>;

// Count-only (head: true) queries — no rows transferred, just the count.
// Fail-soft: a broken counter must not take down the whole admin nav.
//
// The contacts/callbacks/campaigns QUERIES live in the request-free owner-agent
// cores (src/lib/owner-agent/cores/), so this badge, the /admin dashboard card
// and the owner WhatsApp agent run the one same query and can never disagree.
// Those cores THROW on a query error (the agent must not report a confident
// 0); the fail-soft 0 the nav has always had is applied here, in the adapter.

// Exported: the /admin overview dashboard (dashboard.ts) reuses these exact
// same two counters for its "פניות"/"בקשות חזרה" cards, so that card and this
// sidebar badge can never show two different numbers for the same domain.

export async function countNewContacts(supabase: AdminClient): Promise<number> {
  // `reopened` counts too (OPEN_CONTACT_STATUSES in the core): a customer who
  // wrote back on an answered thread is waiting exactly as much as a
  // first-time sender. This moves BOTH surfaces — the sidebar badge and the
  // /admin dashboard card — which is the point: they must never disagree.
  try {
    return await countOpenContacts(supabase);
  } catch {
    return 0;
  }
}

export async function countNewCallbacks(supabase: AdminClient): Promise<number> {
  try {
    return await countNewCallbackRequests(supabase);
  } catch {
    return 0;
  }
}

async function countWinddownCampaigns(supabase: AdminClient): Promise<number> {
  try {
    return await countWinddownCampaignsCore(supabase);
  } catch {
    return 0;
  }
}

async function countPendingFleetRequests(supabase: AdminClient): Promise<number> {
  const { count, error } = await supabase
    .from('fleet_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  return error ? 0 : (count ?? 0);
}

export async function getAdminNavCounts(): Promise<AdminNavCounts> {
  await requirePlatformStaff();
  const supabase = createAdminClient();

  // ⚠️ THE FLOOR HERE IS requirePlatformStaff(), NOT requireAdmin(), and the
  // difference was a live blocker. This function is called by the ADMIN LAYOUT
  // on every admin page render. While it asked requireAdmin() it read user_roles
  // — the retired axis — and redirect()ed on a miss, so a billing_clerk who had
  // just cleared requirePlatformStaff() at the top of that same layout was
  // ejected to /app three lines later. Exactly the defect the 2026-09-10 axis
  // merge existed to remove, still alive in the one module every admin page
  // loads. Fixed 2026-09-10.
  //
  // Resolve permissions once (cache()-memoized) and only run a count the
  // caller is entitled to see — a staff member can legitimately hold none of
  // these, so this must never redirect, only omit.
  const [canCustomer, canBilling, canSettings] = await Promise.all([
    hasPlatformPermission('view_customer_data'),
    hasPlatformPermission('manage_billing'),
    hasPlatformPermission('manage_settings'),
  ]);

  const [contacts, callbacks, campaigns, fleet] = await Promise.all([
    canCustomer ? countNewContacts(supabase) : Promise.resolve(null),
    canCustomer ? countNewCallbacks(supabase) : Promise.resolve(null),
    canBilling ? countWinddownCampaigns(supabase) : Promise.resolve(null),
    canSettings ? countPendingFleetRequests(supabase) : Promise.resolve(null),
  ]);

  return { contacts, callbacks, campaigns, fleet };
}
