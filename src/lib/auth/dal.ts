import 'server-only';

import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

// Data Access Layer (Next.js recommended pattern). Authorization checks live
// close to the data and are memoized per render pass with React's cache().

// Verified current user (or null). getUser() validates the token with the
// Supabase Auth server — never use getSession() for authorization.
export const getUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

// Require an authenticated user; redirect to login otherwise.
export const requireUser = cache(async () => {
  const user = await getUser();
  if (!user) {
    redirect('/auth/login');
  }
  return user;
});

// Whether the current user is an administrator. Non-redirecting — for
// conditional UI (e.g. showing an admin nav link). Returns false for
// anonymous users. Authorization for admin routes is still enforced by
// requireAdmin in the admin layout; this is convenience only, never a gate.
// Memoized per render pass so repeated calls share one RPC round-trip.
export const isAdmin = cache(async (): Promise<boolean> => {
  const user = await getUser();
  if (!user) {
    return false;
  }
  const supabase = await createClient();
  const { data } = await supabase.rpc('has_role', {
    _role: 'admin',
    _user_id: user.id,
  });
  return data === true;
});

// Require an administrator. Role is checked server-side via the trusted
// has_role() RPC against the user_roles table (not browser-supplied data).
// Delegates to isAdmin() rather than issuing its own RPC call so the two stay
// in sync and a shared render pass reuses one round-trip via cache().
/**
 * @deprecated NOT the admin floor — that is `requirePlatformStaff` below.
 *
 * Checks `has_role(uid,'admin')` on `user_roles`, a separate axis from
 * platform_staff that exists for historical reasons and is being retired. Do not
 * reach for it in new code: a data-layer function names a permission, and the
 * area floor is platform staff. Kept only for the surfaces not yet migrated.
 */
export const requireAdmin = cache(async () => {
  const user = await requireUser();
  if (!(await isAdmin())) {
    redirect('/app');
  }
  return user;
});

// ---------------------------------------------------------------------------
// Platform (Owner/Staff) RBAC layer. A SECOND platform role layer, orthogonal to
// the coarse has_role('admin') flag above and to the customer ORG roles below.
// Authorization facts live in the DB as DATA (platform_roles /
// platform_role_permissions / platform_permission_definitions) and are read via
// SECURITY DEFINER RPCs. NOTE: "owner" here means PLATFORM owner (KALFA staff),
// which is DISTINCT from an EVENT owner — do not confuse with requireOwnedEvent.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// THE FLOOR: platform_staff membership.
// ---------------------------------------------------------------------------
//
// Decided 2026-09-10, and the reason is a blocking bug rather than tidiness.
//
// There used to be TWO axes for "is this person staff": `user_roles.admin`
// (checked by requireAdmin/isAdmin above) and `platform_staff` (the table that
// carries roles, permissions, granted_by, an audit log and a last-owner guard).
// Nothing tied them together — no foreign key, no trigger — and they were
// written by two flows that did not know about each other: `setPlatformAdmin`
// touches only user_roles, `assignStaffRole` only platform_staff.
//
// The consequence: adding a `billing_clerk` through /admin/roles produced a
// person the admin layout REDIRECTED to /app, because the layout asked the other
// axis. Every non-owner role shipped unusable.
//
// `user_roles.admin` has no independent job to protect: all 21 RLS policies that
// reference it sit on platform-management tables (app_settings, channels,
// workflows, packages, webhook_inbox, fleet_*, …) and not one on a customer
// table. It is a platform-staff proxy.
//
// ⚠️ STATUS: IN FORCE since 2026-09-10. Migration
// `20260910090301_platform_staff_is_the_admin_floor.sql` is applied. Verified
// against the live database afterwards: 21 policies now call
// is_platform_staff(), 0 still call has_role, and 0 lost the `( SELECT … )`
// initplan wrapper that keeps the check once-per-query instead of once-per-row.
// One axis from here on — do not reintroduce the second.
//
// ⚠️ THE LAYOUT IS NOT THE GATE. `(admin)/admin/layout.tsx` calls
// requirePlatformStaff(), and that is defense in depth, NOT authority. Next's own
// guidance is explicit: "A layout does not control whether the rest of the route
// renders… Instead, you should do the checks close to your data source"
// (node_modules/next/dist/docs/01-app/02-guides/authentication.md, "Layouts and
// auth checks"). Route segments still render and still emit an RSC payload even
// when the layout would have redirected. The real gate is the one in the DAL
// function that touches the data — which is why every module under
// src/lib/data/admin is pinned to a permission and the coverage test fails
// closed on a new one.
//
// ⚠️ WHY THESE ARE RPCs AND NOT JWT CLAIMS. Supabase documents RBAC through a
// Custom Access Token Auth Hook that stamps the role into the token, and
// `authorize()` then reads `auth.jwt()`. We deliberately do not. Two measured
// reasons: (1) that pattern exists to make the check cheap INSIDE RLS, where it
// would otherwise run per row — our fine-grained permissions appear in ZERO
// policies and run once per render pass behind React `cache()`, so there is no
// per-row cost to remove, and Supabase's own auth_rls_initplan lint reports no
// finding on the policies that do use one; (2) a claim is stale until the token
// refreshes — Supabase's sign-out guide states that "Access Tokens of revoked
// sessions remain valid until their expiry time" — whereas a table read revokes
// instantly, which is what we want for permissions that gate charging a card and
// dialling a guest. Revisit ONLY if has_platform_permission ever enters an RLS
// policy; that is the trigger, not team size.

