import 'server-only';

import { getOrgContext, requireUser } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { sendPushToUser } from '@/lib/data/push-delivery';
import { createAdminClient } from '@/lib/supabase/admin';
import type { TablesInsert } from '@/lib/supabase/types';
import type {
  BrowserPushSubscription,
  PushMessagePayload,
  PushSendSummary,
} from '@/lib/push/types';

/**
 * The REQUEST-SCOPED half of web push: everything that acts on behalf of
 * whoever is currently signed in, and therefore reaches `@/lib/auth/dal`.
 *
 * Delivery to a named user lives in `@/lib/data/push-delivery` and must stay
 * there. `dal` pulls in `next/navigation` and `next/headers`, which do not
 * exist outside a request — so anything importable by the pg-boss worker
 * cannot live in this file. That is enforced, not remembered:
 * `.dependency-cruiser.cjs` fails the build if `worker/**` can reach those
 * APIs, and it is what caught the original mixing.
 *
 * If you add an export here, ask whether the worker could ever want it. If it
 * could, it belongs in `push-delivery` with the user passed in explicitly.
 */

type PushSubscriptionInsert = TablesInsert<'push_subscriptions'>;

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
