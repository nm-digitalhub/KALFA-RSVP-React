import type { Enums } from '@/lib/supabase/types';
import type { CelebrantFieldLabels, HostComposition } from '@/lib/validation/schemas';
import type { BadgeVariant } from '@/components/ui/badge';

// WHY the closure reason lives here and not in events.ts: this module is a
// LEAF the worker bundle reaches (template-spec.ts → event-labels.ts), and
// dependency-cruiser treats even a type-only import of events.ts as a path to
// next/headers (worker-no-request-scoped-next). events.ts re-exports this type.
// 'owner' = the owner closed it; 'settlement' = closed with the final charge;
// 'cancellation' = closed by an admin handling a cancellation request.
export type EventClosureReason = 'owner' | 'settlement' | 'cancellation';

// Hebrew labels for the events-domain enums. Defined as EXHAUSTIVE
// `Record<enum, string>` maps so that adding or removing a value in the DB
// enum becomes a compile error here rather than a silently-missing label.
//
// Pure label maps — NO `server-only` here: this module is imported by
// server pages (events list, event detail, dashboard) AND by client forms
// (new/edit event), so it must stay isomorphic.

type EventType = Enums<'event_type'>;
type EventStatus = Enums<'event_status'>;
type CampaignStatus = Enums<'campaign_status'>;

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  wedding: 'חתונה',
  bar_mitzvah: 'בר מצווה',
  bat_mitzvah: 'בת מצווה',
  brit: 'ברית',
  britah: 'בריתה',
  henna: 'חינה',
  engagement: 'אירוסין',
  birthday: 'יום הולדת',
  other: 'אחר',
};

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  draft: 'טיוטה',
  // Audit §2/§3: an `active` EVENT only means its details are confirmed and the
  // dates are locked (R5). "פעיל" is reserved for the CAMPAIGN, so an owner
  // never reads "פעיל" while nothing is being sent yet.
  active: 'פרטי האירוע אושרו',
  closed: 'הסתיים',
};

// The owner-facing event status line. `closed` has two faces: a normal end
// ("הסתיים") and a close that came from a cancellation request ("בוטל") — the
// enum has no `cancelled`, so the distinction rides on the closure reason the
// activity log already records (getEventClosureReason).
export function eventStatusLabel(
  status: EventStatus,
  closureReason: EventClosureReason | null,
): string {
  if (status === 'closed' && closureReason === 'cancellation') return 'בוטל';
  return EVENT_STATUS_LABELS[status];
}

// Hebrew labels for the campaign lifecycle enum, same exhaustive-Record
// discipline as EVENT_STATUS_LABELS above — a new campaign_status value is a
// compile error here rather than a silently-missing label. Used by the admin
// campaigns table and the stats page; owner-facing screens use the DERIVED
// campaignStage below instead.
export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: 'טיוטה',
  pending_approval: 'ממתין לחתימה', // audit §4: what is actually pending is the owner's signature
  approved: 'מאושר',
  scheduled: 'מתוזמן',
  active: 'פעיל',
  paused: 'מושהה',
  closed: 'נסגר',
  awaiting_invoice: 'ממתין לחשבון',
  billed: 'חויב',
  paid: 'שולם',
  cancelled: 'בוטל',
};

// Campaign status → Badge variant, kept alongside CAMPAIGN_STATUS_LABELS (same
// file, same enum-keyed exhaustiveness) per the admin/guests labels.ts convention.
export const CAMPAIGN_STATUS_VARIANTS: Record<CampaignStatus, BadgeVariant> = {
  draft: 'neutral',
  pending_approval: 'warning',
  approved: 'success',
  scheduled: 'info',
  active: 'success',
  paused: 'warning',
  closed: 'neutral',
  awaiting_invoice: 'warning',
  billed: 'info',
  paid: 'success',
  cancelled: 'destructive',
};

