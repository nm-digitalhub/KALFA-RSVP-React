import { requireAdmin } from '@/lib/auth/dal';
import { getProfile } from '@/lib/data/profiles';
import { getMyActiveExchangeConnection } from '@/lib/data/exchange-connections';
import {
  getMyPresence,
  listMyAvailabilityBlocks,
  type AvailabilityBlock,
  type PresenceSnapshot,
} from '@/lib/data/exchange-availability';
import { getAdminNavCounts } from '@/lib/data/admin/nav-counts';
import { AdminShell } from '@/components/admin-shell';

// Admin area layout. requireAdmin() enforces authentication AND the admin role
// server-side on every request (redirecting non-admins). This is the
// authorization boundary for the entire /admin subtree; the nav link in the
// customer shell is a convenience only.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAdmin();
  // Full name for the account menu (profile row is created at signup by the
  // handle_new_user trigger); falls back to the email in the shell when empty.
  // navCounts (per-item sidebar badges) is independent of the profile read —
  // fetched in parallel rather than as a second sequential await.
  const [profile, navCounts] = await Promise.all([getProfile(), getAdminNavCounts()]);
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

  return (
    <AdminShell
      userEmail={user.email}
      userName={userName}
      availabilityBlocks={availabilityBlocks}
      availabilityPresence={availabilityPresence}
      hasExchangeConnection={hasExchangeConnection}
      navCounts={navCounts}
    >
      {children}
    </AdminShell>
  );
}
