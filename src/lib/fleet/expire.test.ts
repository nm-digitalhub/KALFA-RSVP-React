import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));

import { createMockSupabase, type MockQueryBuilder } from '@/test/supabase-mock';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { runFleetExpireSweep } from '@/lib/fleet/expire';
import type { createAdminClient } from '@/lib/supabase/admin';

type Row = Record<string, unknown>;
type Admin = ReturnType<typeof createAdminClient>;

const NOW_MS = Date.parse('2026-08-24T04:00:00+00:00');

beforeEach(() => vi.clearAllMocks());

function mockedAdmin(): { admin: Admin; builder: MockQueryBuilder<Row> } {
  const { client, builder } = createMockSupabase<Row>({ data: null, error: null });
  return { admin: client as unknown as Admin, builder };
}

function resolveWith(builder: MockQueryBuilder<Row>, result: Row[] | null, error: { message: string } | null = null) {
  vi.spyOn(builder, 'then').mockImplementationOnce((f) =>
    (f as (v: unknown) => unknown)({ data: result, error }),
  );
}

describe('runFleetExpireSweep', () => {
  it('marks overdue pending requests expired and alerts with role+title only', async () => {
    const { admin, builder } = mockedAdmin();
    resolveWith(builder, [
      { id: 'r1', role: 'ops-monitor', title: 'דיסק 97%' },
      { id: 'r2', role: 'qa-runner', title: 'שאלה' },
    ]);

    const result = await runFleetExpireSweep(admin, NOW_MS);

    expect(result.expired).toBe(2);
    // The CAS shape is the guard's legal pending->expired edge: status filter +
    // expires_at cutoff, both server-side — never an unconditional update.
    expect(builder.update).toHaveBeenCalledWith({ status: 'expired' });
    expect(builder.eq).toHaveBeenCalledWith('status', 'pending');
    expect(builder.lte).toHaveBeenCalledWith('expires_at', new Date(NOW_MS).toISOString());
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        title: '2 פניות סוכנים פגו ללא מענה',
        source: 'fleet:expire-sweep',
      }),
    );
  });

  it('is a silent no-op when nothing is overdue', async () => {
    const { admin, builder } = mockedAdmin();
    resolveWith(builder, []);

    const result = await runFleetExpireSweep(admin, NOW_MS);

    expect(result).toEqual({ expired: 0, requests: [] });
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('throws on a DB error (guardedWorker/CLI decide how to surface it)', async () => {
    const { admin, builder } = mockedAdmin();
    resolveWith(builder, null, { message: 'boom' });

    await expect(runFleetExpireSweep(admin, NOW_MS)).rejects.toThrow(
      'fleet expire sweep failed: boom',
    );
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });
});
