import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  completedRetentionSeconds,
  DEFAULT_COMPLETED_RETENTION_SECONDS,
  PGBOSS_SEND_IT_QUEUE,
  SHORT_COMPLETED_RETENTION_SECONDS,
  QUEUE_EXPECTED_MAX_MINUTES,
} from './queue-schedule';
import { QUEUES, RETIRED_QUEUES } from '@/lib/queue/queues';

// THE DRIFT GATE for the staleness catalog.
//
// queue-schedule.ts calls itself a mirror of worker/main.ts's cron catalog, and
// for a while carried a date ("verified 31.07") in place of a check. MEASURED
// 2026-09-13: the worker scheduled 32 queues and the map named 20. `isQueueStale`
// returns FALSE for a queue it has never heard of, so each of the missing twelve
// could have stopped running with the Debug badge staying green — including the
// nightly WhatsApp template reconciliation and the Graph subscription renewal
// whose stall ends inbound mail intake.
//
// So the mirror is read off disk instead of trusted. Adding a boss.schedule()
// without deciding how late is too late is now a failing test, not an invisible
// hole.

const ROOT = process.cwd();

/** queues.ts maps a property name to the wire queue name; the worker uses the property. */
function queueNamesByProperty(): Record<string, string> {
  const src = readFileSync(join(ROOT, 'src/lib/queue/queues.ts'), 'utf8');
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/(\w+):\s*'([a-z0-9-]+)'/g)) out[m[1]] = m[2];
  return out;
}

