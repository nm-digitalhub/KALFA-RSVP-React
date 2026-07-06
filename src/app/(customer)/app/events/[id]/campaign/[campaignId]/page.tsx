import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronRight } from 'lucide-react';

import { requireEventAccess, requireOwnedEvent } from '@/lib/data/events';
import { isPastEventDay } from '@/lib/data/event-date';
import { getCampaign } from '@/lib/data/campaigns';
import { getCampaignBillingSummary } from '@/lib/data/billing';
import { getCampaignDeliveryBreakdown } from '@/lib/data/campaign-delivery';
import {
  activateCampaignAction,
  pauseCampaignAction,
  closeCampaignAction,
  settleCampaignAction,
  sendGiftReminderAction,
} from '../campaign-actions';
import { ManageClient } from './manage-client';

// Campaign management (§9 lifecycle + §15 owner board). Wires the previously
// orphaned activate/pause/close + final settlement. Ownership enforced server-side.
export default async function CampaignManagePage({
  params,
}: {
  params: Promise<{ id: string; campaignId: string }>;
}) {
  const { id: eventId, campaignId } = await params;
  const event = await requireEventAccess(eventId, 'campaigns', 'view');
  const isPast = isPastEventDay(event.event_date);

  const campaign = await getCampaign(campaignId);
  if (campaign.event_id !== eventId) notFound();

  // The summary RPC is the source of reached/accrued; tolerate it being
  // unavailable (returns null → the board shows zeros, never crashes the page).
  let summary = null;
  try {
    summary = await getCampaignBillingSummary(campaignId);
  } catch {
    summary = null;
  }

  // The webhook delivery/outcome breakdown (B8) — shown BESIDE the billing
  // summary, not replacing it. Tolerate failure: the board degrades to hiding the
  // block rather than crashing the page.
  let delivery = null;
  try {
    delivery = await getCampaignDeliveryBreakdown(campaignId);
  } catch {
    delivery = null;
  }

  const activate = activateCampaignAction.bind(null, eventId, campaignId);
  const pause = pauseCampaignAction.bind(null, eventId, campaignId);
  const close = closeCampaignAction.bind(null, eventId, campaignId);
  const settle = settleCampaignAction.bind(null, eventId, campaignId);
  const sendGift = sendGiftReminderAction.bind(null, eventId, campaignId);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/app/events/${eventId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ChevronRight className="size-4" aria-hidden />
          חזרה לאירוע
        </Link>
        <h1 className="mt-2 text-2xl font-bold">ניהול קמפיין</h1>
      </div>

      <section className="rounded-lg border border-border bg-card p-5">
        <ManageClient
          campaign={{
            id: campaign.id,
            status: campaign.status,
            price_per_reached: campaign.price_per_reached,
            max_contacts: campaign.max_contacts,
            max_charge_ceiling: campaign.max_charge_ceiling,
            final_charge_amount: campaign.final_charge_amount,
            capture_status: campaign.capture_status,
          }}
          summary={summary}
          delivery={delivery}
          actions={{ activate, pause, close, settle, sendGift }}
          isPast={isPast}
        />
      </section>
    </div>
  );
}
