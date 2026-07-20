import 'server-only';

import type { User } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { recordStaffAccess } from './access-log';
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
// Name/phone search runs against `profiles` (Postgres, ilike-able). Bound the
// match set so the per-id auth fetch that materialises each user stays small.
const SEARCH_PROFILE_CAP = 100;
// A pasted UUID is treated as an exact user-id lookup (skips the page scan).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// A benefit (credit) previously granted to one of the user's events.
export interface AdminUserCredit {
  id: string;
  eventId: string;
  campaignId: string | null; // null = event-level (consumed by the event's campaign)
  amount: number;
  reason: string;
  createdAt: string;
}

export interface AdminUserEvent {
  id: string;
  name: string;
  // The event's single campaign (one-campaign-per-event), if one exists —
  // offered as an optional scope when granting a credit.
  campaignId: string | null;
}

// Per-event credit ledger: granted − consumed (campaigns.credit_applied).
export interface AdminUserCreditBalance {
  eventId: string;
  eventName: string;
  granted: number;
  applied: number;
  remaining: number;
}

export interface AdminUserDetail extends AdminUser {
  phone: string | null;
  orgs: AdminUserOrg[];
  ownedEventCount: number;
  events: AdminUserEvent[];
  credits: AdminUserCredit[];
  creditBalances: AdminUserCreditBalance[];
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

// List all platform users, paginated. When `search` is given it matches across
// four fields, since the GoTrue admin API has no server-side filter:
//   * a pasted UUID  → exact id lookup (no scan);
//   * name / phone   → `profiles` ilike (Postgres), each match materialised via
//                      getUserById (capped);
//   * email          → substring over a capped page scan.
// Results are de-duplicated by id and returned newest-first.
export async function listAllUsers(
  { page, search }: PageParams & { search?: string } = {},
): Promise<PageResult<AdminUser>> {
  await requirePlatformPermission('manage_staff');
  const { page: safePage, pageSize, from, to } = resolvePage(page);
  const admin = createAdminClient();
  const term = search?.trim();

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

  // A pasted user id short-circuits to a single direct lookup — no page scan.
  if (UUID_RE.test(term)) {
    const { data, error } = await admin.auth.admin.getUserById(term);
    const user = error ? null : data?.user ?? null;
    const items = user ? await enrichUsers([user]) : [];
    return { items, total: items.length, page: safePage, pageSize };
  }

  // De-duplicated match set (a user can match on both name and email).
  const byId = new Map<string, User>();

  // (a) name / phone via profiles. Strip characters significant to the
  // PostgREST .or() grammar and to LIKE (%, _, comma, parens, quote, *, \) so a
  // free-text term can neither inject a wildcard nor break the filter. Names
  // and phones never legitimately contain them.
  const filterTerm = term.replace(/[%_,()"*\\]/g, '').trim();
  if (filterTerm) {
    const like = `%${filterTerm}%`;
    const { data: profs } = await admin
      .from('profiles')
      .select('id')
      .or(`full_name.ilike.${like},phone.ilike.${like}`)
      .limit(SEARCH_PROFILE_CAP);
    for (const p of (profs ?? []) as Array<{ id: string }>) {
      if (byId.has(p.id)) continue;
      const { data, error } = await admin.auth.admin.getUserById(p.id);
      if (!error && data?.user) byId.set(p.id, data.user);
    }
  }

  // (b) email substring over a capped page scan (no server-side email filter).
  const lower = term.toLowerCase();
  for (let p = 1; p <= SEARCH_MAX_PAGES; p++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page: p,
      perPage: SEARCH_PER_PAGE,
    });
    if (error) {
      throw new Error('טעינת המשתמשים נכשלה');
    }
    for (const u of data.users) {
      if ((u.email ?? '').toLowerCase().includes(lower)) byId.set(u.id, u);
    }
    if (data.nextPage == null) break;
    if (p === SEARCH_MAX_PAGES) {
      console.warn('listAllUsers: search scan cap reached; results may be incomplete');
    }
  }

  const matched = [...byId.values()].sort((a, b) => {
    const ta = a.created_at ? Date.parse(a.created_at) : 0;
    const tb = b.created_at ? Date.parse(b.created_at) : 0;
    return tb - ta;
  });
  const pageUsers = matched.slice(from, to + 1);
  return {
    items: await enrichUsers(pageUsers),
    total: matched.length,
    page: safePage,
    pageSize,
  };
}

// Full detail for one user, including org memberships, owned-event count,
// events and previously granted benefits.
export async function getUserDetail(
  userId: string,
  reason?: string,
): Promise<AdminUserDetail | null> {
  const staff = await requirePlatformPermission('manage_staff');
  const admin = createAdminClient();

  // Viewing ANOTHER user's full profile (PII: phone, email, owned events,
  // granted credits) is a break-glass reach into one customer's account —
  // audited with a mandatory reason (recordStaffAccess enforces the min length
  // for manage_staff). Viewing your OWN staff record is not cross-customer
  // access, so it carries no reason and no break-glass row (forcing one on the
  // self-view would breed the reason-fatigue that launders a real reason).
  if (userId !== staff.id) {
    await recordStaffAccess({
      staffId: staff.id,
      permission: 'manage_staff',
      subjectType: 'user',
      subjectId: userId,
      ownerId: userId,
      reason,
    });
  }

  const { data: authData, error } = await admin.auth.admin.getUserById(userId);
  if (error || !authData?.user) {
    return null;
  }
  const u = authData.user;

  const [profileRes, roleRes, membersRes, eventsRes] = await Promise.all([
    admin.from('profiles').select('full_name, phone').eq('id', userId).maybeSingle(),
    admin.from('user_roles').select('id').eq('user_id', userId).eq('role', PLATFORM_ADMIN).maybeSingle(),
    admin
      .from('organization_members')
      .select('organization_id, organizations(name), org_roles(label)')
      .eq('user_id', userId),
    admin.from('events').select('id, name').eq('owner_id', userId),
  ]);

  const eventIds = (eventsRes.data ?? []).map((e) => e.id);
  let credits: AdminUserCredit[] = [];
  const campaignByEvent = new Map<string, string>();
  const appliedByEvent = new Map<string, number>();
  if (eventIds.length > 0) {
    const [creditsRes, campaignsRes] = await Promise.all([
      admin
        .from('billing_credits')
        .select('id, event_id, campaign_id, amount, reason, created_at')
        .in('event_id', eventIds)
        .order('created_at', { ascending: false }),
      admin
        .from('campaigns')
        .select('id, event_id, status, credit_applied')
        .in('event_id', eventIds),
    ]);
    credits = (creditsRes.data ?? []).map((c) => ({
      id: c.id,
      eventId: c.event_id,
      campaignId: c.campaign_id,
      amount: c.amount,
      reason: c.reason,
      createdAt: c.created_at,
    }));
    for (const c of campaignsRes.data ?? []) {
      // The grant form offers only the event's live campaign (one per event;
      // cancelled ones are not a valid credit scope).
      if (c.status !== 'cancelled') campaignByEvent.set(c.event_id, c.id);
      appliedByEvent.set(
        c.event_id,
        (appliedByEvent.get(c.event_id) ?? 0) + Number(c.credit_applied ?? 0),
      );
    }
  }

  // Per-event ledger (only for events that ever had a credit): granted −
  // consumed-by-close-charge = remaining.
  const nameByEvent = new Map((eventsRes.data ?? []).map((e) => [e.id, e.name]));
  const grantedByEvent = new Map<string, number>();
  for (const c of credits) {
    grantedByEvent.set(
      c.eventId,
      (grantedByEvent.get(c.eventId) ?? 0) + Number(c.amount ?? 0),
    );
  }
  const creditBalances: AdminUserCreditBalance[] = [...grantedByEvent.entries()].map(
    ([eventId, granted]) => {
      const applied = appliedByEvent.get(eventId) ?? 0;
      return {
        eventId,
        eventName: nameByEvent.get(eventId) ?? '',
        granted,
        applied,
        remaining: Math.max(0, Math.round((granted - applied) * 100) / 100),
      };
    },
  );

  const orgs: AdminUserOrg[] = (membersRes.data ?? []).map((m) => ({
    id: m.organization_id,
    name: m.organizations?.name ?? '',
    roleLabel: m.org_roles?.label ?? '',
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
    events: (eventsRes.data ?? []).map((e) => ({
      id: e.id,
      name: e.name,
      campaignId: campaignByEvent.get(e.id) ?? null,
    })),
    credits,
    creditBalances,
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
  const actor = await requirePlatformPermission('manage_staff');
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
  // Additive security ops alert (fire-and-forget, fail-safe): constant title per
  // branch (dedup-friendly), non-PII actor/target ids only.
  void sendSlackAlert({
    level: 'warn',
    category: 'security',
    source: 'admin-users',
    title: grant ? 'הוענקה הרשאת מנהל מערכת' : 'נשללה הרשאת מנהל מערכת',
    fields: { actorUserId: actor.id, targetUserId: userId },
  });
}

// Suspend (ban) or restore a user's login. Cannot suspend yourself or the last
// platform admin.
export async function setUserSuspended(userId: string, suspend: boolean): Promise<void> {
  const actor = await requirePlatformPermission('manage_staff');
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
  // Additive security ops alert (fire-and-forget, fail-safe): constant title per
  // branch (dedup-friendly), non-PII actor/target ids only.
  void sendSlackAlert({
    level: 'warn',
    category: 'security',
    source: 'admin-users',
    title: suspend ? 'משתמש הושהה' : 'משתמש שוחזר',
    fields: { actorUserId: actor.id, targetUserId: userId },
  });
}

// Grant a benefit: an append-only billing credit (customer-favorable) on one of
// the user's events. amount must be positive.
export async function grantBillingCredit(input: {
  eventId: string;
  amount: number;
  reason: string;
  campaignId?: string | null;
  // The user the credit is granted to (the page it was submitted from). The
  // event MUST be owned by them: the browser-submitted event id is never trusted
  // for ownership scoping on its own (the UI offers only this user's events, so a
  // crafted request must not attach a credit to another owner's event).
  ownerId?: string;
}): Promise<void> {
  const actor = await requirePlatformPermission('manage_staff');
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
  // Never trust the submitted event id for ownership scoping: the credit may
  // only land on an event the target user actually owns.
  if (input.ownerId && ev.owner_id !== input.ownerId) {
    throw new Error('האירוע אינו שייך למשתמש זה');
  }
  // A campaign-scoped credit must point at a campaign of THIS event — never
  // trust the submitted id pair on its own.
  if (input.campaignId) {
    const { data: camp } = await admin
      .from('campaigns')
      .select('id')
      .eq('id', input.campaignId)
      .eq('event_id', input.eventId)
      .maybeSingle();
    if (!camp) {
      throw new Error('הקמפיין אינו שייך לאירוע שנבחר');
    }
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
