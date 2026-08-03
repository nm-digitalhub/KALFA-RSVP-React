import type { SoftResult, ProcessesProbe, SystemProbe } from './agent-client';
import type { JobHealthRow, DbHealthRow } from './db-health';
import { QUEUE_EXPECTED_MAX_MINUTES } from './db-health';

// Pure, side-effect-free rollup for the Debug page's top summary card. Takes
// already-resolved panel data (never fetches anything itself) so it stays
// trivially testable. Deliberately conservative — a panel that failed to load
// is a 'warn' signal (we don't know), not silently 'ok'.

export type OverallLevel = 'ok' | 'warn' | 'error';

export interface OverallStatus {
  level: OverallLevel;
  reasons: string[];
}

const DISK_WARN_PCT = 85; // matches the ops-monitor fleet role's own threshold
const DISK_ERROR_PCT = 95;
const LONG_QUERY_WARN_SECONDS = 30;
const LONG_QUERY_ERROR_SECONDS = 300;
const CONNECTIONS_WARN_RATIO = 0.8;

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
    if (maxConnections > 0 && activeConnections / maxConnections >= CONNECTIONS_WARN_RATIO) {
      bump('warn', `חיבורי DB: ${activeConnections}/${maxConnections}`);
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
