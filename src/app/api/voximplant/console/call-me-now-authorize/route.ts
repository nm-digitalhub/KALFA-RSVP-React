import {
  CALL_ME_NOW_DAILY_CALL_CAP,
  CALL_ME_NOW_DAILY_SPEND_CAP_USD,
  CALL_ME_NOW_MAX_CONCURRENCY,
  CALL_ME_NOW_ESTIMATED_COST_PER_CALL_USD,
  consoleCallMeNowEnabled,
  countAnsweredCallMeNowToday,
  countConcurrentAnsweredCallMeNow,
  linkConsoleCallSession,
  verifyDialToken,
} from '@/lib/data/console-calls';
import { callMeNowAuthorizeBodySchema } from '@/lib/validation/console-calls';
import { authorizeConsoleRing } from '@/lib/voximplant/console-ring-authorize';
import { guardConsoleScenarioRequest } from '@/lib/voximplant/console-scenario-guard';
import { jsonNoStore } from '@/lib/voximplant/no-store-response';

// POST /api/voximplant/console/call-me-now-authorize   body: { secret, token, session_id? }
//   → { ok: true, ring_order, call_id } | { ok: false }
//
// Called by ConsoleCallMeNow.voxengine.js — call-me-now's authorize gate
// (capability A, THIRD design). The scenario calls this AFTER the visitor leg
// answers and its disclosure finishes playing (mirroring ConsoleInbound's
// proceedInbound: record() -> say(disclosure) -> PlaybackFinished -> THEN
// ring agents) — never before, so the disclosure is never skipped even if
// this call is refused.
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
// `ring_order`, so the scenario's own ring-exhausted branch runs — which
// MUST reuse ConsoleInbound's NO_AGENT_LINE_HE/declareNoAgent() verbatim, not
// fresh wording, so a 04:00
// call that briefly looked answerable is answered with the honest promise
// and dies recorded, not in silence. That branch reports 'ended' with
// reason 'no_agent' through the existing /event route, which is what
// actually triggers recordMissedCallCallback — this route does not write a
// callback row itself.
//
// perPhoneCallsLastHour is intentionally NOT re-checked here — same
// reasoning as widget-authorize's perIpCallsLastHour: it already gated
// admission at /api/call-me-now/verify, and this token exists only because
// that check passed a few seconds ago for this exact call.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 1_024;
// Coarse per-IP flood guard only (NOT a security control — Voximplant's
// scenarios call from a small, shared, provider-side IP range) — identical
// rationale and numbers to the sibling authorize/route.ts and
// widget-authorize/route.ts.
const RATE = { limit: 120, windowMs: 60_000 } as const;

const REFUSED = { ok: false as const };

export async function POST(request: Request) {
  const guard = await guardConsoleScenarioRequest(request, {
    scope: 'vox-call-me-now-authorize',
    rate: RATE,
    maxBodyBytes: MAX_BODY_BYTES,
    schema: callMeNowAuthorizeBodySchema,
  });
  if (!guard.ok) return jsonNoStore(REFUSED, guard.status);
  const body = guard.data;

  const verified = await verifyDialToken(body.token, 'cn');
  if (!verified.ok) return jsonNoStore(REFUSED, 200);

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
  if (typeof body.session_id === 'number') {
    try {
      await linkConsoleCallSession(verified.callId, body.session_id);
    } catch {
      /* best-effort — see comment above */
    }
  }

  // Second, authoritative pass — flag, live calls, balance reserve,
  // concurrency and the daily breaker, re-read fresh (see the header).
  // CALL_ME_NOW_*, not INBOUND_* — this places an OUTBOUND PSTN leg, which
  // this account bills at ~10x an inbound answer. See the constant's own
  // header in console-calls.ts (recalibrated 13.8).
  const ring = await authorizeConsoleRing({
    callId: verified.callId,
    flagEnabled: consoleCallMeNowEnabled,
    countConcurrentAnswered: countConcurrentAnsweredCallMeNow,
    countAnsweredToday: countAnsweredCallMeNowToday,
    caps: {
      maxConcurrency: CALL_ME_NOW_MAX_CONCURRENCY,
      dailyCallCap: CALL_ME_NOW_DAILY_CALL_CAP,
      dailySpendCapUsd: CALL_ME_NOW_DAILY_SPEND_CAP_USD,
      estimatedCostPerCallUsd: CALL_ME_NOW_ESTIMATED_COST_PER_CALL_USD,
    },
  });
  if (!ring.ok) return jsonNoStore(REFUSED, 200);

  return jsonNoStore({ ok: true, ring_order: ring.ringOrder, call_id: verified.callId }, 200);
}
