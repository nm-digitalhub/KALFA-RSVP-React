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

// The yearly turnover comes from owner_agent_billing_sums — the one function that already reads BOTH places money is
// recorded (the payment ledger and the old campaign columns) without counting a campaign twice, net of returns.
function mockSums(charged: unknown, error: unknown = null) {
  const data = error
    ? null
    : [{ charged_amount: charged, credit_applied_amount: 0, unvoided_credit_amount: 0, credit_granted_amount: 0 }];
  const rpc = vi.fn().mockResolvedValue({ data, error });
  vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
  return rpc;
}

describe('checkOsekPaturCeilingAfterCharge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stays silent below the 80% warning threshold', async () => {
    mockSums(100);
    await checkOsekPaturCeilingAfterCharge();
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('asks for the revenue of the current calendar year, from its 1 January, through the one shared function', async () => {
    const rpc = mockSums(1);
    await checkOsekPaturCeilingAfterCharge();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('owner_agent_billing_sums', {
      _since: `${new Date().getUTCFullYear()}-01-01T00:00:00Z`,
    });
  });

  it('warns at ≥80% of the ceiling with the utilization figures', async () => {
    const total = Math.ceil(OSEK_PATUR_YEARLY_CEILING_ILS * 0.81);
    mockSums(total);
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
    mockSums(Math.ceil(OSEK_PATUR_YEARLY_CEILING_ILS * 0.96));
    await checkOsekPaturCeilingAfterCharge();
    expect(vi.mocked(sendSlackAlert).mock.calls[0][0].level).toBe('error');
  });

  it('reads a numeric that arrives as a string', async () => {
    mockSums(String(Math.ceil(OSEK_PATUR_YEARLY_CEILING_ILS * 0.9)));
    await checkOsekPaturCeilingAfterCharge();
    expect(vi.mocked(sendSlackAlert).mock.calls[0][0].level).toBe('warn');
  });

  it('is fail-safe on a DB error (no alert, no throw)', async () => {
    mockSums(null, { message: 'boom' });
    await expect(checkOsekPaturCeilingAfterCharge()).resolves.toBeUndefined();
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it.each([
    ['no row', []],
    ['two rows', [{ charged_amount: 1 }, { charged_amount: 1 }]],
    ['a value that is not a number', [{ charged_amount: 'abc' }]],
    ['a negative total', [{ charged_amount: -5 }]],
  ])('an unexpected answer (%s) raises no alert and does not throw', async (_name, data) => {
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
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
