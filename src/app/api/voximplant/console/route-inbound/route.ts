import { NextResponse, after } from 'next/server';

import { normalizePhone } from '@/lib/phone';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { safeTokenEqual, sha256Hex } from '@/lib/security/token-compare';
import { sendSlackAlert } from '@/lib/alerts/slack';
import {
  computeQueueRingOrder,
  countAnsweredInboundToday,
  countAnsweredLastHourForPhone,
  countConcurrentAnsweredInbound,
  createConsoleCall,
  evaluateInboundCaps,
  findRoutableAgentVoxUsernames,
  identifyInboundCaller,
  inboundCallsEnabled,
  maskPhoneForDisplay,
  notifyOffDutyShiftAgentsOfInboundCall,
  notifyRoutableAgentsOfInboundCall,
} from '@/lib/data/console-calls';
import {
  findRoutableAgentVoxUsernamesForQueue,
  resolveActiveQueueForRing,
  setConsoleCallQueue,
} from '@/lib/data/console-queues';
import { checkInboundBalanceReserve } from '@/lib/data/voximplant-balance-cache';
import { getVoximplantConfig } from '@/lib/data/voximplant-config';
import { routeInboundBodySchema } from '@/lib/validation/console-calls';

// POST /api/voximplant/console/route-inbound   called BY
// ConsoleInbound.voxengine.js — gate BEFORE Call.answer(). ANY refusal here
// means the call is reject()ed before being answered: zero cost, zero
// autocharge exposure (verified this account's own billing data — Gate E.3
// fixture: zero-duration `incoming` sessions all carry call_cost=$0.00).
//
// Response shape is exactly what the scenario parses
// (ConsoleInbound.voxengine.js:519-530): accept:true requires ring_order to
// be an array — an EMPTY array is a valid, intentional accept (see the
// no-agent branch below), NOT a refusal.
//
// go-live for this endpoint binding to rule 1494687 is Gate E (ops-knobs
// doc) — a SEPARATE owner approval from this route existing/working. Nothing
// here flips inbound_calls_enabled or binds the rule.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const MAX_BODY_BYTES = 1_024;
// Coarse per-IP flood guard only — NOT the real per-CLI cap (that is a DB
// count on console_call_pii.phone_e164, evaluated below). Loose: every
// inbound call to this account hits this route once, from Voximplant's
// shared infra IPs.
const RATE = { limit: 120, windowMs: 60_000 } as const;

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

const REJECT = { accept: false as const };

