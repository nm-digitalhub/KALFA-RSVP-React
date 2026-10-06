import { requirePlatformStaff } from '@/lib/auth/dal';
import { getProfile } from '@/lib/data/profiles';
import { getMyActiveExchangeConnection } from '@/lib/data/exchange-connections';
import {
  getMyPresence,
  listMyAvailabilityBlocks,
  type AvailabilityBlock,
  type PresenceSnapshot,
} from '@/lib/data/exchange-availability';
import { getAdminNavCounts } from '@/lib/data/admin/nav-counts';
import { getAdminNavGrants } from '@/lib/data/admin/nav-visibility';
import {
  consoleConsultConferenceEnabled,
  consoleHandoffEnabled,
  consoleSoftphoneEnabled,
} from '@/lib/data/console-softphone-config';
import { consoleWakeEnabled, isShiftActiveAndFresh } from '@/lib/data/console-calls';
import { getAgentQueueMemberships } from '@/lib/data/console-queues';
import { createClient } from '@/lib/supabase/server';
import { AdminShell } from '@/components/admin-shell';
import type { SoftphoneGateInfo } from '@/components/console/softphone-panel';

// Admin area layout. requirePlatformStaff() enforces authentication AND
// platform-staff membership server-side, redirecting anyone else to /app.
//
// ⚠️ THIS IS NOT THE AUTHORIZATION BOUNDARY.
// Next's own guidance is explicit: "A layout also does not control whether the rest
// of the route renders… Instead, you should do the checks close to your data
// source" (node_modules/next/dist/docs/01-app/02-guides/authentication.md,
// "Layouts and auth checks"). Route segments below still render, and still emit
// an RSC payload, even where this would have redirected. The real boundary is
// the permission gate inside each data-layer function — see
// src/lib/data/admin/*, every module of which is pinned to a permission by
// admin-data-layer-coverage.test.ts. Treat this as defense in depth.
//
// It reads platform_staff, not user_roles: asking the other axis would bounce a
// `billing_clerk` added through /admin/roles from the panel they had just been
// given a role in. See the note in src/lib/auth/dal.ts.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requirePlatformStaff();
  // Full name for the account menu (profile row is created at signup by the
  // handle_new_user trigger); falls back to the email in the shell when empty.
  // navCounts (per-item sidebar badges) and navGrants (which links this viewer
  // is shown at all) are independent of the profile read — fetched in parallel
  // rather than as sequential awaits. Both resolve the caller's permissions
  // through the same cache()-memoized DAL helpers, so the overlapping keys cost
  // one RPC each for the whole render pass, not one per caller.
  const [profile, navCounts, navGrants] = await Promise.all([
    getProfile(),
    getAdminNavCounts(),
    getAdminNavGrants(),
  ]);
  const userName = profile?.full_name?.trim() || undefined;

  // Availability presence for the account menu. Read here so the avatar's
  // status dot is correct on first paint, with no client round trip. Both
  // reads fail SOFT: an Exchange hiccup must never take down the whole admin
  // area — the menu then simply offers to connect a mailbox.
  let availabilityBlocks: AvailabilityBlock[] = [];
  let availabilityPresence: PresenceSnapshot = {
    showAs: 'free',
    untilIso: null,
    ownedByApp: false,
  };
  let hasExchangeConnection = false;
  try {
    hasExchangeConnection = (await getMyActiveExchangeConnection()) !== null;
    if (hasExchangeConnection) {
      [availabilityBlocks, availabilityPresence] = await Promise.all([
        listMyAvailabilityBlocks(),
        getMyPresence(),
      ]);
    }
  } catch {
    hasExchangeConnection = false;
  }

  // Browser call-center softphone gate: is this admin
  // an enrolled console agent (console_me self-scopes to auth.uid()), AND is
  // the feature flag on. Read here — once, at the shell level — so the panel
  // mounts once and survives navigation instead of being re-derived per page.
  // Fails SOFT like the Exchange reads above: a lookup failure just means no
  // panel, never a broken admin area.
  let softphone: SoftphoneGateInfo = {
    enabled: false,
    voxUsername: null,
    displayName: '',
    handoffEnabled: false,
    queueMemberships: [],
    consultConferenceEnabled: false,
    wakeEnabled: false,
    shiftActive: false,
  };
  try {
    const supabase = await createClient();
    const [
      { data: consoleMe },
      softphoneEnabled,
      handoffEnabled,
      queueMemberships,
      consultConferenceEnabled,
      wakeEnabled,
      // Own-row read of the "on shift" intent — same cookie-session client + RLS
      // (console_agent_shift_select via is_console_agent()) as console_me above,
      // not a service-role fetch: this is self-scoped, an agent's own toggle.
      { data: shiftRow },
    ] = await Promise.all([
      supabase.from('console_me').select('vox_username, display_name').maybeSingle(),
      consoleSoftphoneEnabled(),
      consoleHandoffEnabled(),
      // Read-only, next to presence (department queues). Server-side, service-role
      // read (see console-queues.ts's getAgentQueueMemberships doc) — not a browser
      // RLS fetch. Fails soft like everything else in this block: a lookup error just
      // shows no memberships, never a broken admin area.
      getAgentQueueMemberships(user.id).catch(() => []),
      // Consult/conference — same fail-soft, gate-at-the-shell
      // discipline as handoffEnabled above.
      consoleConsultConferenceEnabled(),
      consoleWakeEnabled(),
      supabase
        .from('console_agent_shift')
        .select('active, updated_at')
        .eq('agent_id', user.id)
        .maybeSingle(),
    ]);
    softphone = {
      enabled: softphoneEnabled,
      voxUsername: consoleMe?.vox_username ?? null,
      displayName: consoleMe?.display_name ?? '',
      handoffEnabled,
      queueMemberships,
      consultConferenceEnabled,
      wakeEnabled,
      shiftActive: isShiftActiveAndFresh(shiftRow ?? null),
    };
  } catch {
    // softphone stays at the all-off default above — the panel renders nothing.
  }

  return (
    <AdminShell
      userEmail={user.email}
      userName={userName}
      availabilityBlocks={availabilityBlocks}
      availabilityPresence={availabilityPresence}
      hasExchangeConnection={hasExchangeConnection}
      navCounts={navCounts}
      navGrants={navGrants}
      softphone={softphone}
    >
      {children}
    </AdminShell>
  );
}
