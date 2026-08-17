import 'server-only';

import { normalizeVoxSessions, type VoxNormalizedSession } from '@/lib/voximplant/call-history-normalize';
import { getCallHistory, VoximplantApiError } from '@/lib/voximplant/core';
import { getVoximplantConfig } from '@/lib/data/voximplant-config';
import { normalizePhone } from '@/lib/phone';
import { createAdminClient } from '@/lib/supabase/admin';

// The call log, read straight from Voximplant.
//
// Voximplant is the record of what happened on a call; this queries it and returns
// the answer. There is no mirror table and no sync job, because a filtered query is
// fast enough to serve a screen — measured against the live account 2026-08-17:
// one hour 460ms, one day 258ms, seven days with a duration filter 367ms.
//
// It replaces reading `console_calls`, which held our own inference and got it
// wrong: `answered_at` is set when the SCENARIO answers — the disclosure line, the
// hold music — so every call the system picked up and no agent ever did counted as
// answered. Over the same week that made 12 missed calls out of 157.
//
// Two known costs, stated rather than hidden:
//  * The API has no outcome filter (no `successful` parameter), so 'missed' is
//    computed here from the legs and needs the window fetched to be accurate.
//  * `offset` caps at 10000 and `count` at 1000 per the reference, so a very wide
//    window is bounded by PAGE_CAP below and says so in `truncated`.

/** Per the reference: max 1000. 100 keeps each round trip small and cache-friendly. */
const PAGE_SIZE = 100;

/**
 * Hard bound on paging.
 *
 * 20, not 10, and the difference was measured rather than guessed: at 10 the query
 * "answered calls this week" scanned 1,000 sessions, found 9 of the 12 that exist
 * and returned `truncated: true`. A week held 1,913 sessions in the busiest
 * measurement, so 20 pages covers one whole — and the outcome filters are exactly
 * the ones that must scan deep, because the API has no `successful` parameter to
 * narrow with server-side.
 *
 * Beyond that it truncates rather than paging indefinitely, and the caller is TOLD.
 * A silently short list is how a call log becomes something nobody trusts.
 */
const PAGE_CAP = 20;

/** Must be explicit: 'auto' resolves to the ACCOUNT's location, not the owner's. */
const TZ = 'Asia/Jerusalem';

/**
 * Voximplant stores and matches remote numbers WITHOUT a leading '+'.
 *
 * MEASURED against the live account, same window, 2026-08-17:
 *
 *     remote_number_list ["+972536212562"]   ->  0 rows
 *     remote_number_list  ["972536212562"]   -> 25 rows
 *
 * Exact string match, no normalisation on their side. So a canonical E.164 value
 * — which is what the rest of this system stores and dials — silently matches
 * NOTHING when used as a filter. Not an error, not an empty-ish result: a
 * confident "no such calls" for a number with 25 of them, which is precisely the
 * failure an agent cannot distinguish from the truth.
 *
 * Canonical everywhere internally, stripped only at this boundary.
 */
function toVoxNumberFilter(e164: string): string {
  return e164.startsWith('+') ? e164.slice(1) : e164;
}

/**
 * How far back a single-session lookup may look.
 *
 * Wide on purpose. The FRESHNESS RULE IS OURS, not the platform's, and it has to
 * be applied to a session we actually found — otherwise the two failures collapse.
 * Measured: asking for a valid session id outside the requested from/to window
 * does NOT return an empty result, it raises code 150, the same code an unknown id
 * raises. So querying inside the freshness bound made "too old" indistinguishable
 * from "no such call", and the agent was told the wrong thing about a call they
 * were looking at.
 */
const SESSION_LOOKUP_DAYS = 365;

