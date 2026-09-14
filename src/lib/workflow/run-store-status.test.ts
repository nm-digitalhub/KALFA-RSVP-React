import { beforeEach, describe, expect, it, vi } from 'vitest';

// The two "still owed a wake-up" columns on workflow_runs, and the one rule that
// makes both of them safe: WRITTEN ON 'waiting', CLEARED ON EVERYTHING ELSE.
//
// ⚠️ WHY THIS NEEDED A TEST. `resume_at` has carried that rule since it was
// added and nothing pinned it — the recovery sweep reads
// `resume_at where status = 'waiting'`, so a finished run that kept a stale
// deadline would be re-delivered for ever by a sweep that believed it was still
// parked. `resume_correlation_id` (0ב-1) has exactly the same failure shape and
// a worse consequence: a run that parked AGAIN for an unrelated reason while
// holding an old correlation could be woken by an event that has nothing to do
// with its current wait.
//
// Both are cleared UNCONDITIONALLY on a non-waiting status rather than only when
// a new value is supplied. That is the property under test: omitting the field
// must still clear the column.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { createRunStore } from '@/lib/workflow/store';

type Row = Record<string, unknown>;

function mock() {
  const { client, builder } = createMockSupabase<Row>({ data: null, error: null });
  vi.mocked(createAdminClient).mockReturnValue(
    client as unknown as ReturnType<typeof createAdminClient>,
  );
  return builder;
}

const patchOf = (builder: ReturnType<typeof mock>) =>
  vi.mocked(builder.update).mock.calls[0]![0] as Row;

beforeEach(() => vi.clearAllMocks());

describe('setRunStatus — the wake-up columns', () => {
  it("writes both when the run parks", async () => {
    const builder = mock();
    await createRunStore().setRunStatus({
      runId: 'r1',
      status: 'waiting',
      resumeAt: '2026-09-14T12:00:00.000Z',
      resumeCorrelationId: 'attempt-1',
    });
    const patch = patchOf(builder);
    expect(patch.resume_at).toBe('2026-09-14T12:00:00.000Z');
    expect(patch.resume_correlation_id).toBe('attempt-1');
    // A parked run has not finished.
    expect(patch).not.toHaveProperty('finished_at');
  });

  it('parks on a deadline alone — a timed wait carries no correlation', async () => {
    const builder = mock();
    await createRunStore().setRunStatus({
      runId: 'r1',
      status: 'waiting',
      resumeAt: '2026-09-14T12:00:00.000Z',
    });
    const patch = patchOf(builder);
    expect(patch.resume_at).toBe('2026-09-14T12:00:00.000Z');
    expect(patch.resume_correlation_id).toBeNull();
  });

  it.each(['running', 'completed', 'failed', 'cancelled'] as const)(
    '⚠️ clears BOTH on %s — even though neither was supplied',
    async (status) => {
      const builder = mock();
      await createRunStore().setRunStatus({ runId: 'r1', status });
      const patch = patchOf(builder);
      expect(patch.resume_at).toBeNull();
      expect(patch.resume_correlation_id).toBeNull();
    },
  );

  it('⚠️ clears both even when values ARE supplied on a non-waiting status', async () => {
    // The status decides, not the argument. A caller passing a correlation with
    // 'completed' is confused, and the column must not record the confusion.
    const builder = mock();
    await createRunStore().setRunStatus({
      runId: 'r1',
      status: 'completed',
      resumeAt: '2026-09-14T12:00:00.000Z',
      resumeCorrelationId: 'attempt-1',
    });
    const patch = patchOf(builder);
    expect(patch.resume_at).toBeNull();
    expect(patch.resume_correlation_id).toBeNull();
  });

  it('stamps finished_at on a terminal status only', async () => {
    const terminal = mock();
    await createRunStore().setRunStatus({ runId: 'r1', status: 'completed' });
    expect(patchOf(terminal)).toHaveProperty('finished_at');

    vi.clearAllMocks();
    const live = mock();
    await createRunStore().setRunStatus({ runId: 'r1', status: 'running' });
    expect(patchOf(live)).not.toHaveProperty('finished_at');
  });
});
