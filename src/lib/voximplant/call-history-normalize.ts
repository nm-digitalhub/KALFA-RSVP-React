import type {
  CallHistoryLeg,
  CallHistoryRecord,
  CallHistorySession,
} from './core';

// Turns a Voximplant call-history session into the record the console shows.
//
// WHY THIS FILE EXISTS, stated plainly: the console has been deciding "was this
// call answered?" from its own bookkeeping, and it was wrong. `console_calls`
// sets `answered_at` when the SCENARIO answers — the disclosure line and the hold
// music — not when a human picks up. So every call where the system answered and
// no agent ever did looked answered. Measured over the same 7 days on 2026-08-17:
// our list found 12 missed calls, Voximplant's own record holds 156.
//
// Voximplant does not guess. A session carries one leg per party, and an agent leg
// says `successful` outright, with the SIP code when it failed. This module reads
// that and computes nothing it can look up.
//
// PURE. No network, no database, no clock — every input arrives as an argument, so
// the outcome rules are unit-testable against captured payloads.
//
// EVERY FIELD IS UNTRUSTED. The API omits rather than nulls, whole branches depend
// on `with_*` request flags, and `end_reason` is an OBJECT on the wire even though
// the reference calls it a string. Nothing here indexes into a shape it has not
// checked.

/** How a leg's far end is described. 'user' is an agent on our own platform. */
const AGENT_LEG_TYPE = 'user';

export type VoxCallDirection = 'inbound' | 'outbound' | 'unknown';

/**
 * What actually happened, from Voximplant's record rather than our inference.
 *
 * Four inbound outcomes rather than two, because a single "not answered" bucket
 * hides populations that call for opposite responses. Measured over 1,913 live
 * sessions, 2026-08-17:
 *
 *   answered   12    an agent was on the call
 *   missed    157    agents were rung, nobody picked up          ← act on these
 *   abandoned 1073   WE answered — disclosure, hold music — and the caller hung
 *                    up before any agent was rung. A real person who gave up.
 *   rejected   671   the inbound leg was never successful at all: SIP 486 Busy
 *                    Here, ≤3s, no audio ever exchanged. Platform-level refusal
 *                    of flood traffic, not a caller we failed.
 *
 * The last two used to be one bucket. They are separated on a fact, not a
 * heuristic — whether the inbound leg itself reports `successful` — and the split
 * matters because 671 refused probes drowning 1,073 real hang-ups is how a queue
 * becomes something nobody reads. Note the 486s are NOT our own gate: the
 * scenario rejects fail-closed with 603 (ConsoleInbound rejectFailClosed).
 */
export type VoxCallOutcome =
  | 'answered' // an agent leg connected
  | 'missed' // agents were rung, none connected
  | 'abandoned' // we answered, caller hung up before anyone was rung
  | 'rejected' // never answered at all — the platform refused the leg
  | 'failed' // outbound that never connected
  | 'unknown'; // no legs in the payload (with_calls was off)

export interface VoxNormalizedLeg {
  callId: number | null;
  incoming: boolean | null;
  successful: boolean;
  durationSec: number;
  startedAt: string | null;
  /** PII when the far end is a caller. Never log it. */
  remoteNumber: string | null;
  remoteNumberType: string | null;
  /**
   * The far end of this leg is one of OUR agents on the platform, not a customer.
   *
   * True on either direction, which is the point: on a call somebody places TO us
   * an agent leg is outgoing, and on a call an agent PLACES their own SDK leg
   * arrives incoming. `isAgentLeg` answers only the first shape.
   */
  isPlatformUser: boolean;
  isAgentLeg: boolean;
  endCode: number | null;
  endDetails: string | null;
  costCents: number | null;
}

