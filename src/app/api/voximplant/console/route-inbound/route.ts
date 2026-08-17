import { NextResponse, after } from 'next/server';

import { normalizePhone } from '@/lib/phone';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { safeTokenEqual, sha256Hex } from '@/lib/security/token-compare';
import { sendSlackAlert } from '@/lib/alerts/slack';
import {
  computeQueueRingOrder,
  countAnsweredInboundToday,
  countAnsweredLastHourForPhone,
  countAnsweredUnidentifiedInboundToday,
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
// Response shape is exactly what the scenario parses, in its
// AppEvents.CallAlerting handler (ConsoleInbound.voxengine.js — named by
// handler, not by line number, which has already drifted once):
//   accept       — must be true, and `ring_order` must be an array; an EMPTY
//                  array is a valid, intentional accept (see the no-agent
//                  branch below), NOT a refusal
//   call_id      — stashed before the first reportEvent so every lifecycle
//                  report resolves this exact console_calls row
//   caller_display — copied into callUser's `displayName` on each ring (see
//                  the accept return at the bottom of this file)
//   display_hint — NOT read by the scenario at all; it is persisted by
//                  createConsoleCall for the console UI
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

  // Caller identification moved up (fraud incident, 17.8) — it now FEEDS the
  // caps decision below, not just the post-accept display_hint enrichment.
  // Still never a hard fail on its own: an identification-lookup error is
  // swallowed to `null` (unidentified) here, deliberately OUTSIDE the
  // fail-closed Promise.all below, so a contacts-table hiccup degrades this
  // caller to the tighter unidentified budget rather than refusing the whole
  // gate — the same lenient-on-this-one-signal posture the ORIGINAL
  // enrichment-only call already had (`.catch(() => null)`).
  const identified = normalizedCli ? await identifyInboundCaller(normalizedCli).catch(() => null) : null;

  // Gather every capped input FIRST (all pre-answer, all fail-closed on
  // error) — evaluateInboundCaps is the single, pure decision point so the
  // caps math itself is unit-testable without touching Supabase.
  let flagEnabled: boolean;
  let liveCallsEnabled: boolean;
  let globalConcurrentAnswered: number;
  let perCliAnsweredLastHour: number;
  let answeredToday: number;
  let answeredUnidentifiedToday: number;
  let balanceOk: boolean;
  try {
    const [flag, vconfig, concurrent, today, unidentifiedToday, balance, perCli] = await Promise.all([
      inboundCallsEnabled(),
      getVoximplantConfig(),
      countConcurrentAnsweredInbound(),
      countAnsweredInboundToday(nowMs),
      countAnsweredUnidentifiedInboundToday(nowMs),
      checkInboundBalanceReserve(nowMs),
      // FIXED (fraud incident, 17.8): used to pass the string literal
      // 'unknown-cli' for an unparseable CLI, which console_call_pii never
      // actually stores (it stores SQL NULL) — that made this cap silently
      // never bind for exactly the CLI shapes this incident used. See the
      // function's own header in console-calls.ts.
      countAnsweredLastHourForPhone(normalizedCli),
    ]);
    flagEnabled = flag;
    liveCallsEnabled = !!vconfig?.liveCallsEnabled;
    globalConcurrentAnswered = concurrent;
    answeredToday = today;
    answeredUnidentifiedToday = unidentifiedToday;
    balanceOk = balance.ok;
    perCliAnsweredLastHour = perCli;
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
    isIdentifiedCaller: identified !== null,
    answeredUnidentifiedToday,
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
    // ADDED (fraud incident, 17.8) — same rate-limited-alert shape as the
    // daily breaker above, DIFFERENT rateLimit key so the two never compete
    // for the same hourly budget. Worth alerting on (unlike concurrency/
    // per_cli_rate, deliberately silent): this reason means the account is
    // actively being probed by callers this account has never talked to.
    if (decision.reason === 'unidentified_flood') {
      if (rateLimit('console-inbound-unidentified-alert', { limit: 1, windowMs: 3_600_000 }).allowed) {
        void sendSlackAlert({
          level: 'warn',
          category: 'send_health',
          source: 'console-route-inbound',
          title: 'תקרת שיחות נכנסות ממתקשרים לא-מזוהים הופעלה',
          detail: `answered_unidentified_today=${answeredUnidentifiedToday} · שיחות נוספות ממתקשרים לא מוכרים נדחות ללא עלות · שיחות ממתקשרים מוכרים לא מושפעות · התראה זו מוגבלת לאחת לשעה`,
          fields: { answered_unidentified_today: answeredUnidentifiedToday },
        });
      }
    }
    return json(REJECT, 200);
  }

  // `identified` was resolved above (feeds the caps decision). callerMasked
  // stays a best-effort DISPLAY enrichment only, same as before.
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

  // ADDED (fraud incident, 17.8, owner-approved) — an UNIDENTIFIED caller
  // arriving when the ring order is EMPTY is a call this account cannot serve
  // by anyone, and answering it buys nothing while costing a real inbound
  // minute plus the disclosure TTS plus a stored recording, purely to say
  // "nobody is here". Measured over the flood's first five days: 1,215 inbound
  // calls, 3 ever reached an agent, and none of those 3 was an unidentified
  // caller. Refusing HERE — before createConsoleCall, so before the scenario
  // ever calls Call.answer() — costs nothing at all.
  //
  // Deliberately ordered BEFORE the unidentified daily budget can be spent
  // (evaluateInboundCaps' 'unidentified_flood', above). The flood runs around
  // the clock, so on the budget alone it would exhaust all 20 slots overnight
  // and the first real unrecognized caller at midday — the exact person that
  // budget exists to admit — would be refused. Gating on "nobody could have
  // answered anyway" spends none of it.
  //
  // A KNOWN guest/contact is never affected: they still reach the honest
  // no-agent line and its callback promise, which is the product decision this
  // must not quietly reverse.
  //
  // Fails closed by construction: findRoutableAgentVoxUsernames() degrading to
  // [] (above) now REFUSES an unidentified caller instead of answering them.
  // That is a deliberate change to that catch's "never a hard refuse" comment
  // — for unidentified callers only — and matches the fail-closed posture
  // every other gate in this route already takes.
  if (ringOrder.length === 0 && identified === null) {
    return json(REJECT, 200);
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
  // `caller_display` is the human-readable label for the RINGING AGENT — the one
  // thing about the caller the scenario cannot work out on its own.
  //
  // The scenario already holds the raw CLI (AppEvents.CallAlerting's `e.callerid`) and
  // now passes it through as callUser's `callerid`, so it needs nothing from us to
  // show a NUMBER. What it has no way to produce is a NAME — and no way to format a
  // number either (no libphonenumber in VoxEngine, and the platform hands over bare
  // digits like `972…`). Both are decided here, where the guest lookup and the
  // normalizer already live, and returned as ONE field the scenario copies straight
  // into callUser's `displayName` — surfaced by the SDK as `Call.remoteDisplayName`,
  // which the app already renders (VoxCallSession.customerName).
  //
  // Name when we recognise the caller, their E.164 otherwise, null when the CLI was
  // withheld or unparsable. Deliberately not a placeholder in that last case: the
  // scenario says "מספר חסוי" itself, so a withheld number reads as withheld rather
  // than as this fix having failed.
  //
  // This reverses an earlier choice, and says so plainly. The scenario used to pass
  // our OWN DID as the callerid on every ring, reasoning that the caller's number
  // "never needs to ride an internal callUser leg" — but the effect was an agent being
  // asked to answer a call knowing nothing about who is on it, which is not privacy,
  // it is a broken console. The agent is about to speak with this person. The other
  // half of that reasoning, an UNVERIFIED worry about Voximplant's CallerID rules for
  // an intra-app callUser, resolved against the live reference on 2026-08-17: the
  // documented restriction is "test numbers rented from Voximplant cannot be used as
  // CallerID, use only real numbers" — a real caller's own number is exactly that.
  //
  // ACCEPTED CONSEQUENCE, stated rather than glossed: the CLI and this label now ride
  // SIP signalling, so they appear in Voximplant's own session logs regardless of this
  // codebase's Logger discipline. That is inherent to showing the agent who is calling
  // — the thing that was asked for — not an oversight.
  //
  // `display_hint` stays MASKED and stays exactly as it was: it feeds console_calls, a
  // stored, queryable record with a far wider audience than the one agent whose phone
  // is ringing right now. Different surface, different exposure, different field.
  return json(
    {
      accept: true,
      ring_order: ringOrder,
      display_hint: callerMasked,
      caller_display: identified?.guestName ?? normalizedCli,
      // The caller's number as a SEPARATE field, because the agent must see it
      // on every call — not only when we failed to recognise them (owner, 17.8:
      // "השם לא מספיק לדעתי, חובה תמיד להציג את המספר ממנו השיחה מתקבלת").
      // The scenario sends this as a SIP header rather than folding it into
      // `caller_display`, so the device gets a name and a number it can lay out
      // as two lines instead of one run-on string. Null for a withheld or
      // unparsable CLI — there is no number to show, and the app must render
      // nothing rather than fall back to whatever the SIP `From` happens to
      // carry, which in that case is our own DID.
      //
      // Deliberately the SAME value `caller_display` falls back to, so when the
      // caller is unrecognised the two fields are byte-identical and the app can
      // suppress the duplicate with a plain equality check. An earlier draft had
      // the app compare the label against the raw platform CLI instead — one
      // normalized, one not — which would never have matched.
      caller_number: normalizedCli,
      call_id: callId,
    },
    200,
  );
}
