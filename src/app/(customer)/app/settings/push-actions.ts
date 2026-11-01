'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';

import {
  revokeCurrentUserPushSubscription,
  sendPushToCurrentUser,
  upsertCurrentUserPushSubscription,
} from '@/lib/data/push-subscriptions';
import { actionClient, returnUserError } from '@/lib/safe-action';
import type { PushSendSummary } from '@/lib/push/types';

// The browser's PushSubscription as JSON (BrowserPushSubscription). Every field is optional, exactly like the type:
// the data layer (normalizeBrowserSubscription) decides what a usable subscription is, and its refusal reaches the
// customer as the fixed message below.
const browserPushSubscriptionSchema = z.object({
  endpoint: z.string().optional(),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string().optional(), auth: z.string().optional() }).optional(),
});

export const subscribePushAction = actionClient
  .inputSchema(browserPushSubscriptionSchema)
  .action(async ({ parsedInput: subscription }) => {
    try {
      const requestHeaders = await headers();
      await upsertCurrentUserPushSubscription(
        subscription,
        requestHeaders.get('user-agent'),
      );
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('שמירת ההתראה בדפדפן נכשלה. נסו שוב.');
    }

    revalidatePath('/app/settings');
    return { success: true };
  });

export const unsubscribePushAction = actionClient
  .inputSchema(z.string())
  .action(async ({ parsedInput: endpoint }) => {
    try {
      await revokeCurrentUserPushSubscription(endpoint);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('ביטול ההתראה נכשל. נסו שוב.');
    }

    revalidatePath('/app/settings');
    return { success: true };
  });

export const sendTestPushAction = actionClient.action(async () => {
  let summary: PushSendSummary;
  try {
    summary = await sendPushToCurrentUser({
      title: 'KALFA',
      body: 'התראות הדחיפה פעילות במכשיר הזה.',
      url: '/app/settings#notifications',
      tag: 'kalfa-test-push',
      renotify: true,
    });
  } catch (err) {
    unstable_rethrow(err);
    returnUserError('שליחת התראת בדיקה נכשלה. נסו שוב.');
  }

  // Outside the try: returnUserError throws, and the catch above would turn this message into its own.
  if (summary.sent === 0) {
    returnUserError('לא נמצאה התראה פעילה לשליחה במכשיר הזה.');
  }

  return {
    success: true,
    summary,
  };
});
