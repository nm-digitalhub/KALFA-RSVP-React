import { beforeEach, describe, expect, it, vi } from 'vitest';

// This sweep deletes accounts irreversibly, so the contract worth pinning is
// restraint: off unless armed, a hard cap per run, and no address in any log.
vi.mock('server-only', () => ({}));

const { createAdminClient, sendSlackAlert } = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  sendSlackAlert: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert }));

import {
  getUnconfirmedCleanupEnabled,
  runUnconfirmedCleanupSweep,
} from './unconfirmed-signup-cleanup';

type Stale = { user_id: string; email: string; created_at: string };

let candidates: Stale[];
let rpc: ReturnType<typeof vi.fn>;
let deleteUser: ReturnType<typeof vi.fn>;
let settingsRow: Record<string, unknown> | null;

function stale(n: number): Stale {
  return { user_id: `u${n}`, email: `p${n}@example.com`, created_at: '2026-07-01T00:00:00Z' };
}

beforeEach(() => {
  vi.clearAllMocks();
  candidates = [stale(1), stale(2)];
  settingsRow = { unconfirmed_cleanup_enabled: true };
  rpc = vi.fn(async () => ({ data: candidates, error: null }));
  deleteUser = vi.fn(async () => ({ error: null }));

  createAdminClient.mockReturnValue({
    rpc,
    auth: { admin: { deleteUser } },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: settingsRow, error: null }) }),
      }),
    }),
  });
});

describe('getUnconfirmedCleanupEnabled', () => {
  it('false when off', async () => {
    settingsRow = { unconfirmed_cleanup_enabled: false };
    expect(await getUnconfirmedCleanupEnabled()).toBe(false);
  });

  it('false when the settings row cannot be read — never delete on a failed read', async () => {
    settingsRow = null;
    expect(await getUnconfirmedCleanupEnabled()).toBe(false);
  });

  it('true only for an explicit true', async () => {
    expect(await getUnconfirmedCleanupEnabled()).toBe(true);
  });
});

describe('runUnconfirmedCleanupSweep', () => {
  it('deletes each candidate through the documented admin API', async () => {
    const res = await runUnconfirmedCleanupSweep();
    expect(res).toEqual({ deleted: 2, failed: 0, candidates: 2 });
    expect(deleteUser).toHaveBeenCalledWith('u1');
    expect(deleteUser).toHaveBeenCalledWith('u2');
  });

  it('asks for the 30-day window Supabase documents for its own cleanup', async () => {
    await runUnconfirmedCleanupSweep();
    expect(rpc).toHaveBeenCalledWith('stale_unconfirmed_signups', { max_age_days: 30 });
  });

  it('a refused delete is counted and does not stop the rest', async () => {
    deleteUser.mockResolvedValueOnce({ error: { message: 'owns storage objects' } });
    const res = await runUnconfirmedCleanupSweep();
    expect(res).toEqual({ deleted: 1, failed: 1, candidates: 2 });
    expect(deleteUser).toHaveBeenCalledTimes(2);
  });

  it('caps a run at 50 — an unexpected candidate list can only do bounded damage', async () => {
    candidates = Array.from({ length: 90 }, (_, i) => stale(i));
    const res = await runUnconfirmedCleanupSweep();
    expect(res.candidates).toBe(50);
    expect(deleteUser).toHaveBeenCalledTimes(50);
  });

  it('stays silent when there is nothing to delete', async () => {
    candidates = [];
    await runUnconfirmedCleanupSweep();
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('reports by user id — an address never reaches Slack', async () => {
    deleteUser.mockResolvedValueOnce({ error: { message: 'nope' } });
    await runUnconfirmedCleanupSweep();
    const alert = sendSlackAlert.mock.calls[0][0];
    const text = `${alert.title}\n${alert.detail}`;
    expect(text).toContain('u1');
    expect(text).not.toContain('@example.com');
    expect(alert.level).toBe('warn');
  });

  it('a candidate-query failure aborts — it never falls back to deleting nothing quietly', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(runUnconfirmedCleanupSweep()).rejects.toThrow(/stale_unconfirmed_signups/);
    expect(deleteUser).not.toHaveBeenCalled();
  });
});
