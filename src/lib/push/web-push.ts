import 'server-only';

import webpush, { type PushSubscription } from 'web-push';

import type { Database } from '@/lib/supabase/types';
import type { PushMessagePayload } from './types';

type PushSubscriptionRow = Database['public']['Tables']['push_subscriptions']['Row'];

let vapidConfigured = false;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

function configureWebPush() {
  if (vapidConfigured) {
    return;
  }

  const publicKey = requireEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY');
  const privateKey = requireEnv('VAPID_PRIVATE_KEY');
  const subject = process.env.VAPID_SUBJECT?.trim();

  if (!subject) {
    throw new Error('VAPID_SUBJECT is not configured');
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
}

export function pushRowToWebPushSubscription(row: PushSubscriptionRow): PushSubscription {
  return {
    endpoint: row.endpoint,
    keys: {
      p256dh: row.p256dh_key,
      auth: row.auth_key,
    },
  };
}

export async function sendWebPushNotification(
  subscription: PushSubscription,
  payload: PushMessagePayload,
) {
  configureWebPush();

  return webpush.sendNotification(
    subscription,
    JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url ?? '/app',
      icon: payload.icon ?? '/icons/icon.svg',
      badge: payload.badge ?? '/icons/badge.svg',
      tag: payload.tag,
      renotify: payload.renotify,
    }),
  );
}

export function getWebPushStatusCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const value = (error as { statusCode?: unknown }).statusCode;
  return typeof value === 'number' ? value : null;
}
