import 'server-only';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { activateCampaign } from '@/lib/data/campaigns';
import { PACKAGE_NO_CONTACTS_ERROR } from '@/lib/data/package-activation-errors';

// Starts a package campaign right after its payment was recorded (plan D6: charged → list filled → activated), so the
// buyer's last real decision is the payment and not one more click. Shared by every path that records a package payment
// in the buyer's own session — the SUMIT purchase route and the CardCom settle route.
//
// FAIL-SAFE: the payment is recorded whatever happens here. If the start is refused (nobody on the list, a ledger that
// cannot be read right now, a concurrent change) the caller shows the buyer the reason and the explicit start button.
// Status is written ONLY by activateCampaign. Reported, never thrown.
export type ActivationResult = 'started' | 'no_contacts' | 'failed';

export async function activateAfterPayment(campaignId: string, eventId: string): Promise<ActivationResult> {
  try {
    await activateCampaign(campaignId);
    return 'started';
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    console.error('[package-purchase] auto-activation after a confirmed payment was refused', { campaignId, message });
    void sendSlackAlert({
      level: 'warn',
      category: 'campaign_billing',
      source: 'package-activation',
      title: 'חבילה שולמה אך ההפעלה האוטומטית נדחתה',
      fields: { campaign_id: campaignId, event_id: eventId },
    });
    return message === PACKAGE_NO_CONTACTS_ERROR ? 'no_contacts' : 'failed';
  }
}
