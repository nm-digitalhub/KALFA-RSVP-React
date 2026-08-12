import type { SoftResult, ProcessesProbe, SystemProbe } from './agent-client';
import type { JobHealthRow, DbHealthRow } from './db-health';
import { QUEUE_EXPECTED_MAX_MINUTES } from './queue-schedule';

// Pure, side-effect-free rollup for the Debug page's top summary card. Takes
// already-resolved panel data (never fetches anything itself) so it stays
// trivially testable. Deliberately conservative — a panel that failed to load
// is a 'warn' signal (we don't know), not silently 'ok'.

export type Severity = 'ok' | 'warn' | 'error';
export type OverallLevel = Severity;

export interface OverallStatus {
  level: OverallLevel;
  reasons: string[];
}

export const DISK_WARN_PCT = 85; // matches the ops-monitor fleet role's own threshold
export const DISK_ERROR_PCT = 95;
const LONG_QUERY_WARN_SECONDS = 30;
const LONG_QUERY_ERROR_SECONDS = 300;
export const CONNECTIONS_WARN_RATIO = 0.8;
export const CONNECTIONS_ERROR_RATIO = 0.95;
// Swap USAGE (% of total swap capacity, not RAM) deliberately has no ERROR
// tier of its own — Linux can leave a swap device mostly full of old,
// reclaimable pages for a long time after real pressure has passed, so high
// usage alone is only ever a 'warn' ("worth knowing"), never an 'error'
// ("page someone"). Only the page-in/out RATE (below) proves active
// pressure and can escalate to 'error' on its own, or combine with high
// usage via worseSeverity() at the call site.
export const SWAP_WARN_PCT = 60;
// Sustained page-in/out rate (pages/sec, sampled over the last completed
// sysstat interval — see ops/probes.mjs) is what actually distinguishes
// "old pages sitting in swap" from active thrashing; usage % alone can't.
const SWAP_ACTIVITY_WARN_PAGES_PER_SEC = 20;
const SWAP_ACTIVITY_ERROR_PAGES_PER_SEC = 100;

// `warn`/`error` are on the SAME scale as `value` (percentage-points for
// disk, a 0–1 ratio for connections) — callers pass matching constants,
// never mix scales.
export function severityForThreshold(value: number, warn: number, error: number): Severity {
  if (value >= error) return 'error';
  if (value >= warn) return 'warn';
  return 'ok';
}

export function severityForSwapUsage(swapPct: number): Severity {
  return swapPct >= SWAP_WARN_PCT ? 'warn' : 'ok';
}

export function severityForSwapActivity(pswpinPerSec: number, pswpoutPerSec: number): Severity {
  const rate = Math.max(pswpinPerSec, pswpoutPerSec);
  if (rate >= SWAP_ACTIVITY_ERROR_PAGES_PER_SEC) return 'error';
  if (rate >= SWAP_ACTIVITY_WARN_PAGES_PER_SEC) return 'warn';
  return 'ok';
}

const SEVERITY_RANK: Record<Severity, number> = { ok: 0, warn: 1, error: 2 };
export function worseSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

// Plain (non-component) helper — safe to call Date.now() here. Shared by the
// summary rollup below AND by the Jobs panel's per-row badge (_panels.tsx),
// which must NOT call Date.now() directly inside a component body (React's
// purity rule flags that as an impure render).
export function isQueueStale(row: JobHealthRow, expectedMaxMinutes: number | undefined): boolean {
  if (expectedMaxMinutes == null) return false; // not on the known-schedule catalog — never flagged
  if (!row.lastCompletedOn) return true;
  const ageMinutes = (Date.now() - new Date(row.lastCompletedOn).getTime()) / 60_000;
  return ageMinutes > expectedMaxMinutes;
}

function staleQueues(jobHealth: JobHealthRow[]): string[] {
  const stale: string[] = [];
  for (const row of jobHealth) {
    const maxMinutes = QUEUE_EXPECTED_MAX_MINUTES[row.queueName];
    if (isQueueStale(row, maxMinutes)) stale.push(row.queueName);
  }
  return stale;
}

