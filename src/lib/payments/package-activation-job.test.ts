import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn(async () => undefined) }));
vi.mock('@/lib/payments/activate-paid-package', () => ({ activatePaidPackage: vi.fn() }));
const eventRead = vi.fn(async () => ({ data: { event_id: 'e1' }, error: null }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: eventRead }) }) }) }),
}));

import { sendSlackAlert } from '@/lib/alerts/slack';
import { activatePaidPackage } from '@/lib/payments/activate-paid-package';
import { runPackageActivationJob } from '@/lib/payments/package-activation-job';
import { PACKAGE_ACTIVATION_RETRY } from '@/lib/queue/queues';

const data = { campaignId: 'c1', operationId: 'op1' };
const delivery = (retryCount: number) => ({ data, retryCount, retryLimit: PACKAGE_ACTIVATION_RETRY.retryLimit });

beforeEach(() => {
  vi.mocked(activatePaidPackage).mockReset();
  vi.mocked(sendSlackAlert).mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('runPackageActivationJob', () => {
  it('passes the job ids to activatePaidPackage and returns its result, with no alert', async () => {
    vi.mocked(activatePaidPackage).mockResolvedValue('started');
    await expect(runPackageActivationJob(delivery(0))).resolves.toBe('started');
    expect(activatePaidPackage).toHaveBeenCalledWith('c1', 'op1');
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('a refusal before the final delivery is rethrown for a retry, with no alert', async () => {
    const refusal = new Error('ledger unreadable');
    vi.mocked(activatePaidPackage).mockRejectedValue(refusal);
    for (let retryCount = 0; retryCount < PACKAGE_ACTIVATION_RETRY.retryLimit; retryCount += 1) {
      await expect(runPackageActivationJob(delivery(retryCount))).rejects.toBe(refusal);
    }
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('a refusal on the final delivery alerts once with the ids, and is still rethrown', async () => {
    const refusal = new Error('event past');
    vi.mocked(activatePaidPackage).mockRejectedValue(refusal);
    await expect(runPackageActivationJob(delivery(PACKAGE_ACTIVATION_RETRY.retryLimit))).rejects.toBe(refusal);
    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error', fields: { campaign_id: 'c1', event_id: 'e1', operation_id: 'op1' } }),
    );
  });
});

describe('PACKAGE_ACTIVATION_RETRY', () => {
  it('is five deliveries in total: the first plus four retries', () => {
    expect(PACKAGE_ACTIVATION_RETRY.retryLimit + 1).toBe(5);
  });

  it('waits longer than the activation-row repair window before the first retry', async () => {
    const { REPAIR_AFTER_MS } = await vi.importActual<typeof import('@/lib/payments/activate-paid-package')>(
      '@/lib/payments/activate-paid-package',
    );
    expect(PACKAGE_ACTIVATION_RETRY.retryDelay * 1000).toBeGreaterThan(REPAIR_AFTER_MS);
  });
});
