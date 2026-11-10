import {
  consoleWidgetEnabled,
  countAnsweredWidgetToday,
  countConcurrentAnsweredWidget,
  verifyDialToken,
  WIDGET_DAILY_CALL_CAP,
  WIDGET_DAILY_SPEND_CAP_USD,
  WIDGET_ESTIMATED_COST_PER_CALL_USD,
  WIDGET_MAX_CONCURRENCY,
} from '@/lib/data/console-calls';
import { widgetAuthorizeBodySchema } from '@/lib/validation/console-calls';
import { authorizeConsoleRing } from '@/lib/voximplant/console-ring-authorize';
import { guardConsoleScenarioRequest } from '@/lib/voximplant/console-scenario-guard';
import { jsonNoStore } from '@/lib/voximplant/no-store-response';

// POST /api/voximplant/console/widget-authorize   body: { secret, token }
//   → { ok: true, ring_order, call_id } | { ok: false }
//
// NOT CALLED BY ANY SCENARIO — this is the widget's authorize gate. The
// widget design it belongs to was superseded by call-me-now and is dead code
// pending an owner cleanup decision (see console-calls.ts). The scenario it
// targets (ConsoleWidgetIn) was never written; it would call this from
// CallAlerting, exactly where
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

const MAX_BODY_BYTES = 1_024;
// Coarse per-IP flood guard only (NOT a security control — Voximplant's
// scenarios call from a small, shared, provider-side IP range) — identical
// rationale and numbers to the sibling authorize/route.ts.
const RATE = { limit: 120, windowMs: 60_000 } as const;

const REFUSED = { ok: false as const };

export async function POST(request: Request) {
  const guard = await guardConsoleScenarioRequest(request, {
    scope: 'vox-widget-authorize',
    rate: RATE,
    maxBodyBytes: MAX_BODY_BYTES,
    schema: widgetAuthorizeBodySchema,
  });
  if (!guard.ok) return jsonNoStore(REFUSED, guard.status);
  const body = guard.data;

  const verified = await verifyDialToken(body.token, 'wt');
  if (!verified.ok) return jsonNoStore(REFUSED, 200);

  // perIpCallsLastHour is intentionally NOT re-checked here: it already
  // gated admission at call-intent (mint time), and by definition this
  // token exists only because that check passed a few seconds ago for this
  // exact call. Re-deriving an IP at this layer would require the scenario
  // to carry it forward, which it never learns in the first place (see
  // evaluateWidgetCallCaps's header) — concurrency/balance/flag/daily-breaker
  // are what CAN meaningfully change in the gap, so those are what get
  // re-checked here, same as authorize/route.ts's own live-dial-gate
  // re-check. The actual thresholds are the SAME exported constants
  // evaluateWidgetCallCaps uses (WIDGET_MAX_CONCURRENCY etc.) — passed to the
  // shared ring gate rather than calling evaluateWidgetCallCaps itself only
  // because that function requires a perIpCallsLastHour input this route has
  // no fresh value for, and threading a fake 0 through a function whose name
  // promises a real per-visitor check would be worse.
  const ring = await authorizeConsoleRing({
    callId: verified.callId,
    flagEnabled: consoleWidgetEnabled,
    countConcurrentAnswered: countConcurrentAnsweredWidget,
    countAnsweredToday: countAnsweredWidgetToday,
    caps: {
      maxConcurrency: WIDGET_MAX_CONCURRENCY,
      dailyCallCap: WIDGET_DAILY_CALL_CAP,
      dailySpendCapUsd: WIDGET_DAILY_SPEND_CAP_USD,
      estimatedCostPerCallUsd: WIDGET_ESTIMATED_COST_PER_CALL_USD,
    },
  });
  if (!ring.ok) return jsonNoStore(REFUSED, 200);

  return jsonNoStore({ ok: true, ring_order: ring.ringOrder, call_id: verified.callId }, 200);
}
