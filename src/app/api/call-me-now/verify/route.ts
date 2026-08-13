import { NextResponse } from 'next/server';

import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { verifyOtp } from '@/lib/data/otp';
import {
  consoleCallMeNowEnabled,
  countAnsweredCallMeNowToday,
  countAnsweredLastHourForPhone,
  countConcurrentAnsweredCallMeNow,
  createConsoleCall,
  evaluateCallMeNowCaps,
  evaluateCallMeNowConsent,
  findRoutableAgentVoxUsernames,
  mintDialToken,
  offerCallbackForCallMeNow,
} from '@/lib/data/console-calls';
import { checkInboundBalanceReserve } from '@/lib/data/voximplant-balance-cache';
import { getVoximplantConfig } from '@/lib/data/voximplant-config';
import { startScenarios } from '@/lib/voximplant/client';
import { getAppOrigin } from '@/lib/url';
import { normalizePhone } from '@/lib/phone';
import { CALL_ME_NOW_OTP_PURPOSE, callMeNowVerifyBodySchema } from '@/lib/validation/call-me-now';

// POST /api/call-me-now/verify   body: { phone, code }   →   { ok, reason? }
//
// PUBLIC — the SECOND and only call-placing step of capability A's third
// design (research + full architecture, 12.8; see console-calls.ts's
// evaluateCallMeNowCaps header for the complete trail, including the
// AVAILABILITY-NOT-THE-CLOCK owner ruling this route implements). Order:
//   1. Coarse per-IP flood guard (same role as every other public
//      call-center entry point's own guard — defense against a burst, not
//      the real per-target cap below).
//   2. verifyOtp — SINGLE-USE; a wrong or replayed code is indistinguishable
//      from "not verified" to the caller (generic refusal, no detail on
//      WHICH check failed, matching route-inbound/widget/call-intent's own
//      "never explain the gate that tripped" discipline for a public route).
//   3. evaluateCallMeNowConsent(phone) — DNC / contacts opt-out / Shabbat-
//      Yom-Tov (the daily window is deliberately skipped for this leg — see
//      that function's own header for the ruling) — the SAME shared gate
//      resolveDialTarget's two existing kinds already use
//      (evaluateSharedConsentGates) — never duplicated.
//   4. Flag check (consoleCallMeNowEnabled) — off means the capability does
//      not exist at all; refuse outright, no callback offer either.
//   5. AVAILABILITY — findRoutableAgentVoxUsernames(), checked BEFORE
//      spending anything else (caps, a console_calls row, a dial token,
//      StartScenarios): no routable agent ⇒ NO outbound leg is placed at
//      all (cost: zero) — offerCallbackForCallMeNow writes an ordinary
//      callback_requests row instead and this returns an honest "no agent"
//      signal. See offerCallbackForCallMeNow's header for why that row is
//      NEVER auto-dialled later.
//   6. Only once an agent IS routable: evaluateCallMeNowCaps — live_calls /
//      balance / concurrency / per-phone-hourly / daily spend breaker, same
//      shape as evaluateInboundCaps/evaluateWidgetCallCaps.
//   7. Only once ALL of the above pass: create the console_calls row, mint a
//      single-use 'cn'-prefixed dial token, and StartScenarios the (not yet
//      created) ConsoleCallMeNow rule — the SAME Management-API primitive
//      already proven in production by the outbound AI-call campaign
//      (dispatchOutreachCall / scripts/voximplant/bridge-call.ts), carrying
//      the SAME tiny {to,from,tok,u} script_custom_data shape
//      outreach-calls.ts's buildScriptCustomData already measured well under
//      the platform's 200-byte cap (docs/voximplant/digest-voxengine-ref.md).
//      The scenario fetches nothing further inline — it POSTs `tok` to
//      call-me-now-authorize/route.ts once the visitor leg's disclosure
//      finishes, mirroring ConsoleDial's own handleOutbound sequencing. That
//      route re-checks availability AGAIN, fresh, right before it rings —
//      the narrow race where an agent was routable here but isn't by then is
//      handled by the scenario's own ring-exhausted branch (ConsoleInbound's
//      NO_AGENT_LINE_HE/declareNoAgent() reused verbatim), not by this route.
//
// Reachability is gated by TWO independent pieces of admin config, either of
// which alone keeps this route inert: console_call_me_now_enabled (the
// feature flag) and voximplant_call_me_now_rule_id (the ConsoleCallMeNow
// routing rule). The route was built and unit-tested ahead of both, the same
// sequencing this project used for route-inbound ahead of gate E and
// widget-authorize ahead of its own (now-superseded) scenario.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const MAX_BODY_BYTES = 512;
const FLOOD_RATE = { limit: 10, windowMs: 60_000 } as const;
const START_TIMEOUT_MS = 25_000; // matches outreach-calls.ts's own StartScenarios timeout

// The ConsoleCallMeNow rule id is ADMIN CONFIG, not a constant here:
// app_settings.voximplant_call_me_now_rule_id, surfaced as
// getVoximplantConfig().callMeNowRuleId. A rule id is platform-assigned and
// changes whenever the rule is recreated, and this codebase's ONE precedent
// for that fact (voximplant_rule_id → ruleId) already lives in the DB — no
// rule id is hard-coded anywhere in src/. Blank/absent is the normal
// fail-closed state and is rejected by the numeric guard below, so this
// route stays inert until an admin binds a real id AND the flag is on.

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

const REFUSED = { ok: false as const };

