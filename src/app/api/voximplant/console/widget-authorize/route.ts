import { NextResponse } from 'next/server';

import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { safeTokenEqual, sha256Hex } from '@/lib/security/token-compare';
import {
  computeRingOrder,
  consoleWidgetEnabled,
  countAnsweredWidgetToday,
  countConcurrentAnsweredWidget,
  findRoutableAgentVoxUsernames,
  updateConsoleCallStatus,
  verifyDialToken,
  WIDGET_DAILY_CALL_CAP,
  WIDGET_DAILY_SPEND_CAP_USD,
  WIDGET_ESTIMATED_COST_PER_CALL_USD,
  WIDGET_MAX_CONCURRENCY,
} from '@/lib/data/console-calls';
import { checkInboundBalanceReserve } from '@/lib/data/voximplant-balance-cache';
import { getVoximplantConfig } from '@/lib/data/voximplant-config';
import { widgetAuthorizeBodySchema } from '@/lib/validation/console-calls';

// POST /api/voximplant/console/widget-authorize   body: { secret, token }
//   → { ok: true, ring_order, call_id } | { ok: false }
//
// NOT YET CALLED BY ANY SCENARIO — this is the widget's authorize gate,
// built and unit-testable ahead of the scenario that will call it, same
// sequencing this project already used for route-inbound ahead of gate E.
// The scenario this targets (ConsoleWidgetIn, not written this pass — see
// the report for why) would call this from CallAlerting, exactly where
// ConsoleDial's outbound branch calls the sibling authorize/route.ts — same
// body SHAPE (secret, token), verified by the SAME verifyDialToken. It is a
// SIBLING schema (widgetAuthorizeBodySchema, 'wt'-prefixed only), not a
// shared one: a shared (ct|wt) schema would let a token minted for
// ConsoleDial parse successfully here (and vice versa) — verifyDialToken's
// expectedPrefix argument is the actual security boundary either way, but a
// wrong-flow token should fail as early as the schema, not several checks
// deeper. See validation/console-calls.ts's comment on this pair.
//
// Re-runs evaluateWidgetCallCaps's inputs fresh (a second, authoritative
// pass — same reasoning as authorize/route.ts's own comment: a token only
// proves "call-intent admitted this specific call within the last 60s", not
// that concurrency/balance/the flag are still true a few seconds later) and
// additionally returns a ring order — call-intent has no reason to compute
// one (it doesn't know who's routable at mint time in any way that would
// still be fresh by the time a visitor actually connects), so this is the
// first point in the widget flow a ring order is meaningful, matching
// route-inbound's own timing (computed at admission, not before).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const MAX_BODY_BYTES = 1_024;
// Coarse per-IP flood guard only (NOT a security control — Voximplant's
// scenarios call from a small, shared, provider-side IP range) — identical
// rationale and numbers to the sibling authorize/route.ts.
const RATE = { limit: 120, windowMs: 60_000 } as const;

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

const REFUSED = { ok: false as const };

export async function POST(request: Request) {
  const ip = getClientIp(request.headers.get.bind(request.headers));
  if (!rateLimit(`vox-widget-authorize:${ip}`, RATE).allowed) {
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
  const parsed = widgetAuthorizeBodySchema.safeParse(parsedJson);
  if (!parsed.success) return json(REFUSED, 400);

  const expected = process.env.KALFA_CONSOLE_SECRET;
  if (!expected) return json(REFUSED, 503);
  if (!safeTokenEqual(parsed.data.secret, sha256Hex(expected))) {
    return json(REFUSED, 401);
  }

  const verified = await verifyDialToken(parsed.data.token, 'wt');
  if (!verified.ok) return json(REFUSED, 200);

  const nowMs = Date.now();
  let flagEnabled: boolean;
  let liveCallsEnabled: boolean;
  let globalConcurrentWidget: number;
  let answeredToday: number;
  let balanceOk: boolean;
  try {
    const [flag, vconfig, concurrent, today, balance] = await Promise.all([
      consoleWidgetEnabled(),
      getVoximplantConfig(),
      countConcurrentAnsweredWidget(),
      countAnsweredWidgetToday(nowMs),
      checkInboundBalanceReserve(nowMs),
    ]);
    flagEnabled = flag;
    liveCallsEnabled = !!vconfig?.liveCallsEnabled;
    globalConcurrentWidget = concurrent;
    answeredToday = today;
    balanceOk = balance.ok;
  } catch {
    return json(REFUSED, 200);
  }

  // perIpCallsLastHour is intentionally NOT re-checked here: it already
  // gated admission at call-intent (mint time), and by definition this
  // token exists only because that check passed a few seconds ago for this
  // exact call. Re-deriving an IP at this layer would require the scenario
  // to carry it forward, which it never learns in the first place (see
  // evaluateWidgetCallCaps's header) — concurrency/balance/flag/daily-breaker
  // are what CAN meaningfully change in the gap, so those are what get
  // re-checked here, same as authorize/route.ts's own live-dial-gate
  // re-check. The actual thresholds are the SAME exported constants
  // evaluateWidgetCallCaps uses (WIDGET_MAX_CONCURRENCY etc.) — restated
  // inline rather than calling evaluateWidgetCallCaps itself only because
  // that function requires a perIpCallsLastHour input this route has no
  // fresh value for; duplicating the four-line comparison is cheaper and
  // safer than threading a fake 0 through a function whose name promises a
  // real per-visitor check.
  if (!flagEnabled || !liveCallsEnabled || !balanceOk) return json(REFUSED, 200);
  if (globalConcurrentWidget >= WIDGET_MAX_CONCURRENCY) return json(REFUSED, 200);
  const estSpendUsd = answeredToday * WIDGET_ESTIMATED_COST_PER_CALL_USD;
  if (answeredToday >= WIDGET_DAILY_CALL_CAP || estSpendUsd >= WIDGET_DAILY_SPEND_CAP_USD) {
    return json(REFUSED, 200);
  }

  let routable: string[];
  try {
    routable = await findRoutableAgentVoxUsernames();
  } catch {
    routable = []; // fail toward "no agent" — still ok:true with an empty ring, never a hard refuse (matches route-inbound)
  }
  const ringOrder = computeRingOrder(routable, answeredToday);

  // Best-effort status bump — same reasoning as authorize/route.ts: this is
  // immediately followed by the scenario ringing agents, so "ringing" is
  // real progress even if the scenario's own /event report is lost.
  try {
    await updateConsoleCallStatus({ callId: verified.callId, status: 'ringing', onlyIfLive: true });
  } catch {
    /* best-effort */
  }

  return json({ ok: true, ring_order: ringOrder, call_id: verified.callId }, 200);
}
