import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/dal';

// Admin dashboard: headline counts. Each is a count-only query (head: true,
// count: 'exact') so no rows are transferred. Authorized by the request-scoped
// session under each table's `*_admin_all` RLS policy plus requireAdmin().

export interface DashboardCounts {
  contacts: number;
  callbacks: number;
  packages: number;
}

// Count a single table head-only; returns 0 on error (a failed counter must not
// take down the whole dashboard). Errors are not surfaced to the user here.
async function countTable(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: 'contact_messages' | 'callback_requests' | 'packages',
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

  const supabase = await createClient();

  const [contacts, callbacks, packages] = await Promise.all([
    countTable(supabase, 'contact_messages'),
    countTable(supabase, 'callback_requests'),
    countTable(supabase, 'packages'),
  ]);

  return { contacts, callbacks, packages };
}
