'use server';

import { z } from 'zod';
import { headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';

import {
  revokeCurrentUserPushSubscription,
  upsertCurrentUserPushSubscription,
} from '@/lib/data/push-subscriptions';
import { actionClient, returnUserError } from '@/lib/safe-action';

// Console-agent push subscribe/unsubscribe — same DAL as the customer
// settings page (src/app/(customer)/app/settings/push-actions.ts), same
// push_subscriptions table, same VAPID keys, same /sw.js. Colocated here
// rather than imported cross-segment: the softphone panel this serves is
// mounted globally via AdminShell (no single owning admin route), so it gets
// its own tiny actions file next to the component tree that uses it instead
// of reaching into a customer-route file. requireUser() inside the DAL is
// role-agnostic — any authenticated user (customer or staff) may subscribe.

// The browser's PushSubscription as JSON (BrowserPushSubscription), every field optional like the type: the data
// layer decides what a usable subscription is, and its refusal reaches the agent as the fixed message below.
const browserPushSubscriptionSchema = z.object({
  endpoint: z.string().optional(),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string().optional(), auth: z.string().optional() }).optional(),
});

export const subscribeConsolePushAction = actionClient
  .inputSchema(browserPushSubscriptionSchema)
  .action(async ({ parsedInput: subscription }) => {
    try {
      const requestHeaders = await headers();
      await upsertCurrentUserPushSubscription(subscription, requestHeaders.get('user-agent'));
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('שמירת ההתראה בדפדפן נכשלה. נסו שוב.');
    }
    return { success: true };
  });

export const unsubscribeConsolePushAction = actionClient
  .inputSchema(z.string())
  .action(async ({ parsedInput: endpoint }) => {
    try {
      await revokeCurrentUserPushSubscription(endpoint);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('ביטול ההתראה נכשל. נסו שוב.');
    }
    return { success: true };
  });
