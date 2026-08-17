import 'server-only';

import { normalizeVoxSessions, type VoxNormalizedSession } from '@/lib/voximplant/call-history-normalize';
import { getCallHistory } from '@/lib/voximplant/core';
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
  days: number;
  direction?: 'inbound' | 'outbound';
  outcome?: 'answered' | 'missed';
  /** Filters server-side on Voximplant, unlike outcome. */
  minDurationSec?: number;
  /** A specific caller. Server-side. */
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

export async function fetchVoxCallHistory(q: VoxHistoryQuery): Promise<VoxHistoryResult> {
  const config = await getVoximplantConfig();
  if (!config) throw new Error('voximplant_not_configured');
  const auth = config.auth;

  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const to = new Date();
  const from = new Date(to.getTime() - q.days * 86_400_000);

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
      // Server-side where the API supports it, so fewer rows travel at all.
      ...(q.minDurationSec !== undefined ? { min_duration: q.minDurationSec } : {}),
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
        phone: s.remoteNumber,
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
