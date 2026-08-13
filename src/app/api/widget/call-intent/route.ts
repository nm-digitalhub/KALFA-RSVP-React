import { NextResponse } from 'next/server';

import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { sha256Hex } from '@/lib/security/token-compare';
import {
  consoleWidgetEnabled,
  countAnsweredWidgetToday,
  countConcurrentAnsweredWidget,
  countWidgetCallsLastHourForIpHash,
  createConsoleCall,
  evaluateWidgetCallCaps,
  mintDialToken,
  recordWidgetOriginIpHash,
} from '@/lib/data/console-calls';
import { checkInboundBalanceReserve } from '@/lib/data/voximplant-balance-cache';
import { getVoximplantConfig } from '@/lib/data/voximplant-config';

// POST /api/widget/call-intent   body: (none)   →   { ok, token?, callId? }
//
// PUBLIC — called by the browser widget BEFORE it attempts Client.call(),
// the moment it has real cost potential: a signed-in shared identity placing
// a call. This is the ADMISSION gate (evaluateWidgetCallCaps), matching
// route-inbound's role for PSTN — but shaped differently because it can be.
// route-inbound is called by Voximplant's own infra AFTER a real caller ID
// already exists; call-intent is called by the browser itself, so it has a
// real per-visitor signal (the IP) available BEFORE any Voximplant session
// exists at all, and mints a single-use token
// (mintDialToken/verifyDialToken — REUSED unchanged from the manual-dial
// flow, not reinvented) that the future widget-authorize route will verify
// scenario-side as the SECOND, authoritative gate — same "browser proposes,
// server disposes, and re-checks live state a second time" shape as
// dial-intent -> authorize.
//
// Coarse per-IP flood guard (in-memory, loose) FIRST — same role as
// route-inbound's own coarse guard: defense against a burst hitting the DB-
// backed count below, not the real per-visitor cap itself (that's
// evaluateWidgetCallCaps's perIpCallsLastHour, DB-backed, tight).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const FLOOD_RATE = { limit: 30, windowMs: 60_000 } as const;

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

const REFUSED = { ok: false as const };

export async function POST(request: Request) {
  const ip = getClientIp(request.headers.get.bind(request.headers));
  if (!rateLimit(`widget-call-intent-flood:${ip}`, FLOOD_RATE).allowed) {
    return json(REFUSED, 429);
  }

  const ipHash = sha256Hex(ip);
  const nowMs = Date.now();

  let flagEnabled: boolean;
  let liveCallsEnabled: boolean;
  let globalConcurrentWidget: number;
  let perIpCallsLastHour: number;
  let answeredToday: number;
  let balanceOk: boolean;
  try {
    const [flag, vconfig, concurrent, today, balance, perIp] = await Promise.all([
      consoleWidgetEnabled(),
      getVoximplantConfig(),
      countConcurrentAnsweredWidget(),
      countAnsweredWidgetToday(nowMs),
      checkInboundBalanceReserve(nowMs),
      countWidgetCallsLastHourForIpHash(ipHash),
    ]);
    flagEnabled = flag;
    liveCallsEnabled = !!vconfig?.liveCallsEnabled;
    globalConcurrentWidget = concurrent;
    answeredToday = today;
    balanceOk = balance.ok;
    perIpCallsLastHour = perIp;
  } catch {
    // Any measurement failure ⇒ fail closed (unknown is treated as capped) —
    // same discipline as route-inbound.
    return json(REFUSED, 200);
  }

  const decision = evaluateWidgetCallCaps({
    flagEnabled,
    liveCallsEnabled,
    balanceOk,
    globalConcurrentWidget,
    perIpCallsLastHour,
    answeredToday,
  });
  if (!decision.ok) {
    return json({ ok: false, reason: decision.reason }, 200);
  }

  let callId: string;
  try {
    const created = await createConsoleCall({
      kind: 'widget',
      direction: 'inbound',
      // No phone, no caller-masked hint — a widget visitor has neither.
      callerMasked: null,
      phoneE164: null,
    });
    callId = created.id;
  } catch {
    // Row creation failed — refuse rather than admit a call we cannot
    // account for (same fail-closed principle as every other gate in this
    // call-center project).
    return json(REFUSED, 200);
  }

  // Best-effort — a failed write here degrades this ONE visitor's own
  // future per-IP count, never blocks the call itself (see
  // recordWidgetOriginIpHash's header).
  await recordWidgetOriginIpHash(callId, ipHash).catch(() => {});

  let token: string;
  try {
    // 'wt' prefix — see console-calls.ts's DIAL_TOKEN_PREFIXES comment for
    // why the widget must NOT share ConsoleDial's 'ct' pattern.
    token = await mintDialToken(callId, 'wt');
  } catch {
    return json(REFUSED, 200);
  }

  return json({ ok: true, token, call_id: callId }, 200);
}
