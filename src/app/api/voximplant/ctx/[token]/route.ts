import { createHash } from 'node:crypto';

import { NextResponse } from 'next/server';

import { getCallContextById } from '@/lib/data/call-attempts';
import { getVoximplantCallbackSecret } from '@/lib/data/voximplant-config';
import { formatIsraelSpokenDate } from '@/lib/date';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { verifyCallToken } from '@/lib/voximplant/call-token';

// GET /api/voximplant/ctx/{token}
//
// The Voximplant RSVP scenario fetches this once at call start (plain GET, no
// custom headers) to voice the invitation. Auth is the signed, purpose='ctx',
// per-call token in the path (verified in constant time against the callback
// secret) — NOT a session, NOT a guessable id. READ-ONLY: never mutates. Every
// failure returns an identical generic 404 so a caller cannot learn whether a
// given guest/event/token exists (privacy-safe, like /r/[token] and /g/[token]).
// Returns ONLY the four fields the scenario needs — never phone, rsvp_token,
// org id, or any other internal data.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CTX_RATE = { limit: 12, windowMs: 5 * 60 * 1000 } as const;

function tokenFingerprint(token: string): string {
  // A short, non-reversible fingerprint for the rate-limit key + any logging —
  // never put the raw token in a key or log.
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

const notFound = () => new NextResponse(null, { status: 404 });

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const ip = getClientIp(req.headers.get.bind(req.headers));
  const fp = token ? tokenFingerprint(token) : 'none';
  if (!rateLimit(`vox-ctx:${fp}:${ip}`, CTX_RATE).allowed) {
    return new NextResponse(null, { status: 429 });
  }

  const secret = await getVoximplantCallbackSecret();
  const verified = verifyCallToken(secret, token, 'ctx', Math.floor(Date.now() / 1000));
  if (!verified.ok) return notFound();

  let ctx;
  try {
    ctx = await getCallContextById(verified.callAttemptId);
  } catch {
    // A real DB error must not reveal itself as anything but the generic 404.
    return notFound();
  }
  if (!ctx) return notFound();

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

  return NextResponse.json({
    guest_name: guestName,
    event_name: ctx.event.name ?? '',
    event_date: formatIsraelSpokenDate(ctx.event.event_date ?? ''),
    event_venue: ctx.event.venue_name ?? '',
  });
}
