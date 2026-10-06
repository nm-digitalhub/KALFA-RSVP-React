import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const requirePlatformPermission = vi.fn();
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: (...a: unknown[]) => requirePlatformPermission(...a) }));

const data = { submitRdpAccessRequest: vi.fn(), cancelMyRdpRequest: vi.fn(), endMyRdpGrant: vi.fn() };
vi.mock('@/lib/data/admin/rdp-access', () => ({
  submitRdpAccessRequest: (...a: unknown[]) => data.submitRdpAccessRequest(...a),
  cancelMyRdpRequest: (...a: unknown[]) => data.cancelMyRdpRequest(...a),
  endMyRdpGrant: (...a: unknown[]) => data.endMyRdpGrant(...a),
}));

const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.9' }) }));
vi.mock('next/navigation', () => ({
  unstable_rethrow: (err: unknown) => {
    if (err instanceof Error && err.message === 'NEXT_REDIRECT') throw err;
  },
}));
const afterCallbacks: Array<() => Promise<void>> = [];
vi.mock('next/server', () => ({ after: (fn: () => Promise<void>) => afterCallbacks.push(fn) }));

const notifyOwnersOfRdpRequest = vi.fn();
vi.mock('@/lib/rdp-access/notify-request', () => ({ notifyOwnersOfRdpRequest: (...a: unknown[]) => notifyOwnersOfRdpRequest(...a) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ admin: true }) }));

import { __resetRateLimitStateForTests } from '@/lib/security/rate-limit';

import { cancelRdpRequestAction, endRdpGrantAction, requestRdpAccessAction } from './actions';

const USER = { id: '11111111-1111-4111-8111-111111111111' };
const REQUEST = '0199e9d1-8c2a-7b3c-9d4e-5f6a7b8c9d0e';

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}
const VALID = { reason: 'החלפת מפתח בשרת', minutes: '60' };

