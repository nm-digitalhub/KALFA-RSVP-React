import 'server-only';

import { randomBytes } from 'node:crypto';

import { createAdminClient } from '@/lib/supabase/admin';
import { normalizePhone } from '@/lib/phone';
import { isDncListed } from '@/lib/data/outreach-engine';
import { isPastEventDay } from '@/lib/data/event-date';
import { buildJewishCalendar } from '@/lib/outreach/jewish-calendar';
import { safeTokenEqual, sha256Hex } from '@/lib/security/token-compare';
import { rateLimit } from '@/lib/security/rate-limit';
import { AGENT_STATUS_FRESHNESS_MS } from '@/lib/console/presence';
import { sendPushToUser } from '@/lib/data/push-delivery';
import type { Database } from '@/lib/supabase/types';

// Service-role DAL for the browser call-center (plan stages 4/5 — internal +
// outbound manual dial, inbound routing). Every export here runs with the
// service-role client: there is no browser session on the three routes the
// Voximplant scenarios call directly, and dial-intent's caller identity is
// already resolved by requireConsoleAgent() at the route layer before any of
// these functions run.
//
// NOT using logActivity() anywhere in this module (precedent:
// interactions.ts's recordRsvpFromWhatsapp comment) — it calls requireUser(),
// which redirect()s to /auth/login on a missing cookie session. None of these
// call sites (a Bearer-only route, or a route reached by the Voximplant
// scenario with a shared secret) ever carries that session. Durable audit
// trail is the console_calls/console_call_pii rows themselves, plus a direct
// service-role activity_log insert (recordConsoleDialAudit) for the
// consent-matrix's "לוג חובה" requirement — same direct-insert shape as
// recordRsvpFromWhatsapp.

type AdminClient = ReturnType<typeof createAdminClient>;
type ConsoleCallInsert = Database['public']['Tables']['console_calls']['Insert'];
type ConsoleCallUpdate = Database['public']['Tables']['console_calls']['Update'];
type ConsoleCallPiiInsert = Database['public']['Tables']['console_call_pii']['Insert'];
type ConsoleCallPiiUpdate = Database['public']['Tables']['console_call_pii']['Update'];

// The exact CHECK-constraint value sets from
// supabase/migrations/20260812154126_callcenter_s3_console_calls_schema.sql,
// extended by 20260812194830_callcenter_widget_kind.sql ('widget') and
// 20260812202521_callcenter_call_me_now.sql ('call_me_now') — types.ts types
// these columns as bare `string`, so this file is the single place that
// re-asserts the DB's real enums. Casts below reference this comment, per
// CLAUDE.md's "no unsafe cast without documentation" rule.
export const CONSOLE_CALL_KINDS = ['manual', 'inbound_customer', 'internal', 'ai_handoff', 'widget', 'call_me_now'] as const;
export type ConsoleCallKind = (typeof CONSOLE_CALL_KINDS)[number];

export const CONSOLE_CALL_DIRECTIONS = ['inbound', 'outbound', 'internal'] as const;
export type ConsoleCallDirection = (typeof CONSOLE_CALL_DIRECTIONS)[number];

export const CONSOLE_CALL_STATUSES = [
  'initiated',
  'ringing',
  'connected',
  'ended',
  'missed',
  'failed',
  'no_agent',
] as const;
export type ConsoleCallStatus = (typeof CONSOLE_CALL_STATUSES)[number];

// Non-terminal statuses — "still live" for every concurrency count in this
// file. Mirrors the TERMINAL_STATUSES/PRE_TERMINAL idiom in call-attempts.ts.
// Exported for the stage-7/8 consumers (transfer-target validation, panel UI).
export const LIVE_STATUSES: readonly ConsoleCallStatus[] = ['initiated', 'ringing', 'connected'];

// How long a 'connected' console_calls row may still mean "this agent is on a
// call". Mirrors SAFETY_NET_MS in ConsoleInbound.voxengine.js and
// ConsoleDial.voxengine.js, which hard-terminate a session at 60 minutes — past
// that the scenario has torn the call down, so a row still marked connected is
// leaked bookkeeping, not a live call. See findRoutableAgents for why the bound
// matters more than the exclusion it bounds.
export const AGENT_BUSY_MAX_MS = 60 * 60 * 1000;

// Call kinds that carry a real customer leg — the only ones any live-call
// topology change (blind transfer, consult, conference) may act on. 'internal'
// (agent<->agent, no customer) and 'ai_handoff' (RSVPAgent's own command
// channel, see /api/calls/{id}/agent-command) are excluded. Was local to
// transfer/route.ts as `TRANSFERABLE_KINDS`; promoted here (stage 2) so the
// new consult/conference routes reuse the exact same set instead of
// redeclaring it four times.
//
// 'call_me_now' is DELIBERATELY EXCLUDED even though it carries a real
// customer leg: every OTHER member's scenario (ConsoleDial for
// manual/internal, ConsoleInbound for inbound_customer) implements the FULL
// transfer/consult/conference command channel those routes rely on — a
// route in LIVE_CUSTOMER_CALL_KINDS succeeding just means it updates
// console_calls and posts a command to the scenario's session_url; if the
// scenario never listens for it, the command is silently dropped with no
// visible error, and an agent's "transfer" click would do nothing. The
// (not yet written) ConsoleCallMeNow scenario does not implement that
// channel in this pass — add 'call_me_now' back only once it does (port
// ConsoleDial's startTransfer/startConsult/startConference block, which is
// fully generic over state.operator/state.remote and does not care how the
// call was established). 'widget' has the identical latent gap (its own
// ConsoleWidgetIn scenario was never written either) but is harmless: that
// whole path is dead code pending an owner cleanup decision (capability A's
// widget design was superseded by call-me-now, 12.8) and is unreachable —
// see evaluateWidgetCallCaps's header.
export const LIVE_CUSTOMER_CALL_KINDS: ReadonlySet<ConsoleCallKind> = new Set(['manual', 'inbound_customer', 'widget']);

// ─────────────────────────────────────────────────────────────────────────
// Human-call quiet-hours window (decide-consent GO/NO-GO table, final
// numbers). Deliberately NOT src/lib/outreach/send-policy.ts's
// DEFAULT_SEND_POLICY (09:00–20:30 / Fri 09:00–12:00) — that policy encodes
// the WhatsApp channel's owner-set numbers under a different legal basis
// (decide-consent explicitly rejects reusing call_consent_required for this
// reason). The Shabbat/Yom-Tov block IS reused, from jewish-calendar.ts.
// ─────────────────────────────────────────────────────────────────────────

const HUMAN_CALL_WINDOW = {
  sunThu: { startMin: 8 * 60, endMin: 19 * 60 }, // 08:00–19:00
  friday: { startMin: 8 * 60, endMin: 13 * 60 }, // 08:00–13:00
} as const;

const IL_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jerusalem',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const IL_TIME_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jerusalem',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function israelWeekdayAndMinutes(ms: number): { weekday: number; minutes: number } {
  const dateStr = IL_DATE_FMT.format(ms); // YYYY-MM-DD
  // Weekday of a plain calendar date is tz-independent (0=Sun … 6=Sat) —
  // same technique as send-window.ts's localParts.
  const weekday = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  const [h, m] = IL_TIME_FMT.format(ms).split(':').map(Number);
  return { weekday, minutes: h * 60 + m };
}

/**
 * Pure, testable. Shabbat/Yom-Tov ONLY (fail-closed on any calendar error) —
 * split out from the daily window below (compliance ruling, 12.8) because
 * the two rest on completely different bases and call-me-now's immediate
 * leg (see evaluateCallMeNowConsent) is exempt from ONE of them, never both:
 * this check is UNCONDITIONAL for every caller, with no opt-out parameter of
 * any kind — see evaluateSharedConsentGates for why that is structural, not
 * a convention documented in a comment.
 */
export function isShabbatOrYomTovBlocked(nowMs: number): boolean {
  try {
    if (buildJewishCalendar(nowMs, nowMs).isBlocked(nowMs)) return true;
  } catch {
    return true; // unknown ⇒ blocked, matching the plan-wide fail-closed rule
  }
  return israelWeekdayAndMinutes(nowMs).weekday === 6; // Saturday — belt-and-suspenders (already hard-blocked above)
}

/**
 * Pure, testable. The daily Israel-local window ONLY — Shabbat/Yom-Tov is
 * NOT checked here (see isShabbatOrYomTovBlocked, the sibling this was split
 * from). Not exported: every caller needs the Shabbat gate too, so nothing
 * outside this file should call this half alone — evaluateSharedConsentGates
 * is the one place that composes them, selectively, via `hoursGate`.
 */
function isWithinDailyCallWindow(nowMs: number): boolean {
  const { weekday, minutes } = israelWeekdayAndMinutes(nowMs);
  const window = weekday === 5 ? HUMAN_CALL_WINDOW.friday : HUMAN_CALL_WINDOW.sunThu;
  return minutes >= window.startMin && minutes < window.endMin;
}

/**
 * Convenience combinator — UNCHANGED behavior and signature from before the
 * split (12.8), so its own pure-function test suite (Sun-Thu/Friday/Saturday
 * cases) keeps passing untouched. Equivalent to
 * `!isShabbatOrYomTovBlocked(nowMs) && isWithinDailyCallWindow(nowMs)`.
 * Sunday=0 … Saturday=6.
 */
export function isWithinHumanCallWindow(nowMs: number): boolean {
  return !isShabbatOrYomTovBlocked(nowMs) && isWithinDailyCallWindow(nowMs);
}

// NO INBOUND HOURS GATE — deliberately removed (compliance ruling, 2026-08-12).
//
// A flat 08:00–21:00 window plus a Shabbat/Yom-Tov block used to live here,
// justified as "same rule as the outbound dispatcher". That justification was
// wrong in DIRECTION, and the ruling that removed it is worth restating so it
// is never re-added by analogy:
//
//   Every Israeli regime that restricts call timing is written around WHO
//   INITIATES. §30א forbids "לשגר" (to send). Amendment 61 defines a marketing
//   approach as "פנייה של עוסק לצרכן". The telephone-harassment offence turns
//   on "שימוש ... באופן העלול להטריד". A consumer who dialled US at 22:00 chose
//   the moment; answering them is not sending, not an approach, and not a use
//   that creates the nuisance. There is no statute — and structurally there is
//   no plaintiff — for "you answered your phone too late".
//
// The real concern the window was reaching for (nobody is awake at 03:00) is
// already handled honestly downstream: the ring exhausts, ConsoleInbound plays
// NO_AGENT_LINE_HE, and a callback row is created (see the 'no_agent' handler
// in /api/voximplant/console/event). That path is hour-agnostic by design —
// it is equally the right answer when every agent is simply busy at 14:00.
//
// Cost is bounded by the caps that remain: flag, concurrency, per-CLI rate,
// balance reserve, and the daily breaker (100 calls / $5) — which this change
// promotes from theoretical to load-bearing, since out-of-hours calls now
// cost ~$0.06 instead of $0.
//
// Shabbat: removed for ANSWERING only. Outbound dialling keeps its hard block
// (that is business-initiated contact). Automated answering employs nobody, so
// חוק שעות עבודה ומנוחה does not reach it. If a human agent is ever STAFFED to
// answer on Shabbat, that is an employment-permit question to settle first —
// tracked in the plan, not gated here.
//
// If the owner ever wants a business-policy answering window, it belongs in
// app_settings as an admin toggle (project rule: no hardcoded business facts),
// never as a constant that reads like a legal requirement.

// ─────────────────────────────────────────────────────────────────────────
// Feature-flag readers. Mirrors consoleSoftphoneEnabled() in
// console-softphone-config.ts / monitorEnabled() in console-monitor.ts:
// app_settings is admin-only RLS, so this is a service-role, single-column
// read. Fails CLOSED — any error is treated as "flag off".
// ─────────────────────────────────────────────────────────────────────────

export async function consoleManualDialEnabled(): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('app_settings')
    .select('console_manual_dial_enabled')
    .eq('id', true)
    .maybeSingle();
  return data?.console_manual_dial_enabled === true;
}

export async function inboundCallsEnabled(): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('app_settings')
    .select('inbound_calls_enabled')
    .eq('id', true)
    .maybeSingle();
  return data?.inbound_calls_enabled === true;
}

// Capability A revision (owner-directed, 12.8) — the browser widget's
// go-live flag. Same fail-closed, admin-only-RLS reader shape as every other
// flag in this file. Migration 20260812194830_callcenter_widget_kind.sql was
// pushed and types.ts regenerated (team-lead, 12.8) — the temporary
// `as unknown as` cast this function used to need is gone; console_widget_enabled
// is now a real typed column. NOTE: the widget path itself was subsequently
// superseded by capability A's THIRD design (call-me-now — see
// evaluateCallMeNowCaps's header) and is now dead code pending a cleanup
// decision; this reader stays functionally correct either way.
export async function consoleWidgetEnabled(): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('app_settings')
    .select('console_widget_enabled')
    .eq('id', true)
    .maybeSingle();
  return data?.console_widget_enabled === true;
}

// Wake-and-answer capability (call-center research, 12.8 — follow-on to
// capability B). Same fail-closed, admin-only-RLS reader shape as every
// other flag in this file. Migration 20260812200243_callcenter_wake_shift_and_flag.sql
// was pushed and types.ts regenerated — verified live against the linked
// project (console audit 12.8): console_wake_enabled is a real typed column,
// so the former `as unknown as` cast is gone.
export async function consoleWakeEnabled(): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('app_settings')
    .select('console_wake_enabled')
    .eq('id', true)
    .maybeSingle();
  return data?.console_wake_enabled === true;
}

// Capability A, THIRD design ("call-me-now" — OTP-verified, PSTN-out, no
// browser Voximplant identity at all; the WebRTC widget above was accepted
// as blocked — see evaluateWidgetCallCaps's header — and this replaces it).
// Same fail-closed, admin-only-RLS reader shape as every other flag in this
// file. Migration 20260812202521_callcenter_call_me_now.sql was pushed and
// types.ts regenerated (team-lead, 12.8, verified live: console_calls_kind_check
// accepts 'call_me_now', app_settings.console_call_me_now_enabled exists) —
// the temporary `as unknown as` cast this function used to need is gone.
export async function consoleCallMeNowEnabled(): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('app_settings')
    .select('console_call_me_now_enabled')
    .eq('id', true)
    .maybeSingle();
  return data?.console_call_me_now_enabled === true;
}

// Stage 6 — owner knob for the DTMF '9' handoff smoke test (ops-knobs
// decision: "DTMF_HANDOFF_ENABLED כדגל app_settings, לא קבוע בתרחיש", so a
// test toggle never requires a scenario redeploy). Read by the outbound
// dispatcher (outreach-calls.ts) and stamped into RSVPAgent's customData as
// the compact 'dh' key. Default FALSE (migration
// 20260812154126_callcenter_s3_console_calls_schema.sql) — fails closed like
// every other flag reader in this file.
export async function consoleDtmfHandoffEnabled(): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('app_settings')
    .select('console_dtmf_handoff_enabled')
    .eq('id', true)
    .maybeSingle();
  return data?.console_dtmf_handoff_enabled === true;
}

// ─────────────────────────────────────────────────────────────────────────
// resolveDialTarget — the consent matrix (decide-consent GO/NO-GO table),
// implemented as the ONLY two admitted shapes. Covers gate steps "fresh DB
// load → DNC → opt-out → quiet hours" (decide-consent's route-implementation
// note, steps 3-6); voximplant_live_calls/env, the manual-dial flag, and
// concurrency are generic to any target and stay in the route.
// ─────────────────────────────────────────────────────────────────────────

export type DialTargetInput =
  | { kind: 'callback'; id: string }
  | { kind: 'guest_service'; eventId: string; contactId: string };

export type DialTargetFailureReason =
  | 'lookup_failed'
  | 'not_found'
  | 'not_open' // callback status not in (new, in_progress)
  | 'stale' // callback older than the 30-day freshness window
  | 'attempt_cap' // ≥3 human-dial attempts already logged in the window
  | 'not_linked' // contact not linked to a guest of this event
  | 'event_not_active'
  | 'past_event_day'
  | 'invalid_phone'
  | 'dnc'
  | 'opted_out'
  | 'quiet_hours';

export type DialTargetResolution =
  | {
      ok: true;
      phone: string; // E.164 — resolved server-side, never from the browser
      eventId: string | null;
      contactId: string | null;
      guestId: string | null;
      callbackRequestId: string | null;
    }
  | { ok: false; reason: DialTargetFailureReason };

