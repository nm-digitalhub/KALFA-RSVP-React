import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { hasPlatformPermission, requireAdmin } from '@/lib/auth/dal';
import { countNewCallbacks, countNewContacts } from './nav-counts';

// Admin dashboard: headline counts. Each is a count-only query (head: true,
// count: 'exact') so no rows are transferred — but a count still discloses one
// domain's volume, so each is gated by that domain's permission rather than a
// blanket admin check. The dashboard is a cross-domain aggregate (customer data +
// billing), so no single permission fits it; per-count gating is the consistent
// resolution — a support agent sees the contacts/callbacks counts (view_customer_data)
// but not the packages count (view_billing). A count the viewer may not see is
// `null`, and the page omits its card. Reads run via service_role; the permission
// check is the authorization, exactly as every other admin reader.
//
// contacts/callbacks count status='new' (via nav-counts.ts's shared counters),
// NOT total row volume — this is the same "needs handling" predicate the
// admin-sidebar badge uses (see nav-counts.ts), so the overview card and the
// sidebar badge always agree on one number instead of showing two different
// counts for the same domain. packages has no status workflow, so it stays a
// plain catalog-size total.

export interface DashboardCounts {
  contacts: number | null;
  callbacks: number | null;
  packages: number | null;
}

// Count a single table head-only; returns 0 on error (a failed counter must not
// take down the whole dashboard). Errors are not surfaced to the user here.
// Used for `packages` only — contacts/callbacks reuse nav-counts.ts's status-
// filtered counters instead (see module comment above).
async function countTable(
  supabase: ReturnType<typeof createAdminClient>,
  table: 'packages',
): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true });
  if (error) {
    return 0;
  }
  return count ?? 0;
}

export async function getDashboardCounts(): Promise<DashboardCounts> {
  await requireAdmin();
  const supabase = createAdminClient();

  // Resolve permissions once (cache()-memoized) and only run a count the caller
  // is entitled to see.
  const [canCustomer, canBilling] = await Promise.all([
    hasPlatformPermission('view_customer_data'),
    hasPlatformPermission('view_billing'),
  ]);

  const [contacts, callbacks, packages] = await Promise.all([
    canCustomer ? countNewContacts(supabase) : Promise.resolve(null),
    canCustomer ? countNewCallbacks(supabase) : Promise.resolve(null),
    canBilling ? countTable(supabase, 'packages') : Promise.resolve(null),
  ]);

  return { contacts, callbacks, packages };
}
