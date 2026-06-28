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
export const requireAdmin = cache(async () => {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: isAdminResult } = await supabase.rpc('has_role', {
    _role: 'admin',
    _user_id: user.id,
  });
  if (!isAdminResult) {
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