// decide-consent §2 correction: 30 days, a policy choice, not a statutory
// figure (the exemption itself carries no expiry).
const CALLBACK_FRESHNESS_MS = 30 * 24 * 60 * 60 * 1000;
// decide-consent §2: counted from logged human-dial attempts against this
// callback_requests.id — NEVER callback_requests.attempt_count (that column
// means something else and nothing in src/lib writes it).
const CALLBACK_MAX_ATTEMPTS = 3;

// hoursGate — a self-documenting, required-to-be-named union (NOT a bare
// boolean, per explicit engineering decision, 12.8): a boolean disabling a
// safety gate reads as nothing at the call site and invites a careless
// `false`; this union states its own justification, and 'apply' — meaning
// "the daily window applies" — is the default every existing caller keeps
// getting for free by passing no third argument at all. Considered and
// REJECTED: splitting this function into a separate DNC/opt-out-only
// function plus moving the window check out to each call site — that trades
// a low risk (this option flipping) for a higher one this project has
// actually been bitten by (a future third caller silently forgetting the
// window check exists at all). Default-applies is the safer failure mode.
//
// The Shabbat/Yom-Tov gate (isShabbatOrYomTovBlocked) is NOT part of this
// option and never will be — it runs unconditionally below, before hoursGate
// is even consulted, so it is structurally impossible for any caller,
// present or future, to skip it by passing the wrong value. That is a
// stronger guarantee than a comment saying "don't skip this".
export type HoursGate = 'apply' | 'skip_consumer_initiated';

async function evaluateSharedConsentGates(
  admin: AdminClient,
  phone: string,
  nowMs: number,
  opts: { hoursGate?: HoursGate } = {},
): Promise<{ ok: true } | { ok: false; reason: DialTargetFailureReason }> {
  // DNC — normalized phone, fail-closed (isDncListed itself fails closed on
  // any DB error; see outreach-engine.ts). Unconditional for every caller,
  // including call-me-now: protects people who asked NOT to be called, a
  // different question entirely from call timing.
  if (await isDncListed(phone)) return { ok: false, reason: 'dnc' };

  // Opt-out — ANY contacts row for this phone (across any event) with
  // removal_requested=true blocks. contacts is event-scoped, so the same
  // phone can legitimately appear under several events; the most protective
  // reading (decide-consent: "אם קיימת שורה תואמת") is "any row objects".
  // Unconditional for every caller, same reasoning as DNC above.
  const { data: optedOut, error: optOutErr } = await admin
    .from('contacts')
    .select('id')
    .eq('normalized_phone', phone)
    .eq('removal_requested', true)
    .limit(1)
    .maybeSingle();
  if (optOutErr) return { ok: false, reason: 'opted_out' }; // fail-closed
  if (optedOut) return { ok: false, reason: 'opted_out' };

  // Shabbat/Yom-Tov — see the type comment above for why this is
  // unconditional and outside the hoursGate option entirely.
  if (isShabbatOrYomTovBlocked(nowMs)) return { ok: false, reason: 'quiet_hours' };

  // The daily window — SKIPPED only for call-me-now's immediate leg
  // (compliance ruling, 12.8; see evaluateCallMeNowConsent's header for the
  // full basis). Every other caller (callback, guest_service) passes no
  // options at all and gets today's exact behavior, untouched.
  if ((opts.hoursGate ?? 'apply') === 'apply' && !isWithinDailyCallWindow(nowMs)) {
    return { ok: false, reason: 'quiet_hours' };
  }

  return { ok: true };
}

async function countRecentCallbackDialAttempts(
  admin: AdminClient,
  callbackRequestId: string,
  nowMs: number,
): Promise<number> {
  const sinceIso = new Date(nowMs - CALLBACK_FRESHNESS_MS).toISOString();
  const { count, error } = await admin
    .from('activity_log')
    .select('id', { count: 'exact', head: true })
    .eq('action', CONSOLE_DIAL_AUDIT_ACTION)
    .eq('meta->>callback_request_id', callbackRequestId)
    .gte('created_at', sinceIso);
  if (error) return CALLBACK_MAX_ATTEMPTS; // unreadable ⇒ treat as capped (fail-closed)
  return count ?? 0;
}

/**
 * Does `nowMs` fall inside the window the CALLER stated on their callback
 * request? Pure and testable.
 *
 * `not_before_min` / `not_after_min` are Israel-local minutes-since-midnight
 * and `excluded_dates` are YYYY-MM-DD strings — the exact shapes
 * callback-scheduling.ts already consumes when it searches for an Exchange
 * slot. Absent values mean "no stated preference" and impose nothing; this
 * function only ever NARROWS the general human-call window, it never grants
 * permission the window itself withholds.
 */
export function isWithinCallerStatedWindow(
  stated: {
    not_before_min?: number | null;
    not_after_min?: number | null;
    excluded_dates?: string[] | null;
  },
  nowMs: number,
): boolean {
  const { minutes } = israelWeekdayAndMinutes(nowMs);
  if (typeof stated.not_before_min === 'number' && minutes < stated.not_before_min) return false;
  if (typeof stated.not_after_min === 'number' && minutes >= stated.not_after_min) return false;
  if (stated.excluded_dates?.length) {
    const today = IL_DATE_FMT.format(nowMs); // YYYY-MM-DD, Israel-local
    if (stated.excluded_dates.includes(today)) return false;
  }
  return true;
}

export async function resolveDialTarget(
  input: DialTargetInput,
  nowMs: number = Date.now(),
): Promise<DialTargetResolution> {
  const admin = createAdminClient();

  if (input.kind === 'callback') {
    const { data, error } = await admin
      .from('callback_requests')
      .select(
        'id, phone, status, requested_at, created_at, not_before_min, not_after_min, excluded_dates',
      )
      .eq('id', input.id)
      .maybeSingle();
    if (error) return { ok: false, reason: 'lookup_failed' };
    if (!data) return { ok: false, reason: 'not_found' };
    if (data.status !== 'new' && data.status !== 'in_progress') {
      return { ok: false, reason: 'not_open' };
    }
    const anchorMs = Date.parse(data.requested_at ?? data.created_at);
    if (Number.isNaN(anchorMs) || nowMs - anchorMs > CALLBACK_FRESHNESS_MS) {
      return { ok: false, reason: 'stale' };
    }
    const phone = normalizePhone(data.phone);
    if (!phone) return { ok: false, reason: 'invalid_phone' };

    // What the CALLER themselves said about when to reach them — the same
    // three columns callback-scheduling.ts already honours when it books an
    // Exchange slot. The manual-dial gate ignored them until now, which meant
    // a human operator could dial at a moment the caller had explicitly ruled
    // out while the automated scheduler would not. This INTERSECTS with the
    // general window below (never widens it): a stated preference can only
    // narrow when we may call, never authorise a call outside business hours.
    if (!isWithinCallerStatedWindow(data, nowMs)) {
      return { ok: false, reason: 'quiet_hours' };
    }

    const attempts = await countRecentCallbackDialAttempts(admin, data.id, nowMs);
    if (attempts >= CALLBACK_MAX_ATTEMPTS) return { ok: false, reason: 'attempt_cap' };

    const shared = await evaluateSharedConsentGates(admin, phone, nowMs);
    if (!shared.ok) return shared;

    return {
      ok: true,
      phone,
      eventId: null,
      contactId: null,
      guestId: null,
      callbackRequestId: data.id,
    };
  }

  // guest_service — resolved ONLY from a server-verified (event_id, contact_id)
  // pair, never from a browser-supplied phone.
  const { data: contact, error: contactErr } = await admin
    .from('contacts')
    .select('id, event_id, normalized_phone, removal_requested')
    .eq('id', input.contactId)
    .eq('event_id', input.eventId)
    .maybeSingle();
  if (contactErr) return { ok: false, reason: 'lookup_failed' };
  if (!contact) return { ok: false, reason: 'not_found' };
  if (contact.removal_requested) return { ok: false, reason: 'opted_out' };

  const { data: guest, error: guestErr } = await admin
    .from('guests')
    .select('id')
    .eq('event_id', input.eventId)
    .eq('contact_id', input.contactId)
    .limit(1)
    .maybeSingle();
  if (guestErr) return { ok: false, reason: 'lookup_failed' };
  if (!guest) return { ok: false, reason: 'not_linked' };

  const { data: event, error: eventErr } = await admin
    .from('events')
    .select('id, status, event_date')
    .eq('id', input.eventId)
    .maybeSingle();
  if (eventErr) return { ok: false, reason: 'lookup_failed' };
  if (!event) return { ok: false, reason: 'not_found' };
  if (event.status !== 'active') return { ok: false, reason: 'event_not_active' };
  // Deliberately NOT checking rsvp_deadline (decide-consent: a human service
  // call may legitimately follow the RSVP deadline; only past_event_day gates).
  if (isPastEventDay(event.event_date, nowMs)) return { ok: false, reason: 'past_event_day' };

  const phone = normalizePhone(contact.normalized_phone);
  if (!phone) return { ok: false, reason: 'invalid_phone' };

  const shared = await evaluateSharedConsentGates(admin, phone, nowMs);
  if (!shared.ok) return shared;

  return {
    ok: true,
    phone,
    eventId: input.eventId,
    contactId: input.contactId,
    guestId: guest.id,
    callbackRequestId: null,
  };
}

// evaluateCallMeNowConsent — reuses the SAME DNC/opt-out/quiet-hours gate
// resolveDialTarget's two kinds already share (evaluateSharedConsentGates),
// for a THIRD provenance: an OTP-verified site visitor's own phone number
// (capability A, third design, 12.8). Deliberately NOT added as a third
// DialTargetInput variant: that union's whole reason to exist is dial-intent's
// own stated invariant ("the browser can only ever name a SERVER-VERIFIED
// provenance for the dial... never a phone number") for the AGENT-authenticated
// manual-dial route, which has its own separate concurrency/manual-dial-flag
// gates that do not apply here. Call-me-now's phone IS accepted directly from
// the browser — but only after otp.ts's verifyOtp() has already consumed a
// one-time code proving control of it, a different and, if anything, stronger
// consent basis (immediate, self-initiated, at this exact moment) than the
// callback-request kind, which is accepted up to 30 days stale. Blending the
// two into one union would let a future edit to that shared code path
// silently treat an ORDINARY unverified phone as trusted for the AGENT flow
// too — kept apart on purpose. Still routes through the identical shared
// gate function so DNC/opt-out/quiet-hours logic is never duplicated.
//
// RULING (israeli-compliance-advisor, 12.8): the DAILY window (08:00–19:00 /
// Fri 08:00–13:00) is OFF for this function; Shabbat/Yom-Tov stays ON,
// unconditionally, same as everywhere else (see isShabbatOrYomTovBlocked —
// structural, not this function's decision to make or unmake). Two separate
// conclusions on two separate bases, not one hours ruling:
//
//   Daily window OFF: it never rested on §30א or Amendment 61 — both were
//   already ruled not to reach a live human call at all (see the "NO INBOUND
//   HOURS GATE" note above) — nor on 16ג(ז), which the advisor confirmed
//   exempts only the do-not-call-registry check, not hours, so it cannot
//   carry an hours conclusion either. It rested entirely on the telephone-
//   harassment doctrine, whose test is a moment the BUSINESS chose that the
//   recipient didn't expect. Call-me-now inverts exactly that: the CONSUMER
//   picks the moment, seconds earlier, OTP-proven to be them, and the whole
//   verify -> StartScenarios -> answer chain completes inside a minute — a
//   STRONGER consent basis than the existing `callback` kind above, which
//   the business schedules and honours up to 30 days stale. Evidence tag:
//   strong inference from statute language; no direct precedent on point.
//
//   Shabbat/Yom-Tov stays ON: a completely different, non-statutory basis
//   (no business-policy answering-hours decision has been made by the
//   owner for ANY channel, and removing or toggling it here would be
//   deciding that in his name) — and operationally moot regardless, since no
//   agent is staffed on Shabbat, so the availability check below already
//   finds nobody routable and takes the no-agent path either way. NO
//   `call_me_now_block_shabbat` toggle exists or should be added.
//
// SCOPE: this ruling covers the IMMEDIATE pattern only — OTP TTL 5 minutes
// (otp.ts), dial-token TTL 60 seconds (DIAL_TOKEN_TTL_MS), one HTTP request
// from verify to StartScenarios. If a DELAYED variant is ever built (an
// OTP-verified number treated as STANDING consent to dial the visitor
// LATER, not immediately), the daily window MUST come back for it — the
// basis for dropping it here (the consumer chose *now*) would no longer
// hold, and this comment is the reason a future author must not extend
// 'skip_consumer_initiated' to any queued/delayed dial.
export async function evaluateCallMeNowConsent(
  phone: string,
  nowMs: number = Date.now(),
): Promise<{ ok: true } | { ok: false; reason: DialTargetFailureReason }> {
  const admin = createAdminClient();
  return evaluateSharedConsentGates(admin, phone, nowMs, { hoursGate: 'skip_consumer_initiated' });
}

// ─────────────────────────────────────────────────────────────────────────
// Dial token — mint (dial-intent) / verify (authorize). Random 32-byte hex,
// 'ct'-prefixed; only the SHA-256 hash is ever persisted. Single-use: a
// successful verify nulls the hash so a replay can never re-authorize.
// ─────────────────────────────────────────────────────────────────────────

export const DIAL_TOKEN_TTL_MS = 60_000;
// 'ct' = manual outbound customer dial (ConsoleDial's ConsoleOut branch,
// rule `^ct[0-9a-f]+`, live, dialed by an operator's browser as the SDK call
// destination). 'wt' = widget inbound (capability A, 12.8, first design —
// the future ConsoleWidgetIn scenario, rule NOT YET CREATED; now dead code
// pending a cleanup decision, see evaluateWidgetCallCaps's header). 'cn' =
// call-me-now (capability A, THIRD design, 12.8) — travels a DIFFERENT
// channel entirely: never dialed as a destination, instead carried in
// StartScenarios' script_custom_data and read via VoxEngine.customData()
// (the same tiny {to,from,tok,u} shape outreach-calls.ts's
// buildScriptCustomData already proved fits well under the platform's
// 200-byte cap), then POSTed to call-me-now-authorize/route.ts. Three
// prefixes, one column: a widget or console token must never be mistaken
// for a call-me-now one or vice versa. The prefix IS part of the
// security property, not just a routing discriminator: verifyDialToken
// takes a required expectedPrefix argument and rejects a token minted for
// another flow even if its hash would otherwise match — all three prefixes
// share the same dial_token_hash column, single-use, so a wrong-flow token
// accepted by the wrong route would consume it and leave the rightful
// caller with a dead token and no recovery. (Found and fixed 12.8, before
// any authorize route went live — see the routes' own schema comments.)
const DIAL_TOKEN_PREFIXES = ['ct', 'wt', 'cn'] as const;
export type DialTokenPrefix = (typeof DIAL_TOKEN_PREFIXES)[number];
// Derived FROM the array (not a hand-duplicated alternation) so the two can
// never drift out of sync.
const DIAL_TOKEN_RE = new RegExp(`^(?:${DIAL_TOKEN_PREFIXES.join('|')})[0-9a-f]{64}$`);

export async function mintDialToken(callId: string, prefix: DialTokenPrefix = 'ct'): Promise<string> {
  const raw = randomBytes(32).toString('hex');
  const token = `${prefix}${raw}`;
  const hash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + DIAL_TOKEN_TTL_MS).toISOString();
  const admin = createAdminClient();
  const { error } = await admin
    .from('console_call_pii')
    .update({ dial_token_hash: hash, dial_token_expires_at: expiresAt })
    .eq('call_id', callId);
  if (error) throw new Error('dial_token_mint_failed');
  return token;
}

export type VerifyDialTokenResult =
  | { ok: true; callId: string; phone: string | null }
  | { ok: false; reason: 'not_found' | 'expired' | 'malformed' };

