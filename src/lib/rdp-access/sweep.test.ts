import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { runRdpAccessSweep, type RdpAccessSweepDeps } from './sweep';

type Admin = Parameters<typeof runRdpAccessSweep>[0];
const admin = {} as unknown as Admin;
const NOW = new Date('2026-10-06T17:00:00Z');
const G1 = 'aaaaaaaa-1111-4111-8111-111111111111';
const G2 = 'bbbbbbbb-2222-4222-8222-222222222222';

const CONFIG_OK = {
  ok: true as const,
  config: {
    gatewayOrigin: 'http://127.0.0.1:3013',
    adminOrigin: 'http://127.0.0.1:3014',
    target: 'desktop.example.test:3389',
    gatewayUser: 'desktopuser',
    checkSecret: 'c'.repeat(40),
    connectSecret: 'n'.repeat(40),
    adminSecret: 'a'.repeat(40),
  },
};

function deps(overrides: Partial<RdpAccessSweepDeps> = {}) {
  const base = {
    sweep: vi.fn().mockResolvedValue({ requestsExpired: 1, grantsExpired: 2, accessRemoved: 0 }),
    listPending: vi.fn().mockResolvedValue([]),
    hasActiveGrant: vi.fn().mockResolvedValue(false),
    getConfig: vi.fn().mockReturnValue(CONFIG_OK),
    disconnect: vi.fn().mockResolvedValue({ ok: true, value: { closed: 1 } }),
    markCut: vi.fn().mockResolvedValue(undefined),
    alert: vi.fn().mockResolvedValue(null),
  };
  const merged = { ...base, ...overrides };
  return { merged: merged as unknown as RdpAccessSweepDeps, mocks: merged as typeof base };
}

describe('runRdpAccessSweep', () => {
  it('reports the bookkeeping counts and does nothing else when no grant needs a disconnect', async () => {
    const { merged, mocks } = deps();
    const summary = await runRdpAccessSweep(admin, merged, NOW);
    expect(summary).toMatchObject({ requestsExpired: 1, grantsExpired: 2, accessRemoved: 0, pendingCut: 0, cutOk: 0 });
    expect(mocks.hasActiveGrant).not.toHaveBeenCalled();
    expect(mocks.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects the gateway identity and records the confirmed attempt', async () => {
    const { merged, mocks } = deps({ listPending: vi.fn().mockResolvedValue([{ grantId: G1, cutAttempts: 0 }]) });
    const summary = await runRdpAccessSweep(admin, merged, NOW);
    expect(mocks.disconnect).toHaveBeenCalledWith(CONFIG_OK.config, { user: 'desktopuser' });
    expect(mocks.markCut).toHaveBeenCalledWith(admin, { grantId: G1, ok: true, errorCode: 'ok' });
    expect(summary).toMatchObject({ pendingCut: 1, cutOk: 1, cutFailed: 0 });
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it('does NOT disconnect while a newer grant is active (it would cut the new holder)', async () => {
    const { merged, mocks } = deps({
      listPending: vi.fn().mockResolvedValue([{ grantId: G1, cutAttempts: 0 }]),
      hasActiveGrant: vi.fn().mockResolvedValue(true),
    });
    const summary = await runRdpAccessSweep(admin, merged, NOW);
    expect(summary.skippedActiveGrant).toBe(true);
    expect(mocks.hasActiveGrant).toHaveBeenCalledWith(admin, NOW);
    expect(mocks.disconnect).not.toHaveBeenCalled();
    expect(mocks.markCut).not.toHaveBeenCalled();
  });

  it('alerts once, with variable names only, when the gateway is not configured', async () => {
    const { merged, mocks } = deps({
      listPending: vi.fn().mockResolvedValue([{ grantId: G1, cutAttempts: 0 }]),
      getConfig: vi.fn().mockReturnValue({ ok: false, problems: [{ variable: 'RDPGW_ADMIN_SECRET', reason: 'missing' }] }),
    });
    const summary = await runRdpAccessSweep(admin, merged, NOW);
    expect(summary.skippedNoGateway).toBe(true);
    expect(mocks.disconnect).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledTimes(1);
    const alert = mocks.alert.mock.calls[0]?.[0] as { detail: string; category: string; level: string };
    expect(alert.category).toBe('security');
    expect(alert.level).toBe('error');
    expect(alert.detail).toContain('RDPGW_ADMIN_SECRET');
  });

  it('records a failed disconnect with a fixed code and stays quiet for the first two attempts', async () => {
    const { merged, mocks } = deps({
      listPending: vi.fn().mockResolvedValue([{ grantId: G1, cutAttempts: 1 }]),
      disconnect: vi.fn().mockResolvedValue({ ok: false, kind: 'unreachable' }),
    });
    const summary = await runRdpAccessSweep(admin, merged, NOW);
    expect(mocks.markCut).toHaveBeenCalledWith(admin, { grantId: G1, ok: false, errorCode: 'unreachable' });
    expect(summary).toMatchObject({ cutOk: 0, cutFailed: 1 });
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it('alerts from the third failed attempt, with the grant id in the title', async () => {
    const { merged, mocks } = deps({
      listPending: vi.fn().mockResolvedValue([{ grantId: G1, cutAttempts: 2 }]),
      disconnect: vi.fn().mockResolvedValue({ ok: false, kind: 'timeout' }),
    });
    await runRdpAccessSweep(admin, merged, NOW);
    const alert = mocks.alert.mock.calls[0]?.[0] as { title: string; detail: string };
    expect(alert.title).toContain(G1.slice(0, 8));
    expect(alert.detail).toContain('timeout');
    expect(alert.detail).not.toContain('לעצור את השער');
  });

  it('adds the operator instruction from the tenth failed attempt', async () => {
    const { merged, mocks } = deps({
      listPending: vi.fn().mockResolvedValue([{ grantId: G2, cutAttempts: 9 }]),
      disconnect: vi.fn().mockResolvedValue({ ok: false, kind: 'rejected' }),
    });
    await runRdpAccessSweep(admin, merged, NOW);
    const alert = mocks.alert.mock.calls[0]?.[0] as { detail: string };
    expect(alert.detail).toContain('לעצור את השער');
  });

  it('lets a database error from the bookkeeping step reach the worker wrapper', async () => {
    const { merged } = deps({ sweep: vi.fn().mockRejectedValue(new Error('db down')) });
    await expect(runRdpAccessSweep(admin, merged, NOW)).rejects.toThrow('db down');
  });
});
