import 'server-only';

import {
  canAccessEvent,
  requireEventAccess,
  getEvent,
} from '@/lib/data/events';
import { getGuestTotals, type GuestTotals } from '@/lib/data/guests';
import { getCampaignForEvent, type OwnerCampaign } from '@/lib/data/campaigns';
import {
  getCampaignDeliveryBreakdown,
  type CampaignDeliveryBreakdown,
} from '@/lib/data/campaign-delivery';
import { getCampaignBillingSummary, type BillingSummary } from '@/lib/data/billing';

export type SectionState = 'visible' | 'permission_limited' | 'empty' | 'error';

export type EventStatsPercentages = {
  responseRate: number | null;
  attendingRate: number | null;
  attendingPeopleRate: number | null;
};

export type EventStatsAlert = {
  id: string;
  label: string;
};

export type EventStatsResult = {
  event: {
    id: string;
    name: string;
    eventType: string | null;
    eventDate: string | null;
    rsvpDeadline: string | null;
    status: string | null;
  } | null;
  eventState: SectionState;
  totals: GuestTotals | null;
  totalsState: SectionState;
  percentages: EventStatsPercentages | null;
  campaign: {
    state: SectionState;
    id: string | null;
    status: string | null;
    captureStatus: string | null;
    maxContacts: number | null;
    reachedCount: number | null; // operational, from delivery aggregation
    delivery: {
      sent: number;
      delivered: number;
      read: number;
      failed: number;
      reached: number;
      wrongNumber: number;
      optedOut: number;
    } | null;
    billing: {
      reachedCount: number;
      accrued: number;
      ceiling: number;
      maxContacts: number;
    } | null;
  };
  alerts: EventStatsAlert[];
};

// Pure: response rate = (attending + declined + maybe) / rows.
// People rate = attending_people / invited_people. Null when denominator is 0.
export function derivePercentages(t: GuestTotals): EventStatsPercentages {
  const rows = t.rows ?? 0;
  const invitedPeople = t.invited_people ?? 0;
  const responseRate =
    rows > 0
      ? Math.round(
          (((t.attending_rows ?? 0) + (t.declined_rows ?? 0) + (t.maybe_rows ?? 0)) / rows) * 100,
        )
      : null;
  const attendingRate =
    rows > 0 ? Math.round(((t.attending_rows ?? 0) / rows) * 100) : null;
  const attendingPeople =
    t.attending_people ?? 0;
  const attendingPeopleRate =
    invitedPeople > 0 ? Math.round((attendingPeople / invitedPeople) * 100) : null;
  return {
    responseRate,
    attendingRate,
    attendingPeopleRate,
  };
}

export function deriveStatsAlerts(input: {
  totals?: GuestTotals;
  delivery?: { failed: number; wrongNumber: number } | null;
  billing?: { accrued: number; ceiling: number } | null;
  campaign?: { status: string; finalChargeAmount: number | null } | null;
}): EventStatsAlert[] {
  const alerts: EventStatsAlert[] = [];
  const t = input.totals;
  if (t) {
    const pending = (t.pending_rows ?? 0) + (t.maybe_rows ?? 0);
    if (t.rows > 0 && pending / t.rows >= 0.5) {
      alerts.push({ id: 'high_pending', label: 'מספר גבוה של מוזמנים טרם השיבו' });
    }
    if ((t.over_invited_rows ?? 0) > 0) {
      alerts.push({ id: 'over_invited', label: 'חריגה ממספר המוזמנים המשוער' });
    }
  }
  if (input.delivery) {
    if (input.delivery.failed > 0)
      alerts.push({ id: 'failed_deliveries', label: 'שליחות שנכשלו' });
    if (input.delivery.wrongNumber > 0)
      alerts.push({ id: 'wrong_numbers', label: 'מספרי טלפון שגויים' });
  }
  if (input.billing && input.billing.ceiling > 0) {
    if (input.billing.accrued / input.billing.ceiling >= 0.9) {
      alerts.push({ id: 'ceiling_near_usage', label: 'קירבה לתקרת החיוב' });
    }
  }
  if (
    input.campaign &&
    input.campaign.status === 'closed' &&
    input.campaign.finalChargeAmount == null
  ) {
    alerts.push({ id: 'campaign_closed_not_settled', label: 'קמפיין סגור וטרם נסגר חשבונית' });
  }
  return alerts;
}

