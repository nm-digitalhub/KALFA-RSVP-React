import { describe, expect, it } from 'vitest';

import { completedRetentionSeconds, PGBOSS_SEND_IT_QUEUE } from '@/lib/ops/queue-schedule';

import { ensureQueues } from './queue-setup';
import { QUEUES, RETIRED_QUEUES, WORKFLOW_RUN_EXPIRE_SECONDS } from './queues';

// A stand-in for the pg-boss calls ensureQueues makes, recording each one in order.
type Existing = { name: string; expireInSeconds: number; deleteAfterSeconds: number };
function fakeBoss(existing: Existing[] = []) {
  const calls: Array<[string, ...unknown[]]> = [];
  const boss = {
    unschedule: async (name: string) => void calls.push(['unschedule', name]),
    deleteQueue: async (name: string) => void calls.push(['deleteQueue', name]),
    getQueues: async () => existing,
    createQueue: async (name: string, options: unknown) => void calls.push(['createQueue', name, options]),
    updateQueue: async (name: string, options: unknown) => void calls.push(['updateQueue', name, options]),
  };
  return { boss: boss as unknown as Parameters<typeof ensureQueues>[0], calls };
}

const created = (calls: Array<[string, ...unknown[]]>) =>
  new Map(calls.filter(([c]) => c === 'createQueue').map(([, name, options]) => [name as string, options as Record<string, unknown>]));

describe('ensureQueues', () => {
  it('unschedules each retired queue before deleting it, ahead of everything else', async () => {
    const { boss, calls } = fakeBoss();
    await ensureQueues(boss);
    const retired = calls.slice(0, RETIRED_QUEUES.length * 2);
    expect(retired).toEqual(RETIRED_QUEUES.flatMap((name) => [['unschedule', name], ['deleteQueue', name]]));
  });

  it('on an empty schema creates every queue, with its policy, expiry and retention', async () => {
    const { boss, calls } = fakeBoss();
    await ensureQueues(boss);
    const made = created(calls);
    expect([...made.keys()].sort()).toEqual(Object.values(QUEUES).sort());

    // the one a test payment sends to: a standard queue with the default expiry
    expect(made.get(QUEUES.packageActivation)).toEqual({ deleteAfterSeconds: completedRetentionSeconds(QUEUES.packageActivation) });
    expect(made.get(QUEUES.callbackSweep)).toEqual({
      policy: 'singleton',
      expireInSeconds: 300,
      deleteAfterSeconds: completedRetentionSeconds(QUEUES.callbackSweep),
    });
    expect(made.get(QUEUES.workflowRun)).toMatchObject({ expireInSeconds: WORKFLOW_RUN_EXPIRE_SECONDS });
    expect(calls.some(([c]) => c === 'updateQueue')).toBe(false);
  });

  it('leaves an existing queue alone when it matches, and updates only what differs', async () => {
    const matching = { name: QUEUES.packageActivation, expireInSeconds: 900, deleteAfterSeconds: completedRetentionSeconds(QUEUES.packageActivation) };
    const stale = { name: QUEUES.callbackSweep, expireInSeconds: 900, deleteAfterSeconds: completedRetentionSeconds(QUEUES.callbackSweep) };
    const { boss, calls } = fakeBoss([matching, stale]);
    await ensureQueues(boss);
    const made = created(calls);
    expect(made.has(QUEUES.packageActivation)).toBe(false);
    expect(made.has(QUEUES.callbackSweep)).toBe(false);
    expect(calls.filter(([c]) => c === 'updateQueue')).toEqual([['updateQueue', QUEUES.callbackSweep, { expireInSeconds: 300 }]]);
  });

  it("aligns only the retention of pg-boss's own send-it queue, and only when it exists", async () => {
    const { boss, calls } = fakeBoss([{ name: PGBOSS_SEND_IT_QUEUE, expireInSeconds: 900, deleteAfterSeconds: 1 }]);
    await ensureQueues(boss);
    expect(calls.filter(([, name]) => name === PGBOSS_SEND_IT_QUEUE)).toEqual([
      ['updateQueue', PGBOSS_SEND_IT_QUEUE, { deleteAfterSeconds: completedRetentionSeconds(PGBOSS_SEND_IT_QUEUE) }],
    ]);

    const empty = fakeBoss();
    await ensureQueues(empty.boss);
    expect(empty.calls.some(([, name]) => name === PGBOSS_SEND_IT_QUEUE)).toBe(false);
  });
});
