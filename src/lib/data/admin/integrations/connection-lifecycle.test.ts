import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// `vi.mock` is hoisted above every `const`, so the spies have to be created by
// `vi.hoisted` — the convention the other DAL tests here already use.
const { requirePlatformPermission, rpc } = vi.hoisted(() => ({
  requirePlatformPermission: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc }) }));

import {
  deleteIntegrationConnection,
  disconnectIntegrationConnection,
  renameIntegrationConnection,
} from './connection-lifecycle';

const ID = '11111111-2222-4333-8444-555555555555';

beforeEach(() => {
  requirePlatformPermission.mockReset();
  requirePlatformPermission.mockResolvedValue({ id: 'admin-1' });
  rpc.mockReset();
});

// ⚠️ THE GATE IS THE POINT OF THIS FILE. These three calls end or rename
// something other workflows are using, and none of them is reversible by the
// person who triggered it. A missing `await` on the permission check is
// invisible: the tests still pass, the RPC still runs, and the only signal is
// that someone without `integrations.manage` could kill a live connection.

describe('who is allowed to do this', () => {
  it('⚠️ every operation demands integrations.manage — not integrations.read', () => {
    // `read` is what the PICKER is gated on, so that a workflow author who may
    // not manage integrations can still choose an account. Copying that weaker
    // gate here would let the same author destroy one.
    for (const fn of [
      disconnectIntegrationConnection,
      deleteIntegrationConnection,
    ] as const) {
      rpc.mockResolvedValueOnce({ data: true, error: null });
      void fn(ID);
    }
    rpc.mockResolvedValueOnce({ data: true, error: null });
    void renameIntegrationConnection(ID, 'x');

    expect(requirePlatformPermission).toHaveBeenCalledTimes(3);
    for (const call of requirePlatformPermission.mock.calls) {
      expect(call[0]).toBe('integrations.manage');
    }
  });

  it('⚠️ checks BEFORE touching the database, not alongside it', async () => {
    // A refused permission must mean the RPC never ran. If the check were
    // awaited after the call, a rejected user would still have disconnected the
    // connection before the error surfaced.
    requirePlatformPermission.mockRejectedValueOnce(new Error('forbidden'));
    await expect(disconnectIntegrationConnection(ID)).rejects.toThrow('forbidden');
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('disconnect', () => {
  it('passes the id and reports that something changed', async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    await expect(disconnectIntegrationConnection(ID)).resolves.toEqual({ ok: true, changed: true });
    expect(rpc).toHaveBeenCalledWith('integrations_disconnect_credential', { p_connection_id: ID });
  });

  it('⚠️ an already-revoked connection is a SUCCESS, not a failure', async () => {
    // The RPC returns false when nothing matched. Reporting that as an error
    // would show a red message to someone who clicked twice, or to the second
    // of two people pressing at once — for a state that is exactly what they
    // asked for.
    rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(disconnectIntegrationConnection(ID)).resolves.toEqual({ ok: true, changed: false });
  });

  it('turns a database error into a safe sentence', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'connection refused at 10.0.0.1' } });
    const result = await disconnectIntegrationConnection(ID);
    expect(result).toEqual({ ok: false, reason: 'ניתוק החיבור נכשל.' });
    expect(JSON.stringify(result)).not.toContain('10.0.0.1');
  });
});

describe('rename', () => {
  it('⚠️ does NOT validate the label itself — the database owns that rule', async () => {
    // Re-checking here would be a second definition of "valid" that drifts from
    // the one actually enforced, and would still not protect a direct RPC call.
    // So a blank label is sent, and the refusal comes back from the RPC.
    rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'empty' } });
    const result = await renameIntegrationConnection(ID, '   ');
    expect(rpc).toHaveBeenCalledWith('integrations_rename_credential', {
      p_connection_id: ID,
      p_label: '   ',
    });
    expect(result).toEqual({ ok: false, reason: 'שם החיבור חייב להיות בין תו אחד ל-200 תווים.' });
  });

  it('⚠️ separates the user mistake from the infrastructure failure', async () => {
    // Both are `error`, and telling a person "the name is invalid" when the
    // database was unreachable sends them editing a name that was fine.
    rpc.mockResolvedValueOnce({ data: null, error: { code: '08006', message: 'gone' } });
    await expect(renameIntegrationConnection(ID, 'ok')).resolves.toEqual({
      ok: false, reason: 'שינוי שם החיבור נכשל.',
    });
  });
});

describe('delete', () => {
  it('⚠️ names the two refusals apart, because the remedies differ', async () => {
    // 23503 — remove it from the workflow first.
    // 22023 — disconnect it first.
    // One message for both would send half the users down the wrong path.
    rpc.mockResolvedValueOnce({ data: null, error: { code: '23503', message: 'referenced' } });
    await expect(deleteIntegrationConnection(ID)).resolves.toEqual({
      ok: false, reason: 'החיבור עדיין בשימוש בתהליך קיים. הסירו אותו משם תחילה.',
    });

    rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'active' } });
    await expect(deleteIntegrationConnection(ID)).resolves.toEqual({
      ok: false, reason: 'יש לנתק את החיבור לפני מחיקתו.',
    });
  });

  it('an unknown id is not an error', async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(deleteIntegrationConnection(ID)).resolves.toEqual({ ok: true, changed: false });
  });
});
