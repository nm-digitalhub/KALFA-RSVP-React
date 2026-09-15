import { NextResponse } from 'next/server';

import { getCallbackVoiceContextByAccessToken } from '@/lib/data/callback-request-attempts';
import { getCompanyLegal } from '@/lib/data/company';
import { getCallbackPolicy } from '@/lib/callbacks/policy-config';
import { formatIsraelRelativeSpokenDate, formatIsraelSpokenClock } from '@/lib/date';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { tokenFingerprint } from '@/lib/security/token-fingerprint';
import { isTerminalCallbackStatus } from '@/lib/validation/admin';

// GET /api/voximplant/mtg/ctx/{token}
//
// The meeting-booking agent's Voximplant scenario fetches this once at call
// start to voice the existing appointment. Same shape as the RSVP ctx/[token]
// route (which this deliberately mirrors, per public-rsvp-sentinel's review
// 2026-08-22): opaque per-attempt access token in the path is the ONLY
// authorization — no session, no guessable id. READ-ONLY. Every failure path
// (unknown token, expired token, stale/reconciled appointment, DB error)
// returns the IDENTICAL generic 404 (review finding B3) — a caller must never
// be able to distinguish "token doesn't exist" from "appointment changed
// underneath it" from "briefly down".

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CTX_RATE = { limit: 12, windowMs: 5 * 60 * 1000 } as const;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const notFound = () => new NextResponse(null, { status: 404, headers: NO_STORE });

/**
 * Stand-ins written when the system has a phone number and no name.
 *
 * Kept here rather than imported so this route has no `server-only` pull beyond
 * what it already carries; each string is copied VERBATIM from its writer:
 *   `console-calls.ts`  missed inbound call
 *   `console-calls.ts`  call-me-now with no agent
 *   `guest-actions.ts`  the workflow's callback node
 *
 * A new writer that invents a fourth stand-in will reintroduce the bug — which
 * is why `callback-request-placeholders.test.ts` pins this set against the
 * literals actually present in those files.
 */
const PLACEHOLDER_NAMES = new Set([
  'מתקשר לא מזוהה',
  'מבקש/ת "התקשרו אליי עכשיו"',
  'אורח',
]);

