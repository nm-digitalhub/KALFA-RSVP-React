import type { Database } from '@/lib/supabase/types';
import type { CelebrantFieldLabels, HostComposition } from '@/lib/validation/schemas';

// Hebrew labels for the events-domain enums. Defined as EXHAUSTIVE
// `Record<enum, string>` maps so that adding or removing a value in the DB
// enum becomes a compile error here rather than a silently-missing label.
//
// Pure label maps — NO `server-only` here: this module is imported by
// server pages (events list, event detail, dashboard) AND by client forms
// (new/edit event), so it must stay isomorphic.

type EventType = Database['public']['Enums']['event_type'];
type EventStatus = Database['public']['Enums']['event_status'];

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
  active: 'פעיל',
  closed: 'סגור',
};

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
