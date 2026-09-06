import 'server-only';

import {
  canAccessEvent,
  requireEventAccess,
  getEvent,
} from '@/lib/data/events';
import { getGuestTotals, type GuestTotals } from '@/lib/data/guests';
import {
  getCampaignForEvent,
  type OwnerCampaign,
  type CampaignStatus,
} from '@/lib/data/campaigns';
import {
  getCampaignDeliveryBreakdown,
  type CampaignDeliveryBreakdown,
} from '@/lib/data/campaign-delivery';
import { getCampaignBillingSummary, type BillingSummary } from '@/lib/data/billing';
import { campaignStage } from '@/lib/data/event-labels';
import type { Enums } from '@/lib/supabase/types';
type EventStatus = Enums<'event_status'>;

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
    venue: string | null;
    rsvpDeadline: string | null;
    status: EventStatus | null;
  } | null;
  eventState: SectionState;
  totals: GuestTotals | null;
  totalsState: SectionState;
  percentages: EventStatsPercentages | null;
  campaign: {
    state: SectionState;
    id: string | null;
    status: CampaignStatus | null;
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
      /** Any evidence of outbound contact, message OR call. */
      outreachStarted: boolean;
    } | null;
    billing: {
      reachedCount: number;
      accrued: number;
      ceiling: number;
      maxContacts: number;
    } | null;
    // The commercial terms + settlement outcome, read off the campaign row that
    // is ALREADY in memory (zero extra queries). Separate from `billing` above
    // because that one is the campaign_billing_summary RPC, which returns
    // exactly four columns and can legitimately come back null. Both sit behind
    // the same billing.view gate; null here means "no campaign, or no
    // billing.view", exactly like `billing`.
    billingDetail: {
      basePrice: number | null;
      includedReached: number | null;
      pricePerReached: number | null;
      finalChargeAmount: number | null;
      creditApplied: number;
      chargeStatus: string | null;
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
  delivery?: {
    failed: number;
    wrongNumber: number;
    // Has the campaign actually contacted anybody yet, through ANY channel?
    // Without this the high_pending alert below fires on every new event: a
    // guest who was never asked is "pending" by definition, so one guest and a
    // fresh campaign is already 100% pending.
    outreachStarted: boolean;
  } | null;
  billing?: { accrued: number; ceiling: number } | null;
  // The raw status cannot answer "is this campaign over": campaignStage() folds
  // awaiting_invoice | billed | paid into the same 'closed' stage, and the DB
  // close guard (events_guard_update) does not list those three — so an event
  // can legally close while the campaign sits in one of them with no final
  // charge. captureStatus rides along so the STAGE, not the raw status, decides.
  campaign?: {
    status: CampaignStatus | null;
    captureStatus?: string | null;
    finalChargeAmount: number | null;
  } | null;
}): EventStatsAlert[] {
  const alerts: EventStatsAlert[] = [];
  const t = input.totals;
  if (t) {
    // "A lot of people have not replied" is only a finding once people have
    // been ASKED. Before the first send every guest is pending, so this fired
    // the moment an event had a single guest — on the live QA event it was
    // showing while the first outreach was still three days away.
    //
    // Silent when outreach state is unknown (no campaign, or a viewer without
    // campaigns.view): with no evidence anyone was contacted, "nobody answered"
    // is not something to claim. A missing alert is a smaller error than a
    // false one.
    const pending = (t.pending_rows ?? 0) + (t.maybe_rows ?? 0);
    if (input.delivery?.outreachStarted && t.rows > 0 && pending / t.rows >= 0.5) {
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
  if (input.campaign && input.campaign.finalChargeAmount == null) {
    const stage = campaignStage(
      input.campaign.status
        ? {
            status: input.campaign.status,
            capture_status: input.campaign.captureStatus ?? null,
          }
        : null,
    );
    if (stage === 'closed') {
      alerts.push({ id: 'campaign_closed_not_settled', label: 'קמפיין סגור וטרם נסגר חשבונית' });
    }
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
        venue: e.venue_name ?? null,
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
    billingDetail: null,
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
            // Computed HERE, from the full breakdown, because the call buckets
            // are not carried on the flattened shape above — an AI-call
            // campaign that has dialled but sent no WhatsApp has started
            // outreach just as much as one that messaged.
            outreachStarted:
              d.delivery.sent > 0 ||
              d.delivery.failed > 0 ||
              d.outcome.reached > 0 ||
              d.outcome.wrongNumber > 0 ||
              d.call.dialed +
                d.call.noAnswer +
                d.call.voicemail +
                d.call.humanInteraction >
                0,
          };
          campaign.reachedCount = d.outcome.reached; // operational reached from delivery
        }
      } catch {
        campaign.state = 'error';
      }
      // 5) billing (campaigns.view AND billing.view)
      const billingOk = await canAccessEvent(eventId, 'billing', 'view');
      if (billingOk) {
        // Field-by-field, never a spread of `c`: the campaign row also carries
        // card_token_ref / card_citizen_id / charge_document_url, which must
        // never reach the DTO. Assigned OUTSIDE the try below because it needs
        // no query and must survive an RPC failure.
        campaign.billingDetail = {
          basePrice: c.base_price,
          includedReached: c.included_reached,
          pricePerReached: c.price_per_reached,
          finalChargeAmount: c.final_charge_amount,
          creditApplied: c.credit_applied,
          chargeStatus: c.charge_status,
        };
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
      ? {
          failed: campaign.delivery.failed,
          wrongNumber: campaign.delivery.wrongNumber,
          outreachStarted: campaign.delivery.outreachStarted,
        }
      : null,
    billing: campaign.billing
      ? { accrued: campaign.billing.accrued, ceiling: campaign.billing.ceiling }
      : null,
    // finalChargeAmount stays sourced from `c` (campaigns.view), NOT from
    // campaign.billingDetail — that one is behind billing.view, and reading it
    // here would silently mute the banner for a member without billing.view.
    campaign: campaign.id
      ? {
          status: campaign.status,
          captureStatus: campaign.captureStatus,
          finalChargeAmount: c?.final_charge_amount ?? null,
        }
      : null,
  });

  return { event, eventState, totals, totalsState, percentages, campaign, alerts };
}
