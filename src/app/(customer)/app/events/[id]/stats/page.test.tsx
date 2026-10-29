import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/data/events', () => ({ requireEventAccess: vi.fn() }));
vi.mock('@/lib/data/event-mode', () => ({ redirectOwnerInSetup: vi.fn() }));
vi.mock('@/lib/data/event-stats', () => ({ getEventStats: vi.fn() }));
vi.mock('./stats-refresh-button', () => ({ StatsRefreshButton: () => null }));

import type { EventModeRead } from '@/lib/data/event-mode';
import { redirectOwnerInSetup } from '@/lib/data/event-mode';
import { getEventStats } from '@/lib/data/event-stats';
import { requireEventAccess } from '@/lib/data/events';
import EventStatsPage from './page';

// Statistics are management (design D4, task 3.4): the page hands the owner of an event still in setup to the setup
// flow before it reads the statistics. Who is redirected, and when, is redirectOwnerInSetup's decision
// (event-mode.test.ts); this pins that the page asks it, with the event its own gate returned, and first.

const EVENT = { id: 'e1', name: 'החתונה', status: 'active' };
const props = { params: Promise.resolve({ id: 'e1' }) };
// The statistics read is where this test stops: what comes after it is the page's ordinary rendering.
const STOP = new Error('stats read reached');

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireEventAccess).mockResolvedValue(EVENT as never);
  vi.mocked(getEventStats).mockRejectedValue(STOP);
});

describe('statistics page: the setup gate', () => {
  it('asks for the mode with the event its own gate returned, before the statistics are read', async () => {
    vi.mocked(redirectOwnerInSetup).mockResolvedValue({ mode: 'management' } as EventModeRead);

    await expect(EventStatsPage(props)).rejects.toBe(STOP);

    expect(requireEventAccess).toHaveBeenCalledWith('e1', 'reports', 'view');
    expect(redirectOwnerInSetup).toHaveBeenCalledWith(EVENT);
    const order = (fn: unknown) => (fn as { mock: { invocationCallOrder: number[] } }).mock.invocationCallOrder[0];
    expect(order(requireEventAccess)).toBeLessThan(order(redirectOwnerInSetup));
    expect(order(redirectOwnerInSetup)).toBeLessThan(order(getEventStats));
  });

  it('the owner of an event in setup is redirected: the redirect propagates and nothing is read', async () => {
    vi.mocked(redirectOwnerInSetup).mockRejectedValue(
      Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/app/events/e1/setup;307;' }),
    );

    await expect(EventStatsPage(props)).rejects.toThrow('NEXT_REDIRECT');
    expect(getEventStats).not.toHaveBeenCalled();
  });
});
