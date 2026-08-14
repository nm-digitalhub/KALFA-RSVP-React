import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/types';
import {
  getWebPushStatusCode,
  pushRowToWebPushSubscription,
  sendWebPushNotification,
} from '@/lib/push/web-push';
import type { PushMessagePayload, PushSendSummary } from '@/lib/push/types';

/**
 * Web-push delivery to an EXPLICITLY NAMED user.
 *
 * Split out of `push-subscriptions.ts`, which is where this lived and where it
 * does not belong. That module also holds the three request-scoped exports
 * (`upsertCurrentUserPushSubscription`, `revokeCurrentUserPushSubscription`,
 * `sendPushToCurrentUser`), and those reach `@/lib/auth/dal` for `requireUser`
 * / `getOrgContext`. `dal` imports `next/navigation` and, through
 * `supabase/server`, `next/headers` — both request-scoped APIs that do not
 * exist in a long-lived non-request process.
 *
 * The pg-boss worker rings agents about an inbound call, so it reaches
 * `console-calls.ts`, which reached `sendPushToUser`, which dragged the whole
 * request-scoped half of that module into the worker's graph. The
 * `worker-no-request-scoped-next` rule in `.dependency-cruiser.cjs` was
 * reporting exactly that, on two paths, and it was right.
 *
 * Nothing here takes a request context: the caller names the user. That is the
 * whole reason the split is possible, and the reason it is structural rather
 * than a convention someone has to remember — this module cannot import `dal`
 * without the rule firing again.
 */

type PushSubscriptionRow = Database['public']['Tables']['push_subscriptions']['Row'];
type PushDeliveryLogInsert = Database['public']['Tables']['push_delivery_log']['Insert'];

const PUSH_SUBSCRIPTION_COLUMNS =
  'id, user_id, org_id, endpoint, p256dh_key, auth_key, expiration_time, user_agent, created_at, updated_at, last_seen_at, revoked_at, failure_count, last_error';

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
