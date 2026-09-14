import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { adminMock, permMock } = vi.hoisted(() => ({
  adminMock: vi.fn(),
  permMock: vi.fn(),
}));

vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: permMock }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: adminMock }));
vi.mock('@/lib/workflow/adapter/to-definition', () => ({ toWorkflowDefinition: vi.fn() }));
vi.mock('@/lib/workflow/engine/dry-run', () => ({}));

import { cancelRun } from './workflows';

// ⚠️ WHICH RUNS MAY BE STOPPED, and why a parked one is now among them.
//
// The rule was "queued only", on the grounds that the vendored runner cannot be
// interrupted once it is inside `runGraph`. That reasoning is sound and it does
// NOT cover a parked run: a run waiting on `logic.wait` is not inside runGraph —
// it is a row with a deadline and a pg-boss job that has not fired. With waits
// allowed up to a year, refusing to cancel it left an owner watching a run they
// no longer wanted with no way to stop it, since disarming does not touch runs
// already in flight.

function mockDb(matched: { id: string }[]) {
  const calls = { updated: null as Record<string, unknown> | null, statuses: null as unknown };
  adminMock.mockReturnValue({
    from: () => ({
      update: (values: Record<string, unknown>) => {
        calls.updated = values;
        return {
          eq: () => ({
            in: (_col: string, values2: unknown) => {
              calls.statuses = values2;
              return { select: async () => ({ data: matched, error: null }) };
            },
          }),
        };
      },
    }),
  });
  return calls;
}

beforeEach(() => {
  vi.clearAllMocks();
  permMock.mockResolvedValue(undefined);
});

describe('cancelRun', () => {
  it('⚠️ stops a QUEUED run and a PARKED one, and nothing else', async () => {
    const calls = mockDb([{ id: 'run-1' }]);
    await expect(cancelRun('run-1')).resolves.toEqual({ ok: true });
    expect(calls.statuses).toEqual(['pending', 'waiting']);
  });

  it('⚠️ clears the deadline along with the status', async () => {
    // `resume_at` means "wake me then", and a cancelled run is never waking.
    // Left set, the row would also stay in the partial index the stuck-run sweep
    // reads — and be re-delivered by the very sweep meant to rescue it.
    const calls = mockDb([{ id: 'run-1' }]);
    await cancelRun('run-1');
    expect(calls.updated).toMatchObject({ status: 'cancelled', resume_at: null });
    expect(calls.updated!.finished_at).toEqual(expect.any(String));
  });

  it('reports a run that had already moved on, rather than claiming success', async () => {
    // The status filter IS the concurrency story: a worker that claimed the job
    // first leaves zero rows matched.
    mockDb([]);
    const r = await cancelRun('run-1');
    expect(r.ok).toBe(false);
  });

  it('requires the admin permission before touching anything', async () => {
    permMock.mockRejectedValue(new Error('denied'));
    mockDb([{ id: 'run-1' }]);
    await expect(cancelRun('run-1')).rejects.toThrow('denied');
    expect(adminMock).not.toHaveBeenCalled();
  });
});
