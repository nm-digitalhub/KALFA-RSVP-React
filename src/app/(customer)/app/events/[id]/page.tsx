import Link from 'next/link';

import { getEvent } from '@/lib/data/events';
import { listCampaignsForEvent } from '@/lib/data/campaigns';
import { EVENT_TYPES, EVENT_STATUSES } from '@/lib/validation/schemas';
import { EditEventForm } from './edit-event-form';

const CAMPAIGN_STATUS_LABELS: Record<string, string> = {
  draft: 'טיוטה',
  pending_approval: 'ממתין לאישור',
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
  const campaigns = await listCampaignsForEvent(id);

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
        ← האירועים שלי
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">{event.name}</h1>
          {summary ? (
            <p className="text-sm text-muted-foreground">{summary}</p>
          ) : null}
        </div>
        <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
          {EVENT_STATUS_LABELS[event.status] ?? event.status}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href={`/app/events/${event.id}/guests`}
          className="inline-block rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          ניהול מוזמנים
        </Link>
        <Link
          href={`/app/events/${event.id}/campaign/new`}
          className="inline-block rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          קמפיין חדש
        </Link>
      </div>

      {campaigns.length > 0 ? (
        <section className="space-y-3 rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">קמפיינים</h2>
          <ul className="divide-y divide-border">
            {campaigns.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-4 py-3"
              >
                <span className="flex items-center gap-2 text-sm">
                  <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">
                    {CAMPAIGN_STATUS_LABELS[c.status] ?? c.status}
                  </span>
                  {c.max_charge_ceiling != null ? (
                    <span className="text-muted-foreground">
                      תקרה ₪{Number(c.max_charge_ceiling).toLocaleString('he-IL')}
                    </span>
                  ) : null}
                </span>
                <Link
                  href={`/app/events/${event.id}/campaign/${c.id}`}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  ניהול קמפיין
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-4 rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold">עריכת פרטי האירוע</h2>
        <EditEventForm event={event} />
      </section>
    </div>
  );
}
