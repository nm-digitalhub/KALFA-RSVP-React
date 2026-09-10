import type { SoftResult, ProcessesProbe, SystemProbe } from './agent-client';
import { CronExpressionParser } from 'cron-parser';

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
/**
 * When would this cron FIRST have fired after the schedule was registered?
 *
 * Uses cron-parser — the very library pg-boss uses to decide when to fire — so there
 * is no drift between "when we think it runs" and when it actually runs. It arrives
 * as a pg-boss dependency rather than a direct one; the test asserts it resolves, so
 * a future pg-boss that drops it fails CI instead of silently changing this answer.
 *
 * Returns null when the queue has no cron (not scheduled) or the expression will not
 * parse — the caller must NOT read that as "excused".
 */
function firstFireAfterRegistration(row: JobHealthRow): Date | null {
  if (!row.cron || !row.scheduleCreatedOn) return null;
  try {
    return CronExpressionParser.parse(row.cron, {
      tz: row.scheduleTz ?? 'Asia/Jerusalem',
      currentDate: new Date(row.scheduleCreatedOn),
    })
      .next()
      .toDate();
  } catch {
    return null;
  }
}

export function isQueueStale(row: JobHealthRow, expectedMaxMinutes: number | undefined): boolean {
  if (expectedMaxMinutes == null) return false; // not on the known-schedule catalog — never flagged

  if (row.lastCompletedOn) {
    const ageMinutes = (Date.now() - new Date(row.lastCompletedOn).getTime()) / 60_000;
    return ageMinutes > expectedMaxMinutes;
  }

  // ⚠️ NEVER COMPLETED IS NOT THE SAME AS LATE, and treating it as such is what made
  // the Debug Mode badge red on 2026-09-10 for two queues that were perfectly
  // healthy: seo-technical-watch (Mondays 09:00, registered Monday EVENING) and
  // supabase-cli-update (Sundays 05:20, registered a Tuesday). Neither weekday had
  // come round yet — zero runs missed — but `!lastCompletedOn → true` reported both
  // as overdue. A weekly queue is unreportable for its whole first week under that
  // rule, and a badge that is red while nothing is wrong stops being read.
  //
  // So: a queue that has never completed is late only once a scheduled fire has
  // ACTUALLY PASSED, plus the same grace every other queue gets.
  const firstDue = firstFireAfterRegistration(row);
  if (firstDue === null) return true; // no schedule to excuse it with — fail closed
  return Date.now() - firstDue.getTime() > expectedMaxMinutes * 60_000;
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
