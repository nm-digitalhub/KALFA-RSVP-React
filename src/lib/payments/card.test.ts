import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { cardFromSumit, readCitizenId, saveCitizenId } from './card';

const rpcClient = (data: unknown, error: { message: string } | null = null) => ({ rpc: vi.fn().mockResolvedValue({ data, error }) });

describe('card details — the citizen id never touches a table column', () => {
  it('cardFromSumit keeps type, token, expiry, last4 and mask; the provider type is kept as text', () =>
    expect(cardFromSumit({ Type: 1, CreditCard_Token: 'tok', CreditCard_ExpirationMonth: 7, CreditCard_ExpirationYear: 2031, CreditCard_LastDigits: '9183', CreditCard_CardMask: 'XXXXXXXXXXXX9183' }))
      .toEqual({ methodType: '1', tokenRef: 'tok', expMonth: 7, expYear: 2031, last4: '9183', mask: 'XXXXXXXXXXXX9183' }));
  it('cardFromSumit → null without a reusable token (CardTokenNotNeeded=true, or no PaymentMethod)', () => {
    expect(cardFromSumit({ Type: 1, CreditCard_Token: null })).toBeNull();
    expect(cardFromSumit(undefined)).toBeNull();
  });
  it('saveCitizenId → payment_citizen_id_write, returns the secret id; null ת"ז → no call, null', async () => {
    const admin = rpcClient('9d8c7b6a-5f4e-4d3c-ab2a-1f0e9d8c7b6a');
    await expect(saveCitizenId(admin as never, '39334087-e68c-4c81-aea4-b465cfc205e2', '316125434')).resolves.toBe('9d8c7b6a-5f4e-4d3c-ab2a-1f0e9d8c7b6a');
    expect(admin.rpc).toHaveBeenCalledWith('payment_citizen_id_write', { p_citizen_id: '316125434', p_campaign_id: '39334087-e68c-4c81-aea4-b465cfc205e2' });
    const none = rpcClient('x');
    await expect(saveCitizenId(none as never, '39334087-e68c-4c81-aea4-b465cfc205e2', null)).resolves.toBeNull();
    expect(none.rpc).not.toHaveBeenCalled();
  });
  it('saveCitizenId failure → Hebrew, provider-free error', async () => {
    await expect(saveCitizenId(rpcClient(null, { message: 'permission denied for schema vault' }) as never, 'c', '316125434'))
      .rejects.toThrow('שמירת פרטי הכרטיס נכשלה');
  });
  it('readCitizenId → payment_citizen_id by operation id; null on error or non-string', async () => {
    const admin = rpcClient('316125434');
    await expect(readCitizenId(admin as never, '01a0d536-cf40-7d60-8000-000000000001')).resolves.toBe('316125434');
    expect(admin.rpc).toHaveBeenCalledWith('payment_citizen_id', { p_operation_id: '01a0d536-cf40-7d60-8000-000000000001' });
    await expect(readCitizenId(rpcClient(null, { message: 'x' }) as never, 'a')).resolves.toBeNull();
    await expect(readCitizenId(rpcClient(null) as never, 'a')).resolves.toBeNull();
  });
});
