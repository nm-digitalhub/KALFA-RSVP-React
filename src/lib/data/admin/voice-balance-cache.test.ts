import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/data/voximplant-config', () => ({ getVoximplantConfig: vi.fn() }));
vi.mock('@/lib/voximplant/core', () => ({ getAccountInfo: vi.fn() }));

import { getVoximplantConfig } from '@/lib/data/voximplant-config';
import { getAccountInfo } from '@/lib/voximplant/core';
import {
  __resetVoiceBalanceCacheForTests,
  getCachedAccountInfo,
} from './voice-balance-cache';

const CONFIG = { auth: {} } as unknown as NonNullable<
  Awaited<ReturnType<typeof getVoximplantConfig>>
>;

beforeEach(() => {
  vi.clearAllMocks();
  __resetVoiceBalanceCacheForTests();
});

describe('getCachedAccountInfo — admin dashboard balance tile, never inline-blocks unboundedly', () => {
  it('returns the normalized balance/currency/callback on a fresh fetch', async () => {
    vi.mocked(getVoximplantConfig).mockResolvedValue(CONFIG);
    vi.mocked(getAccountInfo).mockResolvedValue({
      result: { balance: 10.86, currency: 'USD', callback_url: 'https://example.test/cb' },
    } as never);
    const result = await getCachedAccountInfo();
    expect(result).toMatchObject({ balance: 10.86, currency: 'USD', callbackUrl: 'https://example.test/cb' });
    expect(getAccountInfo).toHaveBeenCalledWith(CONFIG.auth, 2_500, { returnLiveBalance: true });
  });

  it('returns null when the channel is not configured', async () => {
    vi.mocked(getVoximplantConfig).mockResolvedValue(null);
    const result = await getCachedAccountInfo();
    expect(result).toBeNull();
    expect(getAccountInfo).not.toHaveBeenCalled();
  });

  it('returns null on a cold cache when the fetch throws/times out', async () => {
    vi.mocked(getVoximplantConfig).mockResolvedValue(CONFIG);
    vi.mocked(getAccountInfo).mockRejectedValue(new Error('timeout'));
    const result = await getCachedAccountInfo();
    expect(result).toBeNull();
  });

  it('reuses a fresh cache within the TTL without calling the API again', async () => {
    vi.mocked(getVoximplantConfig).mockResolvedValue(CONFIG);
    vi.mocked(getAccountInfo).mockResolvedValue({
      result: { balance: 5, currency: 'USD' },
    } as never);
    const t0 = Date.now();
    await getCachedAccountInfo(t0);
    await getCachedAccountInfo(t0 + 1_000); // well within the 60s TTL
    expect(getAccountInfo).toHaveBeenCalledTimes(1);
  });

  it('refetches once the TTL has elapsed', async () => {
    vi.mocked(getVoximplantConfig).mockResolvedValue(CONFIG);
    vi.mocked(getAccountInfo).mockResolvedValue({
      result: { balance: 5, currency: 'USD' },
    } as never);
    const t0 = Date.now();
    await getCachedAccountInfo(t0);
    await getCachedAccountInfo(t0 + 61_000); // past the 60s TTL
    expect(getAccountInfo).toHaveBeenCalledTimes(2);
  });

  it('falls back to a stale cache instead of null when a later refresh fails within the grace window', async () => {
    vi.mocked(getVoximplantConfig).mockResolvedValue(CONFIG);
    vi.mocked(getAccountInfo).mockResolvedValueOnce({
      result: { balance: 5, currency: 'USD' },
    } as never);
    const t0 = Date.now();
    const first = await getCachedAccountInfo(t0);
    expect(first).toMatchObject({ balance: 5 });

    vi.mocked(getAccountInfo).mockRejectedValueOnce(new Error('timeout'));
    const second = await getCachedAccountInfo(t0 + 61_000); // past TTL, refresh fails
    expect(second).toMatchObject({ balance: 5 }); // stale value, not null
  });

  it('gives up and returns null once the cache is past the stale-grace window', async () => {
    vi.mocked(getVoximplantConfig).mockResolvedValue(CONFIG);
    vi.mocked(getAccountInfo).mockResolvedValueOnce({
      result: { balance: 5, currency: 'USD' },
    } as never);
    const t0 = Date.now();
    await getCachedAccountInfo(t0);

    vi.mocked(getAccountInfo).mockRejectedValue(new Error('timeout'));
    const wayLater = t0 + 10 * 60_000; // past the 5-minute stale-grace window
    const result = await getCachedAccountInfo(wayLater);
    expect(result).toBeNull();
  });

  it('coalesces concurrent cold-cache calls into one Management API call', async () => {
    vi.mocked(getVoximplantConfig).mockResolvedValue(CONFIG);
    let resolveFetch: (v: unknown) => void = () => {};
    vi.mocked(getAccountInfo).mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }) as never,
    );
    const p1 = getCachedAccountInfo();
    const p2 = getCachedAccountInfo();
    resolveFetch({ result: { balance: 5, currency: 'USD' } });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toMatchObject({ balance: 5 });
    expect(r2).toMatchObject({ balance: 5 });
    expect(getAccountInfo).toHaveBeenCalledTimes(1);
  });
});