// expectedPrefix is a REQUIRED authorization check, not just a routing hint:
// ct and wt tokens live in the same dial_token_hash column, so without this a
// 'wt' (widget) token handed to ConsoleDial's authorize route — or a 'ct'
// token handed to widget-authorize — would still hash-match and get
// consumed by the WRONG flow (single-use, so the rightful caller then gets a
// dead token with no recovery). Every call site must name which flow it is
// authorizing for; there is no default.
export async function verifyDialToken(
  token: string,
  expectedPrefix: DialTokenPrefix,
): Promise<VerifyDialTokenResult> {
  if (!DIAL_TOKEN_RE.test(token) || !token.startsWith(expectedPrefix)) {
    return { ok: false, reason: 'malformed' };
  }
  const admin = createAdminClient();

  // Fetch LIVE (unexpired, non-null-hash) candidates and compare in constant
  // time in JS — never `.eq('dial_token_hash', hash)` directly, so a live
  // SQL equality lookup can never become a remote timing oracle. The table
  // is tiny (one row per in-flight manual dial, 60s TTL) — a full filtered
  // scan is cheap.
  const { data, error } = await admin
    .from('console_call_pii')
    .select('call_id, dial_token_hash, dial_token_expires_at, phone_e164')
    .not('dial_token_hash', 'is', null)
    .gt('dial_token_expires_at', new Date().toISOString());
  if (error || !data) return { ok: false, reason: 'not_found' };

  const match = data.find((row) => safeTokenEqual(token, row.dial_token_hash));
  if (!match) return { ok: false, reason: 'not_found' };

  // Single-use: null the hash. Guard on the hash still matching so a
  // concurrent double-consume race loses cleanly instead of double-firing.
  const { data: consumed, error: consumeErr } = await admin
    .from('console_call_pii')
    .update({ dial_token_hash: null, dial_token_expires_at: null })
    .eq('call_id', match.call_id)
    .eq('dial_token_hash', match.dial_token_hash)
    .select('call_id')
    .maybeSingle();
  if (consumeErr || !consumed) return { ok: false, reason: 'not_found' };

  return { ok: true, callId: match.call_id, phone: match.phone_e164 };
}

// ─────────────────────────────────────────────────────────────────────────
// console_calls / console_call_pii row lifecycle.
// ─────────────────────────────────────────────────────────────────────────

export interface CreateConsoleCallInput {
  kind: ConsoleCallKind;
  direction: ConsoleCallDirection;
  agentId?: string | null;
  eventId?: string | null;
  guestId?: string | null;
  contactId?: string | null;
  callAttemptId?: string | null;
  callerMasked?: string | null;
  phoneE164?: string | null; // written to console_call_pii only, never console_calls
}

export async function createConsoleCall(input: CreateConsoleCallInput): Promise<{ id: string }> {
  const admin = createAdminClient();
  const row: ConsoleCallInsert = {
    // CONSOLE_CALL_KINDS/DIRECTIONS above are the documented source of truth
    // for these CHECK constraints; types.ts only knows `string`.
    kind: input.kind,
    direction: input.direction,
    agent_id: input.agentId ?? null,
    event_id: input.eventId ?? null,
    guest_id: input.guestId ?? null,
    contact_id: input.contactId ?? null,
    call_attempt_id: input.callAttemptId ?? null,
    caller_masked: input.callerMasked ?? null,
  };
  const { data, error } = await admin.from('console_calls').insert(row).select('id').single();
  if (error || !data) throw new Error('console_call_create_failed');

  const piiRow: ConsoleCallPiiInsert = { call_id: data.id, phone_e164: input.phoneE164 ?? null };
  const { error: piiError } = await admin.from('console_call_pii').insert(piiRow);
  if (piiError) throw new Error('console_call_pii_create_failed');

  return { id: data.id };
}

export interface UpdateConsoleCallStatusInput {
  callId: string;
  // Omit to update bookkeeping (e.g. transferred_to_agent_id) WITHOUT
  // touching status — used by the transfer_started/transfer_failed events,
  // where the call's own status is unaffected by a transfer attempt.
  status?: ConsoleCallStatus;
  endedReason?: string | null;
  durationSec?: number | null;
  recordingUrl?: string | null; // also flips has_recording, written into console_call_pii
  disclosurePlayed?: boolean;
  answeredNow?: boolean;
  endedNow?: boolean;
  // The agent currently bridged to this call. undefined = no change. Set for
  // inbound calls on the 'connected' event (ConsoleInbound never learns this at
  // row-creation time — only once the serial ring resolves a winner); outbound
  // calls already get it at creation (dial-intent's ctx.userId).
  agentId?: string | null;
  transferredToAgentId?: string | null; // undefined = no change
  // Stage 2 (consult/conference). Same "undefined = no change" convention as
  // every other field here.
  consultAgentId?: string | null;
  // TRUE stamps consult_connected_at = now (the consult target actually
  // answered); NULL clears it (the consult ended, however it ended).
  // Deliberately separate from consultAgentId, which is written
  // OPTIMISTICALLY at consult_started while the target is still ringing —
  // the UI must gate "complete transfer" on the connected stamp and may gate
  // "cancel consult" on the optimistic one. See the column comment in
  // 20260813064814_callcenter_consult_connected_at.sql for the honesty bug
  // this split closes.
  consultConnected?: true | null;
  conferenceAgentIds?: string[];
  // "202 semantics, idempotent-ish (status transitions only forward; ended
  // is terminal)" — when true, the status write only applies while the row
  // is still LIVE_STATUSES, so a re-ordered/duplicated 'ringing' or
  // 'connected' report can never resurrect an already-terminal row. Never
  // set for the 'ended' transition itself (ended must always be settable).
  onlyIfLive?: boolean;
}

export async function updateConsoleCallStatus(input: UpdateConsoleCallStatusInput): Promise<void> {
  const admin = createAdminClient();
  const patch: ConsoleCallUpdate = {};
  if (input.status !== undefined) patch.status = input.status;
  if (input.endedReason !== undefined) patch.ended_reason = input.endedReason;
  if (input.durationSec !== undefined) patch.duration_sec = input.durationSec;
  if (input.disclosurePlayed !== undefined) patch.disclosure_played = input.disclosurePlayed;
  if (input.answeredNow) patch.answered_at = new Date().toISOString();
  if (input.endedNow) patch.ended_at = new Date().toISOString();
  if (input.recordingUrl) patch.has_recording = true;
  if (input.agentId !== undefined) patch.agent_id = input.agentId;
  if (input.transferredToAgentId !== undefined) {
    patch.transferred_to_agent_id = input.transferredToAgentId;
  }
  if (input.consultAgentId !== undefined) patch.consult_agent_id = input.consultAgentId;
  if (input.consultConnected !== undefined) {
    patch.consult_connected_at = input.consultConnected === null ? null : new Date().toISOString();
  }
  // conference_agent_ids is jsonb — generated as `Json`, not `string[]`, so
  // types.ts can't narrow it on its own. We know its real shape (this
  // module's own migration defines it as an array of agent uuids); a
  // string[] is itself a valid Json[], so this is a widening assignment, not
  // a lossy one (same reasoning as outreach-engine.ts's allowed_channels).
  if (input.conferenceAgentIds !== undefined) {
    patch.conference_agent_ids = input.conferenceAgentIds;
  }

  let query = admin.from('console_calls').update(patch).eq('id', input.callId);
  if (input.onlyIfLive) query = query.in('status', LIVE_STATUSES as string[]);
  const { error } = await query;
  if (error) throw new Error('console_call_update_failed');

  if (input.recordingUrl) {
    await admin
      .from('console_call_pii')
      .update({ recording_url: input.recordingUrl })
      .eq('call_id', input.callId);
  }
}

/** Resolves a console agent's user_id from their vox_username (agent_<uuid>). */
export async function resolveAgentIdByVoxUsername(voxUsername: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('console_agents')
    .select('user_id')
    .eq('vox_username', voxUsername)
    .maybeSingle();
  return data?.user_id ?? null;
}

/**
 * Pure. `ended` reason strings are the scenarios' own vocabulary (see
 * ConsoleDial/ConsoleInbound's handleLegDown / refuseOutbound / ringNext call
 * sites) — mapped onto console_calls' status CHECK constraint, which has no
 * 'ended_reason'-shaped granularity of its own.
 */
export function mapEndedReasonToStatus(reason: string): ConsoleCallStatus {
  if (reason === 'no_agent') return 'no_agent';
  if (reason === 'operator_failed' || reason === 'callee_failed' || reason === 'guest_failed') {
    return 'failed';
  }
  return 'ended';
}

// ─────────────────────────────────────────────────────────────────────────
// Session linking — resolves an /event report back to its console_calls row.
//
// authorize() (ConsoleDial.voxengine.js) never receives session_id — only
// {secret, token} — so it cannot write vox_session_id itself. Four-tier
// resolution, in order:
//   0. An exact, scenario-echoed call_id (inbound only — route-inbound
//      returns the row it just created in its accept response; ConsoleInbound
//      stashes it and sends it on every subsequent report). Authoritative:
//      skips the ambiguity below entirely.
//   1. Already linked (vox_session_id).
//   2. A still-live dial-token hash (outbound only). ConsoleDial's
//      handleOutbound now SEQUENCES the authorize call behind the 'started'
//      report's own delivery (not fire-and-forget) specifically so this tier
//      cannot race authorize's verifyDialToken, which nulls the hash on
//      success — see handleOutbound's own comment for why that race mattered
//      (a stage-7 finding: this session_url is now a live-call command
//      capability, not just a status/timestamp target).
//   3. Best-effort FIFO fallback onto the oldest still-unlinked row of the
//      same direction created recently — the last resort now, reachable only
//      if a report is lost/delayed (e.g. a dropped 'started' report before
//      Tier 0/2 ever land, or a session that predates this echo).
//
// Documented, bounded limitation: under genuine concurrent load (>1
// unlinked call of the same direction within RECENT_LINK_WINDOW_MS) tier 3
// can still attach an event to the wrong row — but only ever for a call whose
// OWN Tier 0/2 signal never arrived, which a healthy scenario always sends.
// ─────────────────────────────────────────────────────────────────────────

const RECENT_LINK_WINDOW_MS = 30_000;

async function linkSession(
  admin: AdminClient,
  callId: string,
  sessionId: number,
): Promise<boolean> {
  const { data, error } = await admin
    .from('console_call_pii')
    .update({ vox_session_id: sessionId })
    .eq('call_id', callId)
    .is('vox_session_id', null)
    .select('call_id')
    .maybeSingle();
  return !error && !!data;
}

// Direct session link — for a route that ALREADY knows the exact call_id
// (from verifyDialToken) and is handed session_id in the SAME request, so it
// never needs findConsoleCallForEvent's tiered guesswork at all. Used by
// authorize/route.ts and call-me-now-authorize/route.ts, right after
// verifyDialToken succeeds and BEFORE any of their own caps checks — so the
// link is written even on a caps refusal, not only on a full admit.
//
// Closes a real gap (found in a full telephony audit, 13.8): both routes'
// scenario callers report their OWN 'started' /event over a SEPARATE
// Net.httpRequestAsync call, best-effort and fire-and-forget (its promise
// always resolves, success or failure — see ConsoleDial/ConsoleCallMeNow's
// own reportEvent). If THAT request is lost (a transient network blip, or
// the app mid-deploy at the exact instant the session starts) the row never
// gets linked via Tier 2 (ConsoleDial) at all, or — worse for
// ConsoleCallMeNow specifically — never becomes linkable by ANY later tier,
// because its own 'ringing'/'connected'/'ended' events deliberately claim
// call_kind:'inbound' against a row whose real direction is 'outbound' (see
// findConsoleCallForEvent's Tier 0/3 direction checks and
// ConsoleCallMeNow.voxengine.js's own "EVENT call_kind CHOICE" header note)
// — Tier 3's FIFO fallback filters on direction and can never find it. The
// practical cost: the row stays stuck non-terminal, and if the ring
// exhausts, recordMissedCallCallback() never fires — the "we'll call you back"
// promise NO_AGENT_LINE_HE just made becomes a lie nobody acts on. Linking
// here removes the dependency on 'started' having landed at all: every
// later /event report resolves via Tier 1 (already linked, direction-
// agnostic) regardless of what call_kind/direction it claims.
export async function linkConsoleCallSession(callId: string, sessionId: number): Promise<void> {
  const admin = createAdminClient();
  await linkSession(admin, callId, sessionId);
}

