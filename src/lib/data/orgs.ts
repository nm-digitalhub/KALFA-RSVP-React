import 'server-only';

import { randomBytes } from 'node:crypto';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getUser, requireUser, requireOrgOwner, getOrgContext } from '@/lib/auth/dal';
import { requirePermission } from '@/lib/permissions';
import { logActivity } from '@/lib/data/activity';
import { sendSlackAlert } from '@/lib/alerts/slack';
import type { Database } from '@/lib/supabase/types';
import type {
  InviteMemberInput,
  ChangeMemberRoleInput,
} from '@/lib/validation/schemas';

// Default display name for the auto-created personal org. UI content (not a
// business rule); the backfill migration uses the same string.
const PERSONAL_ORG_NAME = 'הארגון שלי';
const INVITATION_TTL_DAYS = 7;

type AuditInsert = Database['public']['Tables']['organization_audit_log']['Insert'];

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------
export interface OrgRoleDTO {
  id: string;
  name: string;
  label: string;
  description: string | null;
  rank: number;
  isOwnerRole: boolean;
  sortOrder: number;
}

export interface PermissionDefDTO {
  id: string;
  resource: string;
  action: string;
  label: string;
  sortOrder: number;
  // system_protected permissions (currently campaigns.create/manage) can never
  // be granted to a non-owner role — read here so the matrix UI can render
  // those cells locked for every role except the owner (see
  // getOrgRolePermissionMatrix / setOrgRolePermission).
  systemProtected: boolean;
}

export interface OrgMemberDTO {
  id: string;
  userId: string;
  roleId: string;
  roleName: string;
  roleLabel: string;
  rank: number;
  isOwnerRole: boolean;
  fullName: string | null;
  email: string | null;
  createdAt: string;
}

export interface OrgInvitationDTO {
  id: string;
  email: string;
  roleId: string;
  roleLabel: string;
  expiresAt: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Audit (service-role; never breaks the caller's primary flow)
// ---------------------------------------------------------------------------
async function auditOrg(input: {
  organizationId: string;
  actorId: string;
  action: string;
  targetUserId?: string | null;
  targetRoleId?: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const row: AuditInsert = {
      organization_id: input.organizationId,
      actor_id: input.actorId,
      action: input.action,
      target_user_id: input.targetUserId ?? null,
      target_role_id: input.targetRoleId ?? null,
      ...(input.details !== undefined
        ? { details: input.details as unknown as AuditInsert['details'] }
        : {}),
    };
    await admin.from('organization_audit_log').insert(row);
  } catch {
    console.error(`auditOrg: failed to record action "${input.action}"`);
  }
}

// ---------------------------------------------------------------------------
// Invariant helpers
// ---------------------------------------------------------------------------

// The caller's role rank within `orgId` (-1 if not a member).
async function actorRank(orgId: string): Promise<number> {
  const ctx = await getOrgContext();
  return ctx.orgs.find((o) => o.id === orgId)?.rank ?? -1;
}

// How many members currently hold the protected owner role in `orgId`.
async function ownerCount(orgId: string): Promise<number> {
  const supabase = await createClient();
  const { data: ownerRole } = await supabase
    .from('org_roles')
    .select('id')
    .eq('is_owner_role', true)
    .maybeSingle();
  if (!ownerRole) return 0;
  const { count } = await supabase
    .from('organization_members')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('role_id', ownerRole.id);
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Personal org bootstrap
// ---------------------------------------------------------------------------

// Return the caller's active org id, creating a personal org (owner = caller)
// if they have none. Used when a brand-new user creates their first event.
export async function ensurePersonalOrg(): Promise<string> {
  const ctx = await getOrgContext();
  if (ctx.activeOrgId) {
    return ctx.activeOrgId;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_organization', {
    _name: PERSONAL_ORG_NAME,
  });
  if (error || !data) {
    throw new Error('יצירת הארגון נכשלה');
  }
  return data;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

// The global role catalog (for the invite/role-change selectors and the
// read-only roles reference). Highest-rank first.
export async function listRoles(): Promise<OrgRoleDTO[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('org_roles')
    .select('id, name, label, description, rank, is_owner_role, sort_order')
    .order('rank', { ascending: false });
  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id,
    name: r.name,
    label: r.label,
    description: r.description,
    rank: r.rank,
    isOwnerRole: r.is_owner_role,
    sortOrder: r.sort_order,
  }));
}