function spokenDuration(durationMs: number): string {
  const minutes = Math.round(durationMs / 60000);
  return `${minutes} דקות`;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const ip = getClientIp(req.headers.get.bind(req.headers));
  const fp = token ? tokenFingerprint(token) : 'none';
  if (!rateLimit(`vox-mtg-ctx:${fp}:${ip}`, CTX_RATE).allowed) {
    return new NextResponse(null, { status: 429, headers: NO_STORE });
  }

  // Strict shape-guard (review recommendation, tighter than the RSVP ctx
  // precedent's length-only check): the new tokens are always exactly 32 hex
  // characters (randomBytes(16).toString('hex')), so a malformed candidate
  // can be rejected before any DB call.
  if (typeof token !== 'string' || !/^[0-9a-f]{32}$/.test(token)) {
    return notFound();
  }

  let ctx;
  try {
    ctx = await getCallbackVoiceContextByAccessToken(token);
  } catch {
    // A real DB error must not reveal itself as anything but the generic 404.
    return notFound();
  }
  if (!ctx) return notFound();

  // Reject an expired token.
  if (Date.parse(ctx.attempt.token_expires_at) <= Date.now()) return notFound();

  // Freshness re-verification (review finding B3, and the design note already
  // in the meeting-booking plan §7): reconcileCallbacksWithCalendar can
  // release a booked slot between dispatch (~hours ahead) and the actual
  // call. Re-check against the LIVE row, not just the snapshot taken at
  // token-issuance time — a stale appointment must return the same bare 404
  // as an unknown token, not a distinguishing status code.
  //
  // The terminal test is subsumed by the `!== 'scheduled'` test above and
  // cannot fire on its own today. It is kept as the explicit statement of the
  // rule (and survives any future loosening of the exact-status test), but it
  // asks CALLBACK_STATUS_KIND rather than carrying its own copy of the
  // terminal list — a second copy is what drifts.
  if (
    ctx.request.status !== 'scheduled' ||
    !ctx.request.calendar_item_id ||
    !ctx.request.scheduled_at ||
    ctx.request.scheduled_at !== ctx.attempt.scheduled_at_snapshot ||
    isTerminalCallbackStatus(ctx.request.status)
  ) {
    return notFound();
  }

  // First name only — same mitigation as ctx/[token]'s guest_name, per
  // public-rsvp-sentinel's explicit review note that this plan's field list
  // didn't yet say so. Never leak the full callback_requests row.
  //
  // ⚠️ AND A PLACEHOLDER IS NOT A NAME. `callback_requests.full_name` is NOT
  // NULL, so every writer that has only a phone number stores a stand-in:
  // 'מתקשר לא מזוהה' from a missed inbound call, 'מבקש/ת "התקשרו אליי עכשיו"'
  // from call-me-now, 'אורח' from the workflow node. Taking the first token of
  // those yields "מתקשר" / "מבקש/ת" / "אורח" — and the agent's own waypoint 1
  // then asks, verbatim, "מדבר עם מתקשר?".
  //
  // MEASURED: session 8429772552 on 2026-09-14 was dispatched with
  // `dynamic_variables.lead_name = "מתקשר"`, to a real person.
  //
  // Empty is the honest answer, and the agent already has a rule for it —
  // "שדה ריק פירושו שאין לך את המידע הזה — אל תמציא". Matched EXACTLY rather
  // than by prefix: someone genuinely called אורח must not be blanked.
  const rawName = ctx.request.full_name.trim();
  const leadName = PLACEHOLDER_NAMES.has(rawName) ? '' : rawName.split(/\s+/)[0] || '';

  // {{caller_role}}: per the plan's own §5 finding (no per-row assigned
  // rep/sales-person concept exists in this schema today), the only truthful
  // identity available is the company itself — never invent a person's name.
  let companyName = '';
  try {
    const company = await getCompanyLegal();
    companyName = company.name ?? '';
  } catch {
    // Non-fatal: the agent can still function without this one variable.
    companyName = '';
  }

  // {{opening_line}}: the FIRST sentence after the recording notice, rendered
  // here and spoken verbatim from `first_message`.
  //
  // ⚠️ It lives on the server because the agent would not branch. The prompt
  // carried the condition as prose ("כש-{{lead_name}} ריק … פתח בעובדה הזו"),
  // and claude-haiku-4-5 skipped it in BOTH calls placed after it shipped
  // (conv_9301…, conv_8601… on 2026-09-14): it jumped straight to the schedule,
  // so the person was never told why we rang. One of them then asked, at 0:32,
  // "לגבי מי אתה מתקשר?".
  //
  // `first_message` interpolation is MEASURED to work — the very bug that
  // started this spoke "{{lead_name}}" out of it — and a static string cannot
  // skip a branch, because there is no branch left to skip.
  const openingLine = leadName
    ? `מדבר/ת עם ${leadName}?`
    : 'התקשרת אלינו קודם ולא הצלחנו לענות — נוח לך לדבר עכשיו?';

  return NextResponse.json(
    {
      lead_name: leadName,
      opening_line: openingLine,
      topic_he: ctx.request.topic ?? '',
      // Spoken Hebrew, NOT display digits — MeetingConfirmAgent forwards these
      // straight to ElevenLabs with no speech normalization of its own. Each
      // carries its own preposition ("היום" cannot take the template's "ל").
      scheduled_when_spoken: formatIsraelRelativeSpokenDate(ctx.request.scheduled_at),
      scheduled_time_spoken: formatIsraelSpokenClock(ctx.request.scheduled_at),
      meeting_duration_spoken: spokenDuration((await getCallbackPolicy()).durationMs),
      caller_role: companyName,
      // Non-authorizing correlation id (same pattern as ctx/[token]'s
      // kalfa_attempt_token) — the ElevenLabs-bridge scenario injects this so
      // the post-call webhook can map the conversation back to this attempt.
      //
      // This used to send `el_conversation_id`, which is STRUCTURALLY ALWAYS
      // EMPTY here: that column is written by mtg/cb, the TERMINAL callback, so
      // at ctx time — before the conversation exists — it is still null.
      // Confirmed on a real call (conv_0201m2fyxhmgetfaqs0keg0b01ex, 14.9):
      // `"kalfa_attempt_token": ""` in the conversation's initiation data.
      //
      // Nothing consumed that empty value, so nothing was visibly broken. What
      // was missing is a FALLBACK. `callback_request_attempts` has no
      // `el_correlation_nonce` column, so `el_conversation_id` — written only
      // by the terminal cb — was this persona's single correlation path. A
      // VoxEngine scenario's closing HTTP request has no delivery guarantee
      // (queued requests are dropped without a callback when the session
      // terminates), and when it is lost the conversation becomes unlinkable.
      // RSVP survives that on its pre-issued nonce and sales-close on the
      // attempt id; this path had nothing.
      //
      // MEASURED against the live table 2026-09-15, and the damage is so far
      // HYPOTHETICAL: of 13 callback_request_attempts, 10 are linked and the 3
      // that are not were never answered (sip_480, sip_408, sip_408 — all
      // call_duration_sec 0), so no conversation ever existed to link. Every
      // call that actually happened got its id from the cb. This is therefore
      // defence in depth against a documented platform behaviour, not a repair
      // of observed loss — but it costs nothing and removes a field that could
      // never carry a value.
      //
      // The attempt id exists before the call, so it echoes back through the
      // post-call webhook whether or not the cb ever arrives — the same thing
      // sls/ctx already sends.
      // The unified correlation key — see the note on /ctx. Sent beside the
      // old one until every deployed scenario reads the new name.
      kalfa_correlation_id: ctx.attempt.id,
      kalfa_attempt_token: ctx.attempt.id,
    },
    { headers: NO_STORE },
  );
}
