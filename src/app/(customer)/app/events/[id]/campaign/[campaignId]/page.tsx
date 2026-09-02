import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronRight } from 'lucide-react';

import { isAdmin } from '@/lib/auth/dal';
import { getEventForAdminView } from '@/lib/data/admin/campaigns';
import { getCampaignBillingSummary } from '@/lib/data/billing';
import { getCampaignDeliveryBreakdown } from '@/lib/data/campaign-delivery';
import { getCampaign, getThankyouSchedule } from '@/lib/data/campaigns';
import { countAuthorizedContacts, countUniqueContactsForEvent } from '@/lib/data/contacts';
import { isPastEventDay } from '@/lib/data/event-date';
import { requireEventAccess } from '@/lib/data/events';
import {
  activateCampaignAction,
  cancelCampaignAction,
  closeCampaignAction,
  pauseCampaignAction,
  sendEventDayReminderAction,
  sendGiftReminderAction,
  sendThankyouAction,
  settleCampaignAction,
  updateThankyouScheduleAction,
} from '../campaign-actions';
import { ManageClient } from './manage-client';

export const metadata: Metadata = { title: 'ניהול קמפיין' };

export default async function CampaignManagePage({
  params,
}: {
  params: Promise<{ id: string; campaignId: string }>;
}) {
  const { id: eventId, campaignId } = await params;

  const admin = await isAdmin();
  const event = admin
    ? await getEventForAdminView(eventId)
    : await requireEventAccess(eventId, 'campaigns', 'view');
  const isPast = isPastEventDay(event.event_date);

  const campaign = await getCampaign(campaignId);
  if (campaign.event_id !== eventId) notFound();

  let summary = null;
  try {
    summary = await getCampaignBillingSummary(campaignId);
  } catch {
    summary = null;
  }

  let delivery = null;
  try {
    delivery = await getCampaignDeliveryBreakdown(campaignId);
  } catch {
    delivery = null;
  }

  let thankyou = null;
  try {
    thankyou = await getThankyouSchedule(campaignId);
  } catch {
    thankyou = null;
  }

  let authorizedCount: number | null = null;
  let uniqueContacts: number | null = null;
  try {
    authorizedCount = await countAuthorizedContacts(campaignId);
    uniqueContacts = admin ? null : await countUniqueContactsForEvent(eventId);
  } catch {
    authorizedCount = null;
    uniqueContacts = null;
  }

  const activate = activateCampaignAction.bind(null, eventId, campaignId);
  const pause = pauseCampaignAction.bind(null, eventId, campaignId);
  const close = closeCampaignAction.bind(null, eventId, campaignId);
  const settle = settleCampaignAction.bind(null, eventId, campaignId);
  const cancel = cancelCampaignAction.bind(null, eventId, campaignId);
  const sendGift = sendGiftReminderAction.bind(null, eventId, campaignId);
  const sendEventDay = sendEventDayReminderAction.bind(null, eventId, campaignId);
  const sendThankyou = sendThankyouAction.bind(null, eventId, campaignId);
  const updateThankyouSchedule = updateThankyouScheduleAction.bind(
    null,
    eventId,
    campaignId,
  );

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <header>
        <Link
          href={`/app/events/${eventId}`}
          className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <ChevronRight className="size-4" aria-hidden="true" />
          חזרה לאירוע
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
          ניהול קמפיין
        </h1>
      </header>

      <ManageClient
        campaign={{
          id: campaign.id,
          status: campaign.status,
          price_per_reached: campaign.price_per_reached,
          max_contacts: campaign.max_contacts,
          max_charge_ceiling: campaign.max_charge_ceiling,
          final_charge_amount: campaign.final_charge_amount,
          credit_applied: campaign.credit_applied,
          capture_status: campaign.capture_status,
          charge_status: campaign.charge_status,
          base_price: campaign.base_price,
          included_reached: campaign.included_reached,
        }}
        summary={summary}
        delivery={delivery}
        thankyou={thankyou}
        actions={{
          activate,
          pause,
          close,
          settle,
          cancel,
          sendGift,
          sendEventDay,
          sendThankyou,
          updateThankyouSchedule,
        }}
        eventId={eventId}
        authorizedCount={authorizedCount}
        uniqueContacts={uniqueContacts}
        isPast={isPast}
        viewerIsAdmin={admin}
      />
    </div>
  );
}
