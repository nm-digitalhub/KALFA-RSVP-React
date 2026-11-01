import { beforeEach, describe, expect, it, vi } from 'vitest';

// Browser push from the settings page: each failure keeps its fixed Hebrew message, including "no active
// subscription" for a test push that reached nobody (raised after the send's own catch, so it is not replaced).

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers({ 'user-agent': 'UA/1' })) }));
vi.mock('@/lib/data/push-subscriptions', () => ({
  revokeCurrentUserPushSubscription: vi.fn(),
  sendPushToCurrentUser: vi.fn(),
  upsertCurrentUserPushSubscription: vi.fn(),
}));

import {
  revokeCurrentUserPushSubscription,
  sendPushToCurrentUser,
  upsertCurrentUserPushSubscription,
} from '@/lib/data/push-subscriptions';
import { sendTestPushAction, subscribePushAction, unsubscribePushAction } from './push-actions';

const SUBSCRIPTION = {
  endpoint: 'https://push.example/abc',
  expirationTime: null,
  keys: { p256dh: 'p', auth: 'a' },
};
const NEXT_REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/auth/login;307;',
});

beforeEach(() => vi.clearAllMocks());

describe('subscribePushAction', () => {
  it('stores the browser subscription with the user agent', async () => {
    const result = await subscribePushAction(SUBSCRIPTION);

    expect(upsertCurrentUserPushSubscription).toHaveBeenCalledWith(SUBSCRIPTION, 'UA/1');
    expect(result).toEqual({ data: { success: true } });
  });

  it('a refused subscription is the fixed message', async () => {
    vi.mocked(upsertCurrentUserPushSubscription).mockRejectedValue(new Error('Invalid browser push subscription'));

    expect(await subscribePushAction({})).toEqual({ serverError: 'שמירת ההתראה בדפדפן נכשלה. נסו שוב.' });
  });

  it('re-throws a Next.js control-flow signal', async () => {
    vi.mocked(upsertCurrentUserPushSubscription).mockRejectedValue(NEXT_REDIRECT);

    await expect(subscribePushAction(SUBSCRIPTION)).rejects.toThrow('NEXT_REDIRECT');
  });
});

describe('unsubscribePushAction', () => {
  it('revokes the endpoint', async () => {
    const result = await unsubscribePushAction('https://push.example/abc');

    expect(revokeCurrentUserPushSubscription).toHaveBeenCalledWith('https://push.example/abc');
    expect(result).toEqual({ data: { success: true } });
  });

  it('a failed revoke is the fixed message', async () => {
    vi.mocked(revokeCurrentUserPushSubscription).mockRejectedValue(new Error('Missing push subscription endpoint'));

    expect(await unsubscribePushAction('')).toEqual({ serverError: 'ביטול ההתראה נכשל. נסו שוב.' });
  });
});

describe('sendTestPushAction', () => {
  const summary = (sent: number) => ({ attempted: 1, sent, failed: 1 - sent, revoked: 0 });

  it('a delivered test push answers with its summary', async () => {
    vi.mocked(sendPushToCurrentUser).mockResolvedValue(summary(1));

    expect(await sendTestPushAction()).toEqual({ data: { success: true, summary: summary(1) } });
  });

  it('a push that reached no device is the "no active subscription" message', async () => {
    vi.mocked(sendPushToCurrentUser).mockResolvedValue(summary(0));

    expect(await sendTestPushAction()).toEqual({ serverError: 'לא נמצאה התראה פעילה לשליחה במכשיר הזה.' });
  });

  it('a failed send is the fixed message', async () => {
    vi.mocked(sendPushToCurrentUser).mockRejectedValue(new Error('VAPID missing'));

    expect(await sendTestPushAction()).toEqual({ serverError: 'שליחת התראת בדיקה נכשלה. נסו שוב.' });
  });
});
