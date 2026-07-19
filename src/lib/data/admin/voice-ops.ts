import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { recordStaffAccess } from '@/lib/data/admin/access-log';
import { countActiveCalls } from '@/lib/data/call-attempts';
import { resolvePage, type PageResult } from '@/lib/data/admin/shared';
import { getVoximplantConfig } from '@/lib/data/voximplant-config';
import {
  getAccountInfo,
  getAuditLog,
  getCallLists,
  getMediaResources,
  VoximplantApiError,
} from '@/lib/voximplant/core';
import {
  extractIpStrings,
  normalizeAccountInfo,
  normalizeAuditEntry,
  normalizeCallList,
  type NormalizedAuditEntry,
  type NormalizedCallList,
} from '@/lib/validation/vox-payloads';

// Admin voice-ops dashboard DAL. Admins supervise calls across events they do
// NOT own, so — exactly like admin/campaigns.ts — every reader uses the
// service-role client (bypassing RLS) UNDER requireAdmin(). No new dashboard
// RLS is introduced.
//
// PII discipline: the per-event/attempt readers select an EXPLICIT column list
// that EXCLUDES access_token, transcript, and recording_url. Content-bearing
// provider fields never reach here.
//
// Aggregation is JS-first over a bounded window — EXPLAIN ANALYZE on the live
// GROUP BY showed a 0.2ms HashAggregate (no RPC warranted, owner directive #13).

// The answer-rate denominator (plan §4, binding): terminal outcomes only;
// cancelled is excluded (the attempt never reached the callee), and the
// non-terminal failed_to_start/start_unknown markers are excluded too.
const ANSWER_RATE_DENOM = ['completed', 'no_answer', 'no_response', 'failed'] as const;
const ACTIVITY_WINDOW_DAYS = 90; // events with call activity within this window
const AGG_ROW_CAP = 5000; // JS-aggregation safety cap; logged if hit

type AdminClient = ReturnType<typeof createAdminClient>;

async function headCount(
  admin: AdminClient,
  build: (q: ReturnType<AdminClient['from']>) => unknown,
): Promise<number> {
  const base = admin.from('call_attempts').select('id', { count: 'exact', head: true });
  const { count } = (await (build(base) as unknown as Promise<{ count: number | null }>)) ?? {
    count: 0,
  };
  return count ?? 0;
}

export interface VoiceDashboardSummary {
  activeNow: number;
  today: number;
  last7d: number;
  completed7d: number;
  answerRate7d: number | null; // null when the denominator is 0 (shown as '—')
}

// Answer-rate formula (plan §4, binding): completed / (completed + no_answer +
// no_response + failed). '—' (null) when the denominator is 0. Pure + exported
// so the definition is pinned by a test.
export function computeAnswerRate(completed: number, denominator: number): number | null {
  return denominator > 0 ? completed / denominator : null;
}

// Group a bounded set of attempt rows by event, JS-side (the aggregation the
// dashboard's event list is built on). Pure + exported for direct testing.
export interface EventActivityAgg {
  eventId: string;
  attempts: number;
  completed: number;
  noAnswer: number;
  failed: number;
  rsvpFromCall: number;
  lastActivityAt: string;
}
export function aggregateEventActivity(
  rows: Array<{ event_id: string; status: string; rsvp_digit: string | null; created_at: string }>,
): EventActivityAgg[] {
  const byEvent = new Map<string, EventActivityAgg>();
  for (const a of rows) {
    const cur =
      byEvent.get(a.event_id) ??
      {
        eventId: a.event_id,
        attempts: 0,
        completed: 0,
        noAnswer: 0,
        failed: 0,
        rsvpFromCall: 0,
        lastActivityAt: a.created_at,
      };
    cur.attempts += 1;
    if (a.status === 'completed') cur.completed += 1;
    if (a.status === 'no_answer') cur.noAnswer += 1;
    if (a.status === 'failed') cur.failed += 1;
    if (a.rsvp_digit === '1' || a.rsvp_digit === '2') cur.rsvpFromCall += 1;
    if (a.created_at > cur.lastActivityAt) cur.lastActivityAt = a.created_at;
    byEvent.set(a.event_id, cur);
  }
  return [...byEvent.values()].sort((x, y) => y.lastActivityAt.localeCompare(x.lastActivityAt));
}

