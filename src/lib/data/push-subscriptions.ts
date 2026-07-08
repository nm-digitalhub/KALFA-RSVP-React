import 'server-only';

import { getOrgContext, requireUser } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/types';
import {
  getWebPushStatusCode,
  pushRowToWebPushSubscription,
  sendWebPushNotification,
} from '@/lib/push/web-push';
import type {
  BrowserPushSubscription,
  PushMessagePayload,
  PushSendSummary,
} from '@/lib/push/types';

type PushSubscriptionRow = Database['public']['Tables']['push_subscriptions']['Row'];
type PushSubscriptionInsert = Database['public']['Tables']['push_subscriptions']['Insert'];
type PushDeliveryLogInsert = Database['public']['Tables']['push_delivery_log']['Insert'];

const PUSH_SUBSCRIPTION_COLUMNS =
  'id, user_id, org_id, endpoint, p256dh_key, auth_key, expiration_time, user_agent, created_at, updated_at, last_seen_at, revoked_at, failure_count, last_error';

function normalizeBrowserSubscription(subscription: BrowserPushSubscription) {
  const endpoint = subscription.endpoint?.trim();
  const p256dh = subscription.keys?.p256dh?.trim();
  const auth = subscription.keys?.auth?.trim();

  if (!endpoint || !p256dh || !auth) {
    throw new Error('Invalid browser push subscription');
  }

  return {
    endpoint,
    p256dh,
    auth,
    expirationTime:
      typeof subscription.expirationTime === 'number'
        ? new Date(subscription.expirationTime).toISOString()
        : null,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 500);
  }

  return 'Unknown push error';
}

function endpointHost(endpoint: string): string | null {
  try {
    return new URL(endpoint).host;
  } catch {
    return null;
  }
}

function responseStatusCode(response: unknown): number | null {
  if (typeof response !== 'object' || response === null || !('statusCode' in response)) {
    return null;
  }

  const statusCode = (response as { statusCode?: unknown }).statusCode;
  return typeof statusCode === 'number' ? statusCode : null;
}

function pushPayloadToJson(payload: PushMessagePayload): PushDeliveryLogInsert['payload'] {
  return JSON.parse(JSON.stringify(payload)) as PushDeliveryLogInsert['payload'];
}

async function logPushDelivery(
  supabase: ReturnType<typeof createAdminClient>,
  params: {
    row: PushSubscriptionRow;
    payload: PushMessagePayload;
    success: boolean;
    statusCode: number | null;
    errorMessage?: string | null;
  },
) {
  const insert: PushDeliveryLogInsert = {
    subscription_id: params.row.id,
    user_id: params.row.user_id,
    org_id: params.row.org_id,
    notification_type: 'web_push',
    payload: pushPayloadToJson(params.payload),
    success: params.success,
    status_code: params.statusCode,
    endpoint_host: endpointHost(params.row.endpoint),
    error_message: params.errorMessage ?? null,
    sent_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('push_delivery_log').insert(insert);

  if (error) {
    console.error('Writing push delivery log failed', {
      subscriptionId: params.row.id,
      error: error.message,
    });
  }
}

export async function upsertCurrentUserPushSubscription(
  subscription: BrowserPushSubscription,
  userAgent: string | null,
) {
  const user = await requireUser();
  const orgContext = await getOrgContext();
  const normalized = normalizeBrowserSubscription(subscription);
  const supabase = createAdminClient();

  const row: PushSubscriptionInsert = {
    user_id: user.id,
    org_id: orgContext.activeOrgId,
    endpoint: normalized.endpoint,
    p256dh_key: normalized.p256dh,
    auth_key: normalized.auth,
    expiration_time: normalized.expirationTime,
    user_agent: userAgent,
    last_seen_at: new Date().toISOString(),
    revoked_at: null,
    failure_count: 0,
    last_error: null,
  };

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(row, { onConflict: 'endpoint' });

  if (error) {
    throw new Error('Saving push subscription failed');
  }

  await logActivity({
    action: 'push_subscription.upserted',
    meta: {
      source: 'settings.notifications',
      has_org: Boolean(orgContext.activeOrgId),
    },
  });
}

export async function revokeCurrentUserPushSubscription(endpoint: string) {
  const user = await requireUser();
  const normalizedEndpoint = endpoint.trim();

  if (!normalizedEndpoint) {
    throw new Error('Missing push subscription endpoint');
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('push_subscriptions')
    .update({
      revoked_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    })
    .eq('user_id', user.id)
    .eq('endpoint', normalizedEndpoint);

  if (error) {
    throw new Error('Revoking push subscription failed');
  }

  await logActivity({
    action: 'push_subscription.revoked',
    meta: {
      source: 'settings.notifications',
    },
  });
}

export async function sendPushToCurrentUser(
  payload: PushMessagePayload,
): Promise<PushSendSummary> {
  const user = await requireUser();
  return sendPushToUser(user.id, payload);
}

export async function sendPushToUser(
  userId: string,
  payload: PushMessagePayload,
): Promise<PushSendSummary> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('push_subscriptions')
    .select(PUSH_SUBSCRIPTION_COLUMNS)
    .eq('user_id', userId)
    .is('revoked_at', null)
    .returns<PushSubscriptionRow[]>();

  if (error) {
    throw new Error('Loading push subscriptions failed');
  }

  const summary: PushSendSummary = {
    attempted: data.length,
    sent: 0,
    failed: 0,
    revoked: 0,
  };

  for (const row of data) {
    try {
      const response = await sendWebPushNotification(
        pushRowToWebPushSubscription(row),
        payload,
      );
      const statusCode = responseStatusCode(response);
      summary.sent += 1;

      await logPushDelivery(supabase, {
        row,
        payload,
        success: true,
        statusCode,
      });

      await supabase
        .from('push_subscriptions')
        .update({
          last_seen_at: new Date().toISOString(),
          failure_count: 0,
          last_error: null,
        })
        .eq('id', row.id);
    } catch (err) {
      summary.failed += 1;
      const statusCode = getWebPushStatusCode(err);
      const message = errorMessage(err);
      const shouldRevoke = statusCode === 404 || statusCode === 410;
      if (shouldRevoke) {
        summary.revoked += 1;
      }

      await logPushDelivery(supabase, {
        row,
        payload,
        success: false,
        statusCode,
        errorMessage: message,
      });

      await supabase
        .from('push_subscriptions')
        .update({
          revoked_at: shouldRevoke ? new Date().toISOString() : row.revoked_at,
          failure_count: row.failure_count + 1,
          last_error: message,
        })
        .eq('id', row.id);
    }
  }

  return summary;
}
