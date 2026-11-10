import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';

// The project's convention (oauth-flow.ts:16, event-exchange-sync.ts:39 …).
type AdminClient = ReturnType<typeof createAdminClient>;

export type CardDetails = { methodType: string | null; tokenRef: string; expMonth: number | null; expYear: number | null; last4: string | null; mask: string | null; citizenSecretId: string | null };

// The card lives on the payment operation where the provider returned it. The holder's ת"ז goes to vault.secrets; the
// row keeps only the secret's uuid.
export async function saveCitizenId(admin: AdminClient, campaignId: string, citizenId: string | null): Promise<string | null> {
  if (!citizenId) return null;
  const { data, error } = await admin.rpc('payment_citizen_id_write', { p_citizen_id: citizenId, p_campaign_id: campaignId });
  if (error || typeof data !== 'string') throw new Error('שמירת פרטי הכרטיס נכשלה');
  return data;
}