// Whether the current user is platform staff, at any role. Non-redirecting —
// for conditional UI. Returns false for anonymous users. Memoized per render
// pass, so repeated checks share one RPC round-trip.
export const isPlatformStaff = cache(async (): Promise<boolean> => {
  const user = await getUser();
  if (!user) {
    return false;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('is_platform_staff');
  if (error) {
    return false;
  }
  return data === true;
});

// Require platform staff; redirect to /app otherwise.
//
// THE FLOOR for the admin area — "is this person staff at all" — and never the
// authorization for an individual action, which is requirePlatformPermission.
// See the note above on why the layout calling this is defense in depth rather
// than the gate.
export const requirePlatformStaff = cache(async () => {
  const user = await requireUser();
  if (!(await isPlatformStaff())) {
    redirect('/app');
  }
  return user;
});

// Whether the current user is a PLATFORM OWNER (holds a staff row on the owner
// role). Non-redirecting — for conditional UI. Returns false for anonymous
// users. Memoized per render pass. The RPC resolves the caller from
// (select auth.uid()) server-side, so no id is passed from the browser.
export const isPlatformOwner = cache(async (): Promise<boolean> => {
  const user = await getUser();
  if (!user) {
    return false;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('is_platform_owner');
  if (error) {
    return false;
  }
  return data === true;
});

// Require a PLATFORM OWNER. Ownership is checked server-side via the trusted
// is_platform_owner() RPC (not browser-supplied data). Delegates to
// isPlatformOwner() so the two stay in sync and share one round-trip via cache().
export const requirePlatformOwner = cache(async () => {
  const user = await requireUser();
  if (!(await isPlatformOwner())) {
    redirect('/app');
  }
  return user;
});

// Whether the current user is ANY platform staff member. Non-redirecting.
// Returns false for anonymous users. Memoized per render pass.
export const isStaff = cache(async (): Promise<boolean> => {
  const user = await getUser();
  if (!user) {
    return false;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('is_staff');
  if (error) {
    return false;
  }
  return data === true;
});

// Whether the current user holds the platform permission `key` (via their staff
// role). Non-throwing — for conditional UI and gating. Memoized per render pass
// so repeated checks for the same key share one RPC round-trip. `key` is
// validated at the DB against the seeded catalog (no hardcoded union here).
export const hasPlatformPermission = cache(async (key: string): Promise<boolean> => {
  const user = await getUser();
  if (!user) {
    return false;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('has_platform_permission', { _key: key });
  if (error) {
    return false;
  }
  return data === true;
});

// Require the current user to hold platform permission `key` (via their staff
// role); redirect to /app otherwise. Sibling of requirePlatformOwner, one layer
// finer-grained. `key` is validated at the DB against the seeded catalog (no
// hardcoded union here) — an unknown/mistyped key simply never matches and the
// user is redirected. Memoized per (render pass, key) via cache().
export const requirePlatformPermission = cache(async (key: string) => {
  const user = await requireUser();
  if (!(await hasPlatformPermission(key))) {
    redirect('/app');
  }
  return user;
});

// ---------------------------------------------------------------------------
// Organization context (multi-tenant layer). The active org is resolved from a
// cookie but ALWAYS verified server-side against the caller's memberships — a
// browser-supplied org id is never trusted on its own.
// ---------------------------------------------------------------------------

export const ACTIVE_ORG_COOKIE = 'active_org';

export interface OrgMembership {
  /** organization id */
  id: string;
  name: string;
  roleId: string;
  roleName: string;
  roleLabel: string;
  rank: number;
}

export interface OrgContext {
  orgs: OrgMembership[];
  activeOrgId: string | null;
  activeRoleId: string | null;
  activeRoleName: string | null;
}

// The current user's organizations + the resolved active org. Memoized per
// render pass. Returns an empty context for anonymous users.
export const getOrgContext = cache(async (): Promise<OrgContext> => {
  const empty: OrgContext = {
    orgs: [],
    activeOrgId: null,
    activeRoleId: null,
    activeRoleName: null,
  };
  const user = await getUser();
  if (!user) {
    return empty;
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('organization_members')
    .select('organization_id, role_id, organizations(name), org_roles(name, label, rank)')
    .eq('user_id', user.id);
  if (error || !data) {
    return empty;
  }
  const orgs: OrgMembership[] = data.map((r) => ({
    id: r.organization_id,
    name: r.organizations?.name ?? '',
    roleId: r.role_id,
    roleName: r.org_roles?.name ?? '',
    roleLabel: r.org_roles?.label ?? '',
    rank: r.org_roles?.rank ?? 0,
  }));
  const cookieStore = await cookies();
  const requested = cookieStore.get(ACTIVE_ORG_COOKIE)?.value ?? null;
  const active = orgs.find((o) => o.id === requested) ?? orgs[0] ?? null;
  return {
    orgs,
    activeOrgId: active?.id ?? null,
    activeRoleId: active?.roleId ?? null,
    activeRoleName: active?.roleName ?? null,
  };
});

// Whether the current user is the OWNER of `orgId` (holds the org's
// `is_owner_role` role). Non-redirecting — for conditional UI (e.g. revealing
// the roles-matrix nav link). Returns false for anonymous users. Memoized per
// (render pass, orgId) via cache(). Deliberately NOT `can(orgId,'organization',
// 'manage')` — that permission is also granted to the `admin` org role in the
// seed template, which would let an org admin see/edit the owner-only screen.
// The RPC resolves the caller from (select auth.uid()) server-side.
export const isOrgOwner = cache(async (orgId: string): Promise<boolean> => {
  const user = await getUser();
  if (!user) {
    return false;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('is_org_owner', { _org_id: orgId });
  if (error) {
    return false;
  }
  return data === true;
});

// Require the current user to be the OWNER of `orgId`; redirect to
// /app/team otherwise. Ownership is checked server-side via the trusted
// is_org_owner() RPC (not browser-supplied data). Delegates to isOrgOwner() so
// the two stay in sync and share one round-trip via cache().
export const requireOrgOwner = cache(async (orgId: string) => {
  const user = await requireUser();
  if (!(await isOrgOwner(orgId))) {
    redirect('/app/team');
  }
  return user;
});

// Require an active organization; redirects to /app if the user has none.
// Every user gets a personal org on first event creation, so this normally
// always resolves for an authenticated user.
export const requireActiveOrg = cache(
  async (): Promise<{ orgId: string; roleId: string; roleName: string }> => {
    const ctx = await getOrgContext();
    if (!ctx.activeOrgId || !ctx.activeRoleId) {
      redirect('/app');
    }
    return {
      orgId: ctx.activeOrgId,
      roleId: ctx.activeRoleId,
      roleName: ctx.activeRoleName ?? '',
    };
  },
);
