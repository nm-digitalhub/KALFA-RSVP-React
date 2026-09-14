import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { adminMock, rpcMock, senderMock, updateMock } = vi.hoisted(() => ({
  adminMock: vi.fn(),
  rpcMock: vi.fn(),
  senderMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: adminMock }));
vi.mock('@/lib/queue/web-sender', () => ({ getWebJobSender: senderMock }));

import { QUEUES } from '@/lib/queue/queues';
import { wakeParkedRun } from './wake';

// Waking a parked run early, and the ONE ordering rule that makes it safe.
//
// ⚠️ THE TWO HALVES ARE NOT INTERCHANGEABLE. The database call moves the step's
// own `wait_until`, which is what `claimStep` reads — a run delivered early
// while that deadline is still in the future reads 'in_flight' and is FAILED by
// `step_in_flight`, not woken. The queue call only decides when the run finds
// out. So the database half is the one that must happen, must happen first, and
// must be the one that gates whether the second runs at all.
//
// These tests pin exactly that: the gate is the RPC's answer, the queue is never
// touched on a miss, and a queue miss is not an error.

const RUN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NODE = 'node-7';
const CORR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function rpcReturns(value: boolean | null, error: { message: string } | null = null) {
  rpcMock.mockResolvedValue({ data: value, error });
  adminMock.mockReturnValue({ rpc: rpcMock });
}

function queueUpdates(updated: number) {
  updateMock.mockResolvedValue({ jobs: Array(updated).fill('job'), updated });
  senderMock.mockResolvedValue({ update: updateMock });
}

beforeEach(() => vi.clearAllMocks());

describe('wakeParkedRun', () => {
  it('moves the step deadline, then pulls the job forward', async () => {
    rpcReturns(true);
    queueUpdates(1);

    const before = Date.now();
    const outcome = await wakeParkedRun({ runId: RUN, nodeId: NODE, correlationId: CORR });

    expect(outcome).toEqual({ woke: true, delivered: true });
    expect(rpcMock).toHaveBeenCalledWith('wake_parked_workflow_run', {
      p_run_id: RUN,
      p_node_id: NODE,
      p_correlation_id: CORR,
    });

    const [queue, data, opts] = updateMock.mock.calls[0]!;
    expect(queue).toBe(QUEUES.workflowRun);
    // ⚠️ `undefined`, never `null`. pg-boss drops an undefined key from the patch
    // and leaves the job's payload alone; `null` CLEARS it, and the payload is
    // the run id the handler has nothing else to work from.
    expect(data).toBeUndefined();
    // The handle is the run id, which is what enqueueWorkflowRun already sets as
    // the job's singletonKey. Targeting by it is what edits the job in place
    // instead of adding a second delivery for the same run.
    expect(opts.singletonKey).toBe(RUN);
    expect((opts.startAfter as Date).getTime()).toBeGreaterThanOrEqual(before);
  });

  it('⚠️ never touches the queue when the run is not waiting on this event', async () => {
    rpcReturns(false);
    queueUpdates(1);

    expect(await wakeParkedRun({ runId: RUN, nodeId: NODE, correlationId: CORR })).toEqual({
      woke: false,
      delivered: false,
    });
    // Not merely "did not update" — the sender is never even opened. A run that
    // has moved on, or parked again for an unrelated reason, must not be
    // delivered early because an old call finally reported in.
    expect(senderMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('a queue miss is reported, not thrown — the durable half already landed', async () => {
    rpcReturns(true);
    // No pending job to edit: the run's job is already active (a worker is
    // walking the graph and will read the deadline this wake just wrote), or it
    // is gone and the recovery sweep owns it. Neither loses the wake.
    queueUpdates(0);

    expect(await wakeParkedRun({ runId: RUN, nodeId: NODE, correlationId: CORR })).toEqual({
      woke: true,
      delivered: false,
    });
  });

  it('a database error IS thrown — the caller must not report a wake that did not happen', async () => {
    rpcReturns(null, { message: 'permission denied' });
    queueUpdates(1);

    await expect(
      wakeParkedRun({ runId: RUN, nodeId: NODE, correlationId: CORR }),
    ).rejects.toThrow(/markParkedRunReady failed/);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('treats anything but a literal true as "not woken"', async () => {
    // The RPC returns boolean, but a PostgREST shape change that started
    // returning null must read as "no wake", never as one.
    rpcReturns(null);
    queueUpdates(1);

    expect(await wakeParkedRun({ runId: RUN, nodeId: NODE, correlationId: CORR })).toEqual({
      woke: false,
      delivered: false,
    });
    expect(updateMock).not.toHaveBeenCalled();
  });
});
