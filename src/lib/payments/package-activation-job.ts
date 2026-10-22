import 'server-only';

import type { JobWithMetadata } from 'pg-boss';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { activatePaidPackage, type PaidActivationResult } from '@/lib/payments/activate-paid-package';
import { isFinalDelivery, type PackageActivationJob } from '@/lib/queue/queues';
import { createAdminClient } from '@/lib/supabase/admin';

// One delivery of a package-activation job (design D23), worked by kalfa-worker with { includeMetadata: true }.
//
// A refusal is rethrown so pg-boss retries it (PACKAGE_ACTIVATION_RETRY). Staff hear about it once, on the final
// delivery, not on every attempt: a ledger read that fails for a moment and then succeeds is not news. The payment is
// recorded whatever happens here, and the payment orphan sweep looks again at any paid campaign still waiting.
export async function runPackageActivationJob(
  job: Pick<JobWithMetadata<PackageActivationJob>, 'data' | 'retryCount' | 'retryLimit'>,
): Promise<PaidActivationResult> {
  const { campaignId, operationId } = job.data;
  try {
    return await activatePaidPackage(campaignId, operationId);
  } catch (err) {
    console.error('[package-activation] attempt refused', {
      campaignId,
      operationId,
      retryCount: job.retryCount,
      message: err instanceof Error ? err.message : String(err),
    });
    if (isFinalDelivery(job)) {
      await sendSlackAlert({
        level: 'error',
        category: 'campaign_billing',
        source: 'package-activation',
        title: 'חבילה שולמה אך השירות לא הופעל אחרי כל הניסיונות',
        fields: { campaign_id: campaignId, event_id: await eventOf(campaignId), operation_id: operationId },
      });
    }
    throw err;
  }
}

// The event the alert names (spec: "one alert naming the campaign and the event"). Best effort: the alert goes out
// either way, and an unreadable event is said so rather than hidden.
async function eventOf(campaignId: string): Promise<string> {
  try {
    const { data } = await createAdminClient().from('campaigns').select('event_id').eq('id', campaignId).maybeSingle();
    return data?.event_id ?? 'לא נקרא';
  } catch {
    return 'לא נקרא';
  }
}
