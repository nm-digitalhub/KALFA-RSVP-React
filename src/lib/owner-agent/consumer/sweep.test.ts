import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));

import { createFakeTableClient, type TableRow } from '@/test/fake-table-client';
import type { createAdminClient } from '@/lib/supabase/admin';
import { deterministicJobId } from '@/lib/queue/deterministic-id';
import type { OwnerAgentReplyJob } from '@/lib/queue/queues';

import { createReplyStore } from './store';
import { REENQUEUE_UNTIL_MS, STRANDED_AFTER_MS, runStrandedIntakeSweep } from './sweep';

type AdminClient = ReturnType<typeof createAdminClient>;

const NOW = Date.parse('2026-09-24T09:30:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const STAFF = '11111111-1111-4111-8111-111111111111';
const iso = (ms: number) => new Date(ms).toISOString();

function row(id: string, status: string, ageMs: number): TableRow {
  return {
    id,
    wamid: `wamid.${id}`,
    phone_number_id: '1111222233334444',
    staff_user_id: STAFF,
    message_text: 'שאלה',
    status,
    received_at: iso(NOW - ageMs),
    processed_at: null,
  };
}

// A pg-boss double with the one property the sweep relies on: send() with an id
// that already exists inserts nothing and answers null (ON CONFLICT DO NOTHING).
function fakeBoss(existingIds: string[] = []) {
  const jobs = new Map<string, OwnerAgentReplyJob>(existingIds.map((id) => [id, { intakeId: 'earlier' }]));
  const sends: string[] = [];
  const enqueue = async (job: OwnerAgentReplyJob, wamid: string) => {
    const id = deterministicJobId(wamid);
    sends.push(id);
    if (jobs.has(id)) return false;
    jobs.set(id, job);
    return true;
  };
  return { jobs, sends, enqueue };
}

function setup(rows: TableRow[], existingJobIds: string[] = []) {
  const db = createFakeTableClient({ owner_agent_intake: rows, owner_agent_audit: [] });
  const boss = fakeBoss(existingJobIds);
  const logs: string[] = [];
  const deps = {
    store: createReplyStore(db.client as unknown as AdminClient),
    enqueue: boss.enqueue,
    log: (l: string) => logs.push(l),
    now: () => NOW,
  };
  return { db, boss, logs, deps };
}

describe('runStrandedIntakeSweep', () => {
  const rows = () => [
    row('fresh', 'queued', 30_000), // its job is surely still in flight
    row('stranded', 'queued', 10 * MIN),
    row('old-but-in-window', 'queued', 22 * HOUR),
    row('grace', 'queued', 23 * HOUR + 30 * MIN), // too late to re-enqueue, not yet expired
    row('expired-queued', 'queued', 25 * HOUR),
    row('expired-processing', 'processing', 30 * HOUR),
    row('answered-old', 'answered', 30 * HOUR),
    row('sending-old', 'sending', 30 * HOUR), // unknown outcome: the handler closes it, not the sweep
  ];

  it('re-enqueues stranded queued rows with the route\'s own job id, and expires rows past 24h', async () => {
    const { db, boss, deps, logs } = setup(rows());
    expect(await runStrandedIntakeSweep(deps)).toEqual({ expired: 2, requeued: 2 });

    // Oldest first (listStranded orders by received_at).
    expect(boss.sends).toEqual([deterministicJobId('wamid.old-but-in-window'), deterministicJobId('wamid.stranded')]);
    expect([...boss.jobs.values()]).toEqual([{ intakeId: 'old-but-in-window' }, { intakeId: 'stranded' }]);

    const status = Object.fromEntries(db.tables.owner_agent_intake.map((r) => [r.id, r.status]));
    expect(status).toEqual({
      fresh: 'queued',
      stranded: 'queued',
      'old-but-in-window': 'queued',
      grace: 'queued',
      'expired-queued': 'expired',
      'expired-processing': 'expired',
      'answered-old': 'answered',
      'sending-old': 'sending',
    });
    // Oldest first (listExpirable orders by received_at).
    expect(db.tables.owner_agent_audit.map((r) => [r.stage, r.outcome, r.reason_code, r.intake_id])).toEqual([
      ['sweep', 'expired', 'window_closed', 'expired-processing'],
      ['sweep', 'expired', 'window_closed', 'expired-queued'],
    ]);
    expect(logs).toEqual(['[owner-agent] sweep expired=2 requeued=2']);
  });

  it('is idempotent: a second run creates no job and writes no audit row', async () => {
    const { db, boss, deps } = setup(rows());
    await runStrandedIntakeSweep(deps);
    const jobsAfterFirst = boss.jobs.size;
    const auditsAfterFirst = db.tables.owner_agent_audit.length;

    expect(await runStrandedIntakeSweep(deps)).toEqual({ expired: 0, requeued: 0 });
    expect(boss.jobs.size).toBe(jobsAfterFirst);
    expect(db.tables.owner_agent_audit).toHaveLength(auditsAfterFirst);
  });

  it('a job that still exists (waiting or done) is not duplicated', async () => {
    const { boss, deps } = setup([row('stranded', 'queued', 10 * MIN)], [deterministicJobId('wamid.stranded')]);
    expect(await runStrandedIntakeSweep(deps)).toEqual({ expired: 0, requeued: 0 });
    expect(boss.jobs.size).toBe(1);
  });

  it('the window edges are the constants', async () => {
    const { boss, deps } = setup([
      row('just-under-2m', 'queued', STRANDED_AFTER_MS - 1),
      row('at-2m', 'queued', STRANDED_AFTER_MS),
      row('at-23h', 'queued', REENQUEUE_UNTIL_MS),
      row('just-under-23h', 'queued', REENQUEUE_UNTIL_MS - 1),
    ]);
    await runStrandedIntakeSweep(deps);
    expect([...boss.jobs.values()].map((j) => j.intakeId).sort()).toEqual(['at-2m', 'just-under-23h']);
  });

  it('a quiet tick logs nothing', async () => {
    const { deps, logs } = setup([row('fresh', 'queued', 1_000)]);
    await runStrandedIntakeSweep(deps);
    expect(logs).toEqual([]);
  });
});
