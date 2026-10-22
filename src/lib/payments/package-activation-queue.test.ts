import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const send = vi.fn();
vi.mock('@/lib/queue/web-sender', () => ({ getWebJobSender: vi.fn(async () => ({ send })) }));

import { getWebJobSender } from '@/lib/queue/web-sender';
import { enqueuePackageActivation } from '@/lib/payments/package-activation-queue';
import { PACKAGE_ACTIVATION_RETRY, packageActivationJobId, QUEUES } from '@/lib/queue/queues';

beforeEach(() => {
  send.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('enqueuePackageActivation (D23)', () => {
  it('sends ids only, with a job id derived from the payment and the retry policy', async () => {
    send.mockResolvedValue('job-1');
    await expect(enqueuePackageActivation({ campaignId: 'c1', operationId: 'op1' })).resolves.toBe(true);
    expect(send).toHaveBeenCalledWith(
      QUEUES.packageActivation,
      { campaignId: 'c1', operationId: 'op1' },
      { id: packageActivationJobId('op1'), ...PACKAGE_ACTIVATION_RETRY },
    );
  });

  it('the job id is the same for the same payment and differs between payments', () => {
    expect(packageActivationJobId('op1')).toBe(packageActivationJobId('op1'));
    expect(packageActivationJobId('op1')).not.toBe(packageActivationJobId('op2'));
  });

  it('never throws: a send failure or a sender that cannot start answers false', async () => {
    send.mockRejectedValue(new Error('pool down'));
    await expect(enqueuePackageActivation({ campaignId: 'c1', operationId: 'op1' })).resolves.toBe(false);

    vi.mocked(getWebJobSender).mockRejectedValueOnce(new Error('schema mismatch'));
    await expect(enqueuePackageActivation({ campaignId: 'c1', operationId: 'op1' })).resolves.toBe(false);
  });
});
