import Link from 'next/link';
import { CalendarDays, Plus } from 'lucide-react';

import { listEvents, getEventCounts } from '@/lib/data/events';

const EVENT_TYPE_LABELS: Record<string, string> = {
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

const STATUS_LABELS: Record<string, string> = {
  draft: 'טיוטה',
  active: 'פעיל',
  closed: 'סגור',
};

export default async function DashboardPage() {
  // Counts come from head queries (ALL events), independent of the recent-events
  // preview page size; the preview loads just the 5 most recent.
  const [counts, recentEvents] = await Promise.all([
    getEventCounts(),
    listEvents({ limit: 5 }),
  ]);
  const totalEvents = counts.total;
  const activeEvents = counts.active;

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">לוח בקרה</h1>
        <p className="text-muted-foreground">ברוכים הבאים ל-KALFA. הנה תמונת מצב של האירועים שלכם.</p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">סך האירועים</p>
          <p className="mt-2 text-3xl font-bold">{totalEvents}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">אירועים פעילים</p>
          <p className="mt-2 text-3xl font-bold">{activeEvents}</p>
        </div>
        <Link
          href="/app/events/new"
          className="flex flex-col justify-center gap-2 rounded-lg border border-dashed border-border bg-card p-5 transition-colors hover:border-primary hover:bg-accent"
        >
          <span className="flex items-center gap-2 font-medium text-primary">
            <Plus className="size-5" aria-hidden />
            אירוע חדש
          </span>
          <span className="text-sm text-muted-foreground">צרו אירוע והתחילו לאסוף אישורי הגעה.</span>
        </Link>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">אירועים אחרונים</h2>
          <Link href="/app/events" className="text-sm font-medium text-primary hover:underline">
            לכל האירועים
          </Link>
        </div>

        {totalEvents === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-10 text-center">
            <CalendarDays className="size-8 text-muted-foreground" aria-hidden />
            <p className="text-muted-foreground">עדיין אין אירועים. צרו את האירוע הראשון שלכם.</p>
            <Link
              href="/app/events/new"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              אירוע חדש
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {recentEvents.map((event) => (
              <li key={event.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <Link href={`/app/events/${event.id}`} className="min-w-0">
                  <p className="truncate font-medium">{event.name}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {[
                      EVENT_TYPE_LABELS[event.event_type] ?? event.event_type,
                      // event_date is timestamptz → show the date part only.
                      event.event_date ? event.event_date.slice(0, 10) : null,
                      event.venue_name,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'ללא פרטים'}
                  </p>
                </Link>
                <span className="shrink-0 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                  {STATUS_LABELS[event.status] ?? event.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