export interface VoxHistoryQuery {
  /**
   * Lookback in days. A convenience only — `from`/`to` win when supplied.
   *
   * It used to be the ONLY time control the app could express, which reduced a
   * date range to three preset drawers. The API takes 'YYYY-MM-DD HH:mm:ss' on
   * both ends and always did.
   */
  days?: number;
  /** Explicit window start. Epoch ms, converted to Asia/Jerusalem clock time. */
  from?: number;
  /** Explicit window end. */
  to?: number;
  direction?: 'inbound' | 'outbound';
  outcome?: 'answered' | 'missed';
  /** Server-side on Voximplant, unlike outcome. */
  minDurationSec?: number;
  maxDurationSec?: number;
  /**
   * A specific number, passed to Voximplant as `remote_number_list`.
   *
   * That parameter, not `remote_number`: the reference states it "has higher
   * priority", and that `remote_number` is "ignored if the remote_number_list
   * parameter is not empty" — so sending both would silently drop one.
   */
  phone?: string;
  limit?: number;
}

export interface VoxHistoryRow {
  id: string;
  inbound: boolean;
  answered: boolean;
  outcome: VoxNormalizedSession['outcome'];
  /** A CUSTOMER's name when we know the number. Never a guest's. */
  name: string | null;
  phone: string | null;
  startedAt: string | null;
  durationSec: number;
  /** Seconds an agent was actually on the call. */
  talkSec: number;
  agentLegsTried: number;
  endCode: number | null;
  endDetails: string | null;
  hasRecording: boolean;
}

export interface VoxHistoryResult {
  rows: VoxHistoryRow[];
  /** True when PAGE_CAP stopped the scan before the window ended. */
  truncated: boolean;
  scanned: number;
}

