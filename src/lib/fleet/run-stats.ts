// Per-role, per-day run counts from .fleet-logs/runs/index.ndjson. Pure: the
// CLI (`run-stats`) reads the file, this only parses and counts.
//
// Why it exists: on 2026-09-27 social-manager logged 41 starts + 9 lock-skips
// in one day (a normal Sunday is 1-2) and no role reported it by COUNT —
// fleet-maintainer only walks known-issues.json, and the role itself
// misdiagnosed the cause. A count per role per day is the cheapest signal
// that makes a runaway visible without reading pm2 logs.
//
// Dates are bucketed in Asia/Jerusalem: run-role.sh writes local-offset
// timestamps (date -Is) while scheduler.mjs writes UTC (toISOString), so a
// plain ts.slice(0, 10) would split one local day across two buckets.

const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jerusalem',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export type RunStat = {
  role: string;
  date: string;
  started: number;
  lockSkipped: number;
  verdictStarts: number;
  stranded: number;
};

const RANGE_DAYS: Record<string, number> = { '1d': 1, '7d': 7, '30d': 30 };

export function localDate(ts: string): string | null {
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? null : DAY_FORMAT.format(new Date(ms));
}

/** First local date included in the range, or null for an unknown range. */
export function rangeStartDate(range: string, now: Date): string | null {
  const days = RANGE_DAYS[range];
  if (!days) return null;
  return DAY_FORMAT.format(new Date(now.getTime() - (days - 1) * 86_400_000));
}

export function aggregateRunIndex(lines: readonly string[], sinceDate: string): RunStat[] {
  const byKey = new Map<string, RunStat>();
  for (const line of lines) {
    if (!line.trim()) continue;
    let record: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      record = parsed as Record<string, unknown>;
    } catch {
      continue; // one corrupt line must not hide the rest (2026-07-28 incident)
    }
    const role = typeof record.role === 'string' ? record.role : null;
    const date = typeof record.ts === 'string' ? localDate(record.ts) : null;
    if (!role || !date || date < sinceDate) continue;

    const key = `${date}|${role}`;
    const stat = byKey.get(key) ?? { role, date, started: 0, lockSkipped: 0, verdictStarts: 0, stranded: 0 };
    if (typeof record.started === 'string') {
      stat.started += 1;
      if (typeof record.reason === 'string' && record.reason.startsWith('verdict:')) stat.verdictStarts += 1;
    }
    if (record.skipped === 'lock') stat.lockSkipped += 1;
    if (typeof record.stranded_verdict === 'string') stat.stranded += 1;
    byKey.set(key, stat);
  }
  return [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date) || a.role.localeCompare(b.role));
}

export function findRunaways(stats: readonly RunStat[], maxPerDay: number): RunStat[] {
  return stats.filter((s) => s.started + s.lockSkipped > maxPerDay || s.stranded > 0);
}
