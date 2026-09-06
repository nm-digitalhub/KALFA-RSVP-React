import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, unstable_rethrow } from 'next/navigation';
import { ChevronRight } from 'lucide-react';

import { isAdmin } from '@/lib/auth/dal';
import {
  getCampaignDeliveryForAdminView,
  getCampaignForAdminView,
  getEventForAdminView,
  getThankyouScheduleForAdminView,
} from '@/lib/data/admin/campaigns';
import { getCampaignBillingSummary } from '@/lib/data/billing';
import {
  getCampaignDeliveryBreakdown,
  type CampaignDeliveryBreakdown,
} from '@/lib/data/campaign-delivery';
import {
  getCampaign,
  getThankyouSchedule,
  viewerOwnsCampaignEvent,
} from '@/lib/data/campaigns';
import { countAuthorizedContacts, countUniqueContactsForEvent } from '@/lib/data/contacts';
import { isPastEventDay } from '@/lib/data/event-date';
import { requireEventAccess } from '@/lib/data/events';
import {
  activateCampaignAction,
  cancelCampaignAction,
  closeCampaignAction,
  pauseCampaignAction,
  rescheduleEventAction,
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

  // Same admin branch the event read above takes. The owner path reads through
  // RLS, whose only SELECT policy on `campaigns` resolves to
  // events.owner_id = auth.uid() — so staff got zero rows and a bare 404.
  const campaign = admin
    ? await getCampaignForAdminView(campaignId)
    : await getCampaign(campaignId);
  if (campaign.event_id !== eventId) notFound();

  // Each panel below reports THREE outcomes the page used to collapse into one:
  // loaded, could-not-load, and genuinely-empty. Collapsing them is how a staff
  // view of a customer's live campaign came to read "add contacts and start
  // activity" — the read had simply returned nothing, and "nothing" was rendered
  // as a claim about the customer's data. `unstable_rethrow` keeps Next's own
  // control-flow throws (notFound/redirect) from being swallowed as failures.
  let summary = null;
  let summaryFailed = false;
  try {
    summary = await getCampaignBillingSummary(campaignId);
  } catch (err) {
    unstable_rethrow(err);
    summaryFailed = true;
  }

  let delivery: CampaignDeliveryBreakdown | null = null;
  let deliveryFailed = false;
  try {
    // Same admin branch the event and campaign reads take above. Without it the
    // owner-path reader hits RLS, sees no row, and returns null.
    delivery = admin
      ? await getCampaignDeliveryForAdminView(campaignId)
      : await getCampaignDeliveryBreakdown(campaignId);
    // null means invisible-to-this-reader, never "this campaign has no contacts".
    if (!delivery) deliveryFailed = true;
  } catch (err) {
    unstable_rethrow(err);
    deliveryFailed = true;
  }

  // Mirrors exactly who updateThankyouSchedule accepts: the event's owner, or
  // platform staff. `admin` is enough on its own here — reaching this page as
  // staff already required manage_billing (getCampaignForAdminView above), which
  // is the same permission that write demands. What stays read-only is the third
  // case: an org member with campaigns:view who owns nothing, for whom a form
  // would be a control whose submit is certain to be refused.
  const canEditThankyou = admin || (await viewerOwnsCampaignEvent(campaignId));
  let thankyou = null;
  let thankyouFailed = false;
  try {
    thankyou = admin
      ? await getThankyouScheduleForAdminView(campaignId)
      : await getThankyouSchedule(campaignId);
    if (!thankyou) thankyouFailed = true;
  } catch (err) {
    unstable_rethrow(err);
    thankyouFailed = true;
  }

  // A null count is already safe to render: it suppresses both the "no invitees
  // yet" panel and the over-quota warning rather than asserting a number.
  let authorizedCount: number | null = null;
  let uniqueContacts: number | null = null;
  try {
    authorizedCount = await countAuthorizedContacts(campaignId);
    uniqueContacts = admin ? null : await countUniqueContactsForEvent(eventId);
  } catch (err) {
    unstable_rethrow(err);
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
  const rescheduleEvent = rescheduleEventAction.bind(null, eventId, campaignId);

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
        summaryFailed={summaryFailed}
        delivery={delivery}
        deliveryFailed={deliveryFailed}
        thankyou={thankyou}
        thankyouFailed={thankyouFailed}
        canEditThankyou={canEditThankyou}
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
          rescheduleEvent,
        }}
        eventDate={event.event_date}
        eventIsActive={event.status === 'active'}
        eventId={eventId}
        authorizedCount={authorizedCount}
        uniqueContacts={uniqueContacts}
        isPast={isPast}
        viewerIsAdmin={admin}
      />
    </div>
  );
}
