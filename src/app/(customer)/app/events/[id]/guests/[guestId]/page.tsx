import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireOwnedEvent } from '@/lib/data/events';
import { getGuest, listGroups } from '@/lib/data/guests';
import { getRsvpLinkInfo } from '@/lib/data/rsvp';
import { getAppUrl } from '@/lib/url';
import {
  regenerateRsvpTokenAction,
  revokeRsvpTokenAction,
  updateGuestAction,
} from '../guests-actions';
import { GuestForm } from '../guest-form';
import { RsvpLink } from './rsvp-link';

interface PageProps {
  params: Promise<{ id: string; guestId: string }>;
}

export default async function EditGuestPage({ params }: PageProps) {
  const { id: eventId, guestId } = await params;
  await requireOwnedEvent(eventId);

  const [guest, groups, linkInfo] = await Promise.all([
    getGuest(eventId, guestId),
    listGroups(eventId),
    getRsvpLinkInfo(eventId, guestId),
  ]);

  if (!guest) {
    notFound();
  }

  // Bind event + guest ids server-side; the action re-verifies ownership.
  const action = updateGuestAction.bind(null, eventId, guestId);

  // Absolute, shareable RSVP link — APP_ORIGIN when configured, else derived
  // from the request host (see getAppUrl). Always an absolute URL.
  const rsvpUrl = linkInfo ? await getAppUrl(`/r/${linkInfo.token}`) : '';

  // The guest's own confirmed counts (the RSVP result) — not shown in the
  // owner edit form, which carries only the editable status.
  const confirmedAdults = guest.confirmed_adults ?? 0;
  const confirmedKids = guest.confirmed_kids ?? 0;
  const hasResponse = confirmedAdults > 0 || confirmedKids > 0;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">עריכת מוזמן</h1>
        <Link
          href={`/app/events/${eventId}/guests`}
          className="text-sm text-muted-foreground hover:underline"
        >
          חזרה
        </Link>
      </div>

      {linkInfo ? (
        <RsvpLink
          url={rsvpUrl}
          revokedAt={linkInfo.revokedAt}
          revokeAction={revokeRsvpTokenAction.bind(null, eventId, guestId)}
          regenerateAction={regenerateRsvpTokenAction.bind(
            null,
            eventId,
            guestId,
          )}
        />
      ) : null}

      {hasResponse ? (
        <section className="rounded-lg border border-input p-4 text-sm">
          <h2 className="mb-1 font-semibold">אישור הגעה שהתקבל</h2>
          <p className="text-muted-foreground">
            {confirmedAdults} מבוגרים, {confirmedKids} ילדים
          </p>
        </section>
      ) : null}

      <GuestForm
        action={action}
        groups={groups}
        initial={guest}
        submitLabel="שמירת שינויים"
      />
    </div>
  );
}
