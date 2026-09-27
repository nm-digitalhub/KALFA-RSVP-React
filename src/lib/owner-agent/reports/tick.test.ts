import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { ReportAuditInput, ReportRunStatus, ReportSettings, ReportStore } from './store';
import { runReportTick } from './tick';

// The tick over an in-memory store that enforces the run table's UNIQUE key
// (subscription, local_date, slot_time), so "twelve ticks, one run, one job"
// is exercised rather than assumed.

interface Run {
  id: string;
  subscriptionId: string;
  localDate: string;
  slotTime: string;
  status: string;
  claimedAt: string;
}

let settings: ReportSettings | null;
let plannable: Array<{ id: string; slotTime: string; timezone: string }>;
let runs: Run[];
let audits: ReportAuditInput[];
let seq: number;
let clock: number;

function store(): ReportStore {
  const unused = async () => {
    throw new Error('not used by the tick');
  };
  return {
    loadRun: unused,
    loadSubscription: unused,
    loadEntry: unused,
    isStaff: unused,
    verifiedPhone: unused,
    hasPermission: unused,
    lastIntakeAt: unused,
    readSettings: async () => settings,
    listPlannable: async () => plannable,
    insertRun: async (subscriptionId, localDate, slotTime) => {
      if (runs.some((r) => r.subscriptionId === subscriptionId && r.localDate === localDate && r.slotTime === slotTime)) {
        return null;
      }
      seq += 1;
      const id = `run-${seq}`;
      runs.push({ id, subscriptionId, localDate, slotTime, status: 'queued', claimedAt: new Date(clock).toISOString() });
      return id;
    },
    transitionRun: async (id, from, to) => {
      const r = runs.find((x) => x.id === id);
      if (!r || !from.includes(r.status as ReportRunStatus)) return false;
      r.status = to;
      return true;
    },
    writeAudit: async (row) => {
      audits.push(row);
      return true;
    },
    listStrandedRuns: async (older, newer) =>
      runs
        .filter((r) => r.status === 'queued' && r.claimedAt <= older && r.claimedAt > newer)
        .map((r) => r.id),
    listStaleRuns: async (cutoff) =>
      runs.filter((r) => (r.status === 'queued' || r.status === 'processing') && r.claimedAt <= cutoff).map((r) => r.id),
  };
}

const MIN = 60_000;
const SLOT = Date.parse('2026-09-28T05:00:00Z'); // 08:00 Israel

let enqueued: string[];
let jobIds: Set<string>;
const enqueue = vi.fn(async (runId: string) => {
  enqueued.push(runId);
  if (jobIds.has(runId)) return false; // pg-boss ON CONFLICT DO NOTHING on the deterministic id
  jobIds.add(runId);
  return true;
});
const log = vi.fn();

function tick() {
  return runReportTick({ store: store(), enqueue, log, now: () => clock });
}

beforeEach(() => {
  vi.clearAllMocks();
  settings = {
    enabled: true,
    reportsEnabled: true,
    phoneNumberId: '123456789012345',
    templateName: null,
    templateLang: null,
    customTemplateName: null,
    customTemplateLang: null,
  };
  plannable = [{ id: 's1', slotTime: '08:00:00', timezone: 'Asia/Jerusalem' }];
  runs = [];
  audits = [];
  seq = 0;
  clock = SLOT;
  enqueued = [];
  jobIds = new Set();
});

describe('runReportTick', () => {
  it('plans a due slot once across every tick of the catch-up window', async () => {
    for (let t = SLOT - 10 * MIN; t < SLOT + 70 * MIN; t += 5 * MIN) {
      clock = t;
      await tick();
    }
    expect(runs).toEqual([
      expect.objectContaining({ subscriptionId: 's1', localDate: '2026-09-28', slotTime: '08:00:00' }),
    ]);
    // One job created; a later re-enqueue of a stranded run hits the same id.
    expect(jobIds).toEqual(new Set(['run-1']));
  });

  it('with either switch off, or no number, no run row is created', async () => {
    for (const s of [
      { ...settings!, enabled: false },
      { ...settings!, reportsEnabled: false },
      { ...settings!, phoneNumberId: null },
      null,
    ]) {
      settings = s;
      await tick();
    }
    expect(runs).toEqual([]);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('a failed enqueue leaves the run queued, and a later tick re-enqueues it with the same id', async () => {
    enqueue.mockRejectedValueOnce(new Error('pg down'));
    await tick();
    expect(runs[0].status).toBe('queued');
    expect(jobIds.size).toBe(0);
    clock = SLOT + 5 * MIN;
    expect((await tick()).requeued).toBe(1);
    expect(jobIds).toEqual(new Set(['run-1']));
  });

  it('a queued run younger than the stranded threshold is not re-enqueued', async () => {
    await tick();
    enqueued = [];
    clock = SLOT + 60_000;
    await tick();
    expect(enqueued).toEqual([]);
  });

  it('expires queued/processing runs claimed a catch-up window ago, with an audit row', async () => {
    runs.push(
      { id: 'old-q', subscriptionId: 's9', localDate: '2026-09-28', slotTime: '00:00:00', status: 'queued', claimedAt: new Date(SLOT - 61 * MIN).toISOString() },
      { id: 'old-p', subscriptionId: 's9', localDate: '2026-09-27', slotTime: '00:00:00', status: 'processing', claimedAt: new Date(SLOT - 5 * 60 * MIN).toISOString() },
      { id: 'old-s', subscriptionId: 's9', localDate: '2026-09-26', slotTime: '00:00:00', status: 'sending', claimedAt: new Date(SLOT - 5 * 60 * MIN).toISOString() },
    );
    settings = { ...settings!, reportsEnabled: false }; // housekeeping runs regardless
    const r = await tick();
    expect(r.expired).toBe(2);
    expect(runs.find((x) => x.id === 'old-q')?.status).toBe('expired');
    expect(runs.find((x) => x.id === 'old-p')?.status).toBe('expired');
    // A run that may have sent is never touched here.
    expect(runs.find((x) => x.id === 'old-s')?.status).toBe('sending');
    expect(audits).toEqual([
      { outcome: 'expired', reasonCode: 'late', reportRunId: 'old-q' },
      { outcome: 'expired', reasonCode: 'late', reportRunId: 'old-p' },
    ]);
    // An expired run is not re-enqueued.
    expect(enqueued).not.toContain('old-q');
  });

  it('logs counts only', async () => {
    await tick();
    expect(log).toHaveBeenCalledWith('[owner-agent] report tick expired=0 planned=1 requeued=0');
  });
});
