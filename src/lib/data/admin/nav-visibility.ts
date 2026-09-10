import 'server-only';

import { hasPlatformPermission, isPlatformOwner, requirePlatformStaff } from '@/lib/auth/dal';

// Which sidebar links this viewer should be shown. Sibling of ./nav-counts.ts —
// same shape, same discipline: resolve the caller's own permissions server-side,
// hand the client component a plain answer, and NEVER redirect (a staff member
// legitimately holds only some of these).
//
// ⚠️ NAV VISIBILITY IS CONVENIENCE, NOT AUTHORIZATION. Hiding a link protects
// nothing — the URL is still typeable, and the page's own
// requirePlatformPermission is what refuses. The problem this solves is the
// opposite one: BEFORE 2026-09-10 the panel could only be entered by someone
// holding user_roles.admin, which in practice meant the three owners, so
// showing all 33 links to everyone cost nothing. Merging the two auth axes made
// every platform_staff row an admin-area login, and a support_agent now sees 33
// links of which 4 work. The other 29 do not say "no access" — they call
// redirect('/app'), which ejects them from the panel into the customer app.
//
// So this is a UX repair with a security-shaped cause, and it is deliberately
// the WEAKER half of the pair: the gate stays on the page.

// The permission keys the sidebar gates on — the distinct set behind NAV_GROUPS
// in src/components/admin-shell.tsx.
//
// Deliberately NOT imported from that module: it is `'use client'`, and having a
// server module reach into it would drag lucide-react across the boundary to
// read a string. The cost of stating them twice is that a nav item naming a
// NINTH key would silently vanish — fail-closed, which is the right direction,
// but silent. src/components/admin-nav-coverage.test.ts closes that: it asserts
// every `permission` in NAV_GROUPS appears here, so the mistake fails CI instead
// of quietly emptying someone's sidebar.
export const NAV_PERMISSION_KEYS = [
  'manage_settings',
  'manage_billing',
  'view_customer_data',
  'manage_voice',
  'manage_staff',
  'view_recordings',
  'view_activity_log',
  'view_webhooks',
] as const;

export interface AdminNavGrants {
  /** Owner-only links (roles, debug, relocation) hang off this, not a key. */
  owner: boolean;
  /** key → holds it. A key absent from this map means "hide", never "show". */
  permissions: Record<string, boolean>;
}

/**
 * Resolve the viewer's nav grants.
 *
 * `requirePlatformStaff()` here is the floor on purpose and is recorded as such
 * in COARSE_GATE_ALLOWED: this function writes nothing and returns no customer
 * data — nine booleans about the caller's own role. Naming a finer permission
 * would be circular, since its whole job is to answer which permissions the
 * caller has.
 *
 * It must NOT be requireAdmin(). That reads user_roles, the retired axis, and
 * redirects on a miss — so a billing_clerk who cleared requirePlatformStaff() at
 * the top of the layout would be thrown out of the panel by the very call that
 * decides which links to show them. See the note on the same swap in
 * ./nav-counts.ts.
 *
 * Every check is `cache()`-memoized in the DAL, and the layout already calls
 * some of them through getAdminNavCounts(), so the shared render pass collapses
 * the duplicates into one RPC per key.
 */
export async function getAdminNavGrants(): Promise<AdminNavGrants> {
  await requirePlatformStaff();

  const [owner, ...held] = await Promise.all([
    isPlatformOwner(),
    ...NAV_PERMISSION_KEYS.map((key) => hasPlatformPermission(key)),
  ]);

  return {
    owner,
    permissions: Object.fromEntries(NAV_PERMISSION_KEYS.map((key, i) => [key, held[i] ?? false])),
  };
}