// The permission catalog (for the read-only roles matrix reference).
export async function getPermissionCatalog(): Promise<PermissionDefDTO[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('permission_definitions')
    .select('id, resource, action, label, sort_order, system_protected')
    .order('sort_order', { ascending: true });
  if (error || !data) return [];
  return data.map((p) => ({
    id: p.id,
    resource: p.resource,
    action: p.action,
    label: p.label,
    sortOrder: p.sort_order,
    systemProtected: p.system_protected,
  }));
}

// Active members of `orgId`. Identity (name/email) is enriched via the
// service-role client because `profiles` is self-only under RLS and emails live
// in auth.users.
export async function listMembers(orgId: string): Promise<OrgMemberDTO[]> {
  await requirePermission(orgId, 'members', 'view');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('organization_members')
    .select('id, user_id, role_id, created_at, org_roles(name, label, rank, is_owner_role)')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: true });
  if (error || !data) return [];

  const admin = createAdminClient();
  const userIds = data.map((m) => m.user_id);
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, full_name')
    .in('id', userIds);
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  const emailById = new Map<string, string>();
  await Promise.all(
    userIds.map(async (id) => {
      const { data: u } = await admin.auth.admin.getUserById(id);
      if (u?.user?.email) emailById.set(id, u.user.email);
    }),
  );

  return data.map((m) => ({
    id: m.id,
    userId: m.user_id,
    roleId: m.role_id,
    roleName: m.org_roles?.name ?? '',
    roleLabel: m.org_roles?.label ?? '',
    rank: m.org_roles?.rank ?? 0,
    isOwnerRole: m.org_roles?.is_owner_role ?? false,
    fullName: nameById.get(m.user_id) ?? null,
    email: emailById.get(m.user_id) ?? null,
    createdAt: m.created_at,
  }));
}