export function computeOverallStatus(input: {
  processes: SoftResult<ProcessesProbe> | null;
  system: SoftResult<SystemProbe> | null;
  jobHealth: JobHealthRow[] | null;
  dbHealth: DbHealthRow | null;
  errorCountLast1h: number | null;
}): OverallStatus {
  const reasons: string[] = [];
  let level: OverallLevel = 'ok';

  const bump = (next: OverallLevel, reason: string) => {
    reasons.push(reason);
    if (next === 'error' || (next === 'warn' && level === 'ok')) level = next;
  };

  if (!input.processes) {
    bump('warn', 'לא ניתן לקרוא את מצב התהליכים (kalfa-ops-agent אינו זמין)');
  } else if (input.processes.ok) {
    const offline = input.processes.data.pm2.filter((p) => p.status !== 'online');
    if (offline.length > 0) bump('error', `תהליכים לא פעילים: ${offline.map((p) => p.name).join(', ')}`);
    if (input.processes.data.missing.length > 0) {
      bump('error', `תהליכים מוצהרים שאינם רצים: ${input.processes.data.missing.join(', ')}`);
    }
    if (input.processes.data.undeclared.length > 0) {
      bump('warn', `תהליכים רצים שאינם מוצהרים: ${input.processes.data.undeclared.join(', ')}`);
    }
  } else {
    bump('warn', 'לא ניתן לקרוא את מצב התהליכים (kalfa-ops-agent אינו זמין)');
  }

  if (!input.system) {
    bump('warn', 'לא ניתן לקרוא את מצב המערכת');
  } else if (input.system.ok) {
    const pct = input.system.data.disk?.pct;
    if (pct != null) {
      if (pct >= DISK_ERROR_PCT) bump('error', `דיסק בשימוש ${pct}%`);
      else if (pct >= DISK_WARN_PCT) bump('warn', `דיסק בשימוש ${pct}%`);
    }
    const swapPct = input.system.data.mem?.swapPct;
    if (swapPct != null && severityForSwapUsage(swapPct) === 'warn') {
      bump('warn', `Swap בשימוש ${swapPct}%`);
    }
    const activity = input.system.data.swapActivity;
    if (activity) {
      const rate = Math.max(activity.pswpinPerSec, activity.pswpoutPerSec);
      const activitySeverity = severityForSwapActivity(activity.pswpinPerSec, activity.pswpoutPerSec);
      if (activitySeverity !== 'ok') {
        bump(activitySeverity, `פעילות Swap גבוהה: ${rate.toFixed(1)} עמודים/שנ'`);
      }
    }
  } else {
    bump('warn', 'לא ניתן לקרוא את מצב המערכת');
  }

  if (input.jobHealth) {
    const stale = staleQueues(input.jobHealth);
    if (stale.length > 0) bump('error', `תורים ללא הרצה אחרונה בזמן: ${stale.join(', ')}`);
  } else {
    bump('warn', 'לא ניתן לקרוא את מצב התורים');
  }

  if (input.dbHealth) {
    const { activeConnections, maxConnections, longestQuerySeconds } = input.dbHealth;
    if (maxConnections > 0) {
      const ratio = activeConnections / maxConnections;
      if (ratio >= CONNECTIONS_ERROR_RATIO) bump('error', `חיבורי DB: ${activeConnections}/${maxConnections}`);
      else if (ratio >= CONNECTIONS_WARN_RATIO) bump('warn', `חיבורי DB: ${activeConnections}/${maxConnections}`);
    }
    if (longestQuerySeconds != null) {
      if (longestQuerySeconds >= LONG_QUERY_ERROR_SECONDS) bump('error', `שאילתה ארוכה: ${Math.round(longestQuerySeconds)} שנ'`);
      else if (longestQuerySeconds >= LONG_QUERY_WARN_SECONDS) bump('warn', `שאילתה ארוכה: ${Math.round(longestQuerySeconds)} שנ'`);
    }
  } else {
    bump('warn', 'לא ניתן לקרוא את מצב מסד הנתונים');
  }

  if (input.errorCountLast1h != null && input.errorCountLast1h > 0) {
    bump('warn', `${input.errorCountLast1h} שגיאות שרת בשעה האחרונה`);
  }

  return { level, reasons };
}