// Orchestrator for the event-scoped stats page. The mandatory `reports.view` page gate runs
// first (throws notFound if absent). Optional sections then branch on the fail-closed
// `canAccessEvent` visibility helper — hiding a section (permission_limited) instead of
// killing the page. No PII (rsvp_token, gift_link_token, card_token_ref, payload_meta,
// phones, provider ids) is ever selected or returned.
export async function getEventStats(eventId: string): Promise<EventStatsResult> {
  // 1) page gate
  await requireEventAccess(eventId, 'reports', 'view');

  // 2) event header (events.view, via org-aware getEvent)
  let event: EventStatsResult['event'] = null;
  let eventState: SectionState = 'visible';
  if (await canAccessEvent(eventId, 'events', 'view')) {
    try {
      const e = await getEvent(eventId);
      event = {
        id: e.id,
        name: e.name,
        eventType: e.event_type ?? null,
        eventDate: e.event_date ?? null,
        rsvpDeadline: e.rsvp_deadline ?? null,
        status: e.status ?? null,
      };
    } catch {
      eventState = 'error';
    }
  } else {
    eventState = 'permission_limited';
  }

  // 3) RSVP/headcount (guests.view)
  let totals: GuestTotals | null = null;
  let totalsState: SectionState = 'visible';
  const guestsOk = await canAccessEvent(eventId, 'guests', 'view');
  if (guestsOk) {
    try {
      totals = await getGuestTotals(eventId);
    } catch {
      totalsState = 'error';
    }
  } else {
    totalsState = 'permission_limited';
  }
  const percentages = totals ? derivePercentages(totals) : null;

  // 4) campaign operational + delivery (campaigns.view)
  const campaign: EventStatsResult['campaign'] = {
    state: 'empty',
    id: null,
    status: null,
    captureStatus: null,
    maxContacts: null,
    reachedCount: null,
    delivery: null,
    billing: null,
  };
  const campaignsOk = await canAccessEvent(eventId, 'campaigns', 'view');
  let c: OwnerCampaign | null = null;
  if (!campaignsOk) {
    campaign.state = 'permission_limited';
  } else {
    try {
      c = await getCampaignForEvent(eventId);
    } catch {
      campaign.state = 'error';
    }
    if (c) {
      campaign.id = c.id;
      campaign.status = c.status ?? null;
      campaign.captureStatus = c.capture_status ?? null;
      campaign.maxContacts = c.max_contacts ?? null;
      campaign.state = 'visible';
      // delivery (org-aware after Task 4 fix)
      try {
        const d: CampaignDeliveryBreakdown | null = await getCampaignDeliveryBreakdown(c.id);
        if (d) {
          campaign.delivery = {
            sent: d.delivery.sent,
            delivered: d.delivery.delivered,
            read: d.delivery.read,
            failed: d.delivery.failed,
            reached: d.outcome.reached,
            wrongNumber: d.outcome.wrongNumber,
            optedOut: d.outcome.optedOut,
          };
          campaign.reachedCount = d.outcome.reached; // operational reached from delivery
        }
      } catch {
        campaign.state = 'error';
      }
      // 5) billing (campaigns.view AND billing.view)
      const billingOk = await canAccessEvent(eventId, 'billing', 'view');
      if (billingOk) {
        try {
          const b: BillingSummary | null = await getCampaignBillingSummary(c.id);
          if (b)
            campaign.billing = {
              reachedCount: b.reachedCount,
              accrued: b.accrued,
              ceiling: b.ceiling,
              maxContacts: b.maxContacts,
            };
        } catch {
          campaign.state = 'error';
        }
      }
    }
  }

  // 6) alerts from authorized sections only
  const alerts = deriveStatsAlerts({
    totals: totals ?? undefined,
    delivery: campaign.delivery
      ? { failed: campaign.delivery.failed, wrongNumber: campaign.delivery.wrongNumber }
      : null,
    billing: campaign.billing
      ? { accrued: campaign.billing.accrued, ceiling: campaign.billing.ceiling }
      : null,
    campaign: campaign.id
      ? { status: campaign.status ?? '', finalChargeAmount: c?.final_charge_amount ?? null }
      : null,
  });

  return { event, eventState, totals, totalsState, percentages, campaign, alerts };
}