// --- Owner-facing campaign STAGE (audit §3) -----------------------------------
// The lifecycle enum alone cannot tell the owner what to do next: `approved`
// means "signed" BEFORE the card hold and "ready to start" AFTER it. The stage
// is derived from status + capture_status — a pure function, no new enum value,
// no migration — and is the ONLY campaign state owner screens show.
export type CampaignStage =
  | 'not_set' // no campaign yet
  | 'awaiting_signature' // created, agreement not signed
  | 'awaiting_payment' // signed, no confirmed card hold yet
  | 'awaiting_activation' // held; activation did not happen (auto-activation refused / pre-change campaign)
  | 'active'
  | 'paused'
  | 'closed' // closed / awaiting_invoice / billed / paid
  | 'cancelled';

export const CAMPAIGN_STAGE_LABELS: Record<CampaignStage, string> = {
  not_set: 'טרם הוגדר',
  awaiting_signature: 'ממתין לחתימה',
  awaiting_payment: 'ממתין לתשלום',
  awaiting_activation: 'ממתין להפעלה',
  active: 'פעיל',
  paused: 'מושהה',
  closed: 'נסגר',
  cancelled: 'בוטל',
};

export const CAMPAIGN_STAGE_VARIANTS: Record<CampaignStage, BadgeVariant> = {
  not_set: 'neutral',
  awaiting_signature: 'warning',
  awaiting_payment: 'warning',
  awaiting_activation: 'warning',
  active: 'success',
  paused: 'warning',
  closed: 'neutral',
  cancelled: 'destructive',
};

export function campaignStage(
  campaign: { status: CampaignStatus; capture_status: string | null } | null,
): CampaignStage {
  if (!campaign) return 'not_set';
  switch (campaign.status) {
    case 'draft':
    case 'pending_approval':
      return 'awaiting_signature';
    case 'approved':
    case 'scheduled':
      // capture_status vocabulary (campaigns.ts): null | pending | authorized |
      // hold_failed | hold_review — only `authorized` is a confirmed hold.
      return campaign.capture_status === 'authorized' ? 'awaiting_activation' : 'awaiting_payment';
    case 'active':
      return 'active';
    case 'paused':
      return 'paused';
    case 'closed':
    case 'awaiting_invoice':
    case 'billed':
    case 'paid':
      return 'closed';
    case 'cancelled':
      return 'cancelled';
    default: {
      // Exhaustiveness: a new campaign_status value fails to compile here.
      const exhaustive: never = campaign.status;
      return exhaustive;
    }
  }
}

// Hebrew labels for the celebrant (בעלי שמחה) inputs, per event type — used
// as the form labels AND the field-error vocabulary. CelebrantFieldLabels is
// a mapped type over the event_type enum (keyed through each type's celebrant
// kind — see CELEBRANT_KIND_BY_EVENT_TYPE), so a missing event type OR a
// wrong/missing/extra field here is a compile error. Type-only import keeps
// this module isomorphic.
export const CELEBRANT_FIELD_LABELS: CelebrantFieldLabels = {
  wedding: { groom: 'שם מלא של החתן', bride: 'שם מלא של הכלה' },
  bar_mitzvah: { name: 'שם מלא של חתן הבר־מצווה' },
  bat_mitzvah: { name: 'שם מלא של כלת הבת־מצווה' },
  brit: {
    parents: 'שמות ההורים',
    child: 'שם התינוק (אופציונלי)',
    host_composition: 'הרכב המזמינים',
  },
  britah: {
    parents: 'שמות ההורים',
    child: 'שם התינוקת (אופציונלי)',
    host_composition: 'הרכב המזמינים',
  },
  henna: { groom: 'שם מלא של החתן', bride: 'שם מלא של הכלה' },
  engagement: { groom: 'שם מלא של הארוס', bride: 'שם מלא של הארוסה' },
  birthday: { name: 'שם מלא של בעל/ת השמחה' },
  other: { names: 'שמות בעלי השמחה' },
};

// Per-option Hebrew labels for the host_composition select (parents kind).
// Data-driven so the form and any summary read one source, not hardcoded text.
export const HOST_COMPOSITION_LABELS: Record<HostComposition, string> = {
  single_mother: 'אם יחידה',
  single_father: 'אב יחיד',
  couple: 'זוג הורים',
};
