import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { getEvent } from '@/lib/data/events';
import { isPastEventDay } from '@/lib/data/event-date';
import { getCampaignForEvent } from '@/lib/data/campaigns';
import { EVENT_TYPES, EVENT_STATUSES } from '@/lib/validation/schemas';
import { EditEventForm } from './edit-event-form';
import { CampaignSection } from './campaign-section';

const EVENT_TYPE_LABELS: Record<(typeof EVENT_TYPES)[number], string> = {
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

const EVENT_STATUS_LABELS: Record<(typeof EVENT_STATUSES)[number], string> = {
  draft: 'טיוטה',
  active: 'פעיל',
  closed: 'סגור',
};

function formatDate(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

export default async function EventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const event = await getEvent(id);
  const campaign = await getCampaignForEvent(id);
  const isPast = isPastEventDay(event.event_date);

  const summary = [
    EVENT_TYPE_LABELS[event.event_type] ?? event.event_type,
    formatDate(event.event_date),
    event.venue_name,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="space-y-6">
      <Link
        href="/app/events"
        className="text-sm text-muted-foreground hover:underline"
      >
        → האירועים שלי
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">{event.name}</h1>
          {summary ? (
            <p className="text-sm text-muted-foreground">{summary}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {isPast ? (
            <span className="rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-xs font-medium text-warning">
              האירוע חלף
            </span>
          ) : null}
          <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
            {EVENT_STATUS_LABELS[event.status] ?? event.status}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href={`/app/events/${event.id}/guests`}
          className={buttonVariants({ variant: 'outline' })}
        >
          ניהול מוזמנים
        </Link>
      </div>

      <CampaignSection eventId={event.id} campaign={campaign} isPast={isPast} />

      <section className="space-y-4 rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold">עריכת פרטי האירוע</h2>
        <EditEventForm event={event} />
      </section>
    </div>
  );
}
