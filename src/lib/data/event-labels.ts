import type { Database } from '@/lib/supabase/types';

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