beforeEach(() => {
  for (const fn of [requirePlatformPermission, revalidatePath, notifyOwnersOfRdpRequest, ...Object.values(data)]) fn.mockReset();
  afterCallbacks.length = 0;
  requirePlatformPermission.mockResolvedValue(USER);
  notifyOwnersOfRdpRequest.mockResolvedValue({ slack: true, ownersLookedUp: true, ownersFound: 1, pushed: 1, failed: 0 });
  __resetRateLimitStateForTests();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('every action gates on the permission first', () => {
  it('runs nothing else when the gate throws', async () => {
    requirePlatformPermission.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(requestRdpAccessAction(null, form(VALID))).rejects.toThrow('NEXT_REDIRECT');
    await expect(cancelRdpRequestAction(null, form({ requestId: REQUEST }))).rejects.toThrow('NEXT_REDIRECT');
    await expect(endRdpGrantAction(null, form({}))).rejects.toThrow('NEXT_REDIRECT');
    expect(requirePlatformPermission).toHaveBeenCalledWith('rdp.request');
    for (const fn of Object.values(data)) expect(fn).not.toHaveBeenCalled();
  });
});

describe('requestRdpAccessAction', () => {
  it('sends the validated request with the real client address, then tells the owners after the response', async () => {
    data.submitRdpAccessRequest.mockResolvedValue({ outcome: 'created', requestId: REQUEST, expiresAt: 'x' });
    const state = await requestRdpAccessAction(null, form(VALID));
    expect(state).toEqual({ notice: 'הבקשה נשלחה לאישור' });
    expect(data.submitRdpAccessRequest).toHaveBeenCalledWith({ reason: 'החלפת מפתח בשרת', minutes: 60 }, '203.0.113.7');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/rdp-access');

    expect(notifyOwnersOfRdpRequest).not.toHaveBeenCalled(); // not before the response
    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]!();
    expect(notifyOwnersOfRdpRequest).toHaveBeenCalledWith({ admin: true }, { requestId: REQUEST, minutes: 60 });
  });

  it('does not let a failing notification undo or fail anything', async () => {
    data.submitRdpAccessRequest.mockResolvedValue({ outcome: 'created', requestId: REQUEST, expiresAt: 'x' });
    notifyOwnersOfRdpRequest.mockRejectedValue(new Error('slack exploded: token=xoxb-secret'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(requestRdpAccessAction(null, form(VALID))).resolves.toEqual({ notice: 'הבקשה נשלחה לאישור' });
    await expect(afterCallbacks[0]!()).resolves.toBeUndefined();
    expect(JSON.stringify(error.mock.calls)).not.toContain('xoxb-secret');
  });

  it('reports field errors from Zod and never reaches the data layer', async () => {
    const short = await requestRdpAccessAction(null, form({ reason: 'קצר', minutes: '60' }));
    expect(short?.fieldErrors?.reason?.[0]).toContain('קצרה מדי');
    const badMinutes = await requestRdpAccessAction(null, form({ reason: 'החלפת מפתח בשרת', minutes: '45' }));
    expect(badMinutes?.fieldErrors?.minutes?.[0]).toBe('יש לבחור משך גישה מהרשימה');
    const missing = await requestRdpAccessAction(null, new FormData());
    expect(missing?.fieldErrors).toBeDefined();
    expect(data.submitRdpAccessRequest).not.toHaveBeenCalled();
  });

  it('never reads an identity from the form: only the reason and the minutes', async () => {
    data.submitRdpAccessRequest.mockResolvedValue({ outcome: 'created', requestId: REQUEST, expiresAt: 'x' });
    await requestRdpAccessAction(null, form({ ...VALID, userId: 'attacker', requesterId: 'attacker', ip: '1.1.1.1' }));
    expect(data.submitRdpAccessRequest).toHaveBeenCalledWith({ reason: 'החלפת מפתח בשרת', minutes: 60 }, '203.0.113.7');
  });

  it('answers every refusal with a fixed sentence and refreshes the page', async () => {
    const outcomes = ['already_pending', 'has_active_grant', 'rate_limited', 'not_allowed', 'invalid_reason', 'invalid_minutes', 'busy', 'unexpected'] as const;
    for (const outcome of outcomes) {
      __resetRateLimitStateForTests();
      revalidatePath.mockClear();
      data.submitRdpAccessRequest.mockResolvedValueOnce({ outcome, requestId: null, expiresAt: null });
      const state = await requestRdpAccessAction(null, form(VALID));
      expect(state?.error, outcome).toMatch(/\S/);
      expect(state?.notice).toBeUndefined();
      expect(revalidatePath).toHaveBeenCalledWith('/admin/rdp-access');
    }
    expect(afterCallbacks).toHaveLength(0);
  });

  it('treats "created" without an id as a failure instead of a success', async () => {
    data.submitRdpAccessRequest.mockResolvedValue({ outcome: 'created', requestId: null, expiresAt: null });
    expect((await requestRdpAccessAction(null, form(VALID)))?.error).toMatch(/\S/);
    expect(afterCallbacks).toHaveLength(0);
  });

  it('turns a data-layer failure into a generic line without its message', async () => {
    data.submitRdpAccessRequest.mockRejectedValue(new Error('relation rdp_access_requests: password=hunter2'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const state = await requestRdpAccessAction(null, form(VALID));
    expect(state).toEqual({ error: 'הפעולה לא הושלמה. נסו שוב.' });
    expect(JSON.stringify(error.mock.calls)).not.toContain('hunter2');
  });

  it('limits one user to five attempts a minute before the data layer is reached', async () => {
    data.submitRdpAccessRequest.mockResolvedValue({ outcome: 'already_pending', requestId: null, expiresAt: null });
    for (let i = 0; i < 5; i += 1) await requestRdpAccessAction(null, form(VALID));
    expect((await requestRdpAccessAction(null, form(VALID)))?.error).toBe('ניסיתם הרבה פעמים. נסו שוב בעוד דקה.');
    expect(data.submitRdpAccessRequest).toHaveBeenCalledTimes(5);
  });
});

describe('cancelRdpRequestAction', () => {
  it('cancels the named request and refreshes', async () => {
    data.cancelMyRdpRequest.mockResolvedValue({ outcome: 'cancelled' });
    expect(await cancelRdpRequestAction(null, form({ requestId: REQUEST }))).toEqual({ notice: 'הבקשה בוטלה' });
    expect(data.cancelMyRdpRequest).toHaveBeenCalledWith(REQUEST);
    expect(revalidatePath).toHaveBeenCalledWith('/admin/rdp-access');
  });

  it('refuses a malformed id without calling the data layer, and reports a request that is no longer pending', async () => {
    expect((await cancelRdpRequestAction(null, form({ requestId: 'not-a-uuid' })))?.error).toMatch(/\S/);
    expect(data.cancelMyRdpRequest).not.toHaveBeenCalled();

    data.cancelMyRdpRequest.mockResolvedValue({ outcome: 'not_found_or_not_pending' });
    expect(await cancelRdpRequestAction(null, form({ requestId: REQUEST }))).toEqual({ error: 'הבקשה כבר אינה ממתינה. הדף התעדכן.' });
    expect(revalidatePath).toHaveBeenCalled();
  });
});

describe('endRdpGrantAction', () => {
  it('ends the caller\'s own grant, taking no identifier from the form', async () => {
    data.endMyRdpGrant.mockResolvedValue({ outcome: 'ended', grantId: 'g' });
    expect(await endRdpGrantAction(null, form({ grantId: 'someone-elses' }))).toEqual({ notice: 'הגישה הסתיימה' });
    expect(data.endMyRdpGrant).toHaveBeenCalledWith();
  });

  it('reports that there was nothing to end', async () => {
    data.endMyRdpGrant.mockResolvedValue({ outcome: 'no_active_grant', grantId: null });
    expect(await endRdpGrantAction(null, form({}))).toEqual({ error: 'אין כרגע גישה פעילה. הדף התעדכן.' });
  });
});
