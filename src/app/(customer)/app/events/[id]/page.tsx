import Link from 'next/link';
import { cache } from 'react';
import type { Metadata } from 'next';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import {
  canAccessEvent,
  getEvent,
  getEventClosureReason,
  type EventDetail,
} from '@/lib/data/events';
import { signedInviteImageUrl } from '@/lib/storage/event-media';
import { formatIsraelDate, formatIsraelDateTime } from '@/lib/date';
import { ilTimeInputValue, isPastEventDay } from '@/lib/data/event-date';
import {
  getCampaignForEvent,
  getThankyouSchedule,
  listCampaignsForEvent,
  type ThankyouSchedule,
} from '@/lib/data/campaigns';
import { hasAnyOperationalCampaign } from '@/lib/data/campaign-status';
import { getEventStats } from '@/lib/data/event-stats';
import { EVENT_TYPE_LABELS, eventStatusLabel } from '@/lib/data/event-labels';
import { celebrantsTextFor } from '@/lib/data/celebrant-display';
import {
  getCancellationRequestForEvent,
  type OwnCancellationRequest,
} from '@/lib/data/event-cancellation';
import { countGuests } from '@/lib/data/guests';
import { EditEventForm } from './edit-event-form';
import { EventStatusActions } from './event-status-actions';
import { EventSummary } from './event-summary';
import { closeEventAction } from './campaign/campaign-actions';
import { SetupSteps } from './setup-steps';
import { CancellationRequestForm } from './cancellation-request-form';
import { createCancellationRequestAction } from './actions';

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

// Per-type celebrants line — shared composer (celebrant-display.ts), same
// source the public RSVP page uses.
function celebrantsSummary(
  eventType: EventDetail['event_type'],
  celebrants: EventDetail['celebrants'],
): string | null {
  return celebrantsTextFor(eventType, celebrants);
}

// On a CLOSED event the cancellation block may only REPORT an existing request,
// never offer a new one: `closed` is terminal (the DB trigger permits no
// re-open), so a "request cancellation" form there would invite acting on an
// event that is already over. These are exactly the two states in which
// CancellationRequestForm renders a read-only status card — every other input
// falls through to its form.
function showsCancellationStatusOnly(
  request: OwnCancellationRequest | null,
): request is OwnCancellationRequest {
  if (!request) return false;
  return (
    request.status === 'pending' ||
    (request.status === 'resolved' && request.resolution !== 'declined')
  );
}

// cache() so generateMetadata and the page body share ONE getEvent call per
// request instead of fetching (and re-checking ownership) twice.
const getEventCached = cache(getEvent);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const event = await getEventCached(id);
  return { title: event.name };
}