export async function POST(request: Request) {
  const ip = getClientIp(request.headers.get.bind(request.headers));
  if (!rateLimit(`vox-console-route-inbound:${ip}`, RATE).allowed) {
    return json(REJECT, 429);
  }

  const declaredLen = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) {
    return json(REJECT, 413);
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return json(REJECT, 413);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return json(REJECT, 400);
  }
  const parsed = routeInboundBodySchema.safeParse(parsedJson);
  if (!parsed.success) return json(REJECT, 400);
  const body = parsed.data;

  const expected = process.env.KALFA_CONSOLE_SECRET;
  if (!expected) return json(REJECT, 503);
  if (!safeTokenEqual(body.secret, sha256Hex(expected))) {
    return json(REJECT, 401);
  }

  const nowMs = Date.now();
  const normalizedCli = normalizePhone(body.cli); // null for withheld/unparsable CLI

  // Gather every capped input FIRST (all pre-answer, all fail-closed on
  // error) — evaluateInboundCaps is the single, pure decision point so the
  // caps math itself is unit-testable without touching Supabase.
  let flagEnabled: boolean;
  let liveCallsEnabled: boolean;
  let globalConcurrentAnswered: number;
  let perCliAnsweredLastHour: number;
  let answeredToday: number;
  let balanceOk: boolean;
  try {
    const [flag, vconfig, concurrent, today, balance] = await Promise.all([
      inboundCallsEnabled(),
      getVoximplantConfig(),
      countConcurrentAnsweredInbound(),
      countAnsweredInboundToday(nowMs),
      checkInboundBalanceReserve(nowMs),
    ]);
    flagEnabled = flag;
    liveCallsEnabled = !!vconfig?.liveCallsEnabled;
    globalConcurrentAnswered = concurrent;
    answeredToday = today;
    balanceOk = balance.ok;
    perCliAnsweredLastHour = await countAnsweredLastHourForPhone(normalizedCli ?? 'unknown-cli');
  } catch {
    // Any measurement failure ⇒ fail closed (unknown is treated as capped).
    return json(REJECT, 200);
  }

  // No hours condition: answering a call the consumer placed is never
  // time-restricted (compliance ruling 2026-08-12; the reasoning is written
  // out in console-calls.ts where the old window lived). Out-of-hours calls
  // are answered and handled honestly by the no-agent path.
  const decision = evaluateInboundCaps({
    flagEnabled,
    liveCallsEnabled,
    balanceOk,
    globalConcurrentAnswered,
    perCliAnsweredLastHour,
    answeredToday,
  });

  if (!decision.ok) {
    // ONE alert per hour, not one per refused call. Measured the hard way
    // (13.8): the breaker tripped at 84 answered calls during an overnight
    // automated-dialer flood, and from that moment EVERY subsequent call —
    // arriving several per minute — fired its own "breaker tripped" alert.
    // The owner's Slack was unusable. An alert that repeats on every
    // occurrence of a condition that is, by design, now permanent for the
    // rest of the day is not monitoring; it is noise that buries the next
    // real alert. Reuses the existing rateLimit helper (already imported for
    // the flood guard above) rather than inventing a second mechanism —
    // limit:1 per hour, so the trip is still announced promptly, still
    // re-announced hourly while it persists, and the breaker itself is
    // completely unaffected (this gates only the notification).
    if (decision.reason === 'daily_breaker') {
      if (rateLimit('console-inbound-breaker-alert', { limit: 1, windowMs: 3_600_000 }).allowed) {
        void sendSlackAlert({
          level: 'error',
          category: 'send_health',
          source: 'console-route-inbound',
          title: 'עצר-חירום יומי לשיחות נכנסות הופעל',
          detail: `answered_today=${answeredToday} · שיחות נוספות נדחות ללא עלות · התראה זו מוגבלת לאחת לשעה`,
          fields: { answered_today: answeredToday },
        });
      }
    }
    return json(REJECT, 200);
  }

  // Caller identification — best-effort ENRICHMENT, never a gate. An
  // unrecognized or unnormalizable CLI still gets accepted (or refused)
  // purely on the caps above.
  const identified = normalizedCli ? await identifyInboundCaller(normalizedCli).catch(() => null) : null;
  const callerMasked = normalizedCli ? maskPhoneForDisplay(normalizedCli) : null;

  let routable: string[];
  try {
    routable = await findRoutableAgentVoxUsernames();
  } catch {
    routable = []; // fail toward "no agent" (still accept — honest no-agent line), never a hard refuse
  }

  // Department queues (plan §10 extension point) — resolve the target queue
  // (V1: a flat default, see console-queues.ts's resolveInboundQueueKey doc
  // for why caller-history is NOT used) and ring its members first, THEN
  // every other routable agent as a fallback. Any failure here (queue tables
  // unreachable, etc.) degrades to the pre-queue ring — never a refusal: queue
  // routing is a routing PREFERENCE, not an admission gate.
  let queueId: string | null = null;
  let ringOrder: string[];
  try {
    const queue = await resolveActiveQueueForRing();
    queueId = queue?.id ?? null;
    const queueMembers = queue ? await findRoutableAgentVoxUsernamesForQueue(queue.id) : [];
    ringOrder = computeQueueRingOrder(queueMembers, routable, answeredToday);
  } catch {
    ringOrder = computeQueueRingOrder([], routable, answeredToday); // == plain computeRingOrder(routable, ...)
  }

  let callId: string;
  try {
    const created = await createConsoleCall({
      kind: 'inbound_customer',
      direction: 'inbound',
      eventId: identified?.eventId ?? null,
      guestId: identified?.guestId ?? null,
      contactId: identified?.contactId ?? null,
      callerMasked,
      phoneE164: normalizedCli,
    });
    callId = created.id;
  } catch {
    // Row creation failed — refuse rather than answer a call we cannot
    // account for (fail-closed on the same principle as every other gate
    // here: an unrecordable admission is treated as a non-admission).
    return json(REJECT, 200);
  }
  if (queueId) void setConsoleCallQueue(callId, queueId); // best-effort label, never blocks the answer

  // Agent push alert (capability B, call-center research 12.8) — scheduled
  // via next/server's `after()`, NOT a bare `void` fire-and-forget: unlike
  // setConsoleCallQueue's single UPDATE above, this does a SELECT plus N
  // sendPushToUser calls (each its own DB round trips + an HTTPS push-service
  // request), and a `void` call started before `return` has no platform
  // guarantee of running to completion. `after()` is Next 16's sanctioned
  // mechanism for exactly this — deferred, non-blocking, guaranteed to run
  // (stable since 15.1.0; "Node.js server" deployment is explicitly
  // supported, which is this app's pm2 model). See
  // notifyRoutableAgentsOfInboundCall's own header for why this targets the
  // VAPID web-push stack and not Voximplant's PushService.
  after(() => notifyRoutableAgentsOfInboundCall({ voxUsernames: ringOrder, consoleCallId: callId }));
  // Wake-and-answer (call-center research, 12.8): the push above only
  // reaches agents ALREADY routable (already SDK-connected) — precisely the
  // set that does not need waking. When ringOrder is empty (nobody
  // connected — the exact scenario this capability targets) that call is a
  // no-op, so without this second, EXPANDED audience zero pushes would ever
  // go out in the case the whole feature exists for. Fails closed on
  // consoleWakeEnabled inside the function itself; see its own header.
  after(() =>
    notifyOffDutyShiftAgentsOfInboundCall({ consoleCallId: callId, excludeVoxUsernames: ringOrder }),
  );

  // call_id: the row this exact call answers for. ConsoleInbound echoes it on
  // every /event report so findConsoleCallForEvent can resolve it EXACTLY
  // (stage-7 addition) instead of falling to the FIFO tier — inbound never
  // learns vox_session_id/dial-token any other way, and under concurrent
  // inbound calls the FIFO tier can attach one call's session-command
  // capability to a DIFFERENT call's row.
  return json({ accept: true, ring_order: ringOrder, display_hint: callerMasked, call_id: callId }, 200);
}