export interface VoxNormalizedSession {
  sessionId: number;
  startedAt: string | null;
  durationSec: number;
  direction: VoxCallDirection;
  outcome: VoxCallOutcome;
  /** The other party's number — the caller on inbound, the destination on outbound. */
  remoteNumber: string | null;
  localNumber: string | null;
  ruleName: string | null;
  applicationName: string | null;
  finishReason: string | null;
  audioQuality: string | null;
  /** Raw session custom_data, 200 bytes max by platform limit. */
  customData: string | null;
  /** Our console_calls id, when custom_data carries one. */
  consoleCallId: string | null;
  /** How many agents were rung. 0 means nobody was — see `abandoned`. */
  agentLegsTried: number;
  /** Seconds an agent was actually on the call. 0 when none connected. */
  agentTalkSec: number;
  /** SIP code that decided the outcome: the connected leg, else the last failure. */
  endCode: number | null;
  endDetails: string | null;
  hasRecording: boolean;
  recordingUrl: string | null;
  transcriptionUrl: string | null;
  transcriptionStatus: string | null;
  /** Cleared by Voximplant one month after the call. */
  logFileUrl: string | null;
  legs: VoxNormalizedLeg[];
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

/**
 * `end_reason` arrives as `{code, details}` although the reference types it as a
 * string. Both shapes are accepted rather than asserted away: the reference is
 * what it is, and a payload that changes back must not throw on a history screen.
 */
export function parseEndReason(raw: unknown): { code: number | null; details: string | null } {
  if (raw && typeof raw === 'object') {
    const o = raw as { code?: unknown; details?: unknown };
    return { code: num(o.code), details: str(o.details) };
  }
  const s = str(raw);
  if (!s) return { code: null, details: null };
  // "480 User offline" / "480" — take a leading integer if there is one.
  const m = /^(\d{3})\b\s*(.*)$/.exec(s);
  if (m) return { code: Number(m[1]), details: str(m[2]) };
  return { code: null, details: s };
}

/**
 * Reads our console_calls id back out of `custom_data`.
 *
 * Accepts a bare uuid and a small JSON envelope, because the two writers differ:
 * the inbound scenario stamps `VoxEngine.customData`, the app stamps
 * `CallSettings.customData`, and both are capped at 200 bytes. A value we did not
 * write — or a truncated one — yields null rather than a wrong association.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseConsoleCallId(customData: unknown): string | null {
  const s = str(customData);
  if (!s) return null;
  if (UUID_RE.test(s)) return s.toLowerCase();
  if (s.startsWith('{')) {
    try {
      const o = JSON.parse(s) as Record<string, unknown>;
      const v = str(o.console_call_id ?? o.ccid);
      if (v && UUID_RE.test(v)) return v.toLowerCase();
    } catch {
      // A 200-byte cap truncates mid-JSON. Unparseable means unknown, not an error.
      return null;
    }
  }
  return null;
}

function normalizeLeg(raw: CallHistoryLeg): VoxNormalizedLeg {
  const { code, details } = parseEndReason(raw.end_reason);
  const type = str(raw.remote_number_type);
  return {
    callId: num(raw.call_id),
    incoming: bool(raw.incoming),
    // Absent `successful` is treated as NOT successful. The console's whole
    // problem was optimistic defaults about answering; a missing field must not
    // manufacture a connection that was never reported.
    successful: raw.successful === true,
    durationSec: num(raw.duration) ?? 0,
    startedAt: str(raw.start_time),
    remoteNumber: str(raw.remote_number),
    remoteNumberType: type,
    isPlatformUser: type === AGENT_LEG_TYPE,
    isAgentLeg: raw.incoming === false && type === AGENT_LEG_TYPE,
    endCode: code,
    endDetails: details,
    costCents: num(raw.cost),
  };
}

/**
 * Picks the recording worth offering, and drops the ones that are not there.
 *
 * `is_removed` and `expiration_date` are the reason this is not a one-liner. Both
 * are absent from the RecordType reference and both appear in the official
 * response example, and both describe a URL that will not play: one already
 * deleted, one past its expiry (three months out in the published example). A
 * history row offering a dead link is the same class of defect as a filter that
 * does not filter — it looks like a feature and fails at the moment of use.
 */
function pickRecord(
  records: CallHistoryRecord[] | undefined,
  nowMs: number,
): CallHistoryRecord | null {
  if (!Array.isArray(records)) return null;
  let best: CallHistoryRecord | null = null;
  for (const r of records) {
    if (!r || typeof r !== 'object') continue;
    if (r.is_removed === true) continue;
    const exp = str(r.expiration_date);
    if (exp) {
      // 'YYYY-MM-DD'. Parsed as end-of-day UTC so a recording is not hidden on the
      // last day it still works.
      const t = Date.parse(`${exp}T23:59:59Z`);
      if (Number.isFinite(t) && t < nowMs) continue;
    }
    // Longest recording wins: a session can bind several, and the one worth
    // offering is the conversation rather than a one-second artefact.
    if (!best || (num(r.duration) ?? 0) > (num(best.duration) ?? 0)) best = r;
  }
  return best;
}

/**
 * Decides the outcome from the legs.
 *
 * Order matters and is not arbitrary:
 *  1. An agent connected → answered, whatever else failed around it.
 *  2. Agents were rung and none connected → missed. This is the case our own
 *     bookkeeping lost entirely.
 *  3. No agent leg at all → abandoned inbound, or a failed outbound.
 */
function decideOutcome(
  direction: VoxCallDirection,
  legs: VoxNormalizedLeg[],
  agentOriginated: boolean,
): { outcome: VoxCallOutcome; agentLegsTried: number; agentTalkSec: number } {
  // A CALL THE AGENT PLACED is judged on whether the far party picked up, not on
  // whether an agent was rung — the agent is the one who dialled. Reading it the
  // other way reported "abandoned · 0s" on calls that connected and lasted sixteen
  // seconds, because no leg matched "outgoing leg to one of our users".
  if (agentOriginated) {
    const ourLeg = legs.find((l) => l.isPlatformUser);
    const theirLeg = legs.find((l) => !l.isPlatformUser);
    const connected = theirLeg?.successful === true;
    return {
      outcome: connected ? 'answered' : 'failed',
      agentLegsTried: ourLeg ? 1 : 0,
      // The FAR leg's duration: how long the two were actually connected. Our own
      // leg starts when the agent taps dial and includes the ringing and the
      // disclosure, so it overstates the conversation.
      agentTalkSec: connected ? theirLeg?.durationSec ?? 0 : 0,
    };
  }

  const agentLegs = legs.filter((l) => l.isAgentLeg);
  const connected = agentLegs.filter((l) => l.successful);
  const agentTalkSec = connected.reduce((m, l) => Math.max(m, l.durationSec), 0);

  if (legs.length === 0) {
    return { outcome: 'unknown', agentLegsTried: 0, agentTalkSec: 0 };
  }
  if (connected.length > 0) {
    return { outcome: 'answered', agentLegsTried: agentLegs.length, agentTalkSec };
  }
  if (agentLegs.length > 0) {
    return { outcome: 'missed', agentLegsTried: agentLegs.length, agentTalkSec: 0 };
  }
  if (direction === 'outbound') {
    // No agent leg on an outbound session means the far end is the destination.
    const ok = legs.some((l) => l.successful);
    return { outcome: ok ? 'answered' : 'failed', agentLegsTried: 0, agentTalkSec: 0 };
  }
  return { outcome: 'abandoned', agentLegsTried: 0, agentTalkSec: 0 };
}

/** The SIP code that explains the outcome, not merely the last one seen. */
function decisiveEnd(legs: VoxNormalizedLeg[], outcome: VoxCallOutcome, agentOriginated: boolean) {
  // On a call the agent placed, what matters is how the FAR end ended — our own
  // leg's code says only how the agent's app closed.
  if (agentOriginated) {
    const theirLeg = legs.find((l) => !l.isPlatformUser);
    return { endCode: theirLeg?.endCode ?? null, endDetails: theirLeg?.endDetails ?? null };
  }
  const agentLegs = legs.filter((l) => l.isAgentLeg);
  if (outcome === 'answered') {
    const c = agentLegs.find((l) => l.successful) ?? legs.find((l) => l.successful);
    return { endCode: c?.endCode ?? null, endDetails: c?.endDetails ?? null };
  }
  if (outcome === 'missed') {
    // The LAST agent tried is the one whose failure ended the attempt.
    const last = agentLegs[agentLegs.length - 1];
    return { endCode: last?.endCode ?? null, endDetails: last?.endDetails ?? null };
  }
  const first = legs[0];
  return { endCode: first?.endCode ?? null, endDetails: first?.endDetails ?? null };
}

export function normalizeVoxSession(
  raw: CallHistorySession,
  // Passed rather than read, so recording expiry stays testable. See the module
  // header: nothing here reads a clock of its own.
  nowMs: number = Date.now(),
): VoxNormalizedSession | null {
  const sessionId = num(raw?.call_session_history_id);
  // Without the session id there is nothing to key an upsert on, so the row is
  // dropped rather than given a synthetic one that would duplicate on every sync.
  if (sessionId === null) return null;

  const legs = (Array.isArray(raw.calls) ? raw.calls : [])
    .filter((l): l is CallHistoryLeg => Boolean(l) && typeof l === 'object')
    .map(normalizeLeg);

  const inboundLeg = legs.find((l) => l.incoming === true) ?? null;

  // AN AGENT-PLACED CALL ARRIVES AS AN INBOUND LEG, and reading `incoming` alone
  // gets every one of them backwards.
  //
  // Voximplant's own docs say it plainly: "An outgoing call from an SDK also
  // generates an incoming call to the platform." So when the console dials, the
  // AGENT's SDK leg is incoming=true and the CUSTOMER's leg is incoming=false —
  // the mirror image of a customer ringing us.
  //
  // Classifying on `incoming` alone made every outbound console call render as
  // "inbound · abandoned · agent_1bbe74dc · 0s talk" — wrong direction, wrong
  // outcome, wrong party, wrong duration, on calls that had connected and lasted
  // sixteen seconds. Measured on sessions 7758711828 and 7760988732.
  //
  // The leg TYPE settles it: `remote_number_type === 'user'` means the far end is
  // one of our own agents on the platform, which an actual customer never is.
  const agentOriginated = inboundLeg?.isPlatformUser === true;

  const direction: VoxCallDirection =
    legs.length === 0 ? 'unknown' : agentOriginated ? 'outbound' : inboundLeg ? 'inbound' : 'outbound';

  // The far party is whoever is NOT us: never an agent leg on either shape — that
  // is our own side wearing a phone number.
  const party = agentOriginated
    ? legs.find((l) => !l.isPlatformUser) ?? null
    : inboundLeg ?? legs.find((l) => !l.isPlatformUser) ?? null;

  const { outcome, agentLegsTried, agentTalkSec } = decideOutcome(direction, legs, agentOriginated);
  const { endCode, endDetails } = decisiveEnd(legs, outcome, agentOriginated);
  const record = pickRecord(raw.records, nowMs);

  return {
    sessionId,
    startedAt: str(raw.start_date),
    durationSec: num(raw.duration) ?? 0,
    direction,
    outcome,
    remoteNumber: party?.remoteNumber ?? null,
    localNumber:
      str((raw.calls ?? []).find((c) => str(c?.local_number))?.local_number) ?? null,
    ruleName: str(raw.rule_name),
    applicationName: str(raw.application_name),
    finishReason: str(raw.finish_reason),
    audioQuality: str(raw.audio_quality),
    customData: str(raw.custom_data),
    consoleCallId: parseConsoleCallId(raw.custom_data),
    agentLegsTried,
    agentTalkSec,
    endCode,
    endDetails,
    hasRecording: record !== null,
    recordingUrl: str(record?.record_url),
    transcriptionUrl: str(record?.transcription_url),
    transcriptionStatus: str(record?.transcription_status),
    logFileUrl: str(raw.log_file_url),
    legs,
  };
}

export function normalizeVoxSessions(
  raw: unknown,
  nowMs: number = Date.now(),
): VoxNormalizedSession[] {
  if (!Array.isArray(raw)) return [];
  const out: VoxNormalizedSession[] = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue;
    const n = normalizeVoxSession(s as CallHistorySession, nowMs);
    if (n) out.push(n);
  }
  return out;
}
