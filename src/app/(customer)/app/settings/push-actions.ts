'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';

import {
  revokeCurrentUserPushSubscription,
  sendPushToCurrentUser,
  upsertCurrentUserPushSubscription,
} from '@/lib/data/push-subscriptions';
import type { BrowserPushSubscription, PushSendSummary } from '@/lib/push/types';

interface PushActionResult {
  success: boolean;
  error?: string;
  summary?: PushSendSummary;
}

export async function subscribePushAction(
  subscription: BrowserPushSubscription,
): Promise<PushActionResult> {
  try {
    const requestHeaders = await headers();
    await upsertCurrentUserPushSubscription(
      subscription,
      requestHeaders.get('user-agent'),
    );
  } catch (err) {
    unstable_rethrow(err);
    return {
      success: false,
      error: 'שמירת ההתראה בדפדפן נכשלה. נסו שוב.',
    };
  }

  revalidatePath('/app/settings');
  return { success: true };
}

export async function unsubscribePushAction(endpoint: string): Promise<PushActionResult> {
  try {
    await revokeCurrentUserPushSubscription(endpoint);
  } catch (err) {
    unstable_rethrow(err);
    return {
      success: false,
      error: 'ביטול ההתראה נכשל. נסו שוב.',
    };
  }

  revalidatePath('/app/settings');
  return { success: true };
}

export async function sendTestPushAction(): Promise<PushActionResult> {
  try {
    const summary = await sendPushToCurrentUser({
      title: 'KALFA',
      body: 'התראות הדחיפה פעילות במכשיר הזה.',
      url: '/app/settings#notifications',
      tag: 'kalfa-test-push',
      renotify: true,
    });

    if (summary.sent === 0) {
      return {
        success: false,
        summary,
        error: 'לא נמצאה התראה פעילה לשליחה במכשיר הזה.',
      };
    }

    return {
      success: true,
      summary,
    };
  } catch (err) {
    unstable_rethrow(err);
    return {
      success: false,
      error: 'שליחת התראת בדיקה נכשלה. נסו שוב.',
    };
  }
}
