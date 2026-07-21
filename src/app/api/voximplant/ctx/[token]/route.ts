import { NextResponse } from 'next/server';

import { celebrantsTextFor } from '@/lib/data/celebrant-display';
import { getCallContextByAccessToken } from '@/lib/data/call-attempts';
import { formatIsraelSpokenDate, formatIsraelTime } from '@/lib/date';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { tokenFingerprint } from '@/lib/security/token-fingerprint';

// GET /api/voximplant/ctx/{token}
//
// The Voximplant RSVP scenario fetches this once at call start (plain GET, no
// custom headers) to voice the invitation. Auth is the per-call opaque access
// token in the path (Branch B: the same 128-bit random nonce stored on the
// call_attempts row and sent in the scenario payload) — NOT a session, NOT a
// guessable id. READ-ONLY: never mutates. Every failure returns an identical
// generic 404 so a caller cannot learn whether a given guest/event/token exists
// (privacy-safe, like /r/[token] and /g/[token]). Returns ONLY the fields the
// scenario needs. Never returns phone, rsvp_token, org id, or any other internal
// data.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CTX_RATE = { limit: 12, windowMs: 5 * 60 * 1000 } as const;

// Explicit no-store on EVERY response: the success body carries guest-facing data
// behind a bearer token in the URL — `force-dynamic` only skips Next's own cache,
// it does not forbid downstream caches.
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const notFound = () => new NextResponse(null, { status: 404, headers: NO_STORE });

// Speech form of the celebrants text. The shared display composer returns
// "X — לכבוד Y" for parents-kind events (brit/britah) — a page-title artifact:
// injected raw into the agent's dynamic variables, the em-dash run-through
// mangled the spoken name in a live call (session 6875455354, "נטלי קלפה —
// לכבוד בני" heard as "נטליקה"). For VOICE, keep only the parents part — the
// child's name is not needed to answer "של מי האירוע?". Display surfaces keep
// the full string; this transform lives HERE so celebrantsTextFor (shared with
// the event page + public RSVP) stays untouched.
const celebrantsSpeechForm = (text: string | null): string =>
  text ? text.split('—')[0].trim() : '';

// Speech form of a free-text name (events.name). The celebrants fix above was
// never extended to its neighbour, so the owner's raw event title went to TTS
// untouched — and it is the string the agent repeats most, once per turn while
// establishing context.
//
// Same failure mode, different remedy. Truncating at the dash is right for
// celebrants (the part after it is a page-title artifact) and wrong here: an
// owner writing "החתונה של דנה ויוסי — אולם הגן" means all of it. So structural
// punctuation becomes a comma, which TTS reads as the pause the punctuation was
// standing in for, instead of running the words together the way "נטלי קלפה —
// לכבוד בני" collapsed into "נטליקה" (session 6875455354).
//
// Latin quotes are dropped as decoration. Hebrew geresh/gershayim (״ ׳) are
// left ALONE — in הרמ״א they are orthography, not punctuation, and stripping
// them rewrites the word rather than pausing it. No evidence removal helps, so
// the conservative choice wins.
const nameSpeechForm = (text: string | null): string =>
  (text ?? '')
    .replace(/[—–|/]+/g, ',')
    .replace(/[()[\]{}]/g, ',')
    .replace(/["']/g, '')
    .replace(/\s*,\s*/g, ', ')
    .replace(/,\s*(?=,)/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .trim();

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const ip = getClientIp(req.headers.get.bind(req.headers));
  const fp = token ? tokenFingerprint(token) : 'none';
  if (!rateLimit(`vox-ctx:${fp}:${ip}`, CTX_RATE).allowed) {
    return new NextResponse(null, { status: 429, headers: NO_STORE });
  }

  if (typeof token !== 'string' || token.length === 0 || token.length > 256) {
    return notFound();
  }

  let ctx;
  try {
    ctx = await getCallContextByAccessToken(token);
  } catch {
    // A real DB error must not reveal itself as anything but the generic 404.
    return notFound();
  }
  if (!ctx) return notFound();

  // Reject an expired token (the row's token_expires_at is the sole expiry source
  // now that the bearer is the opaque access token, not a self-describing JWT).
  if (Date.parse(ctx.attempt.token_expires_at) <= Date.now()) return notFound();

  // The call must be for an ACTIVE event and an attempt that has not already
  // reached a terminal state (a ctx fetch on a finished call is anomalous).
  const terminal = ['completed', 'failed', 'no_answer', 'no_response', 'cancelled'];
  if (ctx.event.status !== 'active' || terminal.includes(ctx.attempt.status)) {
    return notFound();
  }

  // First name only for the greeting (the scenario's normalizeForSpeech handles
  // the rest). Never leak the full contact/guest record.
  const guestName = ctx.guestFullName
    ? ctx.guestFullName.trim().split(/\s+/)[0] || ''
    : '';

  return NextResponse.json(
    {
      guest_name: guestName,
      event_name: nameSpeechForm(ctx.event.name),
      event_date: formatIsraelSpokenDate(ctx.event.event_date ?? ''),
      // Wall-clock start time ('17:30'). events.event_date is timestamptz, so the
      // time was always there — it was simply dropped by the date-only formatter,
      // leaving the agent unable to answer "באיזו שעה?" (the single most common
      // RSVP question) and forced to deflect to notify_owner.
      event_time: formatIsraelTime(ctx.event.event_date ?? ''),
      event_venue: ctx.event.venue_name ?? '',
      // Street address, so "איפה בדיוק?" is answerable. Event-level data that is
      // printed on the invitation itself — not guest PII.
      event_address: ctx.event.venue_address ?? '',
      // "של מי האירוע?" — the shared display helper, converted to SPEECH form
      // (see celebrantsSpeechForm above) so no display punctuation reaches TTS.
      event_celebrants: celebrantsSpeechForm(
        celebrantsTextFor(ctx.event.event_type, ctx.event.celebrants),
      ),
      event_rsvp_deadline: ctx.event.rsvp_deadline
        ? formatIsraelSpokenDate(ctx.event.rsvp_deadline)
        : '',
      // ADDITIVE (item-2 link vector): the row's NON-authorizing correlation nonce.
      // The ElevenLabs-bridge scenario (VoiceAgentTest, kalfatest) injects this as
      // the `kalfa_attempt_token` dynamic variable so the post-call webhook can map
      // the conversation back to this call_attempt. '' when the row has no nonce
      // (every non-bridge call, incl. all of Branch B — which ignores this field).
      // Non-authorizing by design, so serving it here leaks no capability.
      kalfa_attempt_token: ctx.attempt.el_correlation_nonce ?? '',
    },
    { headers: NO_STORE },
  );
}