/** Every queue the worker puts on a cron, by its wire name. */
function scheduledQueues(): string[] {
  const src = readFileSync(join(ROOT, 'worker/main.ts'), 'utf8');
  const byProp = queueNamesByProperty();
  const out: string[] = [];
  for (const m of src.matchAll(/boss\.schedule\(QUEUES\.(\w+),/g)) {
    const name = byProp[m[1]];
    // An unresolvable property means queues.ts and the worker disagree, which is
    // its own bug — surface it rather than quietly skipping the entry.
    expect(name, `QUEUES.${m[1]} is scheduled but not defined in queues.ts`).toBeTruthy();
    out.push(name);
  }
  return out;
}

describe('QUEUE_EXPECTED_MAX_MINUTES mirrors the worker cron catalog', () => {
  it('the extraction itself found a realistic number of queues', () => {
    // Without this, a regex that silently stops matching makes every assertion
    // below vacuously true — the gate would pass hardest exactly when it broke.
    expect(scheduledQueues().length).toBeGreaterThanOrEqual(30);
  });

  it('every scheduled queue has a staleness allowance', () => {
    const missing = scheduledQueues().filter((q) => !(q in QUEUE_EXPECTED_MAX_MINUTES));
    expect(
      missing,
      `scheduled in worker/main.ts but absent from QUEUE_EXPECTED_MAX_MINUTES, so isQueueStale() can never flag them: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('every allowance names a queue that is actually scheduled', () => {
    // The other direction matters too: an entry for a queue nobody schedules is a
    // rename nobody finished, and it monitors nothing.
    const scheduled = new Set(scheduledQueues());
    const orphans = Object.keys(QUEUE_EXPECTED_MAX_MINUTES).filter((q) => !scheduled.has(q));
    expect(
      orphans,
      `listed in QUEUE_EXPECTED_MAX_MINUTES but never scheduled in worker/main.ts: ${orphans.join(', ')}`,
    ).toEqual([]);
  });

  it('no allowance is tighter than a blip or wider than a lost month', () => {
    for (const [queue, minutes] of Object.entries(QUEUE_EXPECTED_MAX_MINUTES)) {
      // 3 minutes is the every-minute family's allowance; anything under it would
      // flag a queue that is merely mid-run.
      expect(minutes, `${queue} allowance is too tight`).toBeGreaterThanOrEqual(3);
      // 40 days is the monthly job. Anything wider stops being monitoring.
      expect(minutes, `${queue} allowance is too wide to be monitoring`).toBeLessThanOrEqual(
        40 * 24 * 60,
      );
    }
  });
});

// A completed job must outlive its queue's staleness allowance, or isQueueStale
// loses its only evidence and reports a healthy queue as stale (measured
// 2026-09-30: the monthly archive-backup-sweep read red ~23 days a month).
describe('completedRetentionSeconds', () => {
  it('keeps about 1 day for queues ticking at least every 10 minutes and for send-it', () => {
    // allowance 3 min → 1 day + 3 min of margin
    expect(completedRetentionSeconds('outreach-arm')).toBe((24 * 60 + 3) * 60);
    expect(completedRetentionSeconds('voximplant-call-reconcile')).toBe((24 * 60 + 30) * 60);
    expect(completedRetentionSeconds(PGBOSS_SEND_IT_QUEUE)).toBe(SHORT_COMPLETED_RETENTION_SECONDS);
    expect(SHORT_COMPLETED_RETENTION_SECONDS).toBe(86400);
  });

  it('keeps the pg-boss 7-day default for hourly+ queues and uncatalogued (event-driven) ones', () => {
    expect(completedRetentionSeconds('voximplant-balance-check')).toBe(DEFAULT_COMPLETED_RETENTION_SECONDS);
    expect(completedRetentionSeconds('whatsapp-health-check')).toBe(DEFAULT_COMPLETED_RETENTION_SECONDS);
    expect(completedRetentionSeconds('outreach-step')).toBe(DEFAULT_COMPLETED_RETENTION_SECONDS);
    expect(DEFAULT_COMPLETED_RETENTION_SECONDS).toBe(604800);
  });

  it('stays above the docs floor ("above a few minutes") for every queue', () => {
    for (const q of [...Object.keys(QUEUE_EXPECTED_MAX_MINUTES), PGBOSS_SEND_IT_QUEUE]) {
      expect(completedRetentionSeconds(q)).toBeGreaterThanOrEqual(24 * 60 * 60);
    }
  });

  it("pins pg-boss's internal scheduler queue name to the installed pg-boss", () => {
    const src = readFileSync(join(process.cwd(), 'node_modules/pg-boss/dist/timekeeper.js'), 'utf8');
    expect(src).toContain(`SEND_IT: '${PGBOSS_SEND_IT_QUEUE}'`);
  });

  it('keeps a weekly job 11 days and the monthly backup 41 days', () => {
    expect(completedRetentionSeconds('seo-technical-watch')).toBe(11 * 24 * 60 * 60);
    expect(completedRetentionSeconds('archive-backup-sweep')).toBe(41 * 24 * 60 * 60);
  });

  it('never lets a catalogued queue lose its last completion inside its allowance', () => {
    for (const [queue, allowanceMinutes] of Object.entries(QUEUE_EXPECTED_MAX_MINUTES)) {
      expect(completedRetentionSeconds(queue)).toBeGreaterThan(allowanceMinutes * 60);
    }
  });
});

// A retired queue must be gone everywhere: not in QUEUES (no work/schedule is
// registered for it), not on the staleness catalog, and unscheduled + deleted
// by the worker at startup — otherwise its surviving schedule row keeps filing
// jobs that nothing drains.
describe('retired queues', () => {
  const workerSrc = readFileSync(join(process.cwd(), 'worker', 'main.ts'), 'utf8');

  it('are not live queues and are not on the staleness catalog', () => {
    const live = new Set<string>(Object.values(QUEUES));
    for (const name of RETIRED_QUEUES) {
      expect(live.has(name)).toBe(false);
      expect(QUEUE_EXPECTED_MAX_MINUTES[name]).toBeUndefined();
    }
  });

  it('are unscheduled and deleted by the worker at startup', () => {
    expect(workerSrc).toMatch(/for \(const retired of RETIRED_QUEUES\)[\s\S]{0,200}boss\.unschedule\(retired\)[\s\S]{0,80}boss\.deleteQueue\(retired\)/);
  });
});
