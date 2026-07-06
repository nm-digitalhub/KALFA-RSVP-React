import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { getEvent, type EventDetail } from '@/lib/data/events';
import { signedInviteImageUrl } from '@/lib/storage/event-media';
import { formatIsraelDate, formatIsraelDateTime } from '@/lib/date';
import { ilTimeInputValue } from '@/lib/data/event-date';
import { isPastEventDay, isBeforeTomorrowIL } from '@/lib/data/event-date';
import { getCampaignForEvent, listCampaignsForEvent } from '@/lib/data/campaigns';
import { EVENT_TYPE_LABELS, EVENT_STATUS_LABELS } from '@/lib/data/event-labels';
import { CELEBRANT_KIND_BY_EVENT_TYPE } from '@/lib/validation/schemas';
import { EditEventForm } from './edit-event-form';
import { EventStatusActions } from './event-status-actions';
import { publishEventAction, closeEventAction } from './campaign/campaign-actions';
import { CampaignSection } from './campaign-section';

// R7: a non-terminal campaign blocks closing the event. Mirrors the DB
// trigger's (events_guard_update) blocking set exactly.
const BLOCKING_CAMPAIGN_STATUSES = new Set([
  'draft',
  'pending_approval',
  'approved',
  'scheduled',
  'active',
  'paused',
]);

// Israel calendar date (dd.mm.yyyy) — never the raw ISO/UTC slice, which shows
// the wrong day for early-morning IL times (01:00 IDT is 22:00Z the day before).
// Adds the wall-clock time only when one is actually set (legacy date-only
// events are stored as midnight UTC — ilTimeInputValue returns '' for those,
// so they keep showing a plain date instead of a misleading 02:00/03:00).
function formatDate(value: string | null): string | null {
  if (!value) return null;
  const hasTime = ilTimeInputValue(value) !== '';
  return (hasTime ? formatIsraelDateTime(value) : formatIsraelDate(value)) || null;
}

// Display-only join of the celebrants jsonb. The shapes are Zod-validated on
// write, but the column is schemaless at the DB level — read defensively and
// render whatever partial data exists (the campaign gate owns completeness).
function celebrantsSummary(
  eventType: EventDetail['event_type'],
  celebrants: EventDetail['celebrants'],
): string | null {
  if (!celebrants || typeof celebrants !== 'object' || Array.isArray(celebrants)) {
    return null;
  }
  const values = celebrants as Record<string, unknown>;
  const field = (key: string): string | null => {
    const v = values[key];
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
  };
  switch (CELEBRANT_KIND_BY_EVENT_TYPE[eventType]) {
    case 'couple': {
      const groom = field('groom');
      const bride = field('bride');
      return groom && bride ? `${groom} ו${bride}` : (groom ?? bride);
    }
    case 'single':
      return field('name');
    case 'parents': {
      const parents = field('parents');
      const child = field('child');
      return parents && child ? `${parents} — לכבוד ${child}` : parents;
    }
    case 'free':
      return field('names');
  }
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

  // Preview of the current invitation image (private bucket → signed URL,
  // fresh per render so it always shows the latest upload). getEvent above
  // already enforced event access. Fail-open: a signing hiccup must not take
  // down the whole event page — the form just renders without the preview.
  let inviteImageUrl: string | null = null;
  if (event.invite_image_path) {
    try {
      inviteImageUrl = await signedInviteImageUrl(event.invite_image_path, 600);
    } catch (err) {
      // No PII/URL in the log — code-level signal only, per project convention.
      console.error(
        `[event-media] invite preview signing failed (event=${event.id}): ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
      inviteImageUrl = null;
    }
  }

  const allCampaigns = await listCampaignsForEvent(id);
  const hasBlockingCampaign = allCampaigns.some((c) =>
    BLOCKING_CAMPAIGN_STATUSES.has(c.status),
  );
  const canPublish = Boolean(
    event.event_date && !isBeforeTomorrowIL(event.event_date),
  );
  const publishAction = publishEventAction.bind(null, event.id);
  const closeAction = closeEventAction.bind(null, event.id);

  const summary = [
    EVENT_TYPE_LABELS[event.event_type] ?? event.event_type,
    formatDate(event.event_date),
    event.venue_name,
  ]
    .filter(Boolean)
    .join(' · ');
  const celebrantsText = celebrantsSummary(event.event_type, event.celebrants);

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
          {celebrantsText ? (
            <p className="text-sm text-muted-foreground">
              בעלי השמחה: {celebrantsText}
            </p>
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

      <EventStatusActions
        status={event.status}
        canPublish={canPublish}
        hasBlockingCampaign={hasBlockingCampaign}
        publishAction={publishAction}
        closeAction={closeAction}
      />

      <CampaignSection eventId={event.id} campaign={campaign} isPast={isPast} />

      <section className="space-y-4 rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold">עריכת פרטי האירוע</h2>
        <EditEventForm event={event} inviteImageUrl={inviteImageUrl} />
      </section>
    </div>
  );
}
