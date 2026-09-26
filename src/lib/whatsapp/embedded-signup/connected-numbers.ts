import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

// Which phone_number_ids belong to a number connected through Embedded Signup
// (Coexistence). Its own module, with nothing but the admin client, because the
// webhook worker imports it: pulling the admin DAL (auth, url, alerts) into the
// worker bundle for one lookup is how worker.cjs grows imports it cannot run.

export const ES_PROVIDER = 'meta_whatsapp_es';
export const ES_KIND = 'business_token';

/**
 * Worker path (service role, no user): does an active Embedded Signup
 * connection own this phone_number_id?
 *
 * FAIL-CLOSED: a read error THROWS rather than answering false — false would
 * send the row down the alert path, and a retry is the right answer to a
 * database blip (the same reasoning as channel-routing.ts).
 */
export async function isEsConnectedPhoneNumber(phoneNumberId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('integration_connections')
    .select('id')
    .eq('provider', ES_PROVIDER)
    .eq('status', 'active')
    .eq('metadata->>phoneNumberId', phoneNumberId)
    .limit(1);
  if (error) throw new Error('isEsConnectedPhoneNumber: read failed');
  return (data ?? []).length > 0;
}
