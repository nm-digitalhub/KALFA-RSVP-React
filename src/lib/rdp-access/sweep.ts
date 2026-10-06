import { sendSlackAlert } from '@/lib/alerts/slack';
import type { createAdminClient } from '@/lib/supabase/admin';

import { getRdpGatewayConfig } from './config';
import { disconnectRdpTunnels } from './gateway-client';
import {
  hasActiveRdpGrant,
  listRdpGrantsNeedingCut,
  markRdpCut,
  sweepRdpAccess,
} from './service';

// The remote-desktop sweep, run by the worker every minute. ONE implementation, like runFleetExpireSweep.
//
// CORRECTNESS NEVER DEPENDS ON THIS RUNNING. Expiry is evaluated against now() inside every rdp_* function
// and every tunnel check, so a late sweep cannot extend access. What the sweep adds:
//   1. bookkeeping: expired requests / grants are marked, and grants whose holder lost the permission are ended;
//   2. gateway clean-up: an ended grant is retried until two disconnects have been confirmed.
//
// KNOWN LIMIT, BY DESIGN. The gateway identity is the shared OS account, so a disconnect cannot be aimed at one
// grant: it closes every tunnel. While a NEWER grant is active the sweep therefore does not disconnect (it
// would cut the new holder). The first disconnect happens at revoke time in the CLI / server action, and the
// gateway also closes each tunnel by itself at its grant's expiry. Approving a new grant first clears stale
// tunnels (handled in the CLI step).
//
// Throws on a database error so the worker's guardedWorker alerts and the next tick retries. A gateway failure
// is NOT thrown: it is recorded on the grant and alerted, and the next tick retries it.

type AdminClient = ReturnType<typeof createAdminClient>;

export interface RdpAccessSweepSummary {
  requestsExpired: number;
  grantsExpired: number;
  accessRemoved: number;
  /** Ended grants still waiting for a confirmed disconnect at the start of this run. */
  pendingCut: number;
  cutOk: number;
  cutFailed: number;
  /** True when a newer grant was active, so no disconnect was attempted. */
  skippedActiveGrant: boolean;
  /** True when the gateway integration is not configured, so no disconnect was attempted. */
  skippedNoGateway: boolean;
}

export interface RdpAccessSweepDeps {
  sweep: typeof sweepRdpAccess;
  listPending: typeof listRdpGrantsNeedingCut;
  hasActiveGrant: typeof hasActiveRdpGrant;
  getConfig: typeof getRdpGatewayConfig;
  disconnect: typeof disconnectRdpTunnels;
  markCut: typeof markRdpCut;
  alert: typeof sendSlackAlert;
}

const defaultDeps: RdpAccessSweepDeps = {
  sweep: sweepRdpAccess,
  listPending: listRdpGrantsNeedingCut,
  hasActiveGrant: hasActiveRdpGrant,
  getConfig: getRdpGatewayConfig,
  disconnect: disconnectRdpTunnels,
  markCut: markRdpCut,
  alert: sendSlackAlert,
};

// Alerts carry the first 8 characters of the grant id in the TITLE on purpose: sendSlackAlert de-duplicates on
// (level, title, source), and two different grants must not swallow each other's alert.
const shortId = (id: string) => id.slice(0, 8);

export async function runRdpAccessSweep(
  admin: AdminClient,
  deps: RdpAccessSweepDeps = defaultDeps,
  now: Date = new Date(),
): Promise<RdpAccessSweepSummary> {
  const counts = await deps.sweep(admin);
  const pending = await deps.listPending(admin, now);

  const summary: RdpAccessSweepSummary = {
    requestsExpired: counts.requestsExpired,
    grantsExpired: counts.grantsExpired,
    accessRemoved: counts.accessRemoved,
    pendingCut: pending.length,
    cutOk: 0,
    cutFailed: 0,
    skippedActiveGrant: false,
    skippedNoGateway: false,
  };
  if (pending.length === 0) return summary;

  if (await deps.hasActiveGrant(admin, now)) {
    summary.skippedActiveGrant = true;
    return summary;
  }

  const config = deps.getConfig();
  if (!config.ok) {
    summary.skippedNoGateway = true;
    await deps.alert({
      level: 'error',
      category: 'security',
      source: 'rdp-access:sweep',
      title: 'שער ה-RDP אינו מוגדר: חיבורים של גישה שהסתיימה לא נותקו',
      detail: `משתנים: ${config.problems.map((p) => p.variable).join(', ')}`.slice(0, 500),
    });
    return summary;
  }

  for (const grant of pending) {
    const result = await deps.disconnect(config.config, { user: config.config.gatewayUser });
    await deps.markCut(admin, {
      grantId: grant.grantId,
      ok: result.ok,
      errorCode: result.ok ? 'ok' : result.kind,
    });
    if (result.ok) {
      summary.cutOk += 1;
      continue;
    }
    summary.cutFailed += 1;
    // The attempt that just failed is attempt number cutAttempts + 1.
    const attempts = grant.cutAttempts + 1;
    if (attempts >= 3) {
      await deps.alert({
        level: 'error',
        category: 'security',
        source: 'rdp-access:sweep',
        title: `ניתוק חיבורי RDP נכשל (${shortId(grant.grantId)})`,
        detail: `ניסיון ${attempts}, סיבה: ${result.kind}.${attempts >= 10 ? ' יש לעצור את השער לפי הנוהל.' : ''}`,
      });
    }
  }
  return summary;
}
