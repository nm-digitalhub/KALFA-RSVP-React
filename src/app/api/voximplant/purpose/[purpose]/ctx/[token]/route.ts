import { NextResponse } from 'next/server';

import { getCompanyLegal } from '@/lib/data/company';
import { getVoicePurpose } from '@/lib/data/voice-purposes';
import { formatIsraelSpokenDate, formatIsraelTime } from '@/lib/date';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { tokenFingerprint } from '@/lib/security/token-fingerprint';
import { createAdminClient } from '@/lib/supabase/admin';

// The context a configured voice agent fetches once, at call start.
//
// ⚠️ THE RESPONSE IS DELIBERATELY UNINFORMATIVE. An expired token, a token for a
// purpose that was switched off, a purpose that does not exist and a token that
// never existed all answer the SAME bare 404 — the identical discipline the
// RSVP and meeting-confirm ctx routes already follow. Anything finer turns this
// into an oracle for which tokens are live.
//
// ⚠️ AND IT RETURNS FIRST NAMES ONLY, never the guest row. The agent needs
// enough to greet someone and speak about their event; it does not need a phone
// number, an address or a status, and this endpoint is reachable with nothing
// but a bearer string.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CTX_RATE = { limit: 12, windowMs: 5 * 60 * 1000 } as const;
const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const notFound = () => new NextResponse(null, { status: 404, headers: NO_STORE });

export async function GET(
  req: Request,
  { params }: { params: Promise<{ purpose: string; token: string }> },
) {
  const { purpose: purposeKey, token } = await params;

  // Keyed on the token FINGERPRINT plus the IP — never the token itself, which
  // must not reach a rate-limit key, a log line or an error.
  const ip = getClientIp(req.headers.get.bind(req.headers));
  const fp = token ? tokenFingerprint(token) : 'none';
  if (!rateLimit(`vox-purpose-ctx:${fp}:${ip}`, CTX_RATE).allowed) {
    return new NextResponse(null, { status: 429, headers: NO_STORE });
  }

  // Shape-guard before any DB call: these tokens are always 43 base64url
  // characters (randomBytes(32).toString('base64url')), so a malformed candidate
  // costs nothing to reject.
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return notFound();
  if (!/^[a-z][a-z0-9_]{1,48}$/.test(purposeKey)) return notFound();

  const admin = createAdminClient();
  const { data: attempt } = await admin
    .from('voice_purpose_attempts')
    .select('id, purpose_key, event_id, contact_id, token_expires_at')
    .eq('access_token', token)
    .maybeSingle();

  if (!attempt) return notFound();
  // The token must belong to the purpose in the URL. Without this check a token
  // minted for one agent would serve context to another.
  if (attempt.purpose_key !== purposeKey) return notFound();
  if (Date.parse(attempt.token_expires_at) <= Date.now()) return notFound();

  // A purpose switched off mid-call answers 404 rather than serving context —
  // the kill switch has to mean something after the dial, not only before it.
  const purpose = await getVoicePurpose(attempt.purpose_key);
  if (!purpose || !purpose.active || !purpose.enabled) return notFound();

  const { data: guest } = await admin
    .from('guests')
    .select('full_name')
    .eq('contact_id', attempt.contact_id)
    .eq('event_id', attempt.event_id ?? '')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  const { data: event } = attempt.event_id
    ? await admin
        .from('events')
        .select('name, event_type, event_date, venue_name')
        .eq('id', attempt.event_id)
        .maybeSingle()
    : { data: null };

  let companyName = '';
  try {
    companyName = (await getCompanyLegal()).name ?? '';
  } catch {
    // Non-fatal: the agent still functions without this one variable, and an
    // empty string is the documented "you do not have this" signal.
    companyName = '';
  }

  // First name only — the same mitigation the other two ctx routes apply. A
  // household name ("משפחת כהן") yields its first token, which is correct to
  // say aloud and reveals nothing the greeting did not already need.
  const guestName = (guest?.full_name ?? '').trim().split(/\s+/)[0] ?? '';

  return NextResponse.json(
    {
      guest_name: guestName,
      event_name: event?.name ?? '',
      event_date: event?.event_date ? formatIsraelSpokenDate(event.event_date) : '',
      event_time: event?.event_date ? formatIsraelTime(event.event_date) : '',
      event_venue: event?.venue_name ?? '',
      caller_role: companyName,
      purpose_name: purpose.displayName,
      // Correlation only, never authorization — lets the post-call webhook map
      // an ElevenLabs conversation back to this attempt.
      kalfa_attempt_id: attempt.id,
    },
    { headers: NO_STORE },
  );
}
