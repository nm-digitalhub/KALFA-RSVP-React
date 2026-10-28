import type { Enums } from '@/lib/supabase/types';
import type { CampaignStatus } from '@/lib/data/campaign-status';
import { campaignStage, type CampaignStage } from '@/lib/data/event-labels';
import { ilTimeInputValue, isBeforeTomorrowIL } from '@/lib/data/event-date';
import { celebrantsCompleteFor } from '@/lib/validation/schemas';

// Pure, isomorphic model of the event's ONE-TIME setup flow (audit "הזרימה
// המומלצת"): what is done, what the owner does next, what is blocked and why.
// Adding guests is NOT a setup step — it is ongoing event management (guests
// page) and never gates activation. Once the campaign is active the setup view
// is no longer shown at all (setup-steps.tsx).
// No data access — the page loads the rows and calls computeSetupSteps. Kept
// out of the component so the whole decision table is unit-tested.

type EventStatus = Enums<'event_status'>;
type EventType = Enums<'event_type'>;

export type SetupStepKey = 'details' | 'confirm' | 'package' | 'sign' | 'pay' | 'live';
export type SetupStepState = 'done' | 'current' | 'pending' | 'blocked';
export interface SetupStep {
  key: SetupStepKey;
  state: SetupStepState;
  hint?: string;
}

export interface SetupInput {
  event: {
    status: EventStatus;
    event_type: EventType;
    event_date: string | null;
    venue_name: string | null;
    venue_address: string | null;
    celebrants: unknown;
  };
  // `price` = the current pricing round's final price (the pricing module). `payment` = the ledger state of the
  // package (see campaignStage).
  campaign: {
    status: CampaignStatus;
    price?: number | null;
    payment?: { status: string } | null;
  } | null;
  isPast: boolean;
}

export const SETUP_STEP_LABELS: Record<SetupStepKey, string> = {
  details: 'פרטי האירוע',
  confirm: 'אישור פרטי האירוע',
  package: 'בחירת חבילה',
  // The package terms are APPROVED, not signed (no drawn signature, no phone code).
  sign: 'אישור תנאי החבילה',
  // A single purchase of the package.
  pay: 'תשלום החבילה',
  live: 'הקמפיין פעיל',
};

export const PAST_EVENT_HINT = 'מועד האירוע חלף — לא ניתן להמשיך בהקמה';

// The R5 lock, stated BEFORE the click (audit §2, verbatim requirement): the date,
// time and RSVP deadline stay editable until the first message or call has gone
// out to a guest (migration 20260930191529), and are locked from then on.
export const SETUP_LOCK_WARNING =
  'התאריך, השעה והמועד האחרון לאישורי הגעה ניתנים לשינוי עד שתישלח ההודעה הראשונה לאורחים. לאחר מכן הם ננעלים.';

/** The event fields the setup model reads — one mapping for every caller. */
export function toSetupEvent(event: SetupInput['event']): SetupInput['event'] {
  return {
    status: event.status,
    event_type: event.event_type,
    event_date: event.event_date,
    venue_name: event.venue_name,
    venue_address: event.venue_address,
    celebrants: event.celebrants,
  };
}
// What the owner must fill in BEFORE confirming, surfaced up front so it is fixed
// in the details step, not discovered after the one-click confirm.
//  - date in the future, complete celebrants for the type, non-empty venue name:
//    mirror createCampaign's own gates (campaigns.ts);
//  - the time of day and the venue address: required by the setup flow itself:
//    an event without a time or an address cannot produce a correct
//    invitation or reminder. They stay editable until the first send, like the
//    date. `setupCampaignAction` re-checks this list on the server, so it cannot
//    be skipped by a tampered form.
// A stored date with no time of day is midnight UTC (see `ilWallTimeToIso`);
// `ilTimeInputValue` returns '' for it.
export type SetupPrerequisite = {
  /** What the owner reads ("כתובת המקום"). */
  label: string;
  /** The form field it belongs to, or null when no single field does (the celebrants group). */
  field: string | null;
};

