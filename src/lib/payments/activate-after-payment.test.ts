import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
vi.mock('@/lib/data/campaigns', () => ({ activateCampaign: vi.fn() }));

import { sendSlackAlert } from '@/lib/alerts/slack';
import { activateCampaign } from '@/lib/data/campaigns';

import { activateAfterPayment } from './activate-after-payment';

// The payment was the buyer's last real decision, so a campaign starts right after it. FAIL-SAFE: the payment is already
// recorded whatever happens here, and a refusal is reported (not thrown) so the caller can show a notice and the
// explicit start button.

beforeEach(() => vi.clearAllMocks());

describe('activateAfterPayment', () => {
  it('starts the campaign', async () => {
    vi.mocked(activateCampaign).mockResolvedValue(undefined);
    await expect(activateAfterPayment('c1', 'e1')).resolves.toBe('started');
    expect(activateCampaign).toHaveBeenCalledWith('c1');
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('reports any refusal as "failed", tells an admin a paid campaign did not start, and never throws', async () => {
    vi.mocked(activateCampaign).mockRejectedValue(new Error('something else'));
    await expect(activateAfterPayment('c1', 'e1')).resolves.toBe('failed');
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn', fields: { campaign_id: 'c1', event_id: 'e1' } }));
    vi.mocked(activateCampaign).mockRejectedValue('not even an Error');
    await expect(activateAfterPayment('c1', 'e1')).resolves.toBe('failed');
  });
});