export async function getVoiceDashboardSummary(
  nowMs: number = Date.now(),
): Promise<VoiceDashboardSummary> {
  await requirePlatformPermission('manage_voice');
  const admin = createAdminClient();
  const startToday = new Date(nowMs);
  startToday.setUTCHours(0, 0, 0, 0);
  const iso7d = new Date(nowMs - 7 * 24 * 3600 * 1000).toISOString();

  const [activeNow, today, last7d, completed7d, denom7d] = await Promise.all([
    countActiveCalls(),
    headCount(admin, (q) => q.gte('created_at', startToday.toISOString())),
    headCount(admin, (q) => q.gte('created_at', iso7d)),
    headCount(admin, (q) => q.gte('created_at', iso7d).eq('status', 'completed')),
    headCount(admin, (q) => q.gte('created_at', iso7d).in('status', [...ANSWER_RATE_DENOM])),
  ]);

  return {
    activeNow,
    today,
    last7d,
    completed7d,
    answerRate7d: computeAnswerRate(completed7d, denom7d),
  };
}

export interface EventCallActivity {
  eventId: string;
  eventName: string;
  eventDate: string | null;
  ownerName: string;
  attempts: number;
  completed: number;
  noAnswer: number;
  failed: number;
  rsvpFromCall: number;
  lastActivityAt: string;
}

// Aggregate call activity per event over the window, JS-side. Returns a page of
// events ordered by most-recent activity. `truncated` flags if the safety cap
// was hit (never silently drop — surface it).
export async function listEventsWithCallActivity(
  params: { page?: number } = {},
  nowMs: number = Date.now(),
): Promise<PageResult<EventCallActivity> & { truncated: boolean }> {
  await requirePlatformPermission('manage_voice');
  const admin = createAdminClient();
  const since = new Date(nowMs - ACTIVITY_WINDOW_DAYS * 24 * 3600 * 1000).toISOString();

  const { data: rows } = await admin
    .from('call_attempts')
    .select('event_id, status, rsvp_digit, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(AGG_ROW_CAP);

  const attempts = (rows ?? []) as Array<{
    event_id: string;
    status: string;
    rsvp_digit: string | null;
    created_at: string;
  }>;
  const truncated = attempts.length >= AGG_ROW_CAP;

  const sorted = aggregateEventActivity(attempts);
  const total = sorted.length;
  const { page, pageSize, from, to } = resolvePage(params.page);
  const pageRows = sorted.slice(from, to + 1);

  // Fetch event + owner details ONLY for the page's event ids.
  const eventIds = pageRows.map((r) => r.eventId);
  const events = new Map<string, { name: string; event_date: string | null; owner_id: string | null }>();
  const ownerNames = new Map<string, string>();
  if (eventIds.length > 0) {
    const { data: evRows } = await admin
      .from('events')
      .select('id, name, event_date, owner_id')
      .in('id', eventIds);
    for (const e of (evRows ?? []) as Array<{
      id: string;
      name: string;
      event_date: string | null;
      owner_id: string | null;
    }>) {
      events.set(e.id, { name: e.name, event_date: e.event_date, owner_id: e.owner_id });
    }
    const ownerIds = [...events.values()].map((e) => e.owner_id).filter((v): v is string => !!v);
    if (ownerIds.length > 0) {
      const { data: profs } = await admin
        .from('profiles')
        .select('id, full_name')
        .in('id', ownerIds);
      for (const p of (profs ?? []) as Array<{ id: string; full_name: string | null }>) {
        if (p.full_name) ownerNames.set(p.id, p.full_name);
      }
    }
  }

  const items: EventCallActivity[] = pageRows.map((r) => {
    const ev = events.get(r.eventId);
    return {
      ...r,
      eventName: ev?.name ?? '—',
      eventDate: ev?.event_date ?? null,
      ownerName: (ev?.owner_id && ownerNames.get(ev.owner_id)) || '—',
    };
  });

  return { items, total, page, pageSize, truncated };
}

// Per-attempt supervision rows for one event. EXPLICIT non-PII column list:
// access_token / transcript / recording_url are NEVER selected. `hasRecording`
// / `hasTranscript` are boolean presence flags computed without reading content.
export interface EventCallAttemptRow {
  id: string;
  status: string;
  createdAt: string;
  durationSec: number | null;
  rsvpDigit: string | null;
  rsvpMethod: string | null;
  finishReason: string | null;
  hasRecording: boolean;
  hasTranscript: boolean;
  sessionHistoryId: string | null;
}

export async function listCallAttemptsForEvent(
  eventId: string,
  params: { page?: number } = {},
): Promise<PageResult<EventCallAttemptRow>> {
  const staff = await requirePlatformPermission('manage_voice');
  const admin = createAdminClient();
  // Targeted read of one customer's call attempts (which carry transcript/recording
  // presence) — audit it. Operational (manage_voice), so no break-glass reason.
  const { data: ownerRow } = await admin
    .from('events')
    .select('owner_id')
    .eq('id', eventId)
    .maybeSingle();
  if (ownerRow) {
    await recordStaffAccess({
      staffId: staff.id,
      permission: 'manage_voice',
      subjectType: 'call_attempts',
      subjectId: eventId,
      ownerId: ownerRow.owner_id,
      eventId,
    });
  }
  const { page, pageSize, from, to } = resolvePage(params.page);
  // recording_url/transcript appear ONLY inside boolean presence expressions —
  // never returned as values (the select still must name them to test presence,
  // so we fetch them and drop them immediately below; they never leave this fn).
  const { data, count } = await admin
    .from('call_attempts')
    .select(
      'id, status, created_at, call_duration_sec, rsvp_digit, rsvp_method, finish_reason, vox_call_session_history_id, recording_url, transcript',
      { count: 'exact' },
    )
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
    .range(from, to);

  const items: EventCallAttemptRow[] = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    status: r.status as string,
    createdAt: r.created_at as string,
    durationSec: (r.call_duration_sec as number | null) ?? null,
    rsvpDigit: (r.rsvp_digit as string | null) ?? null,
    rsvpMethod: (r.rsvp_method as string | null) ?? null,
    finishReason: (r.finish_reason as string | null) ?? null,
    hasRecording: typeof r.recording_url === 'string' && r.recording_url.length > 0,
    hasTranscript: r.transcript != null,
    sessionHistoryId: (r.vox_call_session_history_id as string | null) ?? null,
  }));

  return { items, total: count ?? 0, page, pageSize };
}

