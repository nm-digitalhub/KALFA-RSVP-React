'use server';

import { headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';

import {
  revokeCurrentUserPushSubscription,
  upsertCurrentUserPushSubscription,
} from '@/lib/data/push-subscriptions';
import type { BrowserPushSubscription } from '@/lib/push/types';

// Console-agent push subscribe/unsubscribe — same DAL as the customer
// settings page (src/app/(customer)/app/settings/push-actions.ts), same
// push_subscriptions table, same VAPID keys, same /sw.js. Colocated here
// rather than imported cross-segment: the softphone panel this serves is
// mounted globally via AdminShell (no single owning admin route), so it gets
// its own tiny actions file next to the component tree that uses it instead
// of reaching into a customer-route file. requireUser() inside the DAL is
// role-agnostic — any authenticated user (customer or staff) may subscribe.

interface PushAlertActionResult {
  success: boolean;
  error?: string;
}

export async function subscribeConsolePushAction(
  subscription: BrowserPushSubscription,
): Promise<PushAlertActionResult> {
  try {
    const requestHeaders = await headers();
    await upsertCurrentUserPushSubscription(subscription, requestHeaders.get('user-agent'));
  } catch (err) {
    unstable_rethrow(err);
    return { success: false, error: 'שמירת ההתראה בדפדפן נכשלה. נסו שוב.' };
  }
  return { success: true };
}

export async function unsubscribeConsolePushAction(
  endpoint: string,
): Promise<PushAlertActionResult> {
  try {
    await revokeCurrentUserPushSubscription(endpoint);
  } catch (err) {
    unstable_rethrow(err);
    return { success: false, error: 'ביטול ההתראה נכשל. נסו שוב.' };
  }
  return { success: true };
}
