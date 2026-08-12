import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { hasPlatformPermission, requireAdmin } from '@/lib/auth/dal';
import { WINDDOWN_STATUSES } from './campaigns';

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

// Exported: the /admin overview dashboard (dashboard.ts) reuses these exact
// same two counters for its "פניות"/"בקשות חזרה" cards, so that card and this
// sidebar badge can never show two different numbers for the same domain.

export async function countNewContacts(supabase: AdminClient): Promise<number> {
  const { count, error } = await supabase
    .from('contact_messages')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'new');
  return error ? 0 : (count ?? 0);
}

export async function countNewCallbacks(supabase: AdminClient): Promise<number> {
  const { count, error } = await supabase
    .from('callback_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'new');
  return error ? 0 : (count ?? 0);
}

async function countWinddownCampaigns(supabase: AdminClient): Promise<number> {
  const { count, error } = await supabase
    .from('campaigns')
    .select('id', { count: 'exact', head: true })
    .in('status', [...WINDDOWN_STATUSES]);
  return error ? 0 : (count ?? 0);
}

async function countPendingFleetRequests(supabase: AdminClient): Promise<number> {
  const { count, error } = await supabase
    .from('fleet_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  return error ? 0 : (count ?? 0);
}

export async function getAdminNavCounts(): Promise<AdminNavCounts> {
  await requireAdmin();
  const supabase = createAdminClient();

  // Resolve permissions once (cache()-memoized) and only run a count the
  // caller is entitled to see — an admin can legitimately hold none of these
  // platform permissions (has_role('admin') and platform permissions are
  // orthogonal), so this must never redirect, only omit.
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
