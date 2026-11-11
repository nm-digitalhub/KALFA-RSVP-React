import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { RSVP_READ_RATE } from '@/lib/constants';
import { getEventAttendeesPublic, getRsvpByToken, looksLikeRsvpToken } from '@/lib/data/rsvp';
import { getT } from '@/i18n.server';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { tokenFingerprint } from '@/lib/security/token-fingerprint';

import { RsvpForm } from './rsvp-form';
import { AddToCalendar } from '@/components/add-to-calendar';
import { GuestAlert } from '@/components/guest/guest-alert';
import { GuestShell } from '@/components/guest/guest-shell';

import { inviteImageUrlOrNull } from '../../invite-image-url';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

// Always render per-request: the response is guest-specific and must never be
// cached or prerendered. Response headers (no-store, no-referrer) are set for
// `/r/:token*` in next.config.

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('public');
  return {
    title: t('r.meta.title', 'אישור הגעה'),
    // Personal, link-only page — keep it out of search indexes.
    robots: { index: false, follow: false },
  };
}

export default async function RsvpPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { t } = await getT('public');
  const { token } = await params;

  const requestHeaders = await headers();
  const ip = getClientIp(requestHeaders.get.bind(requestHeaders));
  // Bucket key uses a token FINGERPRINT, never the raw bearer token (raw
  // tokens in in-memory keys can surface in diagnostics; ctx-route precedent).
  const fp = tokenFingerprint(token);
  const gate = await rateLimit(`rsvp:read:${fp}:${ip}`, RSVP_READ_RATE);
  if (!gate.allowed) {
    return (
      <GuestShell width="md">
        <GuestAlert tone="warning">
          {t('r.rateLimited', 'נשלחו יותר מדי בקשות. נא לנסות שוב בעוד רגע.')}
        </GuestAlert>
      </GuestShell>
    );
  }

  const view = looksLikeRsvpToken(token) ? await getRsvpByToken(token) : null;
  if (!view) {
    // One generic message for unknown / revoked / expired / inactive — never
    // reveal which, to avoid leaking token validity.
    return (
      <GuestShell width="md">
        <GuestAlert tone="error">
          {t('r.invalidLink', 'קישור אישור ההגעה אינו תקף, פג תוקפו או בוטל.')}
        </GuestAlert>
      </GuestShell>
    );
  }

  // Invitation-image hero: sign a short-lived URL AFTER the token resolved to
  // a valid view (the bucket is private; the token holder is exactly the guest
  // this invitation was sent to). Fail-open — the page renders without the
  // image on any signing hiccup.
  const inviteImageUrl = await inviteImageUrlOrNull(view.event.invite_image_path, view.event.id, 'rsvp');

  // "Who's coming" opt-in list. Own rate-limit bucket (read-rate shape reused;
  // separate key so it can't starve the main read gate). Fail-open on error —
  // an empty list just hides the section, never blocks the RSVP form itself.
  const attendeesGate = await rateLimit(`rsvp:attendees:${fp}:${ip}`, RSVP_READ_RATE);
  let attendees: Awaited<ReturnType<typeof getEventAttendeesPublic>> = [];
  if (attendeesGate.allowed) {
    try {
      attendees = await getEventAttendeesPublic(token);
    } catch {
      attendees = [];
    }
  }

  return (
    <GuestShell width="md">
      <RsvpForm
        token={token}
        view={view}
        inviteImageUrl={inviteImageUrl}
        attendees={attendees}
        // Server-rendered here (link generation is server-side); the form shows it
        // in the success state once the guest confirms attendance. Same event
        // fields the form already renders — nothing new reaches the browser.
        calendar={
          <AddToCalendar
            icsHref={`/r/${token}/event.ics`}
            event={{
              name: view.event.name,
              event_type: view.event.event_type,
              event_date: view.event.event_date,
              venue_name: view.event.venue_name,
              venue_address: view.event.venue_address,
              celebrants: view.event.celebrants,
            }}
          />
        }
      />
    </GuestShell>
  );
}
