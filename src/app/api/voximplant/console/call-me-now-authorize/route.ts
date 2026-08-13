import { NextResponse } from 'next/server';

import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { safeTokenEqual, sha256Hex } from '@/lib/security/token-compare';
import {
  CALL_ME_NOW_DAILY_CALL_CAP,
  CALL_ME_NOW_DAILY_SPEND_CAP_USD,
  CALL_ME_NOW_MAX_CONCURRENCY,
  INBOUND_ESTIMATED_COST_PER_CALL_USD,
  computeRingOrder,
  consoleCallMeNowEnabled,
  countAnsweredCallMeNowToday,
  countConcurrentAnsweredCallMeNow,
  findRoutableAgentVoxUsernames,
  linkConsoleCallSession,
  updateConsoleCallStatus,
  verifyDialToken,
} from '@/lib/data/console-calls';
import { checkInboundBalanceReserve } from '@/lib/data/voximplant-balance-cache';
import { getVoximplantConfig } from '@/lib/data/voximplant-config';
import { callMeNowAuthorizeBodySchema } from '@/lib/validation/console-calls';

// POST /api/voximplant/console/call-me-now-authorize   body: { secret, token }
//   → { ok: true, ring_order, call_id } | { ok: false }
//
// NOT YET CALLED BY ANY SCENARIO — this is call-me-now's authorize gate
// (capability A, THIRD design, 12.8), built and unit-testable ahead of the
// ConsoleCallMeNow scenario that will call it — same sequencing this project
// already used for route-inbound ahead of gate E and widget-authorize ahead
// of its own (now-superseded) scenario. The scenario would call this AFTER
// the visitor leg answers and its disclosure finishes playing (mirroring
// ConsoleInbound's proceedInbound: record() -> say(disclosure) ->
// PlaybackFinished -> THEN ring agents) — never before, so the disclosure is
// never skipped even if this call is refused.
//
// Re-runs evaluateCallMeNowCaps's inputs fresh — a second, authoritative
// pass (same reasoning as authorize/route.ts's and widget-authorize's own
// comments: the token only proves "call-me-now/verify admitted this exact
// call within the last 60s", not that concurrency/balance/the flag are still
// true a few seconds later) — and returns a ring order, exactly like
// widget-authorize: /api/call-me-now/verify has no reason to compute one at
// mint time (it does not know who is routable in any way that would still
// be fresh by the time the visitor actually answers).
//
// findRoutableAgentVoxUsernames() here is ALSO the availability recheck
// (owner decision, 12.8): /api/call-me-now/verify already checked
// availability BEFORE placing the visitor leg at all, so the common
// no-agent case never reaches this route — a call only gets here because an
// agent WAS routable a moment ago. This is the narrow RACE case: that agent
// (or every routable agent) went unready between then and now. An empty
// result here is NOT refused — it returns `ok:true` with an empty
// `ring_order`, exactly like today, so the (not yet written) scenario's own
// ring-exhausted branch runs — which MUST reuse ConsoleInbound's
// NO_AGENT_LINE_HE/declareNoAgent() verbatim, not fresh wording, so a 04:00
// call that briefly looked answerable is answered with the honest promise
// and dies recorded, not in silence. That branch reports 'ended' with
// reason 'no_agent' through the existing /event route, which is what
// actually triggers recordNoAgentCallback — this route does not write a
// callback row itself.
//
// perPhoneCallsLastHour is intentionally NOT re-checked here — same
// reasoning as widget-authorize's perIpCallsLastHour: it already gated
// admission at /api/call-me-now/verify, and this token exists only because
// that check passed a few seconds ago for this exact call.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const MAX_BODY_BYTES = 1_024;
// Coarse per-IP flood guard only (NOT a security control — Voximplant's
// scenarios call from a small, shared, provider-side IP range) — identical
// rationale and numbers to the sibling authorize/route.ts and
// widget-authorize/route.ts.
const RATE = { limit: 120, windowMs: 60_000 } as const;

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

const REFUSED = { ok: false as const };

