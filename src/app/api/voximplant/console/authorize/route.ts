import { NextResponse } from 'next/server';

import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { safeTokenEqual, sha256Hex } from '@/lib/security/token-compare';
import { linkConsoleCallSession, updateConsoleCallStatus, verifyDialToken } from '@/lib/data/console-calls';
import { getVoximplantConfig } from '@/lib/data/voximplant-config';
import { consoleAuthorizeBodySchema } from '@/lib/validation/console-calls';

// POST /api/voximplant/console/authorize   called BY ConsoleDial.voxengine.js
// (outbound branch, :563-566) — body: { secret, token }. This is the
// AUTHORITY gate for a manual outbound customer call: the scenario is NEVER
// trusted to decide whether to dial, only to place the PSTN leg once this
// route says so. Response shape is exactly what the scenario parses
// (ConsoleDial.voxengine.js:568-579):
//   ok  → { ok: true, phone, callerid }  (200)
//   not → { ok: false }                  (200 or non-200 — the scenario only
//         requires code===200 && body.ok===true to proceed; anything else,
//         including a network failure, is treated as a refusal)
//
// Re-runs the SAME server-side gates dial-intent already evaluated (fresh,
// authoritative second pass per decide-consent step 9-10) — the dial token
// only proves "an authorized console agent initiated this specific dial
// within the last 60s", not that DNC/quiet-hours/live-calls are still true
// a few seconds later.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const MAX_BODY_BYTES = 1_024;
// Coarse per-IP flood guard only (NOT a security control — Voximplant's
// scenarios call from a small, shared, provider-side IP range). Loose enough
// that legitimate concurrent calls never trip it.
const RATE = { limit: 120, windowMs: 60_000 } as const;

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

const REFUSED = { ok: false as const };

export async function POST(request: Request) {
  const ip = getClientIp(request.headers.get.bind(request.headers));
  if (!rateLimit(`vox-console-authorize:${ip}`, RATE).allowed) {
    return json(REFUSED, 429);
  }

  const declaredLen = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) {
    return json(REFUSED, 413);
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return json(REFUSED, 413);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return json(REFUSED, 400);
  }
  const parsed = consoleAuthorizeBodySchema.safeParse(parsedJson);
  if (!parsed.success) return json(REFUSED, 400);

  // Fail-closed if the shared secret is unset — never an open gate.
  const expected = process.env.KALFA_CONSOLE_SECRET;
  if (!expected) return json(REFUSED, 503);
  if (!safeTokenEqual(parsed.data.secret, sha256Hex(expected))) {
    return json(REFUSED, 401);
  }

  const verified = await verifyDialToken(parsed.data.token, 'ct');
  if (!verified.ok || !verified.phone) return json(REFUSED, 200);

  // Link the session DIRECTLY, before any of the caps checks below can
  // refuse — so the row is correlatable for the rest of this call's /event
  // reports even on a caps refusal, and even if the scenario's own 'started'
  // report never lands (network blip, app mid-deploy at the exact instant
  // the session starts). Best-effort: a failure here must never block the
  // call. See linkConsoleCallSession's header in console-calls.ts.
  // session_id is OPTIONAL at the schema layer so this route and the scenario
  // that posts it can deploy independently (they ship through two different
  // systems and cannot be atomic — see consoleAuthorizeBodySchema's header).
  // Absent means "the still-old scenario is calling": skip the link and fall
  // back to the pre-existing tier resolution, exactly as before this feature.
  if (typeof parsed.data.session_id === 'number') {
    try {
      await linkConsoleCallSession(verified.callId, parsed.data.session_id);
    } catch {
      /* best-effort — see comment above */
    }
  }

  // Authoritative second pass: live-dial gate must still hold right now.
  // (DNC/consent/quiet-hours were already fail-closed-gated at dial-intent;
  // re-running the full resolveDialTarget here is not possible — the dial
  // token intentionally carries no target-kind context to re-resolve from,
  // only the already-resolved phone — so this route re-checks the one gate
  // that can meaningfully change in the ~seconds between mint and dial.)
  const vconfig = await getVoximplantConfig();
  if (!vconfig || !vconfig.liveCallsEnabled || !vconfig.callerId) {
    return json(REFUSED, 200);
  }

  // Best-effort status bump: authorize succeeding is immediately followed by
  // callPSTN in the scenario, so the guest leg is "ringing" for all practical
  // purposes now — this makes the row reflect real progress even if the
  // scenario's own (fire-and-forget) 'ringing' /event report is lost. The
  // /event route re-applies the same transition idempotently; a failure here
  // must never block the call itself.
  try {
    await updateConsoleCallStatus({ callId: verified.callId, status: 'ringing' });
  } catch {
    /* best-effort — see comment above */
  }

  // `kind` is NEW and OPTIONAL for the scenario, deliberately — expand then
  // contract, the same reasoning consoleAuthorizeBodySchema's `session_id`
  // carries. This route and the scenario deploy through two different systems
  // that cannot be made atomic, so each side has to tolerate the other being a
  // version behind. A scenario that does not read it behaves exactly as before.
  //
  // It exists because the disclosure ConsoleDial plays before bridging says the
  // call is "מטעם בעלי האירוע בנוגע לאישור הגעה" — true of a guest_service dial,
  // false of a manual one, and the scenario had no way to tell them apart.
  return json(
    { ok: true, phone: verified.phone, callerid: vconfig.callerId, kind: verified.kind ?? null },
    200,
  );
}
