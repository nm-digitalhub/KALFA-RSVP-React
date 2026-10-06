import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('./ledger', () => ({ loadOperations: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { loadOperations } from './ledger';
import { getPackagePaymentState, packagePaymentOf } from './package-paid';

const COLLECTED = [{ kind: 'package_purchase', effect: 'collect', outcome: 'succeeded', amount: 150, credit: 0, occurredAt: '2026-10-04T10:00:00Z', recordedAt: '2026-10-04T10:00:01Z' }] as const;

beforeEach(() => {
  vi.mocked(createAdminClient).mockReset().mockReturnValue({} as never);
  vi.mocked(loadOperations).mockReset();
});

describe('getPackagePaymentState', () => {
  it('derives the state from the ledger', async () => {
    vi.mocked(loadOperations).mockResolvedValue([...COLLECTED]);
    expect(await getPackagePaymentState('c1')).toMatchObject({ status: 'collected', collected: 150 });
  });

  it('throws when the ledger cannot be read — an unreadable ledger must never look like "nothing paid"', async () => {
    vi.mocked(loadOperations).mockRejectedValue(new Error('db down'));
    await expect(getPackagePaymentState('c1')).rejects.toThrow('db down');
  });
});

describe('packagePaymentOf', () => {
  it('is null for a campaign that is not a package, without touching the ledger', async () => {
    expect(await packagePaymentOf({ id: 'c1', package_price: null })).toBeNull();
    expect(await packagePaymentOf({ id: 'c1' })).toBeNull();
    expect(loadOperations).not.toHaveBeenCalled();
  });

  it('is the ledger state for a package campaign', async () => {
    vi.mocked(loadOperations).mockResolvedValue([...COLLECTED]);
    expect(await packagePaymentOf({ id: 'c1', package_price: 150 })).toMatchObject({ status: 'collected' });
  });

  it('is null — "not funded" — when the ledger cannot be read, and says so in the log', async () => {
    vi.mocked(loadOperations).mockRejectedValue(new Error('db down'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await packagePaymentOf({ id: 'c1', package_price: 150 })).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});
