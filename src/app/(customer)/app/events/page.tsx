import Link from 'next/link';

import { listEvents } from '@/lib/data/events';
import { EVENT_TYPE_LABELS, EVENT_STATUS_LABELS } from '@/lib/data/event-labels';
import { formatIsraelDate } from '@/lib/date';

export default async function EventsPage() {
  const events = await listEvents();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">האירועים שלי</h1>
        <Link
          href="/app/events/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          אירוע חדש
        </Link>
      </div>

      {events.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground">
          עדיין אין אירועים. צרו את האירוע הראשון שלכם.
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {events.map((event) => (
            <li
              key={event.id}
              className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted"
            >
              <Link href={`/app/events/${event.id}`} className="min-w-0 flex-1">
                <p className="font-medium">{event.name}</p>
                <p className="text-sm text-muted-foreground">
                  {[
                    EVENT_TYPE_LABELS[event.event_type] ?? event.event_type,
                    // Israel calendar date — timeZone-pinned, never a UTC slice.
                    event.event_date ? formatIsraelDate(event.event_date) : null,
                    event.venue_name,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'ללא פרטים'}
                </p>
              </Link>
              <div className="flex shrink-0 items-center gap-3">
                <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                  {EVENT_STATUS_LABELS[event.status] ?? event.status}
                </span>
                <Link
                  href={`/app/events/${event.id}`}
                  className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-background"
                >
                  עריכה
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
