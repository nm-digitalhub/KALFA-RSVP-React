import type { Metadata } from 'next';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { getEventClosureReasons, listEvents } from '@/lib/data/events';
import { EVENT_TYPE_LABELS, eventStatusLabel } from '@/lib/data/event-labels';
import type { EventClosureReason } from '@/lib/data/event-labels';
import type { Enums } from '@/lib/supabase/types';
import { formatIsraelDate } from '@/lib/date';
import { cn } from '@/lib/utils';
import { sortEventsForList } from './event-list-sort';

export const metadata: Metadata = { title: 'האירועים שלי' };

// The single action each card offers, per event status (entry-routing plan §7).
// All three lead to the SAME canonical URL — /app/events/{id} renders setup,
// work or summary depending on the status — so the label, not the target, is
// what tells the owner what waits there. Exhaustive Record: a new
// event_status value is a compile error rather than a card with no action.
const NEXT_ACTION_LABELS: Record<Enums<'event_status'>, string> = {
  draft: 'המשך הקמה',
  active: 'ניהול האירוע',
  closed: 'צפייה בסיכום',
};

// A cancelled event is `closed` too, but "צפייה בסיכום" promises a wrap-up of
// an event that took place — the wrong thing to offer for one that was called
// off. The guard MIRRORS eventStatusLabel's exactly (closed + 'cancellation'),
// and the two must stay in lockstep: the closed-only id filter below is
// behaviour-preserving only because BOTH ignore the closure reason for every
// other status.
function nextActionLabel(
  status: Enums<'event_status'>,
  closureReason: EventClosureReason | null,
): string {
  if (status === 'closed' && closureReason === 'cancellation') {
    return 'צפייה בפרטי האירוע';
  }
  return NEXT_ACTION_LABELS[status];
}

export default async function EventsPage() {
  // Ordering is a pure function over the rows listEvents already returns —
  // no extra query, no campaign lookup. See event-list-sort.ts for the
  // declared limitation of ordering by events.status alone.
  const events = sortEventsForList(await listEvents());

  // ONE batched query for the whole page (getEventClosureReasons), never one
  // per row: that N+1 is exactly what kept this list on the raw status label.
  // Only CLOSED ids are asked for, because the closure reason changes nothing
  // for any other status (see nextActionLabel / eventStatusLabel) — so a list
  // without a single closed event issues no query at all.
  const closureReasons = await getEventClosureReasons(
    events.filter((event) => event.status === 'closed').map((event) => event.id),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">האירועים שלי</h1>
        <Link href="/app/events/new" className={buttonVariants()}>
          אירוע חדש
        </Link>
      </div>

      {events.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground">
          עדיין אין אירועים. צרו את האירוע הראשון שלכם.
        </div>
      ) : (
        // overflow-hidden clips the row hover tint at the rounded corners: the
        // whole row is one link now, so the first/last card would paint over
        // the list's border radius. LOAD-BEARING for the rows too: because this
        // clip would swallow an OUTER focus ring along every row's top and
        // bottom edge, each row's ring is drawn INSET (see the <Link> below).
        // Removing overflow-hidden here means revisiting that ring.
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {events.map((event) => {
            // Absent from the map = null, which is what an open event and a
            // closed one with no log entry both mean: "no reason known".
            const closureReason = closureReasons.get(event.id) ?? null;

            return (
              <li key={event.id}>
                {/* ONE action per card. The row itself is the link; the action
                    label below is a span inside it, not a second anchor to the
                    same destination (the old header + "עריכה" pair). */}
                <Link
                  href={`/app/events/${event.id}`}
                  // FOCUS: the row is the focus target, and `focus-visible:bg-muted`
                  // used to be the whole keyboard indicator — identical to the hover
                  // tint (~1.09:1 against the card), so a keyboard user could not see
                  // where they were. The ring is the indicator now; the tint stays
                  // only as a secondary cue.
                  // WHY drawn INWARD instead of the button's outer `ring-3`: the <ul>
                  // is `overflow-hidden` (it clips the row tint at the card's rounded
                  // corners), and an outer ring on a full-width row is clipped along
                  // its entire top and bottom edge — `z-10` does not escape overflow
                  // clipping. Inset, the same two design tokens survive intact: a
                  // solid `ring` line at the edge (outline-1 at -1px offset, painted
                  // inside the box) over the `ring/50` halo.
                  className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-ring focus-visible:inset-ring-3 focus-visible:inset-ring-ring/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{event.name}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {[
                        EVENT_TYPE_LABELS[event.event_type],
                        // Israel calendar date — timeZone-pinned, never a UTC slice.
                        event.event_date ? formatIsraelDate(event.event_date) : null,
                        event.venue_name,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'ללא פרטים'}
                    </p>
                  </div>
                  {/* eventStatusLabel, not the raw EVENT_STATUS_LABELS map (plan
                      §0/§7): an event closed by a cancellation must read "בוטל"
                      here, exactly as it does on the event page — the enum has no
                      `cancelled` value, so the distinction rides on the closure
                      reason batch-loaded above. */}
                  <Badge className="shrink-0">
                    {eventStatusLabel(event.status, closureReason)}
                  </Badge>
                  <span
                    // cn(), not buttonVariants({ className }): the raw cva fn
                    // concatenates without tailwind-merge. pointer-events-none
                    // keeps the row a single hover/click target.
                    className={cn(
                      buttonVariants({ variant: 'outline', size: 'sm' }),
                      'pointer-events-none shrink-0',
                    )}
                  >
                    {nextActionLabel(event.status, closureReason)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
