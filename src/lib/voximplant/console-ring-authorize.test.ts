import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/data/console-calls', () => ({
  computeRingOrder: vi.fn((names: string[]) => names),
  findRoutableAgentVoxUsernames: vi.fn(),
  updateConsoleCallStatus: vi.fn(),
}));
vi.mock('@/lib/data/voximplant-balance-cache', () => ({ checkInboundBalanceReserve: vi.fn() }));
vi.mock('@/lib/data/voximplant-config', () => ({ getVoximplantConfig: vi.fn() }));

import {
  computeRingOrder,
  findRoutableAgentVoxUsernames,
  updateConsoleCallStatus,
} from '@/lib/data/console-calls';
import { checkInboundBalanceReserve } from '@/lib/data/voximplant-balance-cache';
import { getVoximplantConfig } from '@/lib/data/voximplant-config';

import { authorizeConsoleRing } from './console-ring-authorize';

const CAPS = { maxConcurrency: 2, dailyCallCap: 100, dailySpendCapUsd: 5, estimatedCostPerCallUsd: 0.09 };

function input(over: { flag?: boolean; concurrent?: number; today?: number } = {}) {
  return {
    callId: 'call-1',
    flagEnabled: vi.fn(async () => over.flag ?? true),
    countConcurrentAnswered: vi.fn(async () => over.concurrent ?? 0),
    countAnsweredToday: vi.fn(async () => over.today ?? 0),
    caps: CAPS,
  };
}

describe('authorizeConsoleRing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getVoximplantConfig).mockResolvedValue({ liveCallsEnabled: true } as never);
    vi.mocked(checkInboundBalanceReserve).mockResolvedValue({ ok: true } as never);
    vi.mocked(findRoutableAgentVoxUsernames).mockResolvedValue(['agent_a', 'agent_b']);
    vi.mocked(updateConsoleCallStatus).mockResolvedValue(undefined);
  });

  it('admits under every cap, returns the ring order and marks the row ringing (only if live)', async () => {
    const res = await authorizeConsoleRing(input({ today: 3 }));
    expect(res).toEqual({ ok: true, ringOrder: ['agent_a', 'agent_b'] });
    expect(computeRingOrder).toHaveBeenCalledWith(['agent_a', 'agent_b'], 3);
    expect(updateConsoleCallStatus).toHaveBeenCalledWith({ callId: 'call-1', status: 'ringing', onlyIfLive: true });
  });

  it.each([
    ['the flow flag is off', () => input({ flag: false })],
    ['concurrency is at the cap', () => input({ concurrent: 2 })],
    ['the daily call cap is reached', () => input({ today: 100 })],
    ['the estimated daily spend reaches its cap', () => input({ today: 56 })], // 56 * 0.09 = 5.04
  ])('refuses when %s, without ringing anyone', async (_label, make) => {
    expect(await authorizeConsoleRing(make())).toEqual({ ok: false });
    expect(findRoutableAgentVoxUsernames).not.toHaveBeenCalled();
    expect(updateConsoleCallStatus).not.toHaveBeenCalled();
  });

  it('refuses when live calls are disabled, config is missing, or the balance reserve fails', async () => {
    vi.mocked(getVoximplantConfig).mockResolvedValueOnce({ liveCallsEnabled: false } as never);
    expect(await authorizeConsoleRing(input())).toEqual({ ok: false });
    vi.mocked(getVoximplantConfig).mockResolvedValueOnce(null as never);
    expect(await authorizeConsoleRing(input())).toEqual({ ok: false });
    vi.mocked(checkInboundBalanceReserve).mockResolvedValueOnce({ ok: false } as never);
    expect(await authorizeConsoleRing(input())).toEqual({ ok: false });
    expect(updateConsoleCallStatus).not.toHaveBeenCalled();
  });

  it('fails closed when any cap input cannot be read', async () => {
    const broken = input();
    broken.countConcurrentAnswered.mockRejectedValue(new Error('db down'));
    expect(await authorizeConsoleRing(broken)).toEqual({ ok: false });
  });

  it('still admits with an empty ring when the routable lookup throws', async () => {
    vi.mocked(findRoutableAgentVoxUsernames).mockRejectedValue(new Error('db down'));
    expect(await authorizeConsoleRing(input())).toEqual({ ok: true, ringOrder: [] });
  });

  it('never lets a failed status bump block the ring', async () => {
    vi.mocked(updateConsoleCallStatus).mockRejectedValue(new Error('db down'));
    expect(await authorizeConsoleRing(input())).toEqual({ ok: true, ringOrder: ['agent_a', 'agent_b'] });
  });
});
