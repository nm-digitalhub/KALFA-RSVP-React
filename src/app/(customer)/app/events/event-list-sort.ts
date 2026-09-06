import type { Enums } from '@/lib/supabase/types';

// Pure ordering model of the "האירועים שלי" list (entry-routing plan §7): what
// needs the owner's attention first, then what is in progress, then what is
// behind them. No data access — the page loads the rows and calls this. Kept
// out of the component so the whole ordering rule is unit-tested, the same
// discipline as computeSetupSteps in src/lib/data/setup-steps.ts.
//
// DECLARED LIMITATION — the order reads `events.status` ONLY.
// "Requires action" is really a CAMPAIGN question: an `active` event whose
// campaign sits at `awaiting_payment` (campaignStage) genuinely requires the
// owner, and it will NOT sort first here — it lands in the `active` group like
// any other. Deriving the stage would cost one campaign query per event, an
// N+1 that CLAUDE.md forbids, and the customer path has no batched campaign
// loader (the plan lists one as a non-blocking improvement, not part of this
// change). The status order is therefore a deliberate approximation.

type EventStatus = Enums<'event_status'>;

// Exhaustive Record over the enum, the same discipline the label maps in
// event-labels.ts document: adding or removing an event_status value becomes a
// compile error here instead of an event silently landing in an arbitrary spot.
const STATUS_ORDER: Record<EventStatus, number> = {
  draft: 0, // בהקמה — דורש פעולה
  active: 1, // פרטי האירוע אושרו — בעבודה
  closed: 2, // הסתיים
};

/**
 * The row shape the ordering needs. Structural on purpose: the module never
 * imports the data layer, so it stays free of `next/headers` and the test
 * fixtures stay three fields wide. `EventListItem` satisfies it.
 */
export interface SortableEvent {
  status: EventStatus;
  event_date: string | null;
  created_at: string;
}

// Sorting compares INSTANTS, not the formatted Israel dates from src/lib/date.ts
// (those exist for DISPLAY and return strings). `event_date` is timestamptz and
// two rows can carry different UTC offsets, so comparing the raw strings
// lexicographically is wrong. Unparseable input is folded into "no date" —
// the same null-on-unparseable discipline as `toMs` in date.ts — so a bad DB
// value can never make the comparator non-total.
function instantOf(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Orders the events list: draft → active → closed, and inside each group by
 * `event_date` ascending with the date-less events last. Returns a new array;
 * the input is never mutated.
 */
export function sortEventsForList<T extends SortableEvent>(events: readonly T[]): T[] {
  return [...events].sort((a, b) => {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus !== 0) return byStatus;

    const aDate = instantOf(a.event_date);
    const bDate = instantOf(b.event_date);
    if (aDate === null || bDate === null) {
      // A date-less event sinks to the end of ITS OWN group — never past the
      // group boundary, so an undated draft still outranks a dated active one.
      if (aDate !== bDate) return aDate === null ? 1 : -1;
    } else if (aDate !== bDate) {
      return aDate - bDate;
    }

    // Total-order tiebreak, so the result never depends on the engine's sort
    // stability: newest first, which is the `created_at DESC` order listEvents
    // already returns.
    return (instantOf(b.created_at) ?? 0) - (instantOf(a.created_at) ?? 0);
  });
}
