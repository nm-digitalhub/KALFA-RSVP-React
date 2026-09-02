import type { Enums } from '@/lib/supabase/types';
import { campaignStage, type CampaignStage } from '@/lib/data/event-labels';
import { isBeforeTomorrowIL } from '@/lib/data/event-date';
import { celebrantsCompleteFor } from '@/lib/validation/schemas';

// Pure, isomorphic model of the event's SETUP page (audit "הזרימה המומלצת"
// steps 4–9): what is done, what the owner does next, what is blocked and why.
// No data access — the page loads the rows and calls computeSetupSteps. Kept
// out of the component so the whole decision table is unit-tested.

type EventStatus = Enums<'event_status'>;
type EventType = Enums<'event_type'>;
type CampaignStatus = Enums<'campaign_status'>;

export type SetupStepKey = 'details' | 'guests' | 'confirm' | 'sign' | 'pay' | 'live';
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
    celebrants: unknown;
  };
  campaign: { status: CampaignStatus; capture_status: string | null } | null;
  guestCount: number;
  isPast: boolean;
}

export const SETUP_STEP_LABELS: Record<SetupStepKey, string> = {
  details: 'פרטי האירוע',
  guests: 'הוספת מוזמנים',
  confirm: 'אישור פרטי האירוע',
  sign: 'קריאת ההסכם וחתימה',
  pay: 'אמצעי תשלום ותפיסת מסגרת',
  live: 'הקמפיין פעיל',
};

export const PAST_EVENT_HINT = 'מועד האירוע חלף — לא ניתן להמשיך בהקמה';
// G1 (soft gate): the ceiling and the card hold are sized from the guest list
// at the moment of the hold and are not raised afterwards — say so BEFORE the
// owner confirms, without blocking (owner ruling 2026-07-26: signing before
// the list is complete stays allowed).
export const NO_GUESTS_HINT =
  'מומלץ להוסיף מוזמנים לפני האישור — תקרת החיוב ומסגרת האשראי נקבעות לפי הרשימה ברגע תפיסת המסגרת';
const NO_GUESTS_AFTER_CONFIRM_HINT = 'הפניות יישלחו רק למוזמנים שברשימה';

// Mirrors createCampaign's own gates (campaigns.ts): future event_date,
// complete celebrants for the type, non-empty venue_name — surfaced up front so
// the owner fixes them BEFORE the one-click confirm, not after.
export function missingEventPrerequisites(event: SetupInput['event']): string[] {
  const missing: string[] = [];
  if (!event.event_date || isBeforeTomorrowIL(event.event_date)) missing.push('תאריך אירוע עתידי');
  if (!celebrantsCompleteFor(event.event_type, event.celebrants)) missing.push('פרטי בעלי השמחה');
  if (!event.venue_name || event.venue_name.trim() === '') missing.push('מקום האירוע');
  return missing;
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
  const hasGuests = input.guestCount > 0;

  const steps: SetupStep[] = [
    { key: 'details', state: 'done' },
    {
      key: 'guests',
      // Soft step: a recommendation, never `current` — it does not gate the flow.
      state: hasGuests ? 'done' : 'pending',
      hint: hasGuests ? undefined : confirmed ? NO_GUESTS_AFTER_CONFIRM_HINT : NO_GUESTS_HINT,
    },
    {
      key: 'confirm',
      state: confirmed ? 'done' : missing.length > 0 ? 'blocked' : 'current',
      hint: !confirmed && missing.length > 0 ? `יש להשלים: ${missing.join(', ')}` : undefined,
    },
    { key: 'sign', state: signed ? 'done' : confirmed ? 'current' : 'pending' },
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
