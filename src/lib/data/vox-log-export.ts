import 'server-only';

import { createHash } from 'node:crypto';

import { createAdminClient } from '@/lib/supabase/admin';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { getVoximplantConfig } from '@/lib/data/voximplant-config';
import { TERMINAL_STATUSES } from '@/lib/data/call-attempts';
import {
  getCallHistory,
  signManagementJwt,
  type VoximplantConfig,
} from '@/lib/voximplant/core';
import { downloadLogFile } from '@/lib/voximplant/log-download';
import { normalizeSessionLogPointer } from '@/lib/validation/vox-payloads';

// A4 — durable export of Voximplant session logs (which expire ~1 month) into
// the private `vox-call-logs` bucket. Runs as a daily pg-boss cron
// (worker/main.ts) AND can be triggered manually from the admin dashboard.
//
// Fail-safe, like the auto-thankyou sweep and the balance cron:
//   - dark-safe: a no-op when the channel config is missing (getVoximplantConfig
//     null) — but NOT gated on liveCallsEnabled: past calls' logs must survive a
//     toggle-off, and their TTL keeps ticking regardless of the dial switch;
//   - NEVER throws — each row is isolated in its own try/catch; a Slack alert
//     fires ONLY when every processed row failed (systemic problem), so a single
//     expired/missing log does not page anyone;
//   - the atomic per-row lease (claimLeasedRows) makes a manual run and the cron
//     safe to overlap; the queue's singleton policy is a second layer.

const BUCKET = 'vox-call-logs';
const MAX_PER_RUN = 20;
const MAX_ATTEMPTS = 5;
const LEASE_MS = 5 * 60 * 1000; // a claimed row is off-limits for 5 minutes
const LOOKBACK_DAYS = 25; // 5-day margin under the ~1-month TTL
const RETENTION_DAYS = 180; // exported logs (guest PII) are purged after this

type AdminClient = ReturnType<typeof createAdminClient>;

