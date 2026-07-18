import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { sendSlackAlert } from '@/lib/alerts/slack';
import {
  checkOsekPaturCeilingAfterCharge,
  OSEK_PATUR_YEARLY_CEILING_ILS,
} from '@/lib/data/tax-ceiling';

function mockChargedRows(
  rows: Array<{ final_charge_amount: number | string | null }>,
  error: unknown = null,
) {
  const gte = vi.fn().mockResolvedValue({ data: error ? null : rows, error });
  const eq = vi.fn().mockReturnValue({ gte });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  vi.mocked(createAdminClient).mockReturnValue({ from } as never);
  return { from, select, eq, gte };
}

describe('checkOsekPaturCeilingAfterCharge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stays silent below the 80% warning threshold', async () => {
    mockChargedRows([{ final_charge_amount: 100 }]);
    await checkOsekPaturCeilingAfterCharge();
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('sums only charged campaigns from the current calendar year', async () => {
    const { from, eq, gte } = mockChargedRows([{ final_charge_amount: 1 }]);
    await checkOsekPaturCeilingAfterCharge();
    expect(from).toHaveBeenCalledWith('campaigns');
    expect(eq).toHaveBeenCalledWith('charge_status', 'charged');
    expect(gte).toHaveBeenCalledWith(
      'charged_at',
      `${new Date().getUTCFullYear()}-01-01T00:00:00Z`,
    );
  });

  it('warns at ≥80% of the ceiling with the utilization figures', async () => {
    const total = Math.ceil(OSEK_PATUR_YEARLY_CEILING_ILS * 0.81);
    mockChargedRows([{ final_charge_amount: total }]);
    await checkOsekPaturCeilingAfterCharge();
    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
    const input = vi.mocked(sendSlackAlert).mock.calls[0][0];
    expect(input.level).toBe('warn');
    expect(input.category).toBe('campaign_billing');
    expect(input.fields).toMatchObject({
      yearly_charged: total,
      ceiling: OSEK_PATUR_YEARLY_CEILING_ILS,
    });
  });

  it('escalates to error at ≥95% of the ceiling', async () => {
    mockChargedRows([
      { final_charge_amount: Math.ceil(OSEK_PATUR_YEARLY_CEILING_ILS * 0.96) },
    ]);
    await checkOsekPaturCeilingAfterCharge();
    expect(vi.mocked(sendSlackAlert).mock.calls[0][0].level).toBe('error');
  });

  it('is fail-safe on a DB error (no alert, no throw)', async () => {
    mockChargedRows([], { message: 'boom' });
    await expect(checkOsekPaturCeilingAfterCharge()).resolves.toBeUndefined();
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('is fail-safe when the admin client itself throws', async () => {
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error('no key');
    });
    await expect(checkOsekPaturCeilingAfterCharge()).resolves.toBeUndefined();
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });
});