export async function POST(request: Request) {
  const ip = getClientIp(request.headers.get.bind(request.headers));
  if (!rateLimit(`vox-call-me-now-authorize:${ip}`, RATE).allowed) {
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
  const parsed = callMeNowAuthorizeBodySchema.safeParse(parsedJson);
  if (!parsed.success) return json(REFUSED, 400);

  const expected = process.env.KALFA_CONSOLE_SECRET;
  if (!expected) return json(REFUSED, 503);
  if (!safeTokenEqual(parsed.data.secret, sha256Hex(expected))) {
    return json(REFUSED, 401);
  }

  const verified = await verifyDialToken(parsed.data.token, 'cn');
  if (!verified.ok) return json(REFUSED, 200);

  // Link the session DIRECTLY, before any of the caps checks below can
  // refuse. MORE load-bearing here than for authorize/route.ts's 'ct' twin:
  // ConsoleCallMeNow's own later /event reports deliberately claim
  // call_kind:'inbound' against a row whose real direction is 'outbound'
  // (see the scenario's own "EVENT call_kind CHOICE" header), so if the
  // scenario's 'started' report is lost, NOTHING downstream — not Tier 2,
  // not Tier 3's FIFO fallback — can ever correlate this call's later events
  // to this row. Linking here removes that dependency entirely. Best-effort:
  // a failure must never block the ring. See linkConsoleCallSession's header
  // in console-calls.ts.
  // Optional at the schema layer for deploy-ordering safety — see
  // callMeNowAuthorizeBodySchema's header. Absent means the still-old scenario
  // is calling; skip the link rather than 400 a live customer's call.
  if (typeof parsed.data.session_id === 'number') {
    try {
      await linkConsoleCallSession(verified.callId, parsed.data.session_id);
    } catch {
      /* best-effort — see comment above */
    }
  }

  const nowMs = Date.now();
  let flagEnabled: boolean;
  let liveCallsEnabled: boolean;
  let globalConcurrentCallMeNow: number;
  let answeredToday: number;
  let balanceOk: boolean;
  try {
    const [flag, vconfig, concurrent, today, balance] = await Promise.all([
      consoleCallMeNowEnabled(),
      getVoximplantConfig(),
      countConcurrentAnsweredCallMeNow(),
      countAnsweredCallMeNowToday(nowMs),
      checkInboundBalanceReserve(nowMs),
    ]);
    flagEnabled = flag;
    liveCallsEnabled = !!vconfig?.liveCallsEnabled;
    globalConcurrentCallMeNow = concurrent;
    answeredToday = today;
    balanceOk = balance.ok;
  } catch {
    return json(REFUSED, 200);
  }

  if (!flagEnabled || !liveCallsEnabled || !balanceOk) return json(REFUSED, 200);
  if (globalConcurrentCallMeNow >= CALL_ME_NOW_MAX_CONCURRENCY) return json(REFUSED, 200);
  const estSpendUsd = answeredToday * INBOUND_ESTIMATED_COST_PER_CALL_USD;
  if (answeredToday >= CALL_ME_NOW_DAILY_CALL_CAP || estSpendUsd >= CALL_ME_NOW_DAILY_SPEND_CAP_USD) {
    return json(REFUSED, 200);
  }

  let routable: string[];
  try {
    routable = await findRoutableAgentVoxUsernames();
  } catch {
    routable = []; // fail toward "no agent" — still ok:true with an empty ring, never a hard refuse
  }
  const ringOrder = computeRingOrder(routable, answeredToday);

  // Best-effort status bump — same reasoning as authorize/route.ts and
  // widget-authorize/route.ts: this is immediately followed by the scenario
  // ringing agents, so "ringing" is real progress even if the scenario's own
  // /event report is lost.
  try {
    await updateConsoleCallStatus({ callId: verified.callId, status: 'ringing', onlyIfLive: true });
  } catch {
    /* best-effort */
  }

  return json({ ok: true, ring_order: ringOrder, call_id: verified.callId }, 200);
}
