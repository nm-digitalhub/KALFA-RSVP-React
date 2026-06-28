import 'server-only';

import type { User } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { resolvePage, type PageParams, type PageResult } from './shared';

// Admin: cross-user management (platform staff). user_roles/profiles are
// self-only under RLS and emails live in auth.users, so every read/write here
// goes through the SERVICE-ROLE client behind a requireAdmin() gate (the
// platform role layer — orthogonal to the customer org-role layer). Sensitive
// mutations carry last-admin + no-self-lockout guards and are audited.

const PLATFORM_ADMIN = 'admin' as const;
// Supabase auth ban sentinels: a long duration to "suspend", 'none' to restore.
const BAN_FOREVER = '876000h';
const UNBAN = 'none';
// No server-side filter exists in the GoTrue admin API, so search scans pages.
// Capped to stay bounded; a hit on the cap is logged, never silently truncated.
const SEARCH_PER_PAGE = 200;
const SEARCH_MAX_PAGES = 10;

export interface AdminUser {
  id: string;
  email: string | null;
  fullName: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
  isPlatformAdmin: boolean;
  orgCount: number;
  suspended: boolean;
}

export interface AdminUserOrg {
  id: string;
  name: string;
  roleLabel: string;
}

// One row of the user's "current plan/package": a purchase (order) + its package.
export interface AdminUserOrder {
  id: string;
  packageName: string | null;
  tier: string | null;
  status: string;
  totalWithVat: number;
  withAiAddon: boolean;
  createdAt: string;
}

// A benefit (credit) previously granted to one of the user's events.
export interface AdminUserCredit {
  id: string;
  eventId: string;
  amount: number;
  reason: string;
  createdAt: string;
}

export interface AdminUserEvent {
  id: string;
  name: string;
}

export interface AdminUserDetail extends AdminUser {
  phone: string | null;
  orgs: AdminUserOrg[];
  ownedEventCount: number;
  events: AdminUserEvent[];
  orders: AdminUserOrder[];
  credits: AdminUserCredit[];
}

function isSuspended(bannedUntil: string | null | undefined): boolean {
  if (!bannedUntil) return false;
  const t = new Date(bannedUntil).getTime();
  return Number.isFinite(t) && t > Date.now();
}

// Enrich a page of auth users with profile name, platform-admin flag and org
// count, in three batched queries (no N+1).
async function enrichUsers(users: User[]): Promise<AdminUser[]> {
  if (users.length === 0) return [];
  const admin = createAdminClient();
  const ids = users.map((u) => u.id);
  const [profilesRes, rolesRes, membersRes] = await Promise.all([
    admin.from('profiles').select('id, full_name').in('id', ids),
    admin.from('user_roles').select('user_id').eq('role', PLATFORM_ADMIN).in('user_id', ids),
    admin.from('organization_members').select('user_id').in('user_id', ids),
  ]);
  const nameById = new Map((profilesRes.data ?? []).map((p) => [p.id, p.full_name]));
  const adminIds = new Set((rolesRes.data ?? []).map((r) => r.user_id));
  const orgCountById = new Map<string, number>();
  for (const m of membersRes.data ?? []) {
    orgCountById.set(m.user_id, (orgCountById.get(m.user_id) ?? 0) + 1);
  }
  return users.map((u) => ({
    id: u.id,
    email: u.email ?? null,
    fullName: nameById.get(u.id) ?? null,
    createdAt: u.created_at ?? null,
    lastSignInAt: u.last_sign_in_at ?? null,
    isPlatformAdmin: adminIds.has(u.id),
    orgCount: orgCountById.get(u.id) ?? 0,
    suspended: isSuspended(u.banned_until),
  }));
}

// List all platform users, paginated. When `search` is given, scans (capped)
// and filters by email substring (the admin API has no server-side filter).
export async function listAllUsers(
  { page, search }: PageParams & { search?: string } = {},
): Promise<PageResult<AdminUser>> {
  await requireAdmin();
  const { page: safePage, pageSize, from, to } = resolvePage(page);
  const admin = createAdminClient();
  const term = search?.trim().toLowerCase();

  if (!term) {
    const { data, error } = await admin.auth.admin.listUsers({
      page: safePage,
      perPage: pageSize,
    });
    if (error) {
      throw new Error('טעינת המשתמשים נכשלה');
    }
    return {
      items: await enrichUsers(data.users),
      total: data.total,
      page: safePage,
      pageSize,
    };
  }

  const matched: User[] = [];
  for (let p = 1; p <= SEARCH_MAX_PAGES; p++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page: p,
      perPage: SEARCH_PER_PAGE,
    });
    if (error) {
      throw new Error('טעינת המשתמשים נכשלה');
    }
    for (const u of data.users) {
      if ((u.email ?? '').toLowerCase().includes(term)) matched.push(u);
    }
    if (data.nextPage == null) break;
    if (p === SEARCH_MAX_PAGES) {
      console.warn('listAllUsers: search scan cap reached; results may be incomplete');
    }
  }
  const pageUsers = matched.slice(from, to + 1);
  return {
    items: await enrichUsers(pageUsers),
    total: matched.length,
    page: safePage,
    pageSize,
  };
}

