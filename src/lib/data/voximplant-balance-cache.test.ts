import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/data/voximplant-config', () => ({ getVoximplantConfig: vi.fn() }));
vi.mock('@/lib/voximplant/core', () => ({ getAccountInfo: vi.fn() }));

import { getVoximplantConfig } from '@/lib/data/voximplant-config';
import { getAccountInfo } from '@/lib/voximplant/core';
import {
  __resetBalanceCacheForTests,
  checkInboundBalanceReserve,
} from './voximplant-balance-cache';

const CONFIG = { auth: {}, minCallReserve: 0.1 } as unknown as NonNullable<
  Awaited<ReturnType<typeof getVoximplantConfig>>
>;

beforeEach(() => {
  vi.clearAllMocks();
  __resetBalanceCacheForTests();
});

describe('checkInboundBalanceReserve — pre-answer gate, never inline-blocks unboundedly', () => {
  it('ok when a fresh fetch reports a balance above reserve', async () => {
    vi.mocked(getVoximplantConfig).mockResolvedValue(CONFIG);
    vi.mocked(getAccountInfo).mockResolvedValue({ result: { balance: 5 } } as never);
    const result = await checkInboundBalanceReserve();
    expect(result).toEqual({ ok: true });
  });

  it('below_reserve when the fresh balance is under the configured reserve', async () => {
    vi.mocked(getVoximplantConfig).mockResolvedValue(CONFIG);
    vi.mocked(getAccountInfo).mockResolvedValue({ result: { balance: 0.05 } } as never);
    const result = await checkInboundBalanceReserve();
    expect(result).toEqual({ ok: false, reason: 'below_reserve' });
  });

  it('unknown (fail-closed) when the channel is not configured', async () => {
    vi.mocked(getVoximplantConfig).mockResolvedValue(null);
    const result = await checkInboundBalanceReserve();
    expect(result).toEqual({ ok: false, reason: 'unknown' });
  });

  it('unknown (fail-closed) on a cold cache when the fetch throws/times out', async () => {
    vi.mocked(getVoximplantConfig).mockResolvedValue(CONFIG);
    vi.mocked(getAccountInfo).mockRejectedValue(new Error('timeout'));
    const result = await checkInboundBalanceReserve();
    expect(result).toEqual({ ok: false, reason: 'unknown' });
  });

  it('reuses a fresh cache within the TTL without calling the API again', async () => {
    vi.mocked(getVoximplantConfig).mockResolvedValue(CONFIG);
    vi.mocked(getAccountInfo).mockResolvedValue({ result: { balance: 5 } } as never);
    const t0 = Date.now();
    await checkInboundBalanceReserve(t0);
    await checkInboundBalanceReserve(t0 + 1_000); // well within the 60s TTL
    expect(getAccountInfo).toHaveBeenCalledTimes(1);
  });

  it('trusts a slightly-stale cache instead of failing closed on a single missed refresh', async () => {
    vi.mocked(getVoximplantConfig).mockResolvedValue(CONFIG);
    vi.mocked(getAccountInfo).mockResolvedValueOnce({ result: { balance: 5 } } as never);
    const t0 = Date.now();
    const first = await checkInboundBalanceReserve(t0);
    expect(first).toEqual({ ok: true });

    // Past the 60s TTL but well within the 5-minute stale-grace window, and
    // this refresh attempt fails — the OLD cached value should still be used.
    vi.mocked(getAccountInfo).mockRejectedValueOnce(new Error('timeout'));
    const second = await checkInboundBalanceReserve(t0 + 90_000);
    expect(second).toEqual({ ok: true });
  });

  it('gives up and fails closed once the cache is past the stale-grace window', async () => {
    vi.mocked(getVoximplantConfig).mockResolvedValue(CONFIG);
    vi.mocked(getAccountInfo).mockResolvedValueOnce({ result: { balance: 5 } } as never);
    const t0 = Date.now();
    await checkInboundBalanceReserve(t0);

    vi.mocked(getAccountInfo).mockRejectedValue(new Error('timeout'));
    const wayLater = t0 + 10 * 60_000; // past the 5-minute stale-grace window
    const result = await checkInboundBalanceReserve(wayLater);
    expect(result).toEqual({ ok: false, reason: 'unknown' });
  });
});
