import { NextResponse } from 'next/server';

import { getCallbackVoiceContextByAccessToken } from '@/lib/data/callback-request-attempts';
import { getCompanyLegal } from '@/lib/data/company';
import { DEFAULT_CALLBACK_POLICY } from '@/lib/callbacks/schedule-policy';
import { formatIsraelSpokenDate, formatIsraelTime } from '@/lib/date';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { tokenFingerprint } from '@/lib/security/token-fingerprint';

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
  const terminal = ['cancelled', 'closed'];
  if (
    ctx.request.status !== 'scheduled' ||
    !ctx.request.calendar_item_id ||
    !ctx.request.scheduled_at ||
    ctx.request.scheduled_at !== ctx.attempt.scheduled_at_snapshot ||
    terminal.includes(ctx.request.status)
  ) {
    return notFound();
  }

  // First name only — same mitigation as ctx/[token]'s guest_name, per
  // public-rsvp-sentinel's explicit review note that this plan's field list
  // didn't yet say so. Never leak the full callback_requests row.
  const leadName = ctx.request.full_name.trim().split(/\s+/)[0] || '';

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

  return NextResponse.json(
    {
      lead_name: leadName,
      topic_he: ctx.request.topic ?? '',
      scheduled_when_spoken: formatIsraelSpokenDate(ctx.request.scheduled_at),
      scheduled_time_spoken: formatIsraelTime(ctx.request.scheduled_at),
      meeting_duration_spoken: spokenDuration(DEFAULT_CALLBACK_POLICY.durationMs),
      caller_role: companyName,
      // Non-authorizing correlation id (same pattern as ctx/[token]'s
      // kalfa_attempt_token) — the ElevenLabs-bridge scenario injects this so
      // the post-call webhook can map the conversation back to this attempt.
      kalfa_attempt_token: ctx.attempt.el_conversation_id ?? '',
    },
    { headers: NO_STORE },
  );
}