// Full detail for one user, including their CURRENT PLAN/PACKAGE (orders +
// packages), org memberships, owned-event count and previously granted benefits.
export async function getUserDetail(userId: string): Promise<AdminUserDetail | null> {
  await requireAdmin();
  const admin = createAdminClient();

  const { data: authData, error } = await admin.auth.admin.getUserById(userId);
  if (error || !authData?.user) {
    return null;
  }
  const u = authData.user;

  const [profileRes, roleRes, membersRes, eventsRes, ordersRes] = await Promise.all([
    admin.from('profiles').select('full_name, phone').eq('id', userId).maybeSingle(),
    admin.from('user_roles').select('id').eq('user_id', userId).eq('role', PLATFORM_ADMIN).maybeSingle(),
    admin
      .from('organization_members')
      .select('organization_id, organizations(name), org_roles(label)')
      .eq('user_id', userId),
    admin.from('events').select('id, name').eq('owner_id', userId),
    admin
      .from('orders')
      .select('id, status, total_with_vat, with_ai_addon, created_at, package:packages(name, tier)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
  ]);

  const eventIds = (eventsRes.data ?? []).map((e) => e.id);
  let credits: AdminUserCredit[] = [];
  if (eventIds.length > 0) {
    const { data: creditRows } = await admin
      .from('billing_credits')
      .select('id, event_id, amount, reason, created_at')
      .in('event_id', eventIds)
      .order('created_at', { ascending: false });
    credits = (creditRows ?? []).map((c) => ({
      id: c.id,
      eventId: c.event_id,
      amount: c.amount,
      reason: c.reason,
      createdAt: c.created_at,
    }));
  }

  const orgs: AdminUserOrg[] = (membersRes.data ?? []).map((m) => ({
    id: m.organization_id,
    name: m.organizations?.name ?? '',
    roleLabel: m.org_roles?.label ?? '',
  }));

  const orders: AdminUserOrder[] = (ordersRes.data ?? []).map((o) => ({
    id: o.id,
    packageName: o.package?.name ?? null,
    tier: o.package?.tier ?? null,
    status: o.status,
    totalWithVat: o.total_with_vat,
    withAiAddon: o.with_ai_addon,
    createdAt: o.created_at,
  }));

  return {
    id: u.id,
    email: u.email ?? null,
    fullName: profileRes.data?.full_name ?? null,
    phone: profileRes.data?.phone ?? null,
    createdAt: u.created_at ?? null,
    lastSignInAt: u.last_sign_in_at ?? null,
    isPlatformAdmin: Boolean(roleRes.data),
    orgCount: orgs.length,
    suspended: isSuspended(u.banned_until),
    orgs,
    ownedEventCount: eventIds.length,
    events: (eventsRes.data ?? []).map((e) => ({ id: e.id, name: e.name })),
    orders,
    credits,
  };
}

// How many users currently hold the platform admin role.
async function platformAdminCount(): Promise<number> {
  const admin = createAdminClient();
  const { count } = await admin
    .from('user_roles')
    .select('id', { count: 'exact', head: true })
    .eq('role', PLATFORM_ADMIN);
  return count ?? 0;
}

// Grant or revoke the platform admin role. Revoke is guarded: the final admin
// can never be demoted (which also prevents self-lockout).
export async function setPlatformAdmin(userId: string, grant: boolean): Promise<void> {
  const actor = await requireAdmin();
  const admin = createAdminClient();

  if (grant) {
    const { data: existing } = await admin
      .from('user_roles')
      .select('id')
      .eq('user_id', userId)
      .eq('role', PLATFORM_ADMIN)
      .maybeSingle();
    if (!existing) {
      const { error } = await admin
        .from('user_roles')
        .insert({ user_id: userId, role: PLATFORM_ADMIN });
      if (error) throw new Error('הענקת ההרשאה נכשלה');
    }
  } else {
    if ((await platformAdminCount()) <= 1) {
      throw new Error('חייב להישאר לפחות מנהל מערכת אחד');
    }
    const { error } = await admin
      .from('user_roles')
      .delete()
      .eq('user_id', userId)
      .eq('role', PLATFORM_ADMIN);
    if (error) throw new Error('שלילת ההרשאה נכשלה');
  }

  await logActivity({
    action: grant ? 'admin.user.admin_granted' : 'admin.user.admin_revoked',
    meta: { targetUserId: userId },
  });
  void actor;
}

// Suspend (ban) or restore a user's login. Cannot suspend yourself or the last
// platform admin.
export async function setUserSuspended(userId: string, suspend: boolean): Promise<void> {
  const actor = await requireAdmin();
  if (suspend && userId === actor.id) {
    throw new Error('לא ניתן להשהות את עצמך');
  }
  const admin = createAdminClient();

  if (suspend) {
    const { data: isAdminRow } = await admin
      .from('user_roles')
      .select('id')
      .eq('user_id', userId)
      .eq('role', PLATFORM_ADMIN)
      .maybeSingle();
    if (isAdminRow && (await platformAdminCount()) <= 1) {
      throw new Error('לא ניתן להשהות את מנהל המערכת האחרון');
    }
  }

  const { error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: suspend ? BAN_FOREVER : UNBAN,
  });
  if (error) throw new Error('עדכון סטטוס המשתמש נכשל');

  await logActivity({
    action: suspend ? 'admin.user.suspended' : 'admin.user.reactivated',
    meta: { targetUserId: userId },
  });
}

