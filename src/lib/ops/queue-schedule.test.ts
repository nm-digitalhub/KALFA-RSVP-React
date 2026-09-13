import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { QUEUE_EXPECTED_MAX_MINUTES } from './queue-schedule';

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
