import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { saveCitizenId } from './card';

const rpcClient = (data: unknown, error: { message: string } | null = null) => ({ rpc: vi.fn().mockResolvedValue({ data, error }) });

describe('card details — the citizen id never touches a table column', () => {
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
});