/** Voximplant wants 'YYYY-MM-DD HH:mm:ss' in the requested timezone. */
function fmtInTz(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function matches(s: VoxNormalizedSession, q: VoxHistoryQuery): boolean {
  if (q.direction && s.direction !== q.direction) return false;
  if (q.outcome === 'answered' && s.outcome !== 'answered') return false;
  // 'missed' means agents were rung and nobody picked up. Deliberately NOT the
  // whole not-answered set: 'abandoned' (the caller hung up on our hold music) and
  // 'rejected' (the platform refused the leg, never answered at all) are different
  // events, and in the measured week they numbered 1,073 and 671 against 157 real
  // misses. Folding them in is exactly how the one list worth acting on became
  // unreadable.
  if (q.outcome === 'missed' && s.outcome !== 'missed') return false;
  return true;
}

/**
 * Looks up names for the numbers on screen.
 *
 * `profiles` ONLY — the customer axis. Guests are deliberately not consulted: a
 * guest belongs to a customer's event, and reading a name off an unrelated invite
 * list is what labelled the owner's own phone "מבורך קלפה" from a brit. On a
 * business line most callers have no name here at all, and that is the correct
 * outcome rather than a gap to fill.
 */
async function namesForNumbers(phones: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = [...new Set(phones.map((p) => normalizePhone(p)).filter((p): p is string => !!p))];
  if (wanted.length === 0) return out;

  const admin = createAdminClient();
  const { data } = await admin.from('profiles').select('full_name, phone').not('phone', 'is', null);
  for (const row of data ?? []) {
    const norm = normalizePhone(row.phone);
    const name = row.full_name?.trim();
    if (norm && name && wanted.includes(norm)) out.set(norm, name);
  }
  return out;
}

/**
 * Voximplant error codes this resolver classifies on, taken from
 * `references.httpapi.errors` (457 codes, read live 2026-08-17).
 *
 * BY CODE, never by matching the message text. The first version of this matched
 * the string "parameter is invalid" and treated every platform error as "no such
 * call" — which would have reported a rate-limit, an expired token or a database
 * fault as a missing session, hiding real outages behind a wrong answer. The
 * platform publishes structured codes; there is no reason to parse prose.
 *
 * Note 429 is NOT "too many requests" here — Voximplant assigns it to "The
 * 'resource_type' parameter is invalid". HTTP intuitions do not carry over, which
 * is exactly why these are listed explicitly rather than inferred.
 */
const VOX_ERR = {
  /** 150 — "The 'call_session_history_id' parameter is invalid" */
  SESSION_ID_INVALID: 150,
  /** Our own request was malformed — a bug on this side, not a missing call. */
  BAD_REQUEST: new Set([101, 103, 104, 111, 115, 116, 123, 134, 156]),
  /** Credentials / service-account problem. Operational, not user-facing. */
  AUTH: new Set([100]),
  /** Transient. voxRetry already backs off on these; a survivor is still retryable. */
  TRANSIENT: new Set([1, 2, 4, 340, 456, 484, 515]),
} as const;

export type ReturnableCall =
  | { ok: true; phone: string; startedAt: string | null }
  | {
      ok: false;
      /**
       * Explicit, because `null` for every failure hid three different situations
       * behind one word — an unknown session, a malformed id, and a call outside
       * the window are not the same fact and an agent acts on them differently.
       */
      reason:
        | 'invalid_session_id' // not a positive integer — never reached the platform
        | 'not_found' // platform code 150: no such session
        | 'out_of_window' // valid id, but older than the freshness bound
        | 'not_inbound' // an outbound leg: not somebody who called us
        | 'withheld_number' // inbound, but no CLI to ring back
        | 'bad_request' // our query was malformed — a bug, logged not shown
        | 'auth_failed' // service-account problem
        | 'unavailable'; // transient: network, rate limit, platform fault
      code?: number;
    };

/**
 * Reads back the number to ring for ONE session, from Voximplant.
 *
 * This is the whole resolver for returning a call, and it deliberately touches no
 * table of ours. The owner put it plainly: the call log comes from Voximplant, so
 * the number is already in Voximplant's record — going to our database to find it
 * is a detour that also limits the feature to calls we happen to have a row for
 * (28 of 1,241 in the measured week).
 *
 * What the DEVICE sends is a session id, never a number, so this stays a resolver
 * and not a hole. And the checks below are made against Voximplant's own record
 * rather than against anything the caller asserted:
 *
 *   * the session must contain an INBOUND leg — an outbound leg we placed is not
 *     somebody who rang us, and returning one would turn "call back a caller" into
 *     "dial any number this account has ever reached";
 *   * the number comes off that leg, not off any agent leg, which is our own side
 *     wearing a phone number.
 *
 * Bounded to the freshness window: a call from six weeks ago is not a call being
 * returned, and GetCallHistory needs a from/to pair regardless.
 */
export async function fetchReturnableCall(
  sessionId: string,
  withinMs: number,
  nowMs: number = Date.now(),
): Promise<ReturnableCall> {
  const config = await getVoximplantConfig();
  if (!config) return { ok: false, reason: 'auth_failed' };

  const numericId = Number(sessionId);
  // Rejected before the request is made: a non-numeric id is a client bug, and
  // sending it upstream would burn a round trip to be told the same thing.
  if (!Number.isSafeInteger(numericId) || numericId <= 0) {
    return { ok: false, reason: 'invalid_session_id' };
  }

  let res;
  try {
    res = await getCallHistory(config.auth, {
      // A WIDE window, then our freshness rule applied to what came back — see
      // SESSION_LOOKUP_DAYS. Querying inside the bound made "too old" raise the
      // same code 150 as "no such session".
      from_date: fmtInTz(new Date(nowMs - SESSION_LOOKUP_DAYS * 86_400_000)),
      to_date: fmtInTz(new Date(nowMs)),
      timezone: TZ,
      call_session_history_id: numericId,
      with_calls: true,
      count: 1,
    });
  } catch (e) {
    if (e instanceof VoximplantApiError) {
      const code = e.code ?? undefined;
      if (code === VOX_ERR.SESSION_ID_INVALID) return { ok: false, reason: 'not_found', code };
      if (code !== undefined && VOX_ERR.AUTH.has(code)) return { ok: false, reason: 'auth_failed', code };
      if (code !== undefined && VOX_ERR.BAD_REQUEST.has(code)) return { ok: false, reason: 'bad_request', code };
      if (code !== undefined && VOX_ERR.TRANSIENT.has(code)) return { ok: false, reason: 'unavailable', code };
      // An unlisted code is TRANSIENT rather than "not found". 457 codes exist and
      // this resolver names nine; guessing "no such call" for the rest would turn
      // any new platform fault into a confident wrong answer.
      return { ok: false, reason: 'unavailable', code };
    }
    // Network / unparseable response — retryable by definition.
    return { ok: false, reason: 'unavailable' };
  }

  const session = normalizeVoxSessions(res.result ?? [], nowMs)[0];
  if (!session) return { ok: false, reason: 'not_found' };

  // OUR rule, applied to a session we actually found, so "too old to return from
  // here" is reported as itself rather than as "no such call".
  const startedMs = session.startedAt ? Date.parse(session.startedAt.replace(' ', 'T')) : NaN;
  if (Number.isFinite(startedMs) && nowMs - startedMs > withinMs) {
    return { ok: false, reason: 'out_of_window' };
  }
  if (session.direction !== 'inbound') return { ok: false, reason: 'not_inbound' };

  const inboundLeg = session.legs.find((l) => l.incoming === true);
  const phone = inboundLeg?.remoteNumber ? normalizePhone(inboundLeg.remoteNumber) : null;
  if (!phone) return { ok: false, reason: 'withheld_number' };

  return { ok: true, phone, startedAt: session.startedAt };
}

export async function fetchVoxCallHistory(q: VoxHistoryQuery): Promise<VoxHistoryResult> {
  const config = await getVoximplantConfig();
  if (!config) throw new Error('voximplant_not_configured');
  const auth = config.auth;

  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  // An explicit window wins over the day count. Both ends are honoured
  // independently, so "everything since 14 August" and "everything up to noon
  // yesterday" are each expressible without inventing the other end.
  const to = new Date(q.to ?? Date.now());
  const from = new Date(
    q.from ?? to.getTime() - (q.days ?? 7) * 86_400_000,
  );

  const kept: VoxNormalizedSession[] = [];
  let scanned = 0;
  let truncated = false;

  for (let page = 0; page < PAGE_CAP; page++) {
    const res = await getCallHistory(auth, {
      from_date: fmtInTz(from),
      to_date: fmtInTz(to),
      timezone: TZ,
      with_calls: true,
      with_records: true,
      with_total_count: true,
      desc_order: true,
      count: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      // Server-side wherever the API supports it, so fewer rows travel at all —
      // and a duration or number filter narrows the scan itself rather than the
      // page, which is what keeps a deep outcome query from paging the window.
      ...(q.minDurationSec !== undefined ? { min_duration: q.minDurationSec } : {}),
      ...(q.maxDurationSec !== undefined ? { max_duration: q.maxDurationSec } : {}),
      ...(q.phone ? { remote_number_list: JSON.stringify([toVoxNumberFilter(q.phone)]) } : {}),
    });

    const batch = res.result ?? [];
    scanned += batch.length;
    kept.push(...normalizeVoxSessions(batch).filter((s) => matches(s, q)));

    // Newest-first, so once `limit` matches are in hand the rest of the window
    // cannot contain a more recent one.
    if (kept.length >= limit) break;
    if (batch.length < PAGE_SIZE) break;
    if (page === PAGE_CAP - 1) truncated = true;
  }

  const page = kept.slice(0, limit);
  const names = await namesForNumbers(page.map((s) => s.remoteNumber ?? '').filter(Boolean));

  return {
    truncated,
    scanned,
    rows: page.map((s) => {
      const norm = s.remoteNumber ? normalizePhone(s.remoteNumber) : null;
      return {
        id: String(s.sessionId),
        inbound: s.direction === 'inbound',
        answered: s.outcome === 'answered',
        outcome: s.outcome,
        name: norm ? names.get(norm) ?? null : null,
        // NORMALIZED, not raw. Voximplant returns '972536212562' without a
        // leading '+', while the dial path normalizes before ringing — so the
        // number an agent read and the number that gets called were two different
        // strings for the same person. Same helper on both sides now.
        phone: norm ?? s.remoteNumber,
        startedAt: s.startedAt,
        durationSec: s.durationSec,
        talkSec: s.agentTalkSec,
        agentLegsTried: s.agentLegsTried,
        endCode: s.endCode,
        endDetails: s.endDetails,
        hasRecording: s.hasRecording,
      };
    }),
  };
}