// ---------------------------------------------------------------------------
// Platform view (getVoicePlatformView) — the /admin/voice/platform sections.
// Each section is isolated in its own try/catch so a slow/failed provider call
// degrades ONE card, never the page. All data passes through the normalizers
// (metadata-only; no custom_data/result_data/audit-detail).
// ---------------------------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, '0');
const fmtUTCstamp = (d: Date) =>
  `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(
    d.getUTCHours(),
  )}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;

export interface VoiceBalanceSection {
  status: 'ok' | 'unconfigured' | 'unavailable';
  balance: number | null;
  currency: string | null;
  lowBalanceThreshold: number;
  minCallReserve: number;
  callbackUrlEcho: string | null;
}
export interface VoiceCallListsSection {
  status: 'ok' | 'unconfigured' | 'unavailable';
  lists: NormalizedCallList[];
}
export interface VoiceAuditSection {
  status: 'ok' | 'forbidden' | 'unconfigured' | 'unavailable';
  entries: NormalizedAuditEntry[];
}
export interface VoiceAllowlistSection {
  status: 'ok' | 'unavailable';
  ips: string[];
}
export interface VoiceWiringSection {
  state: string; // voximplant_account_callback_state
  tokenSet: boolean;
  wiredAt: string | null;
  lastCallbackAt: string | null;
}
export interface VoicePlatformView {
  balance: VoiceBalanceSection;
  callLists: VoiceCallListsSection;
  audit: VoiceAuditSection;
  allowlist: VoiceAllowlistSection;
  wiring: VoiceWiringSection;
}

// The live-balance tile (reused by the overview and the platform view). Isolated
// so a slow/failed GetAccountInfo degrades one tile. Requires admin.
export async function getVoiceBalanceTile(): Promise<VoiceBalanceSection> {
  const cfg = await getVoximplantConfig();
  if (!cfg) {
    return {
      status: 'unconfigured',
      balance: null,
      currency: null,
      lowBalanceThreshold: 5,
      minCallReserve: 0.1,
      callbackUrlEcho: null,
    };
  }
  try {
    const info = normalizeAccountInfo(
      await getAccountInfo(cfg.auth, 10_000, { returnLiveBalance: true }),
    );
    return {
      status: 'ok',
      balance: info.balance,
      currency: info.currency,
      lowBalanceThreshold: cfg.lowBalanceThreshold,
      minCallReserve: cfg.minCallReserve,
      callbackUrlEcho: info.callbackUrl,
    };
  } catch {
    return {
      status: 'unavailable',
      balance: null,
      currency: null,
      lowBalanceThreshold: cfg.lowBalanceThreshold,
      minCallReserve: cfg.minCallReserve,
      callbackUrlEcho: null,
    };
  }
}

export interface LogExportStatus {
  pending: number;
  stored: number;
  failed: number;
  noLog: number;
  lastExportedAt: string | null;
}

export async function getLogExportStatus(): Promise<LogExportStatus> {
  await requirePlatformPermission('manage_voice');
  const admin = createAdminClient();
  const { data } = await admin
    .from('vox_log_exports')
    .select('status, exported_at')
    .order('exported_at', { ascending: false, nullsFirst: false })
    .limit(1000);
  const rows = (data ?? []) as Array<{ status: string; exported_at: string | null }>;
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  return {
    pending: count('pending') + count('processing'),
    stored: count('stored'),
    failed: count('failed'),
    noLog: count('no_log'),
    lastExportedAt: rows.find((r) => r.exported_at)?.exported_at ?? null,
  };
}

export async function getVoicePlatformView(nowMs: number = Date.now()): Promise<VoicePlatformView> {
  await requirePlatformPermission('manage_voice');
  const admin = createAdminClient();
  const cfg = await getVoximplantConfig();

  const balance = await getVoiceBalanceTile();

  // --- call lists (A1) ---
  let callLists: VoiceCallListsSection;
  if (!cfg) {
    callLists = { status: 'unconfigured', lists: [] };
  } else {
    try {
      const from = new Date(nowMs - 30 * 24 * 3600 * 1000);
      const res = await getCallLists(cfg.auth, {
        from_date: fmtUTCstamp(from),
        to_date: fmtUTCstamp(new Date(nowMs)),
        count: 50,
      });
      callLists = { status: 'ok', lists: (res.result ?? []).map(normalizeCallList) };
    } catch {
      callLists = { status: 'unavailable', lists: [] };
    }
  }

  // --- audit (A3) — 104/403 = forbidden (Owner-only), never a hard fail ---
  let audit: VoiceAuditSection;
  if (!cfg) {
    audit = { status: 'unconfigured', entries: [] };
  } else {
    try {
      const from = new Date(nowMs - 14 * 24 * 3600 * 1000);
      const res = await getAuditLog(cfg.auth, {
        from_date: fmtUTCstamp(from),
        to_date: fmtUTCstamp(new Date(nowMs)),
        count: 50,
      });
      audit = { status: 'ok', entries: (res.result ?? []).map(normalizeAuditEntry) };
    } catch (e) {
      audit = {
        status: e instanceof VoximplantApiError ? 'forbidden' : 'unavailable',
        entries: [],
      };
    }
  }

  // --- allowlist (A2) — public endpoint, independent of cfg ---
  let allowlist: VoiceAllowlistSection;
  try {
    allowlist = { status: 'ok', ips: extractIpStrings(await getMediaResources({ with_jsservers: true })) };
  } catch {
    allowlist = { status: 'unavailable', ips: [] };
  }

  // --- wiring status (B5) — never returns the token/hash, only its presence ---
  let wiring: VoiceWiringSection = {
    state: 'unwired',
    tokenSet: false,
    wiredAt: null,
    lastCallbackAt: null,
  };
  try {
    const { data } = await admin
      .from('app_settings')
      .select(
        'voximplant_account_callback_state, voximplant_account_callback_token_hash, voximplant_account_callback_wired_at, voximplant_balance_callback_at',
      )
      .eq('id', true)
      .maybeSingle();
    const row = (data ?? {}) as Record<string, unknown>;
    wiring = {
      state: typeof row.voximplant_account_callback_state === 'string'
        ? row.voximplant_account_callback_state
        : 'unwired',
      tokenSet: typeof row.voximplant_account_callback_token_hash === 'string'
        && (row.voximplant_account_callback_token_hash as string).length > 0,
      wiredAt: (row.voximplant_account_callback_wired_at as string | null) ?? null,
      lastCallbackAt: (row.voximplant_balance_callback_at as string | null) ?? null,
    };
  } catch {
    /* keep the safe default */
  }

  return { balance, callLists, audit, allowlist, wiring };
}

// Admin recordings list (/admin/recordings). Extracted from the page so it lives
// behind a tested, service-role seam like every other admin call_attempts read —
// this is the one surface that intentionally exposes recording_url (guest voice),
// gated on the most restrictive permission (view_recordings, owner-only). The
// column list is fixed and explicit so a future `select('*')` can never leak
// access_token/transcript into the page. RLS does NOT scope this (service_role);
// the gate is the authorization, exactly as it was under the dropped
// call_attempts_admin_read policy.
export interface CallRecordingRow {
  id: string;
  campaign_id: string | null;
  event_id: string | null;
  status: string;
  finish_reason: string | null;
  call_duration_sec: number | null;
  recording_url: string | null;
  recording_started_at: string | null;
  created_at: string;
}

export async function listCallRecordings(limit = 100): Promise<CallRecordingRow[]> {
  await requirePlatformPermission('view_recordings');
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('call_attempts')
    .select(
      'id, campaign_id, event_id, status, finish_reason, call_duration_sec, recording_url, recording_started_at, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (error) throw new Error('טעינת ההקלטות נכשלה');
  return (data ?? []) as CallRecordingRow[];
}