export default async function EventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const event = await getEventCached(id);

  // Blocker ח1 (plan §0) in its campaigns dress. getCampaignForEvent
  // (campaigns.ts:324) — and listCampaignsForEvent (campaigns.ts:301) further
  // down — OPEN with a MANDATORY requireEventAccess(id,'campaigns','view') that
  // throws notFound(). Calling them unconditionally narrows this page's gate
  // from events.view to events.view AND campaigns.view, so an org member whose
  // role lacks campaigns.view would 404 on the WHOLE event page. That is not a
  // corner: /app now redirects a single-event user straight here and every login
  // lands on /app, so the 404 would be the post-login landing page. And
  // campaigns.view is system_protected=false (verified on the live DB) — an org
  // owner can revoke it at /app/team/roles, i.e. it is reachable through the
  // product. So probe with the fail-closed VISIBILITY helper AFTER the page gate
  // (getEvent) has passed — exactly the shape the reports probe below uses — and
  // degrade the campaign surfaces instead of crashing. All three arguments are
  // passed explicitly so the cache() key matches the one getEventStats uses
  // internally (event-stats.ts:225) and the RPC runs once, not twice.
  const canViewCampaigns = await canAccessEvent(id, 'campaigns', 'view');
  const campaign = canViewCampaigns ? await getCampaignForEvent(id) : null;

  // ── Closed event → summary mode (plan §6). Everything that offers a SETUP
  // action — the setup steps, the lifecycle actions, the edit form and the
  // operational campaign area — is skipped: `closed` is terminal (R6 permits no
  // re-open), so re-offering them would invite acting on an event that is over.
  // An EARLY RETURN rather than an inline branch, so the open path below keeps
  // every variable unconditionally typed, and so a closed event stops paying for
  // the round-trips it no longer needs (invite-image signing,
  // listCampaignsForEvent, countGuests).
  if (event.status === 'closed') {
    // Blocker ח1 (plan §0): getEventStats OPENS with a MANDATORY
    // requireEventAccess(eventId,'reports','view') that throws notFound().
    // Calling it unconditionally from the page body would narrow this page's
    // gate from events.view to events.view AND reports.view — an org member
    // whose role lacks reports.view would then get a 404 on the WHOLE event
    // page. That is reachable, not theoretical: permissions are per-role and the
    // org owner edits them at /app/team/roles. So probe visibility with the
    // fail-closed helper first and load the stats only when it says yes;
    // otherwise the page degrades to heading + status tag.
    const [canViewReports, closureReason, thankyou, cancellationRequest] = await Promise.all([
      canAccessEvent(id, 'reports', 'view'),
      getEventClosureReason(event.id),
      // Thank-you state exists only where there is a campaign to schedule it on.
      // The explicit type argument keeps both arms of the ternary on ONE promise
      // type, so Promise.all infers this tuple slot as ThankyouSchedule | null
      // rather than widening it.
      campaign
        ? getThankyouSchedule(campaign.id)
        : Promise.resolve<ThankyouSchedule | null>(null),
      getCancellationRequestForEvent(event.id),
    ]);
    const stats = canViewReports ? await getEventStats(id) : null;

    // Mirrors the summary component's own subtitle (date · venue) so the
    // permission-limited fallback below reads as the same screen.
    const closedSummary = [formatDate(event.event_date), event.venue_name]
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

        {stats ? (
          // EventSummary owns the closed-event heading (plan §6 item 1), so the
          // parent must not render one too — otherwise two <h1> on one page.
          <EventSummary
            eventId={id}
            stats={stats}
            closureReason={closureReason}
            thankyou={thankyou}
          />
        ) : (
          // No reports.view: there is nothing to summarise, and EventSummary
          // requires a real EventStatsResult (a fabricated one would render no
          // heading at all). Heading + status tag only, so the page still
          // identifies itself instead of 404-ing.
          <header className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{event.name}</h1>
              <Badge variant={closureReason === 'cancellation' ? 'destructive' : 'neutral'}>
                {eventStatusLabel(event.status, closureReason)}
              </Badge>
            </div>
            {closedSummary ? (
              <p className="text-sm text-muted-foreground">{closedSummary}</p>
            ) : null}
          </header>
        )}

        {/* Page-level extras. They sit AFTER the summary on purpose: nothing
            that reads as page content may appear above the <h1> above. */}
        <div className="space-y-4 border-t border-border pt-6">
          {closureReason && closureReason !== 'owner' ? (
            <p className="text-sm text-muted-foreground">
              {closureReason === 'settlement'
                ? 'האירוע נסגר אוטומטית עם השלמת גמר החשבון של הקמפיין — לא ניתן עוד לאורחים לאשר הגעה דרך הקישור.'
                : 'האירוע נסגר בעקבות הטיפול בבקשת הביטול — לא ניתן עוד לאורחים לאשר הגעה דרך הקישור.'}
            </p>
          ) : null}

          {/* Kept: plan §6 item 8 (the guest-list export route) is not built
              yet, so this is the only remaining path to the guest list. */}
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/app/events/${event.id}/guests`}
              className={buttonVariants({ variant: 'outline' })}
            >
              ניהול מוזמנים
            </Link>
            <Link
              href={`/app/events/${event.id}/stats`}
              className={buttonVariants({ variant: 'outline' })}
            >
              סטטיסטיקות
            </Link>
          </div>

          {showsCancellationStatusOnly(cancellationRequest) ? (
            <CancellationRequestForm
              existingRequest={cancellationRequest}
              action={createCancellationRequestAction.bind(null, event.id)}
            />
          ) : null}
        </div>
      </div>
    );
  }

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

  // Same mandatory campaigns.view gate as getCampaignForEvent — null means "the
  // campaign set is invisible to this viewer", never "there are no campaigns".
  const allCampaigns = canViewCampaigns ? await listCampaignsForEvent(id) : null;
  // ∃-operational: does the event have AT LEAST ONE operational (non-terminal)
  // campaign? Computed ONCE over ALL campaigns and reused for both UI surfaces —
  // the SAME quantifier the server (updateEvent) and the DB trigger
  // (events_guard_update) use, so the close block AND the edit-field locks agree
  // with both. NEVER derive this from getCampaignForEvent (newest-non-cancelled):
  // with a newer terminal + older operational campaign that would disagree.
  //
  // Invisible set → FAIL-CLOSED `true`, i.e. "assume a campaign is running".
  // Measured on the live DB, not inferred: the campaigns SELECT policy is
  // `camp_org_select USING can_access_event(event_id,'campaigns','view')`, so a
  // viewer without campaigns.view reads ZERO campaign rows — and updateEvent's
  // own live-campaign lookup (events.ts:382) runs on the SAME RLS-scoped client.
  // Assuming `false` here would therefore unlock event_type/celebrants in the
  // form while the server's guard silently fails to fire, letting a live
  // campaign's template contract be re-typed under it. `true` costs this viewer
  // nothing real elsewhere: can_access_event short-circuits on
  // `owner_id = auth.uid()`, so a campaigns-blind viewer is always a non-owner
  // org member, and closeEvent is `.eq('owner_id', user.id)` — the close it
  // disables would have been a no-op for them anyway.
  const hasOperationalCampaign =
    allCampaigns === null ? true : hasAnyOperationalCampaign(allCampaigns);
  const closeAction = closeEventAction.bind(null, event.id);
  const createCancellationAction = createCancellationRequestAction.bind(null, event.id);
  // guestCount feeds the setup steps' soft "add guests" recommendation.
  // No closure reason is loaded here: `closed` returned early above, so from
  // this line on the status is draft or active and the reason is always null.
  const [guestCount, cancellationRequest] = await Promise.all([
    countGuests(id),
    event.status !== 'draft' ? getCancellationRequestForEvent(event.id) : Promise.resolve(null),
  ]);

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
            {/* null reason: only `closed` has a reason, and it returned early. */}
            {eventStatusLabel(event.status, null)}
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
        <Link
          href={`/app/events/${event.id}/stats`}
          className={buttonVariants({ variant: 'outline' })}
        >
          סטטיסטיקות
        </Link>
      </div>

      {canViewCampaigns ? (
        <SetupSteps event={event} campaign={campaign} guestCount={guestCount} isPast={isPast} />
      ) : (
        // Without campaigns.view `campaign` is null for a PERMISSION reason, not
        // because no campaign exists. Rendering SetupSteps with it would state
        // the opposite ("טרם הוקם") and offer a confirm CTA whose action the
        // viewer cannot complete. Same permission_limited card the stats page
        // uses (stats/page.tsx SectionCard), so the state reads identically
        // across the app.
        <section className="space-y-3 rounded-lg border border-border bg-card p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">אישורי הגעה</h2>
            <Badge variant="secondary">אין הרשאה להציג</Badge>
          </div>
          <p className="text-sm text-muted-foreground">אין לך הרשאה לצפות בנתונים אלו.</p>
        </section>
      )}

      <EventStatusActions
        status={event.status}
        hasBlockingCampaign={hasOperationalCampaign}
        closeAction={closeAction}
      />

      {event.status !== 'draft' ? (
        <CancellationRequestForm
          existingRequest={cancellationRequest}
          action={createCancellationAction}
        />
      ) : null}

      <section className="space-y-4 rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold">עריכת פרטי האירוע</h2>
        <EditEventForm
          event={event}
          inviteImageUrl={inviteImageUrl}
          hasOperationalCampaign={hasOperationalCampaign}
        />
      </section>
    </div>
  );
}