export interface LogExportSummary {
  claimed: number;
  stored: number;
  noLog: number;
  failed: number;
  purged: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const fmtUTC = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

const sha256Hex = (input: Buffer | string) =>
  createHash('sha256').update(input).digest('hex');

// Ensure a pending export row exists for every eligible attempt (terminal
// status + a session id + within the TTL lookback window) that has no row yet.
// The UNIQUE(call_attempt_id) constraint makes this idempotent — ignoreDuplicates
// skips attempts already tracked.
async function enqueuePending(admin: AdminClient, nowMs: number): Promise<void> {
  const cutoff = new Date(nowMs - LOOKBACK_DAYS * 24 * 3600 * 1000).toISOString();
  const { data: attempts } = await admin
    .from('call_attempts')
    .select('id, event_id, vox_call_session_history_id, created_at, vox_log_exports!left(id)')
    .not('vox_call_session_history_id', 'is', null)
    .in('status', TERMINAL_STATUSES as unknown as string[])
    .gte('created_at', cutoff)
    .is('vox_log_exports', null)
    .limit(200);

  const rows = (attempts ?? [])
    .map((a) => {
      const r = a as Record<string, unknown>;
      return {
        call_attempt_id: r.id as string,
        event_id: (r.event_id as string | null) ?? null,
        vox_call_session_history_id: (r.vox_call_session_history_id as string | null) ?? null,
        attempt_created_at: (r.created_at as string | null) ?? null,
        status: 'pending' as const,
      };
    })
    .filter((r) => r.call_attempt_id);
  if (rows.length === 0) return;
  await admin
    .from('vox_log_exports')
    .upsert(rows as never, { onConflict: 'call_attempt_id', ignoreDuplicates: true });
}

// Atomically claim up to MAX_PER_RUN claimable rows: pending/failed, under the
// attempt cap, and not currently leased. The UPDATE ... returning is the lease —
// two concurrent runs can never grab the same row because the WHERE re-checks
// the lease each time.
interface LeasedRow {
  id: string;
  call_attempt_id: string;
  vox_call_session_history_id: string | null;
  attempt_created_at: string | null;
  attempts: number;
}

async function claimLeasedRows(admin: AdminClient, nowMs: number): Promise<LeasedRow[]> {
  const nowIso = new Date(nowMs).toISOString();
  const leaseUntil = new Date(nowMs + LEASE_MS).toISOString();
  // Select candidate ids first, then claim them with a lease-guarded UPDATE.
  const { data: candidates } = await admin
    .from('vox_log_exports')
    .select('id')
    .in('status', ['pending', 'failed'])
    .lt('attempts', MAX_ATTEMPTS)
    .or(`leased_until.is.null,leased_until.lt.${nowIso}`)
    .order('created_at', { ascending: true })
    .limit(MAX_PER_RUN);
  const ids = (candidates ?? []).map((c) => (c as { id: string }).id);
  if (ids.length === 0) return [];

  const { data: claimed } = await admin
    .from('vox_log_exports')
    .update({ status: 'processing', leased_until: leaseUntil } as never)
    .in('id', ids)
    .in('status', ['pending', 'failed']) // re-check: another run may have taken it
    .or(`leased_until.is.null,leased_until.lt.${nowIso}`)
    .select('id, call_attempt_id, vox_call_session_history_id, attempt_created_at, attempts');
  return (claimed ?? []) as unknown as LeasedRow[];
}

// Process ONE claimed row: fetch the session, validate + download the log,
// upload it, and record the outcome. Never throws — returns the terminal status.
async function processRow(
  admin: AdminClient,
  cfg: NonNullable<Awaited<ReturnType<typeof getVoximplantConfig>>>,
  row: LeasedRow,
): Promise<'stored' | 'no_log' | 'failed'> {
  const fail = async (reason: string): Promise<'failed'> => {
    await admin
      .from('vox_log_exports')
      .update({
        status: 'failed',
        attempts: row.attempts + 1,
        leased_until: null,
        last_error: reason.slice(0, 500),
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', row.id);
    return 'failed';
  };
  const terminal = async (
    status: 'stored' | 'no_log',
    patch: Record<string, unknown>,
  ): Promise<'stored' | 'no_log'> => {
    await admin
      .from('vox_log_exports')
      .update({
        status,
        attempts: row.attempts + 1,
        leased_until: null,
        exported_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...patch,
      } as never)
      .eq('id', row.id);
    return status;
  };

  const sessionId = row.vox_call_session_history_id ? Number(row.vox_call_session_history_id) : NaN;
  if (!Number.isFinite(sessionId)) return terminal('no_log', {});

  const anchor = row.attempt_created_at ? Date.parse(row.attempt_created_at) : Date.now();
  const from = new Date(anchor - 24 * 3600 * 1000);
  const to = new Date(anchor + 30 * 24 * 3600 * 1000);

  let logUrl: string | null;
  try {
    const hist = await getCallHistory(cfg.auth, {
      from_date: fmtUTC(from),
      to_date: fmtUTC(to),
      call_session_history_id: sessionId,
      with_other_resources: true,
      with_records: false,
    });
    logUrl = (hist.result ?? [])
      .map((s) => normalizeSessionLogPointer(s).logFileUrl)
      .find((u): u is string => typeof u === 'string' && u.length > 0) ?? null;
  } catch (e) {
    return fail(`history: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!logUrl) return terminal('no_log', {});

  // SSRF-hardened download (anonymous first; JWT only on a 401 from an
  // allowlisted+resolved host).
  const dl = await downloadLogFile(logUrl, {
    jwtProvider: () => signManagementJwt(cfg.auth),
  });
  if (!dl.ok) return fail(`download: ${dl.reason}${dl.status ? ` (${dl.status})` : ''}`);

  const eventPrefix = (await eventIdFor(admin, row.call_attempt_id)) ?? 'unknown';
  const path = `${eventPrefix}/${row.call_attempt_id}.log`;
  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, dl.bytes, {
    contentType: dl.contentType || 'text/plain',
    upsert: true, // a retried export overwrites its own prior partial
  });
  if (upErr) return fail(`storage: ${upErr.message}`);

  return terminal('stored', {
    storage_path: path,
    content_sha256: sha256Hex(dl.bytes),
    size_bytes: dl.bytes.byteLength,
    content_type: dl.contentType || 'text/plain',
    source_url_hash: sha256Hex(logUrl),
  });
}

async function eventIdFor(admin: AdminClient, exportRowCallAttemptId: string): Promise<string | null> {
  const { data } = await admin
    .from('vox_log_exports')
    .select('event_id')
    .eq('call_attempt_id', exportRowCallAttemptId)
    .maybeSingle();
  const ev = (data as { event_id?: string | null } | null)?.event_id;
  return typeof ev === 'string' && ev.length > 0 ? ev : null;
}

// Delete storage objects + rows for exports older than the retention window.
// Best-effort: a failure here never fails the run.
async function purgeExpired(admin: AdminClient, nowMs: number): Promise<number> {
  const cutoff = new Date(nowMs - RETENTION_DAYS * 24 * 3600 * 1000).toISOString();
  const { data: old } = await admin
    .from('vox_log_exports')
    .select('id, storage_path')
    .lt('created_at', cutoff)
    .limit(100);
  const rows = (old ?? []) as Array<{ id: string; storage_path: string | null }>;
  if (rows.length === 0) return 0;
  const paths = rows.map((r) => r.storage_path).filter((p): p is string => !!p);
  if (paths.length > 0) {
    await admin.storage.from(BUCKET).remove(paths);
  }
  await admin
    .from('vox_log_exports')
    .delete()
    .in(
      'id',
      rows.map((r) => r.id),
    );
  return rows.length;
}

export async function runLogExport(nowMs: number = Date.now()): Promise<LogExportSummary> {
  const empty: LogExportSummary = { claimed: 0, stored: 0, noLog: 0, failed: 0, purged: 0 };
  const cfg = await getVoximplantConfig();
  if (!cfg) return empty; // dark-safe: channel not configured

  const admin = createAdminClient();

  let purged = 0;
  try {
    purged = await purgeExpired(admin, nowMs);
  } catch {
    /* best-effort retention — never fails the run */
  }

  try {
    await enqueuePending(admin, nowMs);
  } catch {
    /* enqueue is best-effort; already-tracked rows still process below */
  }

  const claimed = await claimLeasedRows(admin, nowMs);
  if (claimed.length === 0) return { ...empty, purged };

  let stored = 0;
  let noLog = 0;
  let failed = 0;
  for (const row of claimed) {
    let outcome: 'stored' | 'no_log' | 'failed';
    try {
      outcome = await processRow(admin, cfg, row);
    } catch {
      // Defensive: processRow should never throw, but if it does, release the
      // lease so a later run can retry instead of leaving the row stuck.
      await admin
        .from('vox_log_exports')
        .update({ status: 'failed', attempts: row.attempts + 1, leased_until: null } as never)
        .eq('id', row.id);
      outcome = 'failed';
    }
    if (outcome === 'stored') stored += 1;
    else if (outcome === 'no_log') noLog += 1;
    else failed += 1;
  }

  // Alert ONLY on a systemic failure (every processed row failed) — a single
  // expired/missing log is normal and must not page.
  if (shouldAlertLogExport({ claimed: claimed.length, stored, noLog, failed, purged })) {
    void sendSlackAlert({
      level: 'warn',
      category: 'send_health',
      source: 'vox-log-export',
      title: 'Voximplant log export — all rows failed',
      detail: `${failed} attempted, 0 stored`,
      fields: { failed },
    });
  }

  return { claimed: claimed.length, stored, noLog, failed, purged };
}

// A run pages ops ONLY when it processed rows and EVERY one failed — a systemic
// problem (bad key, role loss, network). Any stored/no_log outcome, or a run
// that claimed nothing, is silent. Pure so it is unit-testable.
export function shouldAlertLogExport(s: LogExportSummary): boolean {
  return s.failed > 0 && s.stored === 0 && s.noLog === 0;
}

// Config type is referenced only for the processRow signature.
export type { VoximplantConfig };
