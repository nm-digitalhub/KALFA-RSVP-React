import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/data/call-attempts', () => ({ countActiveCalls: vi.fn() }));
vi.mock('@/lib/data/callback-request-attempts', () => ({ countActiveCallbackDispatches: vi.fn() }));
vi.mock('@/lib/data/sales-call-attempts', () => ({ countActiveSalesDispatches: vi.fn() }));

import { countActiveCalls } from '@/lib/data/call-attempts';
import { countActiveCallbackDispatches } from '@/lib/data/callback-request-attempts';
import { countActiveSalesDispatches } from '@/lib/data/sales-call-attempts';
import { countActiveCallsAllSurfaces } from './voximplant-concurrency';

beforeEach(() => vi.clearAllMocks());

// This is the whole point of the module: three dispatchers on three tables
// share ONE Voximplant account/balance/concurrency ceiling, so a cap check
// against any subset alone is wrong by construction. If this ever regresses
// to counting fewer than all three tables, the dispatchers could jointly
// exceed app_settings.voximplant_max_concurrent_calls without any of them
// noticing.
describe('countActiveCallsAllSurfaces', () => {
  it('sums call_attempts, callback_request_attempts and sales_call_attempts pre-terminal counts', async () => {
    vi.mocked(countActiveCalls).mockResolvedValue(3);
    vi.mocked(countActiveCallbackDispatches).mockResolvedValue(2);
    vi.mocked(countActiveSalesDispatches).mockResolvedValue(4);
    expect(await countActiveCallsAllSurfaces()).toBe(9);
  });

  it('zero on all three surfaces → zero', async () => {
    vi.mocked(countActiveCalls).mockResolvedValue(0);
    vi.mocked(countActiveCallbackDispatches).mockResolvedValue(0);
    vi.mocked(countActiveSalesDispatches).mockResolvedValue(0);
    expect(await countActiveCallsAllSurfaces()).toBe(0);
  });
});
