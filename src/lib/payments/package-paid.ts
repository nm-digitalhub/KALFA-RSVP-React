import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

import { loadOperations } from './ledger';
import { deriveStatus, type PaymentState } from './status';

// The campaign's payment state, DERIVED from the ledger — the one thing the purchase, the payment page, the stage of
// the campaign and its activation all decide on, so a reload, a second tab or a stale `?paid=1` can never disagree
// with what was actually recorded. Throws when the ledger cannot be read: an unreadable ledger must never look like
// "nothing paid".
export async function getPackagePaymentState(campaignId: string): Promise<PaymentState> {
  return deriveStatus(await loadOperations(createAdminClient(), campaignId));
}

// The payment state a SCREEN needs to compute the stage of a campaign: only a package campaign has one (a
// pay-per-result campaign is funded by its card hold, a column of the campaign). An unreadable ledger answers null —
// "not funded" — which is the safe direction for a display: the payment page, which fails closed on its own, then
// tells the customer what is wrong.
export async function packagePaymentOf(campaign: {
  id: string;
  package_price?: number | null;
}): Promise<PaymentState | null> {
  if (campaign.package_price == null) return null;
  try {
    return await getPackagePaymentState(campaign.id);
  } catch (err) {
    console.error('[package-paid] payment state could not be read', {
      campaignId: campaign.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
