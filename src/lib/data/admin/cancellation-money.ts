import 'server-only';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { liveCampaignOf } from '@/lib/data/campaign-status';
import { createAdminClient } from '@/lib/supabase/admin';

import { ledgerForAdmin } from './campaigns';
import { campaignPaymentStatus } from './campaign-payment-status';
import { cancellationListMoney, type CancellationListMoney } from './cancellation-list-money';

// The payment status of every listed cancellation request, for the list's "מצב התשלום" column, in three queries for the
// whole list (never one per row): the events' live campaigns, their ledger (ledgerForAdmin), and the refunds that name a
// listed request. null = the money could not be read; the list then says so instead of guessing.
export async function cancellationMoneyForAdmin(
  requests: readonly { id: string; eventId: string; status: 'pending' | 'resolved' }[],
): Promise<Map<string, CancellationListMoney | null> | null> {
  await requirePlatformPermission('manage_billing');
  if (requests.length === 0) return new Map();
  const admin = createAdminClient();
  try {
    const eventIds = [...new Set(requests.map((r) => r.eventId))];
    const { data: campaigns, error } = await admin
      .from('campaigns')
      .select('id, event_id, status, created_at, capture_status, charge_status, release_status, final_charge_amount')
      .in('event_id', eventIds)
      .order('created_at', { ascending: false });
    if (error) throw new Error('campaigns');
    // The live campaign of each event: the rule the resolver itself uses (liveCampaignOf, newest first).
    const byEvent = new Map<string, NonNullable<typeof campaigns>>();
    for (const c of campaigns ?? []) byEvent.set(c.event_id, [...(byEvent.get(c.event_id) ?? []), c]);
    const live = new Map([...byEvent].map(([eventId, list]) => [eventId, liveCampaignOf(list)]));

    const campaignIds = [...live.values()].flatMap((c) => (c ? [c.id] : []));
    const ledger = await ledgerForAdmin(campaignIds);
    if (ledger === null) throw new Error('ledger');

    const { data: refunds, error: refundsError } = await admin
      .from('payment_operations')
      .select('outcome, recorded_at, meta->>cancellation_request_id')
      .eq('kind', 'refund')
      .in('meta->>cancellation_request_id', requests.map((r) => r.id))
      .order('recorded_at', { ascending: true });
    if (refundsError) throw new Error('refunds');
    // The latest refund attempt of each request (oldest first, so the last one written wins).
    const lastRefund = new Map<string, string>();
    for (const r of refunds ?? []) {
      const requestId = (r as { cancellation_request_id: string | null }).cancellation_request_id;
      if (requestId) lastRefund.set(requestId, r.outcome);
    }

    return new Map(
      requests.map((req) => {
        const campaign = live.get(req.eventId) ?? null;
        const status = campaign
          ? campaignPaymentStatus(ledger.get(campaign.id) ?? null, {
              captureStatus: campaign.capture_status,
              chargeStatus: campaign.charge_status,
              releaseStatus: campaign.release_status,
              finalChargeAmount: campaign.final_charge_amount,
            })
          : null;
        return [
          req.id,
          cancellationListMoney({
            pending: req.status === 'pending',
            hasCampaign: campaign !== null,
            lastRefundOutcome: lastRefund.get(req.id) ?? null,
            campaignStatus: status,
          }),
        ];
      }),
    );
  } catch (err) {
    console.error('[admin-cancellations] the money of the listed requests could not be read', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
