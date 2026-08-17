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
): Promise<{ phone: string; startedAt: string | null } | null> {
  const config = await getVoximplantConfig();
  if (!config) throw new Error('voximplant_not_configured');

  const numericId = Number(sessionId);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) return null;

  let res;
  try {
    res = await getCallHistory(config.auth, {
      from_date: fmtInTz(new Date(nowMs - withinMs)),
      to_date: fmtInTz(new Date(nowMs)),
      timezone: TZ,
      call_session_history_id: numericId,
      with_calls: true,
      count: 1,
    });
  } catch (e) {
    // An id the platform will not accept is NOT FOUND, not a lookup failure, and
    // the distinction reaches the agent as different words. Measured: asking for
    // session 999999999 raises `'call_session_history_id' parameter is invalid`
    // rather than returning an empty result — so without this the app would say
    // "נסה שוב" forever about a session that does not exist.
    //
    // A NETWORK error is re-thrown: that one genuinely is worth retrying, and
    // swallowing it here would report "no such call" every time Voximplant is
    // briefly unreachable.
    if (e instanceof VoximplantApiError) return null;
    throw e;
  }

  const session = normalizeVoxSessions(res.result ?? [], nowMs)[0];
  if (!session) return null;
  if (session.direction !== 'inbound') return null;

  const inboundLeg = session.legs.find((l) => l.incoming === true);
  const phone = inboundLeg?.remoteNumber ? normalizePhone(inboundLeg.remoteNumber) : null;
  // A withheld CLI leaves nothing to ring. Null rather than a partial result, so
  // the caller reports "no number" instead of "no such call".
  if (!phone) return null;

  return { phone, startedAt: session.startedAt };
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
      ...(q.phone ? { remote_number_list: JSON.stringify([q.phone]) } : {}),
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
