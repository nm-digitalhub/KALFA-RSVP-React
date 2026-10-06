import 'server-only';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { sendPushToUser } from '@/lib/data/push-delivery';
import type { createAdminClient } from '@/lib/supabase/admin';

import { listRdpOwnerIds } from './queries';

// Tells the owners that a staff member is waiting for a decision. This is what connects a request made on the
// website to the owner CLI: a request that nobody knows about expires after 30 minutes, so the message carries
// the command that opens the approval screen.
//
// Kept apart from notify.ts on purpose: the owner CLI imports that file, and it must not drag the web-push
// stack (and its environment) into a terminal tool.
//
// Best effort by design. The request already exists when this runs, so a failure here never undoes it: every
// channel is attempted independently, the outcome is returned for the caller to log, and nothing throws. The
// text carries no name, reason or IP address (push and Slack are not a place for personal data); the first
// 8 characters of the id are IN THE TITLE because sendSlackAlert de-duplicates on (level, title, source) and
// two different requests must not swallow each other's alert.

type AdminClient = ReturnType<typeof createAdminClient>;

export type RdpRequestNotification = {
  /** Slack accepted the message (false when Slack is off, unreachable or the alert was de-duplicated). */
  slack: boolean;
  /** False when the owners could not be looked up, so no push was attempted. */
  ownersLookedUp: boolean;
  ownersFound: number;
  /** Push messages delivered, across every owner device. */
  pushed: number;
  /** Push messages that failed, plus owners whose whole delivery threw. */
  failed: number;
};

const shortId = (id: string) => id.slice(0, 8);

export async function notifyOwnersOfRdpRequest(
  admin: AdminClient,
  input: { requestId: string; minutes: number },
): Promise<RdpRequestNotification> {
  const id8 = shortId(input.requestId);

  const slackSent = sendSlackAlert({
    level: 'warn',
    category: 'security',
    source: 'rdp-access:request',
    title: `בקשת גישה לשולחן העבודה ממתינה (${id8})`,
    detail: `${input.minutes} דקות. לאישור: npm run rdp:access -- watch`,
  });

  let ownerIds: string[] = [];
  let ownersLookedUp = true;
  try {
    ownerIds = await listRdpOwnerIds(admin);
  } catch {
    ownersLookedUp = false;
    console.error('rdp-access: owner lookup for the request notification failed');
  }

  const deliveries = await Promise.allSettled(
    ownerIds.map((ownerId) =>
      sendPushToUser(ownerId, {
        title: 'KALFA — גישה לשולחן העבודה',
        body: `בקשה חדשה ממתינה לאישור (${input.minutes} דקות)`,
        url: `/admin/rdp-access/requests/${input.requestId}`,
        tag: `rdp-access-${id8}`,
      }),
    ),
  );

  let pushed = 0;
  let failed = 0;
  for (const delivery of deliveries) {
    if (delivery.status === 'fulfilled') {
      pushed += delivery.value.sent;
      failed += delivery.value.failed;
    } else {
      failed += 1;
      console.error('rdp-access: push delivery to an owner failed');
    }
  }

  return {
    slack: (await slackSent) !== null,
    ownersLookedUp,
    ownersFound: ownerIds.length,
    pushed,
    failed,
  };
}
