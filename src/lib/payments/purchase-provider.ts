import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

// Which clearing company took a campaign's package payment — read from the payment itself, never from today's switch: a
// refund must go back through the company that was paid, whatever the pilot switch says now. The provider is written in the
// purchase row's `meta` when the purchase begins; a row with no provider is a SUMIT purchase (everything before the pilot).
//
// Throws when the ledger cannot be read: "SUMIT" must never be the answer to a failed read, because the refund that follows
// would go to the wrong company. Callers that cannot afford a throw (a summary for a screen) catch it, as they already do.
export type PurchaseProvider = 'sumit' | 'cardcom';

export async function purchaseProviderOf(campaignId: string): Promise<PurchaseProvider> {
  const { data, error } = await createAdminClient()
    .from('payment_operations')
    .select('meta')
    .eq('campaign_id', campaignId)
    .eq('kind', 'package_purchase')
    .eq('outcome', 'succeeded')
    .limit(1)
    .maybeSingle();
  if (error) throw new Error('טעינת פעולות התשלום נכשלה');
  const meta = data?.meta;
  return meta !== null && typeof meta === 'object' && !Array.isArray(meta) && meta.provider === 'cardcom' ? 'cardcom' : 'sumit';
}
