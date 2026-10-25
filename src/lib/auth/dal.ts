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

// ---------------------------------------------------------------------------
// Platform (Owner/Staff) RBAC layer, orthogonal to the customer ORG roles below.
// Authorization facts live in the DB as DATA (platform_roles /
// platform_role_permissions / platform_permission_definitions) and are read via
// SECURITY DEFINER RPCs. NOTE: "owner" here means PLATFORM owner (KALFA staff),
// which is DISTINCT from an EVENT owner — do not confuse with requireOwnedEvent.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// THE PERMISSION MODEL IN THE DATABASE (staff-tables-permission-rls, 25.10.2026)
// ---------------------------------------------------------------------------
//
// Two layers, both required. The DAL functions below are the application gate. Row
// Level Security and table grants are a second, independent layer, so a staff member
// who calls PostgREST with their own session gets no more than the application gives:
//
// - THE FLOOR. is_platform_staff() — a platform_staff row — is what
//   requirePlatformStaff() checks for the admin area. No RLS policy calls it any more
//   (0 policies, local and live, 25.10.2026): the 25 tables below replaced it. One axis
//   since 2026-09-10 (20260910090301): user_roles, has_role and app_role are dropped
//   (20261015114659, 20261015134735) and requireAdmin()/isAdmin() are deleted. Do not
//   reintroduce a second axis.
// - CLOSED TABLES. The 11 tables only the server reaches (otp_challenges,
//   agreement_documents, webhook_inbox, workflows and its three run tables,
//   webhook_deliveries, outreach_template_failures, vox_log_exports,
//   voice_purpose_attempts) keep RLS on with no policy and no grant for anon or
//   authenticated: a user session gets 42501; the service role is untouched.
// - PER-PERMISSION POLICIES. The 14 tables staff reach with their own session (packages,
//   call_dnc_list, call_compliance_settings, voice_purposes, provider_numbers,
//   provider_number_roles, message_templates, channels, faq_items,
//   callback_schedule_policies, ops_alerts and the three fleet tables) have one policy
//   per operation their module performs, `to authenticated`, calling
//   (select public.has_platform_permission('<key>')) with the key the module is pinned
//   to, and grants for exactly those operations. The public reads packages_public_read,
//   faq_items_public_read and channels_auth_read are kept apart. The table → key map is
//   src/lib/auth/staff-table-permissions.ts; packages takes its keys from PLATFORM_ACTIONS.
// - THE HELPERS. is_platform_staff() and has_platform_permission() are SECURITY DEFINER
//   with search_path = '' (20261025163727); every name in their bodies is
//   schema-qualified.
//
// ⚠️ A DENIAL BY POLICY IS SILENT. On a per-permission table a session without the key
// reads zero rows, and its UPDATE or DELETE changes zero rows, with no error. A reader
// gated by a different key than the table's policy fails quietly, so a new user-session
// reader of a staff table uses that table's key (or the service role after its own
// gate) and gets a pgTAP case.
//
// WHERE THE PROOF LIVES. supabase/tests/database/*.sql (pgTAP, local stack only:
// inventories, privileges, the role × table × operation matrix, the data-layer statement
// shapes, the fleet RPCs, the service-role guard, the helpers);
// src/lib/auth/staff-table-sql-consistency.test.ts (each policy names the map's key);
// admin-data-layer-coverage.test.ts (the map equals the module pins, and every module
// under src/lib/data/admin is pinned or carries a documented exemption);
// src/lib/auth/permissions.local-it.test.ts (real sessions through PostgREST and the
// Server Action); scripts/check-permission-deny-matrix.sql (the role grants). Each stage
// is recorded in openspec/changes/staff-tables-permission-rls/verification-*.md.
//
// ⚠️ THE LAYOUT IS NOT THE GATE. `(admin)/admin/layout.tsx` calls
// requirePlatformStaff(), and that is defense in depth, NOT authority. Next's own
// guidance is explicit: "A layout also does not control whether the rest of the route
// renders… Instead, you should do the checks close to your data source"
// (node_modules/next/dist/docs/01-app/02-guides/authentication.md, "Layouts and
// auth checks"). Route segments still render and still emit an RSC payload even
// when the layout would have redirected. The real gate is the one in the DAL
// function that touches the data — which is why every module under
// src/lib/data/admin is pinned to a permission (or carries a documented
// exemption) and the coverage test fails closed on a new one.
//
// ⚠️ WHY THESE ARE TABLE READS AND NOT JWT CLAIMS. Supabase documents RBAC through a
// Custom Access Token Auth Hook that stamps the role into the token, so `authorize()`
// reads `auth.jwt()` cheaply inside RLS. We deliberately do not, for two measured
// reasons: (1) the cost the hook removes is a check run per row; every policy here wraps
// the helper as `(select …)`, which Postgres evaluates once per statement as an InitPlan
// — measured 25.10.2026 on the local stack, a manage_settings holder reading 2,012
// faq_items rows ran InitPlan 1 once (loops=1) — and the helper reads three small
// tables; (2) a claim is stale until the token refreshes — Supabase's sign-out guide
// states that "Access Tokens of revoked sessions remain valid until their expiry time" —
// whereas a table read revokes instantly, which is what we want for permissions that
// gate charging a card and dialling a guest. Revisit if a plan ever shows the check per
// row, or the initplan cost is measured to matter on a large table.

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

// Require platform staff; redirect to /access-denied otherwise.
//
// THE FLOOR for the admin area — "is this person staff at all" — and never the
// authorization for an individual action, which is requirePlatformPermission.
// See the note above on why the layout calling this is defense in depth rather
// than the gate.
export const requirePlatformStaff = cache(async () => {
  const user = await requireUser();
  if (!(await isPlatformStaff())) {
    redirect('/access-denied');
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
    redirect('/access-denied');
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
// role); redirect to /access-denied otherwise. Sibling of requirePlatformOwner, one layer
// finer-grained. `key` is validated at the DB against the seeded catalog (no
// hardcoded union here) — an unknown/mistyped key simply never matches and the
// user is redirected. Memoized per (render pass, key) via cache().
export const requirePlatformPermission = cache(async (key: string) => {
  const user = await requireUser();
  if (!(await hasPlatformPermission(key))) {
    redirect('/access-denied');
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