export async function POST(request: Request) {
  const ip = getClientIp(request.headers.get.bind(request.headers));
  if (!rateLimit(`call-me-now-verify:${ip}`, FLOOD_RATE).allowed) {
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
  const parsed = callMeNowVerifyBodySchema.safeParse(parsedJson);
  if (!parsed.success) return json(REFUSED, 400);

  const otpOk = await verifyOtp(parsed.data.phone, CALL_ME_NOW_OTP_PURPOSE, parsed.data.code);
  if (!otpOk) return json({ ok: false, reason: 'otp' }, 200);

  // Re-normalize AFTER verification — verifyOtp already normalized
  // internally to look up the challenge, but this route needs the clean
  // E.164 value itself for every gate/row below; never trust the raw
  // request body value past this point.
  const phone = normalizePhone(parsed.data.phone);
  if (!phone) return json(REFUSED, 200); // defensive only — verifyOtp would already have failed

  const consent = await evaluateCallMeNowConsent(phone);
  if (!consent.ok) return json({ ok: false, reason: consent.reason }, 200);

  const nowMs = Date.now();
  // ONE read of every measurement this route needs, including availability —
  // reused for the flag check, the availability decision, the caps decision
  // (liveCallsEnabled), the PSTN callerid, and the Management API auth
  // StartScenarios needs below. Never separate reads that could observe
  // different states between the caps decision and the actual dial.
  let vconfig: Awaited<ReturnType<typeof getVoximplantConfig>>;
  let flagEnabled: boolean;
  let globalConcurrentCallMeNow: number;
  let perPhoneCallsLastHour: number;
  let answeredToday: number;
  let balanceOk: boolean;
  let routableAgents: string[];
  try {
    const [flag, cfg, concurrent, perPhone, today, balance, routable] = await Promise.all([
      consoleCallMeNowEnabled(),
      getVoximplantConfig(),
      countConcurrentAnsweredCallMeNow(),
      countAnsweredLastHourForPhone(phone),
      countAnsweredCallMeNowToday(nowMs),
      checkInboundBalanceReserve(nowMs),
      findRoutableAgentVoxUsernames(nowMs),
    ]);
    flagEnabled = flag;
    vconfig = cfg;
    globalConcurrentCallMeNow = concurrent;
    perPhoneCallsLastHour = perPhone;
    answeredToday = today;
    balanceOk = balance.ok;
    routableAgents = routable;
  } catch {
    return json(REFUSED, 200); // any measurement failure ⇒ fail closed
  }

  // Flag off ⇒ the capability does not exist at all — refuse outright, no
  // callback offer either (that would imply the feature is partly on).
  if (!flagEnabled) return json(REFUSED, 200);

  // AVAILABILITY, NOT THE CLOCK, gates the immediate dial (owner decision,
  // 12.8) — checked BEFORE evaluateCallMeNowCaps, BEFORE a console_calls
  // row, BEFORE a dial token, BEFORE StartScenarios. No routable agent ⇒ no
  // outbound leg is placed at all: write an ordinary callback_requests row
  // instead (see offerCallbackForCallMeNow's header for why that row is
  // never auto-dialled later) and tell the caller honestly rather than
  // pretending a call is coming.
  if (routableAgents.length === 0) {
    await offerCallbackForCallMeNow(phone);
    return json({ ok: false, reason: 'no_agent', callback_offered: true }, 200);
  }

  const decision = evaluateCallMeNowCaps({
    flagEnabled,
    liveCallsEnabled: !!vconfig?.liveCallsEnabled,
    balanceOk,
    globalConcurrentCallMeNow,
    perPhoneCallsLastHour,
    answeredToday,
  });
  if (!decision.ok) return json({ ok: false, reason: decision.reason }, 200);

  if (!vconfig || !vconfig.callerId) return json(REFUSED, 200);

  // Refuse structurally, not just via the DB flag, when the rule is not yet
  // a real numeric id — checked here, right before the first actual state
  // change, now that every earlier gate (consent/flag/availability/caps)
  // has already passed and a dial is genuinely about to be attempted. The
  // callback-fallback path above never reaches this line, so an unset rule
  // never blocks the fallback from working.
  const callMeNowRuleId = vconfig.callMeNowRuleId;
  if (!/^\d+$/.test(callMeNowRuleId)) return json(REFUSED, 200);

  let callId: string;
  try {
    const created = await createConsoleCall({
      kind: 'call_me_now',
      direction: 'outbound',
      phoneE164: phone,
    });
    callId = created.id;
  } catch {
    return json(REFUSED, 200);
  }

  let token: string;
  try {
    // 'cn' prefix — see console-calls.ts's DIAL_TOKEN_PREFIXES comment.
    token = await mintDialToken(callId, 'cn');
  } catch {
    return json(REFUSED, 200);
  }

  const origin = await getAppOrigin();
  // Same tiny Branch B shape outreach-calls.ts's buildScriptCustomData
  // already proved fits well under the 200-byte cap — the full invitation-
  // style context RSVPAgent needs does not apply here (call-me-now-authorize
  // returns everything the scenario needs: ring_order + call_id), so no
  // separate ctx-fetch endpoint is needed.
  const payload = JSON.stringify({ to: phone, from: vconfig.callerId, tok: token, u: origin });

  let started: Awaited<ReturnType<typeof startScenarios>>;
  try {
    started = await startScenarios(
      vconfig.auth,
      { rule_id: callMeNowRuleId, script_custom_data: payload },
      START_TIMEOUT_MS,
    );
  } catch {
    return json(REFUSED, 200);
  }
  if (started.result !== 1 || !started.call_session_history_id) {
    return json(REFUSED, 200);
  }

  return json({ ok: true }, 200);
}