export async function findConsoleCallForEvent(input: {
  sessionId: number;
  direction: 'outbound' | 'inbound';
  token?: string;
  callId?: string | null;
}): Promise<string | null> {
  const admin = createAdminClient();

  // Tier 0 — exact, scenario-echoed call_id (inbound only, see header).
  // direction is still checked as a defense-in-depth sanity guard (a call_id
  // sent under the wrong call_kind would otherwise silently link).
  if (input.callId) {
    const { data: exact } = await admin
      .from('console_calls')
      .select('id')
      .eq('id', input.callId)
      .eq('direction', input.direction)
      .maybeSingle();
    if (exact) {
      await linkSession(admin, exact.id, input.sessionId);
      return exact.id;
    }
  }

  // Tier 1 — already linked.
  const { data: linked } = await admin
    .from('console_call_pii')
    .select('call_id')
    .eq('vox_session_id', input.sessionId)
    .maybeSingle();
  if (linked) return linked.call_id;

  // Tier 2 — live dial-token hash (outbound only).
  if (input.token && DIAL_TOKEN_RE.test(input.token)) {
    const hash = sha256Hex(input.token);
    const { data: byToken } = await admin
      .from('console_call_pii')
      .select('call_id')
      .eq('dial_token_hash', hash)
      .maybeSingle();
    if (byToken) {
      await linkSession(admin, byToken.call_id, input.sessionId);
      return byToken.call_id;
    }
  }

  // Tier 3 — best-effort FIFO fallback.
  const cutoffIso = new Date(Date.now() - RECENT_LINK_WINDOW_MS).toISOString();
  const { data: candidates } = await admin
    .from('console_calls')
    .select('id')
    .eq('direction', input.direction)
    .in('status', ['initiated', 'ringing'])
    .gte('created_at', cutoffIso)
    .order('created_at', { ascending: true })
    .limit(5);
  for (const candidate of candidates ?? []) {
    const { data: pii } = await admin
      .from('console_call_pii')
      .select('vox_session_id')
      .eq('call_id', candidate.id)
      .maybeSingle();
    if (pii && pii.vox_session_id === null) {
      const applied = await linkSession(admin, candidate.id, input.sessionId);
      if (applied) return candidate.id;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Session command access (plan stage 7 — transfer). ConsoleDial/ConsoleInbound
// report their own _StartedEvent.accessURL/accessSecureURL on 'started' (the
// CallAlerting equivalent of RSVPAgent's StartScenarios-only
// media_session_access_url) — these are the CAPABILITY to command the live
// session, so they live in console_call_pii, never console_calls.
// ─────────────────────────────────────────────────────────────────────────

export async function recordConsoleCallSessionAccess(input: {
  callId: string;
  accessUrl: string | null;
  accessSecureUrl: string | null;
}): Promise<void> {
  const patch: ConsoleCallPiiUpdate = {};
  if (input.accessUrl) patch.session_url = input.accessUrl;
  if (input.accessSecureUrl) patch.secure_session_url = input.accessSecureUrl;
  if (Object.keys(patch).length === 0) return;
  const admin = createAdminClient();
  await admin.from('console_call_pii').update(patch).eq('call_id', input.callId);
}

export interface ConsoleCallSessionUrls {
  sessionUrl: string | null;
  secureSessionUrl: string | null;
}

export async function getConsoleCallSessionUrls(
  callId: string,
): Promise<ConsoleCallSessionUrls | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('console_call_pii')
    .select('session_url, secure_session_url')
    .eq('call_id', callId)
    .maybeSingle();
  if (error || !data) return null;
  return { sessionUrl: data.session_url, secureSessionUrl: data.secure_session_url };
}

// ─────────────────────────────────────────────────────────────────────────
// Transfer support (plan stage 7).
// ─────────────────────────────────────────────────────────────────────────

export interface ConsoleCallSummary {
  id: string;
  status: ConsoleCallStatus;
  direction: ConsoleCallDirection;
  kind: ConsoleCallKind;
  eventId: string | null;
}

export async function getConsoleCallById(callId: string): Promise<ConsoleCallSummary | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('console_calls')
    .select('id, status, direction, kind, event_id')
    .eq('id', callId)
    .maybeSingle();
  if (error || !data) return null;
  // CONSOLE_CALL_* above are the documented source of truth for these CHECK
  // constraints — see the module header comment.
  return {
    id: data.id,
    status: data.status as ConsoleCallStatus,
    direction: data.direction as ConsoleCallDirection,
    kind: data.kind as ConsoleCallKind,
    eventId: data.event_id,
  };
}

export type TransferTargetFailureReason = 'self' | 'not_found' | 'not_provisioned' | 'not_ready';

export type TransferTargetResolution =
  | { ok: true; voxUsername: string }
  | { ok: false; reason: TransferTargetFailureReason };

/**
 * Routable = console_agents.vox_username IS NOT NULL (provisioned) AND
 * agent_status.status = 'ready' AND agent_status.updated_at fresher than
 * AGENT_STATUS_FRESHNESS_MS (same <90s heartbeat gate findRoutableAgents
 * applies to inbound ring routing — see that function's own doc comment),
 * excluding the requester themselves. Queries the base tables directly (same
 * reasoning as findRoutableAgentVoxUsernames — this runs service-role, so
 * console_agents_roster's is_console_agent() WHERE would resolve auth.uid()
 * to NULL and silently return nothing).
 *
 * The freshness half was missing until a full telephony audit (13.8) found
 * it: this function is the ONE server-side gate transfer/consult/conference
 * all share, but unlike inbound ring routing it used to accept a bare
 * status='ready' row with no staleness check — an agent whose session died
 * without a clean 'busy'/'offline' transition (tab closed, SDK dropped,
 * laptop asleep) stayed a valid transfer/consult/conference target
 * indefinitely, so naming them rings a phantom agent_<uuid> for up to
 * TRANSFER_TIMEOUT_MS (20s) before the scenario's own timeout gives up —
 * wasted time a consult target spends as customer-facing SILENCE (the
 * customer is on hold throughout) and a transfer/conference target spends as
 * a live but pointless ring (the customer stays normally bridged). Fails
 * CLOSED on a missing/unparseable updated_at, matching every other gate in
 * this file — never silently admits a target this function cannot actually
 * vouch for as fresh.
 */
export async function resolveTransferTarget(
  targetAgentId: string,
  requestingAgentId: string,
): Promise<TransferTargetResolution> {
  if (targetAgentId === requestingAgentId) return { ok: false, reason: 'self' };
  const admin = createAdminClient();
  const { data: agent } = await admin
    .from('console_agents')
    .select('vox_username')
    .eq('user_id', targetAgentId)
    .maybeSingle();
  if (!agent?.vox_username) return { ok: false, reason: 'not_found' };

  const { data: secret } = await admin
    .from('console_agent_secrets')
    .select('user_id')
    .eq('user_id', targetAgentId)
    .maybeSingle();
  if (!secret) return { ok: false, reason: 'not_provisioned' };

  const { data: status } = await admin
    .from('agent_status')
    .select('status, updated_at')
    .eq('agent_id', targetAgentId)
    .maybeSingle();
  if (status?.status !== 'ready') return { ok: false, reason: 'not_ready' };
  const freshMs = Date.parse(status.updated_at ?? '');
  if (!Number.isFinite(freshMs)) return { ok: false, reason: 'not_ready' };
  if (freshMs <= Date.now() - AGENT_STATUS_FRESHNESS_MS) return { ok: false, reason: 'not_ready' };

  return { ok: true, voxUsername: agent.vox_username };
}

/**
 * Countries an agent may dial into from a live call, as E.164 prefixes.
 *
 * Israel only, and this is the single most effective control on the feature it
 * guards. The attack it exists for is IRSF — international revenue share fraud, the
 * outbound mirror of the wangiri flood this account measured on 17.8 (1,875 calls,
 * $13.41, over 4.5 months). There the attacker made US dial THEM; an endpoint that
 * dials any number on an agent's say-so is the same economics with the direction
 * reversed, and a leaked token or a stolen unlocked phone is all it needs. The
 * payload is always a premium-rate range in a country nobody here has business
 * calling, so refusing those costs this product nothing: KALFA is a B2C Israeli
 * event platform and the manager, supplier or event owner an agent conferences in
 * has an Israeli number.
 *
 * A CONSTANT, not an app_settings row, and deliberately so despite this codebase's
 * "no hardcoded business facts" rule. That rule is about facts the owner changes —
 * prices, channels, policy. This is a security boundary, and putting it in a table
 * would make widening it a data edit rather than a reviewed code change. When a real
 * need for another country appears, adding it here is one line and leaves a diff.
 */
const EXTERNAL_DIAL_ALLOWED_PREFIXES = ['+972'] as const;

/** Per-agent ceiling on outward consult/conference legs. */
const EXTERNAL_DIAL_RATE = { limit: 10, windowMs: 60 * 60 * 1000 } as const;

export type ExternalDialResolution =
  | { ok: true; phone: string }
  | { ok: false; reason: 'invalid' | 'not_allowed_country' | 'dnc' | 'rate_limited' };

/**
 * Validates and clears an operator-typed phone number for a consult or conference
 * leg. This function, not the Zod schema, is the authority on whether a number may
 * be dialled.
 *
 * Order is chosen so the cheapest and most decisive checks run first, and so a
 * caller probing the endpoint learns as little as possible per attempt:
 *
 *   1. E.164 normalization (libphonenumber) — anything unparsable stops here.
 *   2. Country allowlist — see EXTERNAL_DIAL_ALLOWED_PREFIXES.
 *   3. Rate limit, per AGENT and before the DNC query, so a token being used to
 *      enumerate the DNC list runs out of attempts rather than database round
 *      trips.
 *   4. DNC. Applied even though this is an operational internal call rather than
 *      marketing: the number an agent types may well be a guest's, we cannot tell
 *      from the digits alone, and a person who asked never to be called by this
 *      platform has not consented to being conferenced into a call either.
 *
 * The raw number is never logged by this function or its callers — it travels to
 * the scenario in the command envelope and nowhere else.
 */
export async function resolveExternalDialTarget(
  rawPhone: string,
  requestingAgentId: string,
): Promise<ExternalDialResolution> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false, reason: 'invalid' };

  if (!EXTERNAL_DIAL_ALLOWED_PREFIXES.some((p) => phone.startsWith(p))) {
    return { ok: false, reason: 'not_allowed_country' };
  }

  if (!rateLimit(`console-external-dial:${requestingAgentId}`, EXTERNAL_DIAL_RATE).allowed) {
    return { ok: false, reason: 'rate_limited' };
  }

  // Fail CLOSED on a DNC lookup error, unlike most best-effort checks in this file:
  // isDncListed already swallows its own errors to `false`, so this call cannot
  // distinguish "not listed" from "could not check" — which is why the DNC list is
  // the last gate rather than the only one, and why the country allowlist above
  // carries the weight it does.
  if (await isDncListed(phone)) return { ok: false, reason: 'dnc' };

  return { ok: true, phone };
}

/** Audit action for a consult/conference leg placed to a number outside the console. */
export const CONSOLE_EXTERNAL_DIAL_AUDIT_ACTION = 'console_call.external_dial';

// Mirrors CONSOLE_DIAL_AUDIT_ACTION below — direct service-role activity_log
// insert, best-effort, non-PII (identifiers + a purpose code only).
export const CONSOLE_TRANSFER_AUDIT_ACTION = 'console_call.transfer';

export async function recordConsoleTransferAudit(input: {
  fromAgentId: string;
  toAgentId: string;
  consoleCallId: string;
  eventId: string | null;
  requestId: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from('activity_log').insert({
      event_id: input.eventId,
      user_id: input.fromAgentId,
      action: CONSOLE_TRANSFER_AUDIT_ACTION,
      meta: {
        console_call_id: input.consoleCallId,
        to_agent_id: input.toAgentId,
        request_id: input.requestId,
      } as Database['public']['Tables']['activity_log']['Insert']['meta'],
    });
  } catch {
    // Best-effort — see recordConsoleDialAudit's identical rationale below.
  }
}

// Stage 2 — consult-before-transfer / conference. Same shape and rationale as
// recordConsoleTransferAudit immediately above (best-effort, non-PII,
// identifiers + a purpose code only); kept as siblings rather than merged
// into one parameterized helper, matching this module's own existing
// precedent of NOT merging recordConsoleDialAudit/recordConsoleTransferAudit
// despite their near-identical shape.
export const CONSOLE_CONSULT_AUDIT_ACTION = 'console_call.consult';
export const CONSOLE_CONFERENCE_AUDIT_ACTION = 'console_call.conference';

export async function recordConsoleConsultAudit(input: {
  fromAgentId: string;
  // Known (and worth recording) only on 'start', and only when the target was an
  // AGENT — the route resolves a real one there. 'cancel'/'complete' act on
  // whatever consult the SCENARIO already has in flight, which the route never
  // reads back from the DB, so there is no target to attribute at those phases.
  toAgentId?: string;
  // True when the target was a phone number outside the console. The NUMBER is
  // deliberately not recorded: this log is identifiers and a purpose code, never
  // PII (same rule as every other audit in this file). That an outward leg was
  // placed, by whom, on which call, is the auditable fact.
  externalTarget?: boolean;
  consoleCallId: string;
  eventId: string | null;
  requestId: string;
  phase: 'start' | 'cancel' | 'complete';
}): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from('activity_log').insert({
      event_id: input.eventId,
      user_id: input.fromAgentId,
      action: CONSOLE_CONSULT_AUDIT_ACTION,
      meta: {
        console_call_id: input.consoleCallId,
        ...(input.toAgentId ? { to_agent_id: input.toAgentId } : {}),
        ...(input.externalTarget ? { external_target: true } : {}),
        request_id: input.requestId,
        phase: input.phase,
      } as Database['public']['Tables']['activity_log']['Insert']['meta'],
    });
  } catch {
    // Best-effort — see recordConsoleDialAudit's identical rationale below.
  }
}

export async function recordConsoleConferenceAudit(input: {
  fromAgentId: string;
  /** Present when the third participant was an AGENT; absent for an outside number. */
  toAgentId?: string;
  /**
   * True when the third participant was a phone number outside the console. The
   * NUMBER is deliberately not recorded — identifiers and a purpose code only,
   * the same rule every other audit in this file follows.
   */
  externalTarget?: boolean;
  consoleCallId: string;
  eventId: string | null;
  requestId: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from('activity_log').insert({
      event_id: input.eventId,
      user_id: input.fromAgentId,
      action: CONSOLE_CONFERENCE_AUDIT_ACTION,
      meta: {
        console_call_id: input.consoleCallId,
        ...(input.toAgentId ? { to_agent_id: input.toAgentId } : {}),
        ...(input.externalTarget ? { external_target: true } : {}),
        request_id: input.requestId,
      } as Database['public']['Tables']['activity_log']['Insert']['meta'],
    });
  } catch {
    // Best-effort — see recordConsoleDialAudit's identical rationale below.
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Concurrency / rate counters.
// ─────────────────────────────────────────────────────────────────────────

// dial-intent's own cap — system-wide (any kind/direction), matching the
// task's literal "count live console_calls ≤2" plus ops-knobs' "V1's staff
// pool is small" rationale.
export const MANUAL_DIAL_MAX_LIVE_CALLS = 2;

export async function countLiveConsoleCalls(): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from('console_calls')
    .select('id', { count: 'exact', head: true })
    .in('status', LIVE_STATUSES as string[]);
  if (error) throw new Error('count_live_console_calls_failed');
  return count ?? 0;
}

// Gate E / ops-knobs decision 3 — the operative caps, restated as constants.
export const INBOUND_MAX_CONCURRENCY = 2;
// RAISED 3 → 7 on 17.8 at the owner's explicit instruction, for the same reason
// INBOUND_DAILY_SPEND_CAP_USD was raised on 15.8: it was refusing his own test
// calls. Three inbound calls per number per rolling hour is spent in under two
// minutes of testing, and the fourth attempt is rejected before answer with no
// ring and no message — indistinguishable, from the caller's side, from a dead
// line.
//
// Why this is a smaller concession than it was this morning. Until 17.8 this
// cap was the FRONT line against the inbound flood. It no longer is; two layers
// now sit above it:
//   • Voximplant PSTN blacklist — 23 entries, including the pattern
//     `^0?882[0-9]+$` covering the ITU +882 international-networks range every
//     unidentified caller in the flood used. A blacklisted number is refused
//     before a session is even created, so it never reaches this code.
//   • INBOUND_UNIDENTIFIED_DAILY_CAP (20/day) — added the same day. For an
//     UNIDENTIFIED flooder that budget binds long before an hourly cap of 7
//     could matter, which is precisely the population this cap was defending
//     against.
//
// What the raise DOES change, and is the better argument for it: an IDENTIFIED
// guest — a real customer of a real event — has no daily budget above them, and
// was being cut off after three attempts in an hour. A customer who cannot get
// through and keeps trying is the normal case, not an attack. Three was treating
// them as one.
//
// MEASURED the same day: 1,215 inbound calls over five days, 3 ever reached an
// agent. Nothing in that record suggests a legitimate caller was ever served by
// this cap being 3 rather than 7.
export const INBOUND_MAX_PER_CLI_HOURLY = 7;
// RECALIBRATED 13.8 after the estimate below fired a false emergency.
//
// The original design intent was right and is preserved: in "N calls OR $X,
// whichever first", the $ cap must bind slightly BEFORE the count cap, or it
// is dead code. What was wrong was the input. The old $0.06/call was taken
// from the top of a measured range ("fractions of a cent to $0.08") that
// included PSTN_OUT_INCOUNTRY — the OUTBOUND rate. Inbound is far cheaper,
// so a $5 cap tripped at 84 answered calls that had actually spent well
// under a dollar, disabled the service, and flooded Slack.
//
// MEASURED (13.8), not estimated from a range:
//   • account transaction history: an inbound call bills PSTN_IN_GEOGRAPHIC
//     $0.005–0.01 + AUDIORECORD $0.0015 ⇒ ~$0.0065–0.0115 before speech.
//   • call history, 24h window covering the whole overnight flood:
//     call_cost sum $0.6340 across 499 rows. Attributing ALL of it to the 84
//     answered inbound calls — a deliberate overestimate, since that window
//     also contains outbound and call-me-now activity — gives $0.0075/call.
// 0.02 sits ~2.7x above that measured aggregate. The headroom is deliberate
// and specific, not padding: as of 13.8 an unanswered inbound call now also
// speaks a hold line once per ring attempt (ConsoleInbound's ringNext), on
// top of the disclosure and the no-agent line, and TTS_TEXT_GOOGLE is billed
// per character. Revisit once a post-hold-line day has actually been billed.
export const INBOUND_DAILY_CALL_CAP = 300;
// RAISED 15.8 at the owner's explicit instruction ("תעלה את העצר"), because the
// breaker was refusing his own test calls and nothing shipped tonight had ever
// reached the ring stage as a result. It fired on the ESTIMATE, not on real
// spend: 250 answered calls x $0.02 = $5, while the measured aggregate is
// ~$0.0075/call, so actual spend when it tripped was ~$1.87. Raising this to 15
// deliberately makes INBOUND_DAILY_CALL_CAP (300) the binding limit instead —
// a hard call ceiling rather than a guess multiplied by a count. Worst case is
// therefore 300 x ~$0.0075 = ~$2.25/day, against a $10.83 balance.
// This is NOT a licence to stop caring: the sustained ~25 calls/hour inbound
// flood is unexplained and under investigation. Put this back to 5 once the
// flood's cause is known, or sooner if real billing contradicts $0.0075.
export const INBOUND_DAILY_SPEND_CAP_USD = 15;
// Read this together with the two constants above, because the ordering they
// describe REVERSED on 15.8 and the consequence is easy to miss.
//
// While the spend cap was $5: $5 ÷ $0.02 ⇒ the spend breaker fired at 250
// answered calls, AHEAD of the 300-call cap. The spend cap was the binding one.
//
// At $15 it no longer is. 300 x $0.02 = $6, well under $15, so the breaker now
// trips at INBOUND_DAILY_CALL_CAP — a flat 300 answered calls/day.
//
// That number has to be read against the flood, not in isolation: the measured
// inbound flood runs ~25 calls/hour, i.e. ~250/day sustained. The binding limit
// therefore sits ABOVE the thing it exists to bound, and a steady flood at the
// observed rate will never trip it. The breaker is protecting against a SURGE
// past 300, not against the flood we actually have.
//
// This is not an argument for lowering it — it was raised because it was
// refusing the owner's own test calls, and that reason still stands. It is an
// argument that the breaker is not, and was never going to be, the answer to
// the flood. Blocking the sources is. Keep both facts visible so nobody reads
// "the breaker is armed" as "the flood is handled".
export const INBOUND_ESTIMATED_COST_PER_CALL_USD = 0.02;

// ADDED (fraud incident, 17.8) — the "blocking the sources" the comment above
// says the count/spend breaker was never going to be. Owner-tunable, same as
// every other cap in this file; 20 is a starting point, not a measured
// optimum: it is far above the ~1/week of genuinely identified-but-first-time
// callers this account has ever seen (0 evidence either way for a legitimate
// UNIDENTIFIED caller — none observed in 7 days), and far below the flood's
// observed ~250-450/day, so it should bind fast against a repeat of this
// incident while leaving headroom for a real caller Voximplant/KALFA cannot
// resolve to a contact (wrong number saved, new phone, etc.). Revisit once a
// day with the fix live has been observed.
export const INBOUND_UNIDENTIFIED_DAILY_CAP = 20;

export async function countConcurrentAnsweredInbound(): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from('console_calls')
    .select('id', { count: 'exact', head: true })
    .eq('direction', 'inbound')
    .in('status', ['ringing', 'connected']);
  if (error) throw new Error('count_concurrent_inbound_failed');
  return count ?? 0;
}

