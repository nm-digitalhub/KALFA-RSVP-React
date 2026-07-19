import { NextResponse } from 'next/server';

import { getCallContextByAccessToken } from '@/lib/data/call-attempts';
import { getVoximplantGroqKey } from '@/lib/data/voximplant-config';
import { formatIsraelSpokenDate } from '@/lib/date';
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
// scenario needs — the four invitation fields plus the Groq key (Branch B moved
// the key OUT of the scenario payload so it never lands in Voximplant call
// history). Never returns phone, rsvp_token, org id, or any other internal data.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CTX_RATE = { limit: 12, windowMs: 5 * 60 * 1000 } as const;

// Explicit no-store on EVERY response: the success body carries the Groq key
// and guest-facing data behind a bearer token in the URL — `force-dynamic`
// only skips Next's own cache, it does not forbid downstream caches.
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const notFound = () => new NextResponse(null, { status: 404, headers: NO_STORE });

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

  // Groq key for the scenario's ASR→LLM step. Served here (token-gated) instead of
  // in the scenario payload so it never appears in Voximplant call history. Absent
  // key → 404 (a call with no key cannot run its dialogue; fail generic).
  const groqKey = await getVoximplantGroqKey();
  if (!groqKey) return notFound();

  // First name only for the greeting (the scenario's normalizeForSpeech handles
  // the rest). Never leak the full contact/guest record.
  const guestName = ctx.guestFullName
    ? ctx.guestFullName.trim().split(/\s+/)[0] || ''
    : '';

  return NextResponse.json(
    {
      guest_name: guestName,
      event_name: ctx.event.name ?? '',
      event_date: formatIsraelSpokenDate(ctx.event.event_date ?? ''),
      event_venue: ctx.event.venue_name ?? '',
      groq_key: groqKey,
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
