import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireEventAccess } from '@/lib/data/events';
import { getGuest, listGroups } from '@/lib/data/guests';
import {
  getGuestOutreachSummary,
  listInteractionsForContact,
} from '@/lib/data/interactions-org-reads';
import { getRsvpLinkInfo } from '@/lib/data/rsvp-links';
import { Badge } from '@/components/ui/badge';
import { formatIsraelDateTime } from '@/lib/date';
import { getAppUrl } from '@/lib/url';
import {
  regenerateRsvpTokenAction,
  revokeRsvpTokenAction,
  updateGuestAction,
} from '../guests-actions';
import { GuestForm } from '../guest-form';
import {
  DELIVERY_STATUS_LABELS,
  OP_STATUS_LABELS,
  OP_STATUS_VARIANTS,
  REMOVAL_REQUESTED_LABEL,
  REMOVAL_REQUESTED_VARIANT,
  deliveryStatusVariant,
} from '../labels';
import { RsvpLink } from './rsvp-link';

interface PageProps {
  params: Promise<{ id: string; guestId: string }>;
}

export default async function EditGuestPage({ params }: PageProps) {
  const { id: eventId, guestId } = await params;
  await requireEventAccess(eventId, 'guests', 'view');

  const [guest, groups, linkInfo, outreach] = await Promise.all([
    getGuest(eventId, guestId),
    listGroups(eventId),
    getRsvpLinkInfo(eventId, guestId),
    getGuestOutreachSummary(eventId, guestId),
  ]);

  if (!guest) {
    notFound();
  }

  // WhatsApp message timeline for this guest's contact (event-based: each row is
  // a message with its current delivery state, oldest-first). Empty when the
  // guest has no linked contact (invalid/missing phone) or no history yet.
  const interactions = outreach
    ? await listInteractionsForContact(eventId, outreach.contactId)
    : [];

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
          {guest.meal_pref ? (
            <p className="mt-1 text-muted-foreground">
              העדפת תפריט: {guest.meal_pref}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-lg border border-input p-4 text-sm">
        <h2 className="mb-3 font-semibold">היסטוריית WhatsApp</h2>

        {outreach ? (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">מצב פנייה:</span>
            <Badge variant={OP_STATUS_VARIANTS[outreach.opStatus]}>
              {OP_STATUS_LABELS[outreach.opStatus]}
            </Badge>
            {outreach.removalRequested ? (
              <Badge variant={REMOVAL_REQUESTED_VARIANT}>
                {REMOVAL_REQUESTED_LABEL}
              </Badge>
            ) : null}
          </div>
        ) : null}

        {interactions.length > 0 ? (
          <ol className="space-y-3">
            {interactions.map((it) => {
              const inbound = it.direction === 'in';
              return (
                <li key={it.id} className="rounded-md border border-input p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {inbound ? 'תשובה התקבלה' : 'הודעה נשלחה'}
                    </span>
                    {inbound ? (
                      <Badge variant="info">נכנסת</Badge>
                    ) : it.delivery_status ? (
                      <Badge variant={deliveryStatusVariant(it.delivery_status)}>
                        {DELIVERY_STATUS_LABELS[it.delivery_status] ??
                          it.delivery_status}
                      </Badge>
                    ) : (
                      <Badge variant="neutral">ממתין</Badge>
                    )}
                  </div>
                  <time
                    dateTime={it.created_at}
                    className="mt-1 block text-xs text-muted-foreground"
                  >
                    {formatIsraelDateTime(it.created_at) || it.created_at}
                  </time>
                  {it.provider_id ? (
                    <p
                      dir="ltr"
                      className="mt-1 truncate text-left font-mono text-[11px] text-muted-foreground"
                    >
                      {it.provider_id}
                    </p>
                  ) : null}
                  {it.delivery_error_code ? (
                    <p className="mt-1 text-xs text-destructive">
                      קוד שגיאה: {it.delivery_error_code}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-muted-foreground">
            אין עדיין היסטוריית WhatsApp עבור מוזמן זה.
          </p>
        )}
      </section>

      <GuestForm
        action={action}
        groups={groups}
        initial={guest}
        submitLabel="שמירת שינויים"
      />
    </div>
  );
}
