import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

// Is the purchase waiting on this campaign a CardCom form the buyer can pick up again? The payment page asks, because a
// pending payment shows the form again (the server hands back the SAME session) only for CardCom: a SUMIT charge that is
// pending may already have charged the card, so it stays "in progress". Reads only; false on any error — the safe answer,
// "in progress", is what the page shows then.
export async function isCardcomPurchasePending(campaignId: string): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient()
      .from('payment_operations')
      .select('meta')
      .eq('campaign_id', campaignId)
      .eq('kind', 'package_purchase')
      .eq('outcome', 'pending')
      .maybeSingle();
    if (error || !data) return false;
    const meta = data.meta;
    return meta !== null && typeof meta === 'object' && !Array.isArray(meta) && meta.provider === 'cardcom';
  } catch {
    return false;
  }
}
