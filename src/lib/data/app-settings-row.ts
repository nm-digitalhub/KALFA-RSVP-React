import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

// The singleton app_settings row, read with the service-role client as a loose
// record: callers pick their columns by name and narrow every value themselves.
// Null when the read failed or the row is missing. Throws only what
// createAdminClient()/the query throw — each caller keeps its own fail-safe
// try/catch and its own "missing means off/default" rule.
export async function readAppSettingsRow(): Promise<Record<string, unknown> | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('app_settings')
    .select('*')
    .eq('id', true)
    .maybeSingle();
  if (error || !data) return null;
  return data as Record<string, unknown>;
}