export function missingSetupPrerequisites(event: SetupInput['event']): SetupPrerequisite[] {
  const missing: SetupPrerequisite[] = [];
  if (!event.event_date || isBeforeTomorrowIL(event.event_date)) {
    missing.push({ label: 'תאריך אירוע עתידי', field: 'event_date' });
  }
  if (ilTimeInputValue(event.event_date) === '') missing.push({ label: 'שעת האירוע', field: 'event_time' });
  if (!celebrantsCompleteFor(event.event_type, event.celebrants)) {
    missing.push({ label: 'פרטי בעלי השמחה', field: null });
  }
  if (!event.venue_name || event.venue_name.trim() === '') missing.push({ label: 'מקום האירוע', field: 'venue_name' });
  if (!event.venue_address || event.venue_address.trim() === '') {
    missing.push({ label: 'כתובת המקום', field: 'venue_address' });
  }
  return missing;
}

export function missingEventPrerequisites(event: SetupInput['event']): string[] {
  return missingSetupPrerequisites(event).map((p) => p.label);
}

// Where "back" leads from the step the owner is on. It leads only to a step whose page can still be used, and both
// stay inside setup (design D5): on the confirm step and on the package-choice step, the details form
// (/setup?step=details), which a draft and a confirmed event alike can reopen while setup runs.
// Everywhere else there is no back, on purpose: the package choice creates the campaign (price and quota are snapshotted on
// it), and the approval and the payment are facts in the ledger. A customer who wants out of an unpaid setup closes the
// event, which retires it (closeEvent); undoing a campaign otherwise is a staff action. A past event, a blocked step and a
// finished flow have no current step, hence no back.
export type SetupBackTarget = { key: SetupStepKey; href: string };

export function setupBackTarget(input: { eventId: string; steps: readonly SetupStep[] }): SetupBackTarget | null {
  const current = input.steps.find((s) => s.state === 'current');
  if (current?.key === 'confirm' || current?.key === 'package') {
    return { key: 'details', href: `/app/events/${input.eventId}/setup?step=details` };
  }
  return null;
}

const SIGNED_STAGES: readonly CampaignStage[] = [
  'awaiting_payment',
  'awaiting_activation',
  'active',
  'paused',
  'closed',
];
const HELD_STAGES: readonly CampaignStage[] = ['awaiting_activation', 'active', 'paused', 'closed'];

export function computeSetupSteps(input: SetupInput): {
  steps: SetupStep[];
  stage: CampaignStage;
} {
  const stage = campaignStage(input.campaign);
  const confirmed = input.event.status !== 'draft';
  const signed = SIGNED_STAGES.includes(stage);
  const held = HELD_STAGES.includes(stage);
  const live = stage === 'active' || stage === 'closed';
  const missing = confirmed ? [] : missingEventPrerequisites(input.event);

  // The package-choice step sits between confirming the event and approving the terms, because the choice is what
  // CREATES the campaign (its price and quota are snapshotted on it) and the terms are approved for that campaign. With
  // no package on offer the step stays current and says so (PackageChoiceForm).
  const packageChosen = input.campaign !== null;
  const canSign = confirmed && packageChosen;

  const steps: SetupStep[] = [
    {
      // The owner fixes whatever is missing HERE; once nothing is, the flow moves on.
      key: 'details',
      state: confirmed || missing.length === 0 ? 'done' : 'current',
      hint: !confirmed && missing.length > 0 ? `יש להשלים: ${missing.join(', ')}` : undefined,
    },
    { key: 'confirm', state: confirmed ? 'done' : missing.length > 0 ? 'pending' : 'current' },
    { key: 'package', state: packageChosen ? 'done' : confirmed ? 'current' : 'pending' },
    { key: 'sign', state: signed ? 'done' : canSign ? 'current' : 'pending' },
    { key: 'pay', state: held ? 'done' : signed ? 'current' : 'pending' },
    {
      key: 'live',
      state: live ? 'done' : held ? 'current' : 'pending',
      hint: stage === 'paused' ? 'הקמפיין מושהה' : undefined,
    },
  ];

  // A past event can no longer advance (createCampaign / approve / hold /
  // activate all refuse it): the step the owner would take next is blocked.
  if (input.isPast) {
    for (const s of steps) {
      if (s.state === 'current' || s.state === 'blocked') {
        s.state = 'blocked';
        s.hint = PAST_EVENT_HINT;
      }
    }
  }

  return { steps, stage };
}