/**
 * Approximate: counts console_call_pii rows for this normalized phone within
 * the last rolling hour. Covers both an answered inbound call from this CLI
 * and any outbound dial that happened to target the same number — both
 * represent "contact with this phone in the last hour", which is the
 * property the cap actually protects.
 */
// FIXED (fraud incident, 17.8): the call site used to pass the STRING
// literal 'unknown-cli' whenever normalizePhone couldn't parse the caller ID
// (any international/satellite-format/withheld CLI — precisely the format the
// 8/13-17 inbound flood's caller IDs used), but createConsoleCall/console_call_pii
// stores an unparseable CLI as SQL NULL, never the string 'unknown-cli'. A
// `.eq('phone_e164', 'unknown-cli')` query can therefore never match a row —
// this cap was silently returning 0 (i.e. never binding) for every call this
// flood actually made with a non-Israeli-format CLI. Verified empirically: no
// row in console_call_pii has ever contained the literal string 'unknown-cli'.
// Now accepts `null` and queries IS NULL, so every unparseable-CLI call shares
// ONE real rolling-hour bucket (still capped at INBOUND_MAX_PER_CLI_HOURLY) —
// callers cannot evade the per-CLI cap merely by presenting a CLI this account
// cannot normalize.
export async function countAnsweredLastHourForPhone(normalizedPhone: string | null): Promise<number> {
  const admin = createAdminClient();
  const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  let query = admin
    .from('console_call_pii')
    .select('call_id', { count: 'exact', head: true })
    .gte('created_at', sinceIso);
  query = normalizedPhone === null ? query.is('phone_e164', null) : query.eq('phone_e164', normalizedPhone);
  const { count, error } = await query;
  if (error) throw new Error('count_per_cli_failed');
  return count ?? 0;
}

/**
 * UTC calendar day count of answered inbound calls whose caller was NOT
 * resolved to a known contact/guest (createConsoleCall's guest_id/contact_id
 * both null — see identifyInboundCaller). Added for the same fraud incident:
 * measured 17.8, 7 days of console_calls — only 7 of 1218 inbound calls ever
 * matched a known contact; 1211 did not. A daily budget scoped to exactly the
 * unidentified population lets a real (rare) unrecognized caller through while
 * cutting off a rotating-spoofed-CLI flood far faster than the 300/day
 * account-wide breaker, which was calibrated for a totally different failure
 * mode (a burst past normal volume) — see INBOUND_DAILY_CALL_CAP's own header.
 */
export async function countAnsweredUnidentifiedInboundToday(nowMs: number = Date.now()): Promise<number> {
  const admin = createAdminClient();
  const dayStartIso = new Date(nowMs).toISOString().slice(0, 10) + 'T00:00:00.000Z';
  const { count, error } = await admin
    .from('console_calls')
    .select('id', { count: 'exact', head: true })
    .eq('direction', 'inbound')
    .is('guest_id', null)
    .is('contact_id', null)
    .gte('created_at', dayStartIso);
  if (error) throw new Error('count_unidentified_today_failed');
  return count ?? 0;
}