// Grant a benefit: an append-only billing credit (customer-favorable) on one of
// the user's events. amount must be positive.
export async function grantBillingCredit(input: {
  eventId: string;
  amount: number;
  reason: string;
  campaignId?: string | null;
}): Promise<void> {
  const actor = await requireAdmin();
  if (!(input.amount > 0)) {
    throw new Error('סכום ההטבה חייב להיות חיובי');
  }
  if (input.reason.trim() === '') {
    throw new Error('נא להזין סיבה');
  }
  const admin = createAdminClient();
  const { data: ev } = await admin
    .from('events')
    .select('id, owner_id')
    .eq('id', input.eventId)
    .maybeSingle();
  if (!ev) {
    throw new Error('האירוע לא נמצא');
  }
  const { error } = await admin.from('billing_credits').insert({
    event_id: input.eventId,
    campaign_id: input.campaignId ?? null,
    amount: input.amount,
    reason: input.reason,
    created_by: actor.id,
  });
  if (error) throw new Error('מתן ההטבה נכשל');

  await logActivity({
    eventId: input.eventId,
    action: 'admin.billing_credit_granted',
    meta: { amount: input.amount, targetUserId: ev.owner_id },
  });
}

// Orders whose plan/package may still be changed (not yet paid / in-flight).
const UPDATABLE_ORDER_STATUSES: readonly string[] = ['pending', 'failed'];

// Update the user's plan: switch the package on a not-yet-paid order and set the
// total to the new package's price (single plan model — the package price IS the
// plan price). Paid/processing orders are never touched. Audited.
export async function updateOrderPackage(orderId: string, packageId: string): Promise<void> {
  await requireAdmin();
  const admin = createAdminClient();

  const { data: order } = await admin
    .from('orders')
    .select('id, status, package_id, user_id, event_id')
    .eq('id', orderId)
    .maybeSingle();
  if (!order) {
    throw new Error('ההזמנה לא נמצאה');
  }
  if (!UPDATABLE_ORDER_STATUSES.includes(order.status)) {
    throw new Error('ניתן לעדכן תוכנית רק בהזמנה שטרם שולמה');
  }

  const { data: pkg } = await admin
    .from('packages')
    .select('id, price_with_vat, active')
    .eq('id', packageId)
    .maybeSingle();
  if (!pkg) {
    throw new Error('החבילה לא נמצאה');
  }

  const { error } = await admin
    .from('orders')
    .update({ package_id: pkg.id, total_with_vat: pkg.price_with_vat })
    .eq('id', orderId);
  if (error) {
    throw new Error('עדכון התוכנית נכשל');
  }

  await logActivity({
    eventId: order.event_id,
    action: 'admin.user.plan_updated',
    meta: { orderId, from: order.package_id, to: pkg.id, targetUserId: order.user_id },
  });
}
