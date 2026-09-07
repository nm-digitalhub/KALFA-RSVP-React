import { NextResponse } from 'next/server';

import { celebrantsTextFor } from '@/lib/data/celebrant-display';
import { EVENT_TYPE_LABELS } from '@/lib/data/event-labels';
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

// Speech form of the event TYPE — the single word that tells the guest what the
// call is about ("חתונה", "ברית", "בר מצווה").
//
// It was never sent. A live call (conv_3001m1xxjh80f938yh3jenrpb3xc, 2026-09-07)
// opened with only `event_name`, which is the owner's free-text title — for that
// event, "שלומית קאקון ואייל מלכה". Two names and no noun: the guest asked what
// the call was about four separate times and 42 of the call's 123 seconds went
// to establishing something the opening line should have carried.
//
// EVENT_TYPE_LABELS is owner-facing FORM copy, so `other` is "אחר" — a valid
// dropdown option and an impossible sentence ("בנוגע לאחר של..."). It degrades
// to the generic noun instead. Every other label reads correctly after "ל".
const eventKindSpeechForm = (
  eventType: keyof typeof EVENT_TYPE_LABELS | null,
): string => (!eventType || eventType === 'other' ? 'אירוע' : EVENT_TYPE_LABELS[eventType]);

// Per-call ASR keyword list, sent to ElevenLabs as
// conversation_config_override.asr.keywords.
//
// WHY IT IS BUILT HERE AND NOT IN THE SCENARIO. The live override docs are
// explicit that "ASR keyword overrides REPLACE the agent's default keyword list
// for that conversation (maximum 50 keywords)" — they do not merge. So whoever
// sends the override owns the whole vocabulary, and splitting it between the
// agent config and the VoxEngine scenario would guarantee drift the first time
// either side is edited. The server already holds every per-call name, so it
// composes the complete list and the scenario forwards it verbatim.
//
// BASE is the agent's own configured vocabulary, mirrored so an override never
// silently drops it. Keep the two in sync when either changes.
//
// The proper nouns are the point: a live call heard "נכון" as "רכון" and lost a
// guest's own name, and names are exactly what a general Hebrew model has no
// prior for. Order matters only for the 50-cap — names first, then the closed
// RSVP vocabulary, so a long celebrant list can never push out "כן"/"לא".
const ASR_BASE_KEYWORDS = [
  'כן', 'לא', 'מגיעים', 'לא מגיעים', 'נגיע', 'לא נגיע', 'מאשר', 'מאשרת',
  'אישור', 'כמה', 'אחד', 'שניים', 'שלושה', 'ארבעה', 'חמישה', 'שישה',
  'ילדים', 'מבוגרים', 'אולי', 'עדיין לא יודע', 'תסירו אותי',
] as const;

const ASR_KEYWORD_CAP = 50;

// A Hebrew keyword is worth boosting only if it is a real word: single letters
// and stray punctuation add noise to the bias and burn cap slots.
const asrKeywordsFor = (parts: readonly (string | null)[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string) => {
    const w = raw.trim();
    if (w.length < 2 || seen.has(w) || out.length >= ASR_KEYWORD_CAP) return;
    seen.add(w);
    out.push(w);
  };
  // Names first: both the full phrase (so a two-word name biases as a unit) and
  // its individual tokens (so a partly-heard name still gets help).
  for (const part of parts) {
    const clean = (part ?? '').replace(/[^\p{L}\p{N}\s'"״׳-]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    push(clean);
    for (const tok of clean.split(' ')) push(tok);
  }
  for (const w of ASR_BASE_KEYWORDS) push(w);
  return out;
};

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

  // The FULL name, whitespace-normalized.
  //
  // This was the first token until 2026-09-07 ("first name only for the
  // greeting"), which silently assumed given-name-first ordering. `guests` stores
  // one free-text `full_name` and nothing else, so a row entered surname-first
  // made the agent greet a real guest by their family name on a live call
  // ("קלפה נתנאל" -> "מדבר עם קלפה?"). 35 of 47 guest rows are multi-token and
  // no field says which token is the given name, so the heuristic cannot be
  // repaired — only dropped. The full name is never wrong, just more formal.
  //
  // Still leaks nothing else from the guest/contact record.
  const guestName = (ctx.guestFullName ?? '').trim().replace(/\s+/g, ' ');

  return NextResponse.json(
    {
      guest_name: guestName,
      event_name: nameSpeechForm(ctx.event.name),
      // The noun the opening line needs — see eventKindSpeechForm above.
      event_kind: eventKindSpeechForm(ctx.event.event_type),
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
      // Per-call ASR keyword bias (see asrKeywordsFor above). The scenario
      // forwards this verbatim as conversation_config_override.asr.keywords.
      // Not personalization: these words are already spoken aloud on the call,
      // so this adds no disclosure beyond what the guest hears anyway.
      asr_keywords: asrKeywordsFor([
        guestName,
        celebrantsSpeechForm(celebrantsTextFor(ctx.event.event_type, ctx.event.celebrants)),
        nameSpeechForm(ctx.event.name),
        ctx.event.venue_name,
      ]),
    },
    { headers: NO_STORE },
  );
}
