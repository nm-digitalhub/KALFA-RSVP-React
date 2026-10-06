import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { fillAuthorizedSet } from './authorized-fill';

function rpcReturning(result: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(result);
  vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
  return rpc;
}

beforeEach(() => {
  vi.mocked(createAdminClient).mockReset();
});

describe('fillAuthorizedSet', () => {
  it('calls the function with the event, the campaign and the actor and returns the parsed answer', async () => {
    const rpc = rpcReturning({ data: { verdict: 'filled', admitted: 3, size: 3, quota: 100, waiting: 0 }, error: null });
    expect(await fillAuthorizedSet('e1', 'c1', 'activation')).toEqual({ verdict: 'filled', admitted: 3, size: 3, quota: 100, waiting: 0 });
    expect(rpc).toHaveBeenCalledWith('fill_authorized_set', { p_event: 'e1', p_campaign: 'c1', p_actor: 'activation' });
  });

  it.each(['no_campaign', 'event_mismatch', 'not_operational', 'no_quota'])('returns the %s verdict as it is', async (verdict) => {
    rpcReturning({ data: { verdict }, error: null });
    expect(await fillAuthorizedSet('e1', 'c1', 'activation')).toEqual({ verdict });
  });

  it('throws a safe message when the database fails, never the database message', async () => {
    rpcReturning({ data: null, error: { message: 'permission denied for table campaigns' } });
    await expect(fillAuthorizedSet('e1', 'c1', 'activation')).rejects.toThrow('מילוי רשימת אנשי הקשר נכשל');
  });

  it.each([
    ['an unknown verdict', { verdict: 'maybe' }],
    ['a filled answer without counts', { verdict: 'filled' }],
    ['a negative count', { verdict: 'filled', admitted: -1, size: 0, quota: 1, waiting: 0 }],
    ['a fractional count', { verdict: 'filled', admitted: 1.5, size: 1, quota: 2, waiting: 0 }],
    ['nothing at all', null],
  ])('refuses %s: an answer the code has no branch for must not pass as success', async (_label, data) => {
    rpcReturning({ data, error: null });
    await expect(fillAuthorizedSet('e1', 'c1', 'activation')).rejects.toThrow('מילוי רשימת אנשי הקשר החזיר תשובה לא מוכרת');
  });
});
