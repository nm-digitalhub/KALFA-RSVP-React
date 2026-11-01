import { beforeEach, describe, expect, it, vi } from 'vitest';

// Console-agent push subscribe/unsubscribe: success, and each failure's fixed Hebrew message.

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers({ 'user-agent': 'UA/1' })) }));
vi.mock('@/lib/data/push-subscriptions', () => ({
  revokeCurrentUserPushSubscription: vi.fn(),
  upsertCurrentUserPushSubscription: vi.fn(),
}));

import {
  revokeCurrentUserPushSubscription,
  upsertCurrentUserPushSubscription,
} from '@/lib/data/push-subscriptions';
import { subscribeConsolePushAction, unsubscribeConsolePushAction } from './push-alert-actions';

const SUBSCRIPTION = {
  endpoint: 'https://push.example/abc',
  expirationTime: null,
  keys: { p256dh: 'p', auth: 'a' },
};

beforeEach(() => vi.clearAllMocks());

describe('subscribeConsolePushAction', () => {
  it('stores the browser subscription with the user agent', async () => {
    expect(await subscribeConsolePushAction(SUBSCRIPTION)).toEqual({ data: { success: true } });
    expect(upsertCurrentUserPushSubscription).toHaveBeenCalledWith(SUBSCRIPTION, 'UA/1');
  });

  it('a refused subscription is the fixed message', async () => {
    vi.mocked(upsertCurrentUserPushSubscription).mockRejectedValue(new Error('Invalid browser push subscription'));

    expect(await subscribeConsolePushAction({})).toEqual({ serverError: 'שמירת ההתראה בדפדפן נכשלה. נסו שוב.' });
  });
});

describe('unsubscribeConsolePushAction', () => {
  it('revokes the endpoint', async () => {
    expect(await unsubscribeConsolePushAction('https://push.example/abc')).toEqual({ data: { success: true } });
    expect(revokeCurrentUserPushSubscription).toHaveBeenCalledWith('https://push.example/abc');
  });

  it('a failed revoke is the fixed message', async () => {
    vi.mocked(revokeCurrentUserPushSubscription).mockRejectedValue(new Error('Revoking push subscription failed'));

    expect(await unsubscribeConsolePushAction('https://push.example/abc')).toEqual({
      serverError: 'ביטול ההתראה נכשל. נסו שוב.',
    });
  });
});