/** UTC calendar day, per ops-knobs E.2 ("resets at UTC midnight"). */
export async function countAnsweredInboundToday(nowMs: number = Date.now()): Promise<number> {
  const admin = createAdminClient();
  const dayStartIso = new Date(nowMs).toISOString().slice(0, 10) + 'T00:00:00.000Z';
  const { count, error } = await admin
    .from('console_calls')
    .select('id', { count: 'exact', head: true })
    .eq('direction', 'inbound')
    .gte('created_at', dayStartIso);
  if (error) throw new Error('count_answered_today_failed');
  return count ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────
// Inbound admission decision — pure (caps math only; caller supplies every
// measured input so this is testable without Supabase).
// ─────────────────────────────────────────────────────────────────────────

// NOTE: there is deliberately no hours input here. Answering an inbound call
// is never time-restricted by Israeli law (see the ruling written up where
// the old window used to live, above) — the caps below are cost and capacity
// controls, nothing else.
export interface InboundCapsInput {
  flagEnabled: boolean;
  liveCallsEnabled: boolean;
  balanceOk: boolean;
  globalConcurrentAnswered: number;
  perCliAnsweredLastHour: number;
  answeredToday: number;
  // ADDED (fraud incident, 17.8). `isIdentifiedCaller` mirrors what
  // route-inbound already computes via identifyInboundCaller — previously
  // ENRICHMENT-only (display_hint), never a gate (see that call site's own
  // comment, unchanged in spirit: an unidentified caller is still admitted,
  // just against a MUCH tighter shared budget instead of an unlimited one).
  // `answeredUnidentifiedToday` is irrelevant when isIdentifiedCaller is true
  // — a known contact/guest is NEVER capped by this mechanism.
  isIdentifiedCaller: boolean;
  answeredUnidentifiedToday: number;
}

export type InboundCapReason =
  | 'flag_disabled'
  | 'live_calls_disabled'
  | 'balance'
  | 'concurrency'
  | 'per_cli_rate'
  | 'unidentified_flood'
  | 'daily_breaker';

export function evaluateInboundCaps(
  input: InboundCapsInput,
): { ok: true } | { ok: false; reason: InboundCapReason } {
  if (!input.flagEnabled) return { ok: false, reason: 'flag_disabled' };
  if (!input.liveCallsEnabled) return { ok: false, reason: 'live_calls_disabled' };
  if (!input.balanceOk) return { ok: false, reason: 'balance' };
  if (input.globalConcurrentAnswered >= INBOUND_MAX_CONCURRENCY) {
    return { ok: false, reason: 'concurrency' };
  }
  if (input.perCliAnsweredLastHour >= INBOUND_MAX_PER_CLI_HOURLY) {
    return { ok: false, reason: 'per_cli_rate' };
  }
  if (!input.isIdentifiedCaller && input.answeredUnidentifiedToday >= INBOUND_UNIDENTIFIED_DAILY_CAP) {
    return { ok: false, reason: 'unidentified_flood' };
  }
  const estSpendUsd = input.answeredToday * INBOUND_ESTIMATED_COST_PER_CALL_USD;
  if (input.answeredToday >= INBOUND_DAILY_CALL_CAP || estSpendUsd >= INBOUND_DAILY_SPEND_CAP_USD) {
    return { ok: false, reason: 'daily_breaker' };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────
// Widget call admission — capability A, REVISED (owner-directed pivot,
// 12.8). Full research trail, so this isn't read as an unexplained reversal
// of the earlier NOT-FEASIBLE verdict:
//
// The earlier verdict rested on two things: an unauthenticated
// credential-issuing endpoint with no bounded-abuse pattern, and (per the
// owner's framing) MAU exhaustion risk from routing every site visitor
// through Voximplant logins. The MAU half turned out to be wrong — DOCS
// (docs.voximplant.ai/platform/voxengine/how-billing-works.md, live-fetched
// 12.8): "An active user is defined by a unique credential logging in at
// least once a month. One user logging in from multiple devices counts as
// ONE MAU." And DOCS (docs.voximplant.ai/getting-started/network-options/
// web-mobile.md): "Multi-device behavior: Expect one user identity to be
// active on multiple clients" — concurrent sessions under one identity are
// the platform's documented, expected model, not a workaround. So ALL
// widget visitors sharing ONE Voximplant identity costs 1 MAU/month
// total, regardless of traffic. (This corrects this project's own earlier
// recorded shorthand, "כל login = MAU" — the metered unit is the unique
// credential per month, not the login event; multiple logins under the same
// credential are free.)
//
// That does NOT dissolve the credential-issuing-endpoint problem — it
// changes its shape. Once every visitor shares one identity, the endpoint
// that signs a login for that identity (src/app/api/widget/sdk-auth) is
// still reachable by anyone, not just real widget users, so it is bounded
// the same way route-inbound bounds PSTN admission: this function, evaluated
// authoritatively server-side before any cost accrues (never trusting the
// browser's own claim that it's allowed to call).
//
// ONE further architectural fact the PSTN caps don't have to deal with:
// route-inbound's per-CLI cap works because a real phone number IS a
// per-visitor identity available at the VoxEngine scenario layer
// (CallAlerting's e.callerid). Once every widget visitor is logged in as
// the SAME shared Voximplant user, the scenario layer can no longer tell
// visitors apart at all — there is no per-visitor CLI to key a DB count on.
// So the per-visitor rate limit has to be enforced one layer earlier, at the
// point where the app DOES still see a real per-visitor signal: the
// browser's IP, at call-intent mint time (src/app/api/widget/call-intent) —
// hence perIpCallsLastHour below instead of a per-CLI count, fed by
// console_call_pii.origin_ip_hash (sha256 of the IP, never raw — see the
// migration's column comment). Everything else in this function's shape —
// names, order, fail-closed discipline — mirrors evaluateInboundCaps
// exactly, per the explicit instruction to reuse that pattern rather than
// invent a parallel one.
// ─────────────────────────────────────────────────────────────────────────

export const WIDGET_MAX_CONCURRENCY = 2; // same N=1-2 staff-pool rationale as INBOUND_MAX_CONCURRENCY
export const WIDGET_MAX_PER_IP_HOURLY = 3; // mirrors INBOUND_MAX_PER_CLI_HOURLY
export const WIDGET_DAILY_CALL_CAP = 100; // mirrors INBOUND_DAILY_CALL_CAP
export const WIDGET_DAILY_SPEND_CAP_USD = 5; // mirrors INBOUND_DAILY_SPEND_CAP_USD
// INFERRED, not MEASURED (flag carried through to the caller, not hidden):
// a widget call is SDK-leg -> scenario -> agent SDK-leg, with NO PSTN leg on
// either end, so its real per-call cost should be LOWER than PSTN inbound's
// measured $0.06 working figure (INBOUND_ESTIMATED_COST_PER_CALL_USD) — but
// this account has never carried a widget call, so there is no measured
// figure to derive a lower number from. Reusing 0.06 here is a deliberately
// CONSERVATIVE choice: it trips the spend breaker SOONER than the real cost
// would justify, never later. Revise down once real widget calls have a
// resource_charge to measure (same account-data-driven method ops-knobs used
// for the PSTN figure).
export const WIDGET_ESTIMATED_COST_PER_CALL_USD = 0.06;

export interface WidgetCapsInput {
  flagEnabled: boolean;
  liveCallsEnabled: boolean;
  balanceOk: boolean;
  globalConcurrentWidget: number;
  perIpCallsLastHour: number;
  answeredToday: number;
}

export type WidgetCapReason =
  | 'flag_disabled'
  | 'live_calls_disabled'
  | 'balance'
  | 'concurrency'
  | 'per_ip_rate'
  | 'daily_breaker';

export function evaluateWidgetCallCaps(
  input: WidgetCapsInput,
): { ok: true } | { ok: false; reason: WidgetCapReason } {
  if (!input.flagEnabled) return { ok: false, reason: 'flag_disabled' };
  if (!input.liveCallsEnabled) return { ok: false, reason: 'live_calls_disabled' };
  if (!input.balanceOk) return { ok: false, reason: 'balance' };
  if (input.globalConcurrentWidget >= WIDGET_MAX_CONCURRENCY) {
    return { ok: false, reason: 'concurrency' };
  }
  if (input.perIpCallsLastHour >= WIDGET_MAX_PER_IP_HOURLY) {
    return { ok: false, reason: 'per_ip_rate' };
  }
  const estSpendUsd = input.answeredToday * WIDGET_ESTIMATED_COST_PER_CALL_USD;
  if (input.answeredToday >= WIDGET_DAILY_CALL_CAP || estSpendUsd >= WIDGET_DAILY_SPEND_CAP_USD) {
    return { ok: false, reason: 'daily_breaker' };
  }
  return { ok: true };
}

/** Mirrors countConcurrentAnsweredInbound, scoped to kind='widget' so the
 * widget channel has its own concurrency budget rather than silently sharing
 * PSTN inbound's (both use direction='inbound'). */
export async function countConcurrentAnsweredWidget(): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from('console_calls')
    .select('id', { count: 'exact', head: true })
    .eq('kind', 'widget')
    .in('status', ['ringing', 'connected']);
  if (error) throw new Error('count_concurrent_widget_failed');
  return count ?? 0;
}

/** Mirrors countAnsweredInboundToday, scoped to kind='widget'. UTC calendar
 * day, same convention as the PSTN counterpart. */
export async function countAnsweredWidgetToday(nowMs: number = Date.now()): Promise<number> {
  const admin = createAdminClient();
  const dayStartIso = new Date(nowMs).toISOString().slice(0, 10) + 'T00:00:00.000Z';
  const { count, error } = await admin
    .from('console_calls')
    .select('id', { count: 'exact', head: true })
    .eq('kind', 'widget')
    .gte('created_at', dayStartIso);
  if (error) throw new Error('count_answered_widget_today_failed');
  return count ?? 0;
}

/**
 * The per-visitor rate-limit read — see this section's header for why this
 * is keyed on a hashed IP rather than a per-CLI count. Mirrors
 * countAnsweredLastHourForPhone's shape exactly, on the sibling column.
 */
export async function countWidgetCallsLastHourForIpHash(ipHash: string): Promise<number> {
  const admin = createAdminClient();
  const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  // Migration 20260812194830_callcenter_widget_kind.sql was pushed and
  // types.ts regenerated (team-lead, 12.8) — origin_ip_hash is now a real
  // typed column; the temporary `as unknown as` cast this used to need is
  // gone.
  const { count, error } = await admin
    .from('console_call_pii')
    .select('call_id', { count: 'exact', head: true })
    .eq('origin_ip_hash', ipHash)
    .gte('created_at', sinceIso);
  if (error) throw new Error('count_widget_per_ip_failed');
  return count ?? 0;
}

/** Writes the hashed IP onto an already-created widget call's PII row. Best-
 * effort by design (same as recordConsoleCallSessionAccess): a failed write
 * here degrades countWidgetCallsLastHourForIpHash's precision for THIS one
 * visitor, never blocks the call itself. */
export async function recordWidgetOriginIpHash(callId: string, ipHash: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from('console_call_pii')
    .update({ origin_ip_hash: ipHash })
    .eq('call_id', callId);
}

// ─────────────────────────────────────────────────────────────────────────
// Call-me-now admission — capability A, THIRD design (owner-directed pivot,
// 12.8, follow-on to the widget's own pivot). Full research trail, so this
// isn't read as an unexplained third reversal:
//
// The widget (above) was accepted as genuinely blocked: even on a shared
// Voximplant identity, /api/widget/sdk-auth is an unauthenticated endpoint
// that signs telephony login credentials for anyone who calls it — a real
// attack surface with no bounded-abuse pattern, not a MAU problem. This
// design has NO browser Voximplant identity at all, so that objection does
// not apply: the visitor's phone is dialed by the SERVER via StartScenarios
// (Management API) — the SAME primitive already proven in production by the
// outbound AI-call campaign (dispatchOutreachCall /
// scripts/voximplant/bridge-call.ts), never a browser SDK call. There is
// nothing here for an attacker to authenticate INTO.
//
// Three research findings that made this the accepted design instead of the
// widget (DOCS/MEASURED, live-verified 12.8):
//
// 1. OTP is reusable AS-IS (otp.ts's requestOtp/verifyOtp — already live in
//    production for agreement-signing) — purpose-keyed, takes a raw phone,
//    no auth baked in. BUT every EXISTING call site is authenticated and can
//    only request a code for its OWN profile phone; a public "call me"
//    endpoint accepts an ATTACKER-NAMED phone. requestOtp's own limit
//    (5 codes/phone/purpose/hour) caps hitting one victim repeatedly but
//    does nothing against an attacker rotating destination numbers from one
//    IP to burn SMS budget or harass strangers — the public request-code
//    route layers its OWN getClientIp+rateLimit on top (same class of
//    objection as the widget's credential endpoint; not laundered away just
//    because the OTP module itself is pre-existing and safe elsewhere).
// 2. The ct-token/ConsoleDial path CANNOT be reused, and this needs a NEW
//    Voximplant rule+scenario — verified by reading ConsoleDial.voxengine.js
//    end to end: its ONLY entry point is AppEvents.CallAlerting (an
//    operator's browser physically dialing a destination through an
//    already-logged-in SDK session); it never reads customData/
//    script_custom_data at all. StartScenarios binds a session to a rule_id
//    with NO CallAlerting event — there is no code path from "visitor
//    submitted a verified phone" to "ConsoleDial's outbound branch runs"
//    without a different scenario. One genuine advantage of that: because
//    StartScenarios names the rule directly, no CallAlerting pattern
//    matching happens for this flow — the rule-ordering/shadowing risk the
//    widget's `^wt` pattern carried (and this project has been bitten by
//    before) does not apply here.
// 3. The consent layer extends cleanly with NO duplication —
//    evaluateCallMeNowConsent (above) reuses evaluateSharedConsentGates
//    (DNC -> contacts opt-out -> Shabbat/Yom-Tov -> daily window, the last of
//    which it explicitly skips) on the OTP-verified phone; DialTargetResolution's
//    eventId/contactId/guestId/callbackRequestId are already nullable. An
//    OTP-verified visitor who typed their own number and pressed "call me"
//    seconds ago is a STRONGER consent basis than the existing `callback`
//    kind, which is honoured up to 30 days stale — see
//    evaluateCallMeNowConsent's own header for the full ruling (RESOLVED,
//    12.8: daily window off for this leg, Shabbat/Yom-Tov unconditional for
//    every leg) and why this is still a separate function, not a third
//    DialTargetInput variant.
//
// Cost/capacity is bounded the SAME shape as evaluateInboundCaps/
// evaluateWidgetCallCaps (concurrency cap, per-target rate limit, daily
// spend breaker) — reused, not reinvented — except the per-target rate limit
// keys on the ACTUAL phone number (countAnsweredLastHourForPhone, already
// exported, already generic across kinds — no new counter needed) rather
// than a hashed IP: unlike the widget's shared identity, this flow has a
// real, OTP-proven destination number, which is a strictly better rate-limit
// key than an IP ever was.
//
// AVAILABILITY, NOT THE CLOCK, GATES THE IMMEDIATE DIAL (owner decision,
// 12.8 — the actual resolution of the hours question above, not a separate
// concern): /api/call-me-now/verify checks findRoutableAgentVoxUsernames()
// BEFORE spending anything — before evaluateCallMeNowCaps, before creating a
// console_calls row, before StartScenarios. If nobody is routable, NO
// outbound leg is placed at all (cost: zero) and offerCallbackForCallMeNow
// (below) writes an ordinary callback_requests row on the spot instead — the
// common no-agent case now resolves at INTENT time, not ring exhaustion.
// Ring exhaustion (call-me-now-authorize/route.ts's own fresh
// findRoutableAgentVoxUsernames() re-check, right before the scenario rings)
// becomes the narrow RACE case: an agent was routable at intent, gone by the
// time the scenario actually rings — the scenario's ring-exhausted branch
// must still handle it (reusing ConsoleInbound's NO_AGENT_LINE_HE/
// declareNoAgent() verbatim, which reports 'no_agent' through the existing
// /event route and triggers recordMissedCallCallback unchanged), so a 04:00
// call that briefly looked answerable doesn't get answered and die in
// silence.
//
// HARD CONSTRAINT (owner ruling, 12.8): NEVER build "an agent connected ->
// auto-dial the waiting call-me-now requests." Once a callback_requests row
// is written (by either path above), the customer's chosen moment is
// EXHAUSTED — the row becomes an ORDINARY callback, indistinguishable from
// any other, dialled only when a human agent chooses to from the panel,
// through EVERY existing gate (daily window, Shabbat, 30-day freshness,
// max attempts, DNC, opt-out) via the unmodified
// resolveDialTarget({kind:'callback', id}) path. An auto-dial-on-connect
// would smuggle back exactly the "our moment, not theirs" problem the whole
// ruling above exists to prevent.
// ─────────────────────────────────────────────────────────────────────────

export const CALL_ME_NOW_MAX_CONCURRENCY = 2; // same N=1-2 staff-pool rationale as INBOUND_MAX_CONCURRENCY
// Deliberately tighter than the widget's per-IP 3/hour: this cap is keyed on
// a REAL verified phone, not a shared-identity proxy, so a genuine repeat
// need within an hour is unusual for a "call me now" support ask — 1 keeps a
// script from ringing the same real person's phone repeatedly even if every
// other gate is somehow satisfied.
export const CALL_ME_NOW_MAX_PER_PHONE_HOURLY = 1;
export const CALL_ME_NOW_DAILY_CALL_CAP = 100;
export const CALL_ME_NOW_DAILY_SPEND_CAP_USD = 5;
// Its OWN cost estimate — it used to borrow INBOUND_ESTIMATED_COST_PER_CALL_USD,
// which was wrong in a way that only became visible when that constant was
// recalibrated for inbound (13.8). The two are not comparable: an inbound call
// bills PSTN_IN_GEOGRAPHIC (~$0.005–0.01), a call-me-now call bills
// PSTN_OUT_INCOUNTRY — measured at $0.08 in this account's own transaction
// history — plus AUDIORECORD ($0.0015) and per-character TTS for the
// disclosure, hold and no-agent lines (a full script measured $0.0081).
// Sharing one number meant the direction of the error flipped with whichever
// flow it was tuned for: keeping $0.06 would have been ~8x too HIGH for
// inbound, and dropping to $0.02 would have been ~4x too LOW here, quietly
// letting outbound spend run past the $5 the cap promises. $0.09 is the
// measured floor plus a small margin for speech.
export const CALL_ME_NOW_ESTIMATED_COST_PER_CALL_USD = 0.09;
// No separate cost constant: this call's telephony shape (one PSTN leg to
// the visitor + internal callUser legs ringing agents) is the SAME shape as
// PSTN inbound, not the widget's all-WebRTC shape — INBOUND_ESTIMATED_COST_PER_CALL_USD
// is reused directly rather than inventing a third figure with no data
// behind it either. At $0.06/call the spend breaker fires at 84 answered
// calls/day (84 x 0.06 = $5.04) — genuinely ahead of the 100-call cap, same
// arithmetic as inbound/widget.

export interface CallMeNowCapsInput {
  flagEnabled: boolean;
  liveCallsEnabled: boolean;
  balanceOk: boolean;
  globalConcurrentCallMeNow: number;
  perPhoneCallsLastHour: number;
  answeredToday: number;
}

export type CallMeNowCapReason =
  | 'flag_disabled'
  | 'live_calls_disabled'
  | 'balance'
  | 'concurrency'
  | 'per_phone_rate'
  | 'daily_breaker';

export function evaluateCallMeNowCaps(
  input: CallMeNowCapsInput,
): { ok: true } | { ok: false; reason: CallMeNowCapReason } {
  if (!input.flagEnabled) return { ok: false, reason: 'flag_disabled' };
  if (!input.liveCallsEnabled) return { ok: false, reason: 'live_calls_disabled' };
  if (!input.balanceOk) return { ok: false, reason: 'balance' };
  if (input.globalConcurrentCallMeNow >= CALL_ME_NOW_MAX_CONCURRENCY) {
    return { ok: false, reason: 'concurrency' };
  }
  if (input.perPhoneCallsLastHour >= CALL_ME_NOW_MAX_PER_PHONE_HOURLY) {
    return { ok: false, reason: 'per_phone_rate' };
  }
  const estSpendUsd = input.answeredToday * CALL_ME_NOW_ESTIMATED_COST_PER_CALL_USD;
  if (input.answeredToday >= CALL_ME_NOW_DAILY_CALL_CAP || estSpendUsd >= CALL_ME_NOW_DAILY_SPEND_CAP_USD) {
    return { ok: false, reason: 'daily_breaker' };
  }
  return { ok: true };
}

/** Mirrors countConcurrentAnsweredWidget, scoped to kind='call_me_now'. */
export async function countConcurrentAnsweredCallMeNow(): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from('console_calls')
    .select('id', { count: 'exact', head: true })
    .eq('kind', 'call_me_now')
    .in('status', ['ringing', 'connected']);
  if (error) throw new Error('count_concurrent_call_me_now_failed');
  return count ?? 0;
}

/** Mirrors countAnsweredWidgetToday, scoped to kind='call_me_now'. UTC
 * calendar day, same convention as every other daily counter in this file. */
export async function countAnsweredCallMeNowToday(nowMs: number = Date.now()): Promise<number> {
  const admin = createAdminClient();
  const dayStartIso = new Date(nowMs).toISOString().slice(0, 10) + 'T00:00:00.000Z';
  const { count, error } = await admin
    .from('console_calls')
    .select('id', { count: 'exact', head: true })
    .eq('kind', 'call_me_now')
    .gte('created_at', dayStartIso);
  if (error) throw new Error('count_answered_call_me_now_today_failed');
  return count ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────
// Round-robin ring order — pure. Sorted by a stable key (vox_username) then
// rotated by todayCount % n, so the start position advances over the day
// without any new persisted cursor.
// ─────────────────────────────────────────────────────────────────────────

export function computeRingOrder(routableVoxUsernames: string[], rotateBy: number): string[] {
  const n = routableVoxUsernames.length;
  if (n === 0) return [];
  const sorted = [...routableVoxUsernames].sort();
  const start = ((rotateBy % n) + n) % n;
  return [...sorted.slice(start), ...sorted.slice(0, start)];
}

// Department-queue extension point (plan §10: "מחלקות (נקודת הרחבה = ring-order
// בשרת)") — pure composition, no new concept. Queue members are rung first (in
// their own rotated order), then every OTHER routable agent as a fallback (also
// rotated, queue members excluded so nobody rings twice). Zero queue members
// (queue inactive, unresolvable, or genuinely empty) degenerates to
// `computeRingOrder(allRoutable, rotateBy)` — byte-identical to the pre-queue
// behavior, so a queue that fails to resolve is never a worse outcome than
// today. See console-queues.ts for queue resolution and membership lookup.
export function computeQueueRingOrder(
  queueMemberVoxUsernames: string[],
  allRoutableVoxUsernames: string[],
  rotateBy: number,
): string[] {
  const memberSet = new Set(queueMemberVoxUsernames);
  const primary = computeRingOrder(queueMemberVoxUsernames, rotateBy);
  const rest = allRoutableVoxUsernames.filter((u) => !memberSet.has(u));
  const fallback = computeRingOrder(rest, rotateBy);
  return [...primary, ...fallback];
}

// Calendar-derived presence de-prioritizer (Outlook/Exchange sync research,
// 12.8) — a THIRD, advisory signal alongside agent_status (business truth)
// and the SDK connection (technical signal). Two-axis rule
// (plans/shimmering-snuggling-neumann.md "נוכחות"): a calendar block may
// REORDER an already-routable ring, never REMOVE an agent from it — an
// agent who set themselves 'ready' rings, always, even if their calendar
// also shows them in a meeting. Moves calendar-busy vox_usernames to the end
// of an already-computed ring order, preserving relative order within each
// group; a ring with zero calendar-busy members is returned unchanged
// (same array values, new array identity).
//
// NOT wired into findRoutableAgents/findRoutableAgentVoxUsernames or any
// route in this pass — inbound routing itself is not yet live (gate E,
// stage 5). Exists so the two-axis-respecting logic is written, tested, and
// ready for that call site once inbound goes live, matching this module's
// existing computeRingOrder/computeQueueRingOrder — pure, no I/O, caller
// supplies the calendar-busy set (from console_agent_calendar_presence via
// console-agent-calendar-presence.ts).
export function deprioritizeCalendarBusyAgents(
  ringOrder: string[],
  calendarBusyVoxUsernames: ReadonlySet<string>,
): string[] {
  if (calendarBusyVoxUsernames.size === 0) return ringOrder;
  const free = ringOrder.filter((u) => !calendarBusyVoxUsernames.has(u));
  const busy = ringOrder.filter((u) => calendarBusyVoxUsernames.has(u));
  return [...free, ...busy];
}

// <90s freshness window on agent_status.updated_at (plan §נוכחות). Now that
// softphone-panel.tsx's heartbeat effect re-POSTs the agent's current
// presence every 60s while the SDK is logged in and the tab is visible, this
// gate is no longer vacuous: a genuinely-connected 'ready' agent has
// updated_at inside the window; a stale/abandoned 'ready' row (tab closed,
// SDK disconnected, laptop asleep) ages out and stops being routable within
// two missed beats.
// Imported, not redeclared: the browser roster and CallBar's target picker
// apply the SAME window via effectivePresence() (src/lib/console/presence.ts).
// Two copies of this number would let the router and the roster disagree
// about who is available — which is exactly the bug that motivated moving it
// there (MEASURED 13.8: roster showed 'ready', heartbeat was 661 minutes old).
export { AGENT_STATUS_FRESHNESS_MS };

export interface RoutableAgent {
  agentId: string;
  voxUsername: string;
}

/**
 * Routable = console_agents.vox_username IS NOT NULL (provisioned) AND
 * agent_status.status = 'ready' AND agent_status.updated_at fresher than
 * AGENT_STATUS_FRESHNESS_MS. Queries the BASE tables directly, never
 * console_agents_roster: that view's WHERE is_console_agent() resolves
 * auth.uid() from the caller's JWT, which is NULL for a service-role
 * request — the view would silently return zero rows here.
 *
 * Exported (not `findRoutableAgentVoxUsernames`'s private internals) so
 * console-queues.ts's queue-scoped variant can intersect this SAME ready+fresh
 * computation with queue membership, instead of re-deriving it — the freshness
 * gate must stay defined in exactly one place.
 */
export async function findRoutableAgents(nowMs: number = Date.now()): Promise<RoutableAgent[]> {
  const admin = createAdminClient();
  const { data: agents, error: agentsErr } = await admin
    .from('console_agents')
    .select('user_id, vox_username')
    .not('vox_username', 'is', null);
  if (agentsErr) throw new Error('find_routable_agents_failed');
  if (!agents || agents.length === 0) return [];

  const { data: statuses, error: statusErr } = await admin
    .from('agent_status')
    .select('agent_id, status, updated_at')
    .eq('status', 'ready')
    .in(
      'agent_id',
      agents.map((a) => a.user_id),
    );
  if (statusErr) throw new Error('find_routable_agents_failed');

  const freshCutoffMs = nowMs - AGENT_STATUS_FRESHNESS_MS;
  const readyIds = new Set(
    (statuses ?? [])
      .filter((s) => Date.parse(s.updated_at) > freshCutoffMs)
      .map((s) => s.agent_id),
  );

  // An agent already on a call is not routable, and nothing else establishes
  // that. `agent_status` has an 'in_call' value that NOTHING ever writes: the
  // status route rejects it from clients as "system-managed" (softphone-panel
  // .tsx) and no server path sets it — and it could not work if one did, because
  // the heartbeat overwrites the row with 'ready' every 30-60s. So busy is
  // DERIVED here from the calls table, which the server owns outright, instead
  // of stored in a field the heartbeat would clobber.
  //
  // Only 'connected' counts, not the rest of LIVE_STATUSES: agent_id is written
  // in exactly one place — the event route's 'connected' branch — so a row with
  // both is an agent genuinely on a call, while 'ringing' rows have no agent yet
  // and excluding them would remove agents from the very ring being computed.
  //
  // Time-bounded, and that bound is load-bearing rather than defensive. There is
  // no sweep closing stuck console_calls rows (checked: none in worker/, and the
  // module already notes a row "stays stuck non-terminal"), so an unbounded
  // exclusion would drop an agent from routing PERMANENTLY over one leaked row —
  // with a single provisioned agent, that is the whole call centre, silently.
  // One hour is not a guess: both ConsoleInbound and ConsoleDial hard-terminate
  // a session at SAFETY_NET_MS = 60 minutes, so a 'connected' row older than
  // that cannot still be a live call by construction. The failure mode degrades
  // to the old behaviour (a wasted ring window) instead of an invisible outage.
  const busyIds = new Set<string>();
  const candidateIds = agents.map((a) => a.user_id).filter((id) => readyIds.has(id));
  if (candidateIds.length > 0) {
    const { data: liveCalls, error: liveErr } = await admin
      .from('console_calls')
      .select('agent_id')
      .eq('status', 'connected')
      .in('agent_id', candidateIds)
      .gt('created_at', new Date(nowMs - AGENT_BUSY_MAX_MS).toISOString());
    // Fail OPEN on a query error: not knowing who is busy must never empty the
    // ring order. A ring to a busy agent is rejected by their SDK and costs one
    // window; an empty ring order tells a real caller nobody is available.
    if (!liveErr) {
      for (const c of liveCalls ?? []) {
        if (c.agent_id) busyIds.add(c.agent_id);
      }
    }
  }

  return agents
    .filter(
      (a): a is { user_id: string; vox_username: string } =>
        readyIds.has(a.user_id) && !busyIds.has(a.user_id) && !!a.vox_username,
    )
    .map((a) => ({ agentId: a.user_id, voxUsername: a.vox_username }));
}

export interface TransferTarget {
  agentId: string;
  displayName: string;
}

/**
 * The agents an agent on a live call may hand it to — the list behind the
 * transfer / consult / conference pickers in the native console.
 *
 * Built on findRoutableAgents rather than a query of its own, so "who can take a
 * call" has exactly one definition (provisioned + ready + heartbeat-fresh + not
 * already on one). That is deliberately STRICTER than resolveTransferTarget,
 * which each of those routes runs as the real authority and which does not
 * exclude busy agents. The mismatch is in the safe direction: the picker may hide
 * someone the route would have accepted, so an agent never gets an error from a
 * name they were just offered. It cannot do the reverse.
 *
 * [excludeAgentId] drops the caller. resolveTransferTarget already refuses a
 * transfer to self with reason 'self', so this only stops the UI offering a
 * choice that is guaranteed to fail.
 *
 * `display_name` is what the agent picking reads; agents with none fall back to
 * a truncated id rather than being hidden, because an unnamed but reachable
 * colleague is still a valid destination and silently dropping them would look
 * like they were offline.
 */
export async function findTransferTargets(
  excludeAgentId: string,
  nowMs: number = Date.now(),
): Promise<TransferTarget[]> {
  const routable = (await findRoutableAgents(nowMs)).filter((a) => a.agentId !== excludeAgentId);
  if (routable.length === 0) return [];

  const admin = createAdminClient();
  const { data: named } = await admin
    .from('console_agents')
    .select('user_id, display_name')
    .in(
      'user_id',
      routable.map((a) => a.agentId),
    );
  const names = new Map((named ?? []).map((n) => [n.user_id, n.display_name?.trim() || null]));

  return routable
    .map((a) => ({
      agentId: a.agentId,
      displayName: names.get(a.agentId) || `נציג ${a.agentId.slice(0, 8)}`,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'he'));
}

/**
 * Provisioned console agents who DECLARED they are on shift — deliberately
 * WITHOUT the heartbeat gate findRoutableAgents applies.
 *
 * This exists to break a closed loop that only became visible once native
 * push was researched (14.8). Voximplant sends an incoming-call push to a
 * device ONLY when a scenario calls `callUser` on that user. `callUser` is
 * only reached for usernames the server put in a ring order. Ring orders
 * only contain heartbeat-fresh agents. So a sleeping app could never be
 * woken by the platform: no heartbeat ⇒ not in the ring ⇒ no callUser ⇒ no
 * push ⇒ still asleep.
 *
 * For a BROWSER agent that loop was already broken from outside, by
 * notifyOffDutyShiftAgentsOfInboundCall's VAPID web push. That push cannot
 * reach a native app (push_subscriptions is Browser-Push-API shaped —
 * endpoint + p256dh/auth keys — and there is no FCM sender in this codebase),
 * so the native case needs the loop broken from INSIDE: put the on-shift
 * agent in the retry ring, let `callUser` fire, and let Voximplant's own
 * push infrastructure do the waking.
 *
 * Same shift rule as the web-push audience (isShiftActiveAndFresh — active
 * AND touched within CONSOLE_SHIFT_FRESHNESS_MS), so a forgotten toggle from
 * two days ago does not resurrect anyone. Callers are expected to use this
 * ONLY for the retry wave, never the primary ring: ringing a sleeping agent
 * costs a real attempt, and a caller should not pay that before every
 * already-connected agent has been tried.
 */
export async function findOnShiftAgentVoxUsernames(nowMs: number = Date.now()): Promise<string[]> {
  const admin = createAdminClient();
  const { data: agents, error: agentsErr } = await admin
    .from('console_agents')
    .select('user_id, vox_username')
    .not('vox_username', 'is', null);
  if (agentsErr) throw new Error('find_on_shift_agents_failed');
  if (!agents || agents.length === 0) return [];

  const { data: shiftRows, error: shiftErr } = await admin
    .from('console_agent_shift')
    .select('agent_id, active, updated_at')
    .in(
      'agent_id',
      agents.map((a) => a.user_id),
    );
  if (shiftErr) throw new Error('find_on_shift_agents_failed');

  const onShiftIds = new Set(
    (shiftRows ?? []).filter((r) => isShiftActiveAndFresh(r, nowMs)).map((r) => r.agent_id),
  );
  return agents
    .filter((a): a is { user_id: string; vox_username: string } =>
      onShiftIds.has(a.user_id) && !!a.vox_username,
    )
    .map((a) => a.vox_username);
}

export async function findRoutableAgentVoxUsernames(nowMs: number = Date.now()): Promise<string[]> {
  return (await findRoutableAgents(nowMs)).map((a) => a.voxUsername);
}

// ─────────────────────────────────────────────────────────────────────────
// Inbound-call push alert (call-center research, 12.8 — capability B). The
// existing VAPID web-push stack (push_subscriptions / sendPushToUser), not
// Voximplant's own PushService: PushService's web path requires a Firebase
// Cloud Messaging project + `require(Modules.PushService)` in the scenario
// (DOCS: live guides.troubleshooting.push — `<web_fcm_push_token>`,
// "DEVICE_UNREGISTERED FCM error (android/web)"), which is a second push
// transport AND a scenario upload — out of scope and unnecessary when a
// working, simpler VAPID stack already exists.
//
// Fired from route-inbound's accept branch, NOT from the scenario's
// 'ringing' event report — that event carries no per-agent identity
// (ConsoleInbound rings serially and only the 'connected' event learns a
// winner, via resolveAgentIdByVoxUsername). route-inbound already computes
// the ring order server-side before answering, so this is the one place the
// full routable-agent set is known up front.
//
// Deliberately notifies EVERY agent in the ring, not just the first: a push
// can arrive after a closed tab reopens, by which point the serial ring may
// already be on agent 3 — claiming "a call is ringing for YOU" would be
// dishonest by then. "A call is waiting" stays true for as long as the call
// itself is live. tag=consoleCallId so a flaky network's retried push
// collapses into one OS notification instead of stacking duplicates.
//
// Known limitation, not fixed here: this does not check whether a
// push-subscribed agent's SDK is actually connected. An agent who is
// subscribed but not logged into the softphone right now still gets the
// alert, opens /admin, and may find the serial ring has already moved past
// them — "a call is waiting" (not "for you") is honest even then, but it is
// worth knowing when reading a live-test result.
//
// Never awaited by the caller — route-inbound's response gates
// Call.answer() in the scenario and must stay fast, so a slow or failed push
// must never delay or block answering the call. The caller schedules this
// through next/server's `after()`, not a bare `void` call, so it is not
// depending on inference about whether the Node process keeps running past
// the response — see route-inbound/route.ts's call site for why.
export async function notifyRoutableAgentsOfInboundCall(input: {
  voxUsernames: string[];
  consoleCallId: string;
}): Promise<void> {
  if (input.voxUsernames.length === 0) return;
  try {
    const admin = createAdminClient();
    const { data: agents, error } = await admin
      .from('console_agents')
      .select('user_id')
      .in('vox_username', input.voxUsernames);
    if (error || !agents) return;

    await Promise.all(
      agents.map((a) =>
        sendPushToUser(a.user_id, {
          title: 'KALFA — מוקד שירות',
          // No caller name/number/event — push payloads are not a PII
          // surface (project rule: no PII in logs/notifications).
          body: 'שיחה נכנסת ממתינה במוקד',
          // Deep-link the console call id (wake-and-answer research, 12.8) —
          // the SW already forwards data.url verbatim to notificationclick's
          // openWindow/focus (public/sw.js), so a tap lands the launched PWA
          // straight on /admin with the panel able to auto-open (softphone-
          // panel.tsx reads this `call` param). Still not PII: a UUID call
          // id is an internal identifier, not a caller name/number.
          url: `/admin?call=${input.consoleCallId}`,
          tag: `console-call-${input.consoleCallId}`,
        }).catch(() => {
          // Best-effort per agent — one dead/expired subscription must never
          // stop the alert reaching the others.
        }),
      ),
    );
  } catch {
    // Best-effort overall — see module header's audit-write precedent. The
    // in-browser softphone ring (SDK CallEvents) and the panel's own
    // Realtime feed remain the authoritative signal; this is a
    // supplementary alert only.
  }
}

// Bounded staleness window for console_agent_shift.active — see the
// migration's table comment for why this is a SEPARATE concept from
// agent_status's <90s AGENT_STATUS_FRESHNESS_MS heartbeat gate. 12 hours is
// an operational UX bound (a plausible shift length plus buffer), not a
// business fact — same category as AGENT_STATUS_FRESHNESS_MS /
// CALLBACK_FRESHNESS_MS above, not "no hardcoded business facts" territory
// (that rule is about prices/channels/policy, not UI staleness windows).
export const CONSOLE_SHIFT_FRESHNESS_MS = 12 * 60 * 60 * 1000;

/** Pure — testable without Supabase. A row the agent never touched, or
 * touched more than CONSOLE_SHIFT_FRESHNESS_MS ago, is treated as off-shift
 * regardless of what `active` says — the forgotten-toggle case the
 * agent_status reuse alternative could not solve. */
export function isShiftActiveAndFresh(
  row: { active: boolean; updated_at: string } | null,
  nowMs: number = Date.now(),
): boolean {
  if (!row || !row.active) return false;
  const updatedMs = Date.parse(row.updated_at);
  if (Number.isNaN(updatedMs)) return false;
  return nowMs - updatedMs < CONSOLE_SHIFT_FRESHNESS_MS;
}

/**
 * Wake-and-answer's audience EXPANSION (call-center research, 12.8): the
 * existing notifyRoutableAgentsOfInboundCall only reaches agents who are
 * ALREADY routable — i.e. already SDK-connected, the set that does not need
 * waking. When ringOrder is empty (nobody currently connected — precisely
 * the case this capability exists for) that function is a no-op by design
 * (`if (input.voxUsernames.length === 0) return`), so without this second
 * audience zero pushes would ever go out in the scenario the whole feature
 * targets. Audience here = provisioned console agents with a fresh
 * console_agent_shift.active=true AND at least one non-revoked push
 * subscription, excluding anyone already covered by the routable-agent
 * push. Same non-PII payload shape, same tag, same best-effort/never-throws
 * discipline as notifyRoutableAgentsOfInboundCall — see that function's
 * header for the full reasoning this one shares. Fails CLOSED on the
 * consoleWakeEnabled flag: off by default until the owner verifies the
 * real-device latency this capability's viability depends on.
 */
export async function notifyOffDutyShiftAgentsOfInboundCall(input: {
  consoleCallId: string;
  excludeVoxUsernames: string[];
}): Promise<void> {
  try {
    if (!(await consoleWakeEnabled())) return;
    const admin = createAdminClient();
    const exclude = new Set(input.excludeVoxUsernames);

    const { data: agents, error: agentsErr } = await admin
      .from('console_agents')
      .select('user_id, vox_username')
      .not('vox_username', 'is', null);
    if (agentsErr || !agents) return;
    const candidates = agents.filter(
      (a): a is { user_id: string; vox_username: string } =>
        !!a.vox_username && !exclude.has(a.vox_username),
    );
    if (candidates.length === 0) return;

    const { data: shiftRows, error: shiftErr } = await admin
      .from('console_agent_shift')
      .select('agent_id, active, updated_at')
      .in(
        'agent_id',
        candidates.map((c) => c.user_id),
      );
    if (shiftErr || !shiftRows) return;
    const nowMs = Date.now();
    const onShiftIds = new Set(
      shiftRows.filter((r) => isShiftActiveAndFresh(r, nowMs)).map((r) => r.agent_id),
    );
    const onShiftAgentIds = candidates
      .filter((c) => onShiftIds.has(c.user_id))
      .map((c) => c.user_id);
    if (onShiftAgentIds.length === 0) return;

    const { data: subs, error: subsErr } = await admin
      .from('push_subscriptions')
      .select('user_id')
      .in('user_id', onShiftAgentIds)
      .is('revoked_at', null);
    if (subsErr || !subs) return;
    const targetIds = new Set(subs.map((s) => s.user_id));
    if (targetIds.size === 0) return;

    await Promise.all(
      Array.from(targetIds).map((userId) =>
        sendPushToUser(userId, {
          title: 'KALFA — מוקד שירות',
          body: 'שיחה נכנסת ממתינה במוקד',
          url: `/admin?call=${input.consoleCallId}`,
          tag: `console-call-${input.consoleCallId}`,
        }).catch(() => {
          // Best-effort per agent — matches notifyRoutableAgentsOfInboundCall.
        }),
      ),
    );
  } catch {
    // Best-effort overall — same discipline as notifyRoutableAgentsOfInboundCall.
  }
}

/**
 * Replaces the "שיחה נכנסת ממתינה במוקד" push once the call is over, so the
 * alert stops claiming a call is waiting that hung up minutes ago.
 *
 * Reported live 14.8: notifications piled up on the agent's device, one per
 * unanswered inbound call, each still saying a call was waiting. Nothing ever
 * closed them — `public/sw.js` only closes a notification on `notificationclick`,
 * so an untapped one persists until the OS or the user removes it, and iOS
 * (this account's endpoint is web.push.apple.com) keeps them indefinitely.
 *
 * This REPLACES rather than closes, deliberately. A push on the open web must
 * result in a shown notification — `userVisibleOnly` is mandatory and a handler
 * that shows nothing gets the browser's own "site updated in the background"
 * notice instead, which would be a worse lie than the one being fixed. Reusing
 * the same `tag` swaps the displayed notification in place, and because sw.js
 * leaves `renotify` false unless asked, the swap is silent — no second buzz for
 * a call that is already over.
 *
 * The audience comes from `push_delivery_log`, which already records the
 * `user_id` and the payload `tag` of every successful send. That matters: it
 * targets exactly the agents who received the original. Re-deriving the
 * routable set here instead would push a "call ended" notification to agents
 * who never saw a "call waiting" one — inventing an alert out of nothing rather
 * than correcting one.
 */
export async function notifyAgentsInboundCallResolved(input: {
  consoleCallId: string;
  reason?: string | null;
}): Promise<void> {
  try {
    const tag = `console-call-${input.consoleCallId}`;
    const admin = createAdminClient();

    const { data: delivered, error } = await admin
      .from('push_delivery_log')
      .select('user_id')
      .eq('payload->>tag', tag)
      .eq('success', true);
    if (error || !delivered || delivered.length === 0) return;

    const userIds = Array.from(
      new Set(delivered.map((d) => d.user_id).filter((id): id is string => Boolean(id))),
    );
    if (userIds.length === 0) return;

    // WHICH call this was, not just that one ended. A missed call is the whole
    // reason an agent would look at their phone again, and until 17.8 this said
    // "שיחה נכנסת לא נענתה" with no number and arrived SILENTLY — engineered to be
    // unnoticeable, which is exactly how calls were being lost ("פספסתי שיחה
    // מלקוח").
    //
    // The FULL number, not display_hint's masked form, and for the same reason the
    // ring screen shows it: this goes to the one agent who has to call this person
    // back, and half a number cannot be dialled. It reaches nobody else — the
    // recipient list below is exactly the agents this call was already pushed to.
    // A caller who withheld their number simply has none to show.
    const { data: pii } = await admin
      .from('console_call_pii')
      .select('phone_e164')
      .eq('call_id', input.consoleCallId)
      .maybeSingle();
    const phone = pii?.phone_e164 ?? null;

    // Answered or not, decided by the row rather than the reason — the same
    // discriminator recordMissedCallCallback uses, for the same reason: a
    // 'caller_hangup' can be either a five-second abandon or the end of a long
    // conversation.
    const { data: row } = await admin
      .from('console_calls')
      .select('answered_at')
      .eq('id', input.consoleCallId)
      .maybeSingle();
    const missed = row ? row.answered_at === null : input.reason === 'no_agent';

    const body = missed
      ? phone
        ? `שיחה שלא נענתה מ־${phone}. נרשמה בקשה לחזור אל המתקשר.`
        : 'שיחה נכנסת לא נענתה (מספר חסוי).'
      : 'השיחה הנכנסת הסתיימה.';

    await Promise.all(
      userIds.map((userId) =>
        sendPushToUser(userId, {
          title: missed ? 'KALFA — שיחה שלא נענתה' : 'KALFA — מוקד שירות',
          body,
          // Straight to the callback queue for a missed call: the follow-up this
          // notification is about is a row there, and "/admin" would leave the
          // agent to find it. An answered call has nothing to action, so it keeps
          // pointing at the call itself.
          url: missed ? '/admin/callbacks' : `/admin?call=${input.consoleCallId}`,
          tag,
          // Silent ONLY when there is nothing to do. This function exists to stop
          // re-buzzing an agent about a call that is over — true for an answered
          // one, and the opposite of what a MISSED call needs. A silent missed-call
          // alert is a missed-call alert nobody sees, which is how this was lost:
          // it corrected the "call waiting" banner and said nothing audible in its
          // place.
          silent: !missed,
        }).catch(() => {
          // Best-effort per agent — same discipline as the two notify
          // functions above: one dead subscription must not stop the others.
        }),
      ),
    );
  } catch {
    // Best-effort overall. A stale notification is a real annoyance but never
    // a reason to fail the scenario's end-of-call report, which also closes
    // the call row and creates the callback.
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Inbound caller identification — best-effort enrichment (never a gate: the
// call is answered/refused purely on the caps above, independent of whether
// the caller is recognized).
// ─────────────────────────────────────────────────────────────────────────

export interface IdentifiedCaller {
  eventId: string;
  guestId: string;
  contactId: string;
  /**
   * The guest's own name, for the ringing agent to see before they answer.
   *
   * Read from the guests row this function ALREADY fetches, so it costs no extra
   * round trip — it was simply never selected. Nullable because `full_name` is,
   * and a caller identified without a usable name should fall back to their
   * number rather than to a placeholder that looks like an identification.
   */
  guestName: string | null;
}

export async function identifyInboundCaller(normalizedCli: string): Promise<IdentifiedCaller | null> {
  const admin = createAdminClient();
  // A phone can back contacts under several events; most-recent first is the
  // best available heuristic with no stronger signal (the CLI alone cannot
  // disambiguate which event the caller means).
  const { data: contacts } = await admin
    .from('contacts')
    .select('id, event_id')
    .eq('normalized_phone', normalizedCli)
    .order('created_at', { ascending: false })
    .limit(5);

  // Collect every match instead of returning the first, so the rule below has
  // something to choose between. Same worst-case query count as the previous
  // early-return loop (both are bounded by the 5 contacts above) and identical
  // in the common single-contact case.
  const matches: IdentifiedCaller[] = [];
  for (const c of contacts ?? []) {
    const { data: guest } = await admin
      .from('guests')
      .select('id, full_name')
      .eq('event_id', c.event_id)
      .eq('contact_id', c.id)
      .limit(1)
      .maybeSingle();
    if (guest) {
      matches.push({
        eventId: c.event_id,
        guestId: guest.id,
        contactId: c.id,
        guestName: guest.full_name?.trim() || null,
      });
    }
  }
  if (matches.length === 0) return null;

  // Prefer the record that actually names the person.
  //
  // This used to return the first match outright, which meant "whichever event
  // this phone was most recently imported into" decided the name — and one real
  // number here demonstrates why that is not good enough: it backs a guest called
  // "מבורך קלפה" in one event and "Netanel" in another, and recency picked the
  // bare first token. The agent's phone rang showing a partial name (owner
  // report, 17.8: "נדרש להציג שם מלא של הלקוח").
  //
  // Ranked, most decisive first: a name with more than one token beats a
  // single-token name, which beats no name at all. Recency breaks every tie,
  // because `contacts` is already ordered by it and Array.sort is stable — so
  // this only ever reorders records the old rule had no reason to prefer between.
  //
  // Note this also decides the EVENT the call is attributed to, not just the
  // label. That is not a side effect to apologise for: between two records of the
  // same human, the one carrying their full name is the better-maintained row,
  // and the previous rule was choosing arbitrarily on a signal (import order)
  // that means nothing to the person calling.
  const rank = (m: IdentifiedCaller): number => {
    if (!m.guestName) return 2;
    return /\s/.test(m.guestName) ? 0 : 1;
  };
  return [...matches].sort((a, b) => rank(a) - rank(b))[0];
}

/** "05x-xxx1234"-style masked hint. Never the full E.164 — that lives only
 * in console_call_pii. */
export function maskPhoneForDisplay(e164: string): string {
  const digits = e164.replace(/\D/g, '');
  if (digits.length < 6) return '••••';
  const head = digits.slice(0, 3);
  const tail = digits.slice(-4);
  return `${head}-${'x'.repeat(Math.max(0, digits.length - 7))}${tail}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Consent-matrix audit log (decide-consent §2's "לוג חובה" column) — direct
// service-role activity_log insert, same shape as recordRsvpFromWhatsapp.
// Non-PII: identifiers and a purpose code only, never a phone or name.
// Doubles as the durable source for countRecentCallbackDialAttempts above.
// ─────────────────────────────────────────────────────────────────────────

export const CONSOLE_DIAL_AUDIT_ACTION = 'console_call.dial_intent';

/**
 * Turn "נחזור אליכם בהקדם" into an actual callback row.
 *
 * ConsoleInbound already SAYS this — NO_AGENT_LINE_HE plays whenever the ring
 * order is exhausted — but until now nothing recorded the promise, so it was
 * the same class of false assurance as save_rsvp's "queued". This closes it.
 *
 * Hour-agnostic on purpose: the ring exhausts at 03:00 because nobody is
 * awake, and at 14:00 because everyone is busy. Both deserve a callback.
 *
 * Idempotent per call: a second 'no_agent' report for the same console call
 * (retry, duplicate delivery) must not create a second row, so an existing
 * open request for the same phone created for this call is left alone.
 * Best-effort like the rest of this module — a lost write degrades the
 * follow-up, never the live call.
 */
/**
 * Was this inbound call ever picked up by a human?
 *
 * `answered_at` is the honest signal and `agent_id` alone is not: an outbound call
 * carries agent_id from creation (dial-intent's caller), so it says who OWNS the
 * call, not that anyone spoke. answered_at is written in exactly one place — the
 * event route's 'connected' branch, when the serial ring finds a winner.
 *
 * Errors resolve to "answered", i.e. NOT missed. That direction is deliberate: a
 * failed read must not manufacture a callback promise to a caller who already got
 * through, which would put a real person on a call-back list for a conversation
 * they already had.
 */
async function inboundCallWentUnanswered(consoleCallId: string): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('console_calls')
      .select('answered_at, direction')
      .eq('id', consoleCallId)
      .maybeSingle();
    if (error || !data) return false;
    return data.direction === 'inbound' && data.answered_at === null;
  } catch {
    return false;
  }
}

/**
 * Records the follow-up for a call nobody answered, and is the thing that makes
 * "נחזור אליכם בהקדם" true.
 *
 * Fires for ANY inbound call that ended without ever being answered, not only for a
 * ring that ran out of agents (owner decision, 17.8). A caller who gives up after
 * five seconds of ringing wanted something from this business and did not get it —
 * commercially identical to the ring exhausting, and previously invisible: that path
 * recorded nothing and told the agent only "השיחה הנכנסת הסתיימה".
 *
 * Worth stating plainly, because it is the one asymmetry: in the abandoned case we
 * never PROMISED a callback. The scenario only speaks NO_AGENT_LINE_HE when the ring
 * exhausts, and a caller who hung up first heard nothing. So this is a promise the
 * business is making to itself about following up — not one the caller was given.
 */
/**
 * How far back an OPEN callback suppresses a new one for the same number.
 *
 * The dedupe itself is right — somebody who calls three times in five minutes
 * because nobody is picking up needs one follow-up, not three. What was wrong was
 * that it had no time bound at all, so ANY open request blocked that number forever.
 *
 * Measured 17.8, which is how this surfaced: 14 requests sat in status 'new' from
 * 13.8, none ever worked, and every one of them was silently suppressing every
 * future missed call from its caller. A real unanswered call at 19:42 that evening
 * recorded nothing at all, for exactly that reason.
 *
 * Six hours is "the same episode of trying to reach us". Someone calling again the
 * next day is not retrying — they are asking again, and a queue that cannot say so
 * is worse than one with two rows in it. Deliberately shorter than a working day so
 * a morning call and an afternoon call are never collapsed into one.
 */
const CALLBACK_DEDUPE_WINDOW_MS = 6 * 60 * 60 * 1000;

export async function recordMissedCallCallback(input: {
  consoleCallId: string;
  callerName?: string | null;
}): Promise<void> {
  try {
    if (!(await inboundCallWentUnanswered(input.consoleCallId))) return;
    const admin = createAdminClient();

    // The caller's number lives only in the server-only PII side table — it
    // never travels in the scenario's event payload, so read it here.
    const { data: pii } = await admin
      .from('console_call_pii')
      .select('phone_e164')
      .eq('call_id', input.consoleCallId)
      .maybeSingle();
    const phoneE164 = pii?.phone_e164 ?? null;
    if (!phoneE164) return; // withheld/unnormalizable CLI — nothing to call back

    // Bounded — see CALLBACK_DEDUPE_WINDOW_MS. An open request older than the window
    // no longer suppresses a fresh call, because at that age it is a backlog item
    // rather than the follow-up for THIS attempt to reach us.
    const { data: existing } = await admin
      .from('callback_requests')
      .select('id')
      .eq('phone', phoneE164)
      .in('status', ['new', 'in_progress'])
      .gte('created_at', new Date(Date.now() - CALLBACK_DEDUPE_WINDOW_MS).toISOString())
      .limit(1)
      .maybeSingle();
    if (existing) return;

    await admin.from('callback_requests').insert({
      full_name: input.callerName?.trim() || 'מתקשר לא מזוהה',
      phone: phoneE164,
      topic: 'שיחה נכנסת ללא נציג זמין',
      // requested_at NULL = "no stated time" — the scheduler resolves ASAP
      // against the clock when it actually runs (inquiries.ts precedent).
      requested_at: null,
      requested_rank: 'earliest',
      note: `נוצר אוטומטית משיחה נכנסת ${input.consoleCallId}`,
    });
  } catch {
    // Best-effort — the console_calls row already records the missed call.
  }
}

/**
 * The INTENT-TIME no-agent fallback for call-me-now (owner availability-first
 * decision, 12.8) — the COMMON no-agent case now, since /api/call-me-now/verify
 * checks findRoutableAgentVoxUsernames() BEFORE placing any outbound leg (see
 * this section's own "AVAILABILITY, NOT THE CLOCK" header above). Ring
 * exhaustion (recordMissedCallCallback, above) is the narrow race that survives
 * this — an agent was routable at intent, gone by the time the scenario
 * actually rings.
 *
 * Deliberately the SAME insert shape as recordMissedCallCallback — full_name/
 * topic text differ (there is no consoleCallId to reference; no leg was ever
 * placed), but the table, the idempotency check, and every column this row
 * needs later are identical, so resolveDialTarget({kind:'callback', id})
 * handles a row from EITHER function identically. No special bypass lane for
 * a call-me-now-originated request.
 *
 * NEVER call this from anywhere that reacts to "an agent just became
 * available" — see this section's own HARD CONSTRAINT header above. This
 * function's only two legitimate callers are: /api/call-me-now/verify (no
 * agent routable at intent time) and, in principle, nothing else. A row it
 * writes is picked up ONLY when a human agent chooses to dial it from the
 * panel, through every existing callback gate — never automatically.
 *
 * Idempotent per phone (same check as recordMissedCallCallback): an existing
 * open request for this number is left alone rather than duplicated. Best-
 * effort — a lost write here degrades the follow-up, never the (already
 * decided) "no agent" response to the visitor.
 */
export async function offerCallbackForCallMeNow(phone: string): Promise<void> {
  try {
    const admin = createAdminClient();

    const { data: existing } = await admin
      .from('callback_requests')
      .select('id')
      .eq('phone', phone)
      .in('status', ['new', 'in_progress'])
      // Same bound, same reason as recordMissedCallCallback's — an unworked request
      // from days ago must not silently swallow a fresh request for help.
      .gte('created_at', new Date(Date.now() - CALLBACK_DEDUPE_WINDOW_MS).toISOString())
      .limit(1)
      .maybeSingle();
    if (existing) return;

    await admin.from('callback_requests').insert({
      full_name: 'מבקש/ת "התקשרו אליי עכשיו"',
      phone,
      topic: 'בקשת "התקשרו אליי עכשיו" — לא נמצא נציג זמין',
      // requested_at NULL = "no stated time", same convention as
      // recordMissedCallCallback — the scheduler resolves ASAP against the
      // clock when it actually runs.
      requested_at: null,
      requested_rank: 'earliest',
      note: 'נוצר אוטומטית מבקשת "התקשרו אליי עכשיו" (capability A, 12.8) — לא נמצא נציג זמין בזמן הבקשה',
    });
  } catch {
    // Best-effort — see header.
  }
}

export async function recordConsoleDialAudit(input: {
  agentId: string;
  consoleCallId: string;
  target: DialTargetInput;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const meta: Record<string, unknown> = {
      console_call_id: input.consoleCallId,
      agent_id: input.agentId,
      kind: input.target.kind,
    };
    let eventId: string | null = null;
    if (input.target.kind === 'callback') {
      meta.callback_request_id = input.target.id;
    } else {
      meta.event_id = input.target.eventId;
      meta.contact_id = input.target.contactId;
      eventId = input.target.eventId;
    }
    await admin.from('activity_log').insert({
      event_id: eventId,
      user_id: input.agentId,
      action: CONSOLE_DIAL_AUDIT_ACTION,
      meta: meta as Database['public']['Tables']['activity_log']['Insert']['meta'],
    });
  } catch {
    // Best-effort — see module header. The console_calls row itself remains
    // the primary durable record even if this write is lost.
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Wake-and-answer late-ring-arrival retry (call-center research, 12.8). The
// SCENARIO computes ring_order ONCE, before Call.answer() — ConsoleInbound.
// voxengine.js just walks that static array (see ringNext). An agent who
// connects via the wake push AFTER the original ring was computed is
// architecturally invisible to the in-progress call no matter how fast they
// arrive, unless something re-checks for newly-routable agents. The retry
// endpoint (route-inbound-retry/route.ts) is that re-check; this is its
// audit trail — same non-PII, best-effort shape as
// recordConsoleDialAudit/recordConsoleTransferAudit above (identifiers + a
// count only, never a phone or name).
// ─────────────────────────────────────────────────────────────────────────

export const CONSOLE_WAKE_RETRY_AUDIT_ACTION = 'console_call.wake_retry';

export async function recordConsoleWakeRetryAudit(input: {
  consoleCallId: string;
  foundCount: number;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from('activity_log').insert({
      event_id: null,
      user_id: null,
      action: CONSOLE_WAKE_RETRY_AUDIT_ACTION,
      meta: {
        console_call_id: input.consoleCallId,
        found_count: input.foundCount,
      } as Database['public']['Tables']['activity_log']['Insert']['meta'],
    });
  } catch {
    // Best-effort — see module header's audit-write precedent throughout
    // this file. A lost audit write never blocks or delays the live call.
  }
}
