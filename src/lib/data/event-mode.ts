import 'server-only';

import { redirect } from 'next/navigation';

import { getCampaignForEvent, type OwnerCampaign } from '@/lib/data/campaigns';
import { eventMode, resolveEventLifecycle, type EventLifecycleSnapshot, type EventMode } from '@/lib/data/event-lifecycle';
import { canAccessEvent, isEventOwner } from '@/lib/data/events';
import { packagePaymentOf } from '@/lib/payments/package-paid';
import type { PaymentState } from '@/lib/payments/status';
import type { Enums } from '@/lib/supabase/types';

export type EventModeRead = {
  mode: EventMode;
  lifecycle: EventLifecycleSnapshot;
  // False when the viewer may not see the event's campaigns: `campaign` is then null for a permission reason.
  campaignsVisible: boolean;
  campaign: OwnerCampaign | null;
  payment: PaymentState | null;
};

// The event's mode (design D1) for a page whose own gate is another resource (guests, reports). The campaigns are
// probed with the fail-closed visibility helper first, because getCampaignForEvent 404s a viewer without
// campaigns.view, and that viewer may still hold the page's own permission. Such a viewer reads `unavailable`.
export async function readEventMode(event: { id: string; status: Enums<'event_status'> }): Promise<EventModeRead> {
  const campaignsVisible = await canAccessEvent(event.id, 'campaigns', 'view');
  const campaign = campaignsVisible ? await getCampaignForEvent(event.id) : null;
  const payment = campaign ? await packagePaymentOf(campaign) : null;
  const lifecycle = resolveEventLifecycle({ eventStatus: event.status, campaignsVisible, campaign, payment });
  return { mode: eventMode(lifecycle), lifecycle, campaignsVisible, campaign, payment };
}

// A management page (guests, statistics, the service results; design D2/D4): the owner of an event still in setup
// belongs in the setup flow. Another viewer stays and sees the page as their permissions allow, and `unavailable`
// never redirects anyone. Called after the page's own gate and outside any try, so the redirect is not swallowed.
export async function redirectOwnerInSetup(event: { id: string; status: Enums<'event_status'> }): Promise<EventModeRead> {
  const read = await readEventMode(event);
  if (read.mode === 'setup' && (await isEventOwner(event.id))) redirect(`/app/events/${event.id}/setup`);
  return read;
}