// Pending (not accepted, not revoked, not expired) invitations for `orgId`.
export async function listInvitations(orgId: string): Promise<OrgInvitationDTO[]> {
  await requirePermission(orgId, 'members', 'view');
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('organization_invitations')
    .select('id, email, role_id, expires_at, created_at, org_roles(label)')
    .eq('organization_id', orgId)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return data.map((i) => ({
    id: i.id,
    email: i.email,
    roleId: i.role_id,
    roleLabel: i.org_roles?.label ?? '',
    expiresAt: i.expires_at,
    createdAt: i.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Org-scoped role→permission matrix (owner-only, UI-editable)
// ---------------------------------------------------------------------------
//
// A SECOND, org-scoped RBAC layer on top of the global role_permissions
// template — mirrors the PLATFORM (KALFA staff) Owner/Staff matrix in
// src/lib/data/admin/platform-roles.ts one layer down. Every org gets its own
// (organization_id, role_id) → permission grants, seeded from the global
// template at org-creation time / by a one-time backfill (see
// supabase/migrations/20260713203826_org_role_permissions_per_role.sql), then
// independently editable by that org's OWNER. has_org_permission() reads only
// this table — role_permissions stays a frozen factory-default template.
//
// AUTHORIZATION: requireOrgOwner(orgId) gates every function — deliberately
// stricter than organization.manage (which the admin role also holds; see
// isOrgOwner's doc comment). Writes go through the SERVICE-ROLE client (RLS on
// organization_role_permissions is owner-only READ; writes are service-role
// only). The DB additionally enforces invariants via triggers: the owner
// role's grants are immutable, a system_protected permission can never be
// granted to a non-owner role, and every change is written to
// organization_role_audit_log. On top of that we logActivity() with the real
// actor and fire a non-PII security Slack alert (mirrors platform-roles.ts).

export interface OrgRolePermissionMatrix {
  roles: OrgRoleDTO[];
  permissions: PermissionDefDTO[];
  // roleId → the permission ids granted to that role, scoped to THIS org.
  granted: Record<string, string[]>;
}

// The full roles × permissions grid for `orgId`'s roles screen.
export async function getOrgRolePermissionMatrix(orgId: string): Promise<OrgRolePermissionMatrix> {
  await requireOrgOwner(orgId);
  const [roles, permissions] = await Promise.all([listRoles(), getPermissionCatalog()]);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('organization_role_permissions')
    .select('role_id, permission_id')
    .eq('organization_id', orgId);
  if (error) throw new Error('טעינת מטריצת ההרשאות נכשלה');

  const granted: Record<string, string[]> = {};
  for (const role of roles) granted[role.id] = [];
  for (const row of data ?? []) {
    (granted[row.role_id] ??= []).push(row.permission_id);
  }
  return { roles, permissions, granted };
}

// Grant or revoke a single (role, permission) matrix cell within `orgId`.
//
// Guards (defense-in-depth on top of the DB triggers + RLS):
//   * The owner role's grants are IMMUTABLE (owner is always all-permissions);
//     the DB BEFORE-DELETE trigger also blocks removal, but we reject BOTH
//     grant and revoke here so the UI never even attempts an owner-cell write.
//   * SYSTEM-PROTECTED permissions (currently campaigns.create/manage) may
//     never be granted to a non-owner role — the DB BEFORE-INSERT trigger and
//     has_org_permission()'s own read-time guard also enforce this; this is
//     the third, app-layer, belt-and-suspenders check.
export async function setOrgRolePermission(
  orgId: string,
  roleId: string,
  permissionId: string,
  granted: boolean,
): Promise<void> {
  const actor = await requireOrgOwner(orgId);
  const admin = createAdminClient();

  const [{ data: role }, { data: permission }] = await Promise.all([
    admin.from('org_roles').select('id, is_owner_role').eq('id', roleId).maybeSingle(),
    admin
      .from('permission_definitions')
      .select('id, system_protected')
      .eq('id', permissionId)
      .maybeSingle(),
  ]);
  if (!role) throw new Error('התפקיד לא נמצא');
  if (!permission) throw new Error('ההרשאה לא נמצאה');
  if (role.is_owner_role) {
    throw new Error('לא ניתן לשנות את הרשאות הבעלים — הן קבועות');
  }
  if (granted && permission.system_protected) {
    throw new Error('הרשאה זו שמורה לבעלים בלבד');
  }

  if (granted) {
    const { error } = await admin.from('organization_role_permissions').upsert(
      { organization_id: orgId, role_id: roleId, permission_id: permissionId, granted_by: actor.id },
      { onConflict: 'organization_id,role_id,permission_id' },
    );
    if (error) throw new Error('עדכון ההרשאה נכשל');
  } else {
    const { error } = await admin
      .from('organization_role_permissions')
      .delete()
      .eq('organization_id', orgId)
      .eq('role_id', roleId)
      .eq('permission_id', permissionId);
    if (error) throw new Error('עדכון ההרשאה נכשל');
  }

  // organization_role_audit_log is written by the DB trigger on this same
  // insert/delete (atomic with the write); this is the separate, human-facing
  // business activity log + security alert, mirroring platform-roles.ts.
  await logActivity({
    action: granted ? 'org_role.permission_granted' : 'org_role.permission_revoked',
    meta: { orgId, roleId, permissionId },
  });
  void sendSlackAlert({
    level: 'warn',
    category: 'security',
    source: 'org-roles',
    title: granted ? 'הוענקה הרשאת ארגון לתפקיד' : 'נשללה הרשאת ארגון מתפקיד',
    fields: { actorUserId: actor.id, organizationId: orgId, roleId, permissionId },
  });
}

// ---------------------------------------------------------------------------
// Mutations (each re-verifies permission + invariants server-side)
// ---------------------------------------------------------------------------

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function invitationExpiry(): string {
  return new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000).toISOString();
}

// Create an invitation. Returns the token so the action layer can email a link.
// Anti-escalation: cannot invite at a role higher than the caller's own.
export async function inviteMember(
  orgId: string,
  input: InviteMemberInput,
): Promise<{ token: string; email: string; roleLabel: string }> {
  await requirePermission(orgId, 'members', 'manage');
  const actor = await requireUser();
  const supabase = await createClient();

  const { data: role } = await supabase
    .from('org_roles')
    .select('id, label, rank')
    .eq('id', input.role_id)
    .maybeSingle();
  if (!role) {
    throw new Error('תפקיד לא תקין');
  }
  if (role.rank > (await actorRank(orgId))) {
    throw new Error('לא ניתן להזמין לתפקיד גבוה מהתפקיד שלך');
  }

  const token = newToken();
  const { error } = await supabase.from('organization_invitations').insert({
    organization_id: orgId,
    email: input.email.toLowerCase(),
    role_id: input.role_id,
    token,
    invited_by: actor.id,
    expires_at: invitationExpiry(),
  });
  if (error) {
    throw new Error('שליחת ההזמנה נכשלה');
  }

  await auditOrg({
    organizationId: orgId,
    actorId: actor.id,
    action: 'member.invited',
    targetRoleId: input.role_id,
    details: { email: input.email.toLowerCase() },
  });

  return { token, email: input.email.toLowerCase(), roleLabel: role.label };
}

// Re-issue a pending invitation (new token + fresh expiry). Returns the new
// token so the action layer can re-send the email.
export async function resendInvitation(
  orgId: string,
  invitationId: string,
): Promise<{ token: string; email: string }> {
  await requirePermission(orgId, 'members', 'manage');
  const actor = await requireUser();
  const supabase = await createClient();

  const token = newToken();
  const { data, error } = await supabase
    .from('organization_invitations')
    .update({ token, expires_at: invitationExpiry() })
    .eq('id', invitationId)
    .eq('organization_id', orgId)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .select('email')
    .maybeSingle();
  if (error || !data) {
    throw new Error('חידוש ההזמנה נכשל');
  }
  await auditOrg({
    organizationId: orgId,
    actorId: actor.id,
    action: 'member.invitation_resent',
    details: { invitationId },
  });
  return { token, email: data.email };
}

// Revoke a pending invitation.
export async function revokeInvitation(orgId: string, invitationId: string): Promise<void> {
  await requirePermission(orgId, 'members', 'manage');
  const actor = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from('organization_invitations')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', invitationId)
    .eq('organization_id', orgId)
    .is('accepted_at', null)
    .is('revoked_at', null);
  if (error) {
    throw new Error('ביטול ההזמנה נכשל');
  }
  await auditOrg({
    organizationId: orgId,
    actorId: actor.id,
    action: 'member.invitation_revoked',
    details: { invitationId },
  });
}

// Change a member's role. Guards: not yourself; you must out- or equal-rank the
// member's current AND target role; cannot remove the last owner via downgrade.
export async function changeMemberRole(
  orgId: string,
  input: ChangeMemberRoleInput,
): Promise<void> {
  await requirePermission(orgId, 'members', 'manage');
  const actor = await requireUser();
  const supabase = await createClient();

  const { data: member } = await supabase
    .from('organization_members')
    .select('id, user_id, role_id, org_roles(rank, is_owner_role)')
    .eq('id', input.member_id)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (!member) {
    throw new Error('החבר לא נמצא');
  }
  if (member.user_id === actor.id) {
    throw new Error('לא ניתן לשנות את התפקיד של עצמך');
  }

  const { data: newRole } = await supabase
    .from('org_roles')
    .select('rank, is_owner_role')
    .eq('id', input.role_id)
    .maybeSingle();
  if (!newRole) {
    throw new Error('תפקיד לא תקין');
  }

  const myRank = await actorRank(orgId);
  const currentRank = member.org_roles?.rank ?? 0;
  if (currentRank > myRank || newRole.rank > myRank) {
    throw new Error('אין לך הרשאה לשנות לתפקיד זה');
  }

  // Last-owner protection: don't demote the final owner out of the owner role.
  if (member.org_roles?.is_owner_role && !newRole.is_owner_role && (await ownerCount(orgId)) <= 1) {
    throw new Error('חייב להישאר לפחות בעלים אחד');
  }

  const { error } = await supabase
    .from('organization_members')
    .update({ role_id: input.role_id })
    .eq('id', input.member_id)
    .eq('organization_id', orgId);
  if (error) {
    throw new Error('שינוי התפקיד נכשל');
  }
  await auditOrg({
    organizationId: orgId,
    actorId: actor.id,
    action: 'member.role_changed',
    targetUserId: member.user_id,
    targetRoleId: input.role_id,
    details: { from: member.role_id, to: input.role_id },
  });
}

// Remove a member. Guards: not yourself; out- or equal-rank; not the last owner.
export async function removeMember(orgId: string, memberId: string): Promise<void> {
  await requirePermission(orgId, 'members', 'manage');
  const actor = await requireUser();
  const supabase = await createClient();

  const { data: member } = await supabase
    .from('organization_members')
    .select('id, user_id, role_id, org_roles(rank, is_owner_role)')
    .eq('id', memberId)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (!member) {
    throw new Error('החבר לא נמצא');
  }
  if (member.user_id === actor.id) {
    throw new Error('לא ניתן להסיר את עצמך');
  }
  if ((member.org_roles?.rank ?? 0) > (await actorRank(orgId))) {
    throw new Error('אין לך הרשאה להסיר חבר זה');
  }
  if (member.org_roles?.is_owner_role && (await ownerCount(orgId)) <= 1) {
    throw new Error('חייב להישאר לפחות בעלים אחד');
  }

  const { error } = await supabase
    .from('organization_members')
    .delete()
    .eq('id', memberId)
    .eq('organization_id', orgId);
  if (error) {
    throw new Error('הסרת החבר נכשלה');
  }
  await auditOrg({
    organizationId: orgId,
    actorId: actor.id,
    action: 'member.removed',
    targetUserId: member.user_id,
    targetRoleId: member.role_id,
  });
}

// ---------------------------------------------------------------------------
// Invitation acceptance (token flow — used by /join/[token])
// ---------------------------------------------------------------------------

// Public-ish lookup for the accept page: the org name behind a still-valid
// token, or null. Uses service-role (an invitee is not yet a member, so RLS
// would hide the row). Returns nothing sensitive beyond the org name + email.
export async function getInvitationPreview(
  token: string,
): Promise<{ orgName: string; email: string } | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('organization_invitations')
    .select('email, organizations(name)')
    .eq('token', token)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (!data) return null;
  return { orgName: data.organizations?.name ?? '', email: data.email };
}

// Accept an invitation for the signed-in user via the atomic SECURITY DEFINER
// RPC (single-use, email-matched). Returns the joined org id.
export async function acceptInvitation(token: string): Promise<string> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('accept_invitation', { _token: token });
  if (error || !data) {
    throw new Error('ההזמנה אינה תקפה');
  }
  return data;
}

// Lightweight membership list for the org switcher (delegates to org context).
export async function listOrgsForUser() {
  const ctx = await getOrgContext();
  return ctx.orgs;
}

// Exported so callers (e.g. event creation) can resolve the current user once.
export { getUser };
