import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { provisionConsoleAgentVoxUser } from '@/lib/data/console-agent-provisioning';
import { hasPlatformPermission, requirePlatformOwner } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { sendSlackAlert } from '@/lib/alerts/slack';

// Admin: UI-editable PLATFORM (Owner/Staff) RBAC — read the role/permission
// catalog + the role→permission matrix, and mutate it. This mirrors the customer
// ORG role layer (src/lib/data/orgs.ts) but for KALFA *platform* staff.
//
// AUTHORIZATION: every function is gated by requirePlatformOwner() (redirects a
// non-owner). Writes go through the SERVICE-ROLE client (RLS on the platform_*
// tables is owner-only READ; writes are service-role only). The DB additionally
// enforces invariants via triggers: the owner role's permissions are immutable,
// the last owner cannot be removed, and every staff/permission change is written
// to platform_role_audit_log. On top of that we logActivity() with the real
// actor and fire a non-PII security Slack alert (mirrors admin/users.ts).
//
// "owner" here = PLATFORM owner (KALFA staff), NOT an event owner.

export interface PlatformRoleDTO {
  id: string;
  name: string;
  label: string;
  description: string | null;
  isOwnerRole: boolean;
  rank: number;
  sortOrder: number;
}

export interface PlatformPermissionDTO {
  id: string;
  key: string;
  label: string;
  category: string;
  sortOrder: number;
}

export interface RolePermissionMatrix {
  roles: PlatformRoleDTO[];
  permissions: PlatformPermissionDTO[];
  // roleId → the permission ids granted to that role. Plain arrays (not Sets) so
  // the matrix serializes cleanly into the client component that renders the grid.
  granted: Record<string, string[]>;
}

// The platform role catalog. Highest-rank first, then by sort order for stable
// column ordering in the matrix.
export async function listPlatformRoles(): Promise<PlatformRoleDTO[]> {
  await requirePlatformOwner();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('platform_roles')
    .select('id, name, label, description, is_owner_role, rank, sort_order')
    .order('rank', { ascending: false })
    .order('sort_order', { ascending: true });
  if (error) throw new Error('טעינת התפקידים נכשלה');
  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    label: r.label,
    description: r.description,
    isOwnerRole: r.is_owner_role,
    rank: r.rank,
    sortOrder: r.sort_order,
  }));
}

// The platform permission catalog, ordered for stable row grouping (category is
// resolved client-side; sort_order gives the intended order within/across groups).
export async function listPlatformPermissions(): Promise<PlatformPermissionDTO[]> {
  await requirePlatformOwner();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('platform_permission_definitions')
    .select('id, key, label, category, sort_order')
    .order('sort_order', { ascending: true });
  if (error) throw new Error('טעינת ההרשאות נכשלה');
  return (data ?? []).map((p) => ({
    id: p.id,
    key: p.key,
    label: p.label,
    category: p.category,
    sortOrder: p.sort_order,
  }));
}

// The full roles × permissions grid for the matrix screen.
export async function getRolePermissionMatrix(): Promise<RolePermissionMatrix> {
  await requirePlatformOwner();
  const admin = createAdminClient();
  const [roles, permissions] = await Promise.all([
    listPlatformRoles(),
    listPlatformPermissions(),
  ]);
  const { data, error } = await admin
    .from('platform_role_permissions')
    .select('role_id, permission_id');
  if (error) throw new Error('טעינת מטריצת ההרשאות נכשלה');

  const granted: Record<string, string[]> = {};
  for (const role of roles) granted[role.id] = [];
  for (const row of data ?? []) {
    (granted[row.role_id] ??= []).push(row.permission_id);
  }
  return { roles, permissions, granted };
}

// The platform role a user currently holds (single role per user), or null when
// the user is not a staff member. Owner-gated read for the user-detail selector.
export async function getUserStaffRoleId(userId: string): Promise<string | null> {
  await requirePlatformOwner();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('platform_staff')
    .select('role_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error('טעינת תפקיד הצוות נכשלה');
  return data?.role_id ?? null;
}

// Grant or revoke a single (role, permission) matrix cell.
//
// Guards (defense-in-depth on top of the DB triggers + RLS):
//   * The owner role's permissions are IMMUTABLE (owner is always all-permissions);
//     the DB BEFORE-DELETE trigger also blocks removal, but we reject BOTH grant
//     and revoke here so the UI never even attempts an owner-cell write.
//   * SELF-ESCALATION: a caller may not GRANT a permission they do not personally
//     hold. Owner holds every permission so this is moot for the owner, but it is
//     enforced regardless for future non-owner editors.
export async function setRolePermission(
  roleId: string,
  permissionId: string,
  granted: boolean,
): Promise<void> {
  const actor = await requirePlatformOwner();
  const admin = createAdminClient();

  const [{ data: role }, { data: permission }] = await Promise.all([
    admin.from('platform_roles').select('id, is_owner_role').eq('id', roleId).maybeSingle(),
    admin
      .from('platform_permission_definitions')
      .select('id, key')
      .eq('id', permissionId)
      .maybeSingle(),
  ]);
  if (!role) throw new Error('התפקיד לא נמצא');
  if (!permission) throw new Error('ההרשאה לא נמצאה');
  if (role.is_owner_role) {
    throw new Error('לא ניתן לשנות את הרשאות בעל המערכת — הן קבועות');
  }

  if (granted) {
    // Self-escalation guard: never grant a permission the caller lacks.
    if (!(await hasPlatformPermission(permission.key))) {
      throw new Error('לא ניתן להעניק הרשאה שאין לך בעצמך');
    }
    const { error } = await admin
      .from('platform_role_permissions')
      .upsert({ role_id: roleId, permission_id: permissionId }, { onConflict: 'role_id,permission_id' });
    if (error) throw new Error('עדכון ההרשאה נכשל');
  } else {
    const { error } = await admin
      .from('platform_role_permissions')
      .delete()
      .eq('role_id', roleId)
      .eq('permission_id', permissionId);
    if (error) throw new Error('עדכון ההרשאה נכשל');
  }

  await logActivity({
    action: granted ? 'admin.platform_role.permission_granted' : 'admin.platform_role.permission_revoked',
    meta: { roleId, permissionId },
  });
  void sendSlackAlert({
    level: 'warn',
    category: 'security',
    source: 'admin-platform-roles',
    title: granted ? 'הוענקה הרשאת פלטפורמה לתפקיד' : 'נשללה הרשאת פלטפורמה מתפקיד',
    fields: { actorUserId: actor.id, roleId, permissionId },
  });
}

// Create a new platform role. It starts with ZERO permissions (owner grants them
// via the matrix afterwards). Never an owner role — owner is the single seeded,
// protected role.
export async function createPlatformRole(name: string, label: string): Promise<PlatformRoleDTO> {
  const actor = await requirePlatformOwner();
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('platform_roles')
    .insert({ name, label, is_owner_role: false })
    .select('id, name, label, description, is_owner_role, rank, sort_order')
    .single();
  if (error || !data) {
    // 23505 = unique_violation on the role name.
    if (error?.code === '23505') throw new Error('שם התפקיד כבר קיים');
    throw new Error('יצירת התפקיד נכשלה');
  }

  await logActivity({
    action: 'admin.platform_role.created',
    meta: { roleId: data.id, name },
  });
  void sendSlackAlert({
    level: 'warn',
    category: 'security',
    source: 'admin-platform-roles',
    title: 'נוצר תפקיד פלטפורמה חדש',
    fields: { actorUserId: actor.id, roleId: data.id },
  });

  return {
    id: data.id,
    name: data.name,
    label: data.label,
    description: data.description,
    isOwnerRole: data.is_owner_role,
    rank: data.rank,
    sortOrder: data.sort_order,
  };
}

// ---------------------------------------------------------------------------
// Console agent membership (console_agents).
//
// A THIRD axis on top of staff/customer: who sits at the call console. Since
// 20260720234500 the gate function requires is_staff(), and since 20260721005100
// console_agents.user_id is a foreign key to platform_staff(user_id) ON DELETE
// CASCADE — so membership here is a strict subset of platform staff, enforced by
// the database rather than by convention.
//
// These live in this module (not a separate one) because enrolment is a platform
// staff privilege decision: it is gated by the same owner check, surfaces on the
// same user-detail screen as the staff-role selector, and its removal is the
// cascade that revokeStaffRole() above already has to account for.
// ---------------------------------------------------------------------------

export interface ConsoleAgentDTO {
  displayName: string;
  voxUsername: string | null;
  /**
   * True only when the SDK user's secret is stored alongside the username.
   * A username on its own proves nothing — console_agents held one for an agent
   * with no Voximplant user behind it, which is what provisioning exists to fix.
   */
  provisioned: boolean;
}

// This user's console membership, or null when they are not an agent.
export async function getUserConsoleAgent(userId: string): Promise<ConsoleAgentDTO | null> {
  await requirePlatformOwner();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('console_agents')
    .select('display_name, vox_username')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error('טעינת חברות המוקד נכשלה');
  if (!data) return null;

  // A username alone is NOT proof of provisioning — console_agents carried one
  // for an agent that had no Voximplant user and no secret, which is the whole
  // reason provisioning was built. Report the same condition provisioning tests:
  // an identity counts only when its secret is stored too.
  const { data: secret } = await admin
    .from('console_agent_secrets')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();

  return {
    displayName: data.display_name,
    voxUsername: data.vox_username,
    provisioned: Boolean(data.vox_username && secret),
  };
}

// Enrol a user as a console agent. The FK guarantees the target is platform
// staff, but we check first so the owner gets a sentence instead of a constraint
// violation; the 23503 mapping below stays as the backstop for the race where
// staff is revoked between the check and the insert.
export async function enrollConsoleAgent(userId: string, displayName: string): Promise<void> {
  const actor = await requirePlatformOwner();
  const admin = createAdminClient();

  const { data: staff } = await admin
    .from('platform_staff')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (!staff) {
    throw new Error('רק חבר צוות פלטפורמה יכול לשמש נציג מוקד — הקצו תפקיד צוות תחילה');
  }

  const { error } = await admin
    .from('console_agents')
    .upsert({ user_id: userId, display_name: displayName }, { onConflict: 'user_id' });
  if (error) {
    // 23503 = the staff FK — the user stopped being staff mid-flight. Never leak
    // the raw constraint text to the UI.
    throw new Error(
      error.code === '23503'
        ? 'רק חבר צוות פלטפורמה יכול לשמש נציג מוקד — הקצו תפקיד צוות תחילה'
        : 'הוספת נציג המוקד נכשלה',
    );
  }

  // Full automation (owner directive): enrolment provisions the agent's
  // Voximplant SDK identity too. Without it an agent looks enrolled and cannot
  // log in — which is the exact state this codebase already had, a vox_username
  // with no user behind it.
  //
  // Deliberately NOT fatal: enrolment itself succeeded and grants real console
  // access (the call feed, live-call commands, outbound dial). Provisioning
  // failure only withholds the listen/take-over half, and rolling back the
  // enrolment over it would be worse. It is surfaced instead — the outcome is
  // returned, logged, and vox_username stays null so a retry is safe.
  const provisioning = await provisionConsoleAgentVoxUser(userId, displayName);
  if (!provisioning.ok) {
    console.error(
      `[enrol] console agent ${userId} enrolled WITHOUT a Voximplant identity (${provisioning.reason})`,
    );
  }

  await logActivity({
    action: 'admin.console_agent.enrolled',
    meta: {
      targetUserId: userId,
      voxProvisioned: provisioning.ok,
      ...(provisioning.ok ? {} : { voxFailure: provisioning.reason }),
    },
  });
  void sendSlackAlert({
    level: 'warn',
    category: 'security',
    source: 'admin-platform-roles',
    title: 'משתמש נוסף כנציג אנושי במוקד השיחות',
    fields: { actorUserId: actor.id, targetUserId: userId },
  });
}

// Remove a user's console membership. Leaves their platform staff role intact —
// this is the narrow half of the pair (revokeStaffRole removes both, via cascade).
export async function removeConsoleAgent(userId: string): Promise<void> {
  const actor = await requirePlatformOwner();
  const admin = createAdminClient();

  const { error } = await admin.from('console_agents').delete().eq('user_id', userId);
  if (error) throw new Error('הסרת נציג המוקד נכשלה');

  await logActivity({
    action: 'admin.console_agent.removed',
    meta: { targetUserId: userId },
  });
  void sendSlackAlert({
    level: 'warn',
    category: 'security',
    source: 'admin-platform-roles',
    title: 'משתמש הוסר מנציגי מוקד השיחות',
    fields: { actorUserId: actor.id, targetUserId: userId },
  });
}

// The role ids flagged as owner roles (normally exactly one — the seeded 'owner').
async function ownerRoleIds(): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin.from('platform_roles').select('id').eq('is_owner_role', true);
  return (data ?? []).map((r) => r.id);
}

// How many platform staff currently hold an owner role.
async function ownerCount(): Promise<number> {
  const ids = await ownerRoleIds();
  if (ids.length === 0) return 0;
  const admin = createAdminClient();
  const { count } = await admin
    .from('platform_staff')
    .select('id', { count: 'exact', head: true })
    .in('role_id', ids);
  return count ?? 0;
}

// Assign a platform role to a user (SINGLE role per user — upserts on user_id).
// granted_by records the acting owner. Guard: reassigning the LAST owner to a
// non-owner role is blocked here (the DB last-owner trigger only fires on DELETE,
// not on this role-changing UPDATE).
export async function assignStaffRole(userId: string, roleId: string): Promise<void> {
  const actor = await requirePlatformOwner();
  const admin = createAdminClient();

  const { data: newRole } = await admin
    .from('platform_roles')
    .select('id, is_owner_role')
    .eq('id', roleId)
    .maybeSingle();
  if (!newRole) throw new Error('התפקיד לא נמצא');

  const { data: current } = await admin
    .from('platform_staff')
    .select('role_id')
    .eq('user_id', userId)
    .maybeSingle();
  let currentlyOwner = false;
  if (current) {
    const { data: curRole } = await admin
      .from('platform_roles')
      .select('is_owner_role')
      .eq('id', current.role_id)
      .maybeSingle();
    currentlyOwner = curRole?.is_owner_role ?? false;
  }
  if (currentlyOwner && !newRole.is_owner_role && (await ownerCount()) <= 1) {
    throw new Error('חייב להישאר לפחות בעל מערכת אחד');
  }

  const { error } = await admin
    .from('platform_staff')
    .upsert({ user_id: userId, role_id: roleId, granted_by: actor.id }, { onConflict: 'user_id' });
  if (error) throw new Error('הקצאת התפקיד נכשלה');

  await logActivity({
    action: 'admin.platform_staff.role_assigned',
    meta: { targetUserId: userId, roleId },
  });
  void sendSlackAlert({
    level: 'warn',
    category: 'security',
    source: 'admin-platform-roles',
    title: 'הוקצה תפקיד פלטפורמה למשתמש',
    fields: { actorUserId: actor.id, targetUserId: userId, roleId },
  });
}

// Revoke a user's platform staff membership. The DB BEFORE-DELETE trigger blocks
// removing the last owner (raising a Hebrew message we surface as-is).
//
// SECOND EFFECT: console_agents.user_id references platform_staff(user_id) ON
// DELETE CASCADE (migration 20260721005100), so this delete ALSO un-enrols the
// user from the agent console. That is intentional — a console agent must be
// staff — but it is a second privilege removal, and an audit trail that names
// only the first is incomplete. We therefore read the console membership BEFORE
// the delete (afterwards the row is already gone) and carry it into both records.
export async function revokeStaffRole(userId: string): Promise<void> {
  const actor = await requirePlatformOwner();
  const admin = createAdminClient();

  // null = the probe itself failed. Recorded as "unknown" rather than asserting a
  // false "no" into the audit record, and never allowed to block the revocation:
  // a security action must not be held hostage to a bookkeeping read.
  let wasConsoleAgent: boolean | null = null;
  const { data: consoleRow, error: consoleErr } = await admin
    .from('console_agents')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (!consoleErr) wasConsoleAgent = consoleRow !== null;

  const { error } = await admin.from('platform_staff').delete().eq('user_id', userId);
  if (error) {
    // The last-owner guard raises P0001 with a user-facing Hebrew message; pass it
    // through so the owner sees WHY. Any other DB error → a generic safe message.
    throw new Error(error.code === 'P0001' ? error.message : 'שלילת התפקיד נכשלה');
  }

  await logActivity({
    action: 'admin.platform_staff.role_revoked',
    meta: { targetUserId: userId, wasConsoleAgent },
  });
  void sendSlackAlert({
    level: 'warn',
    category: 'security',
    source: 'admin-platform-roles',
    title: 'נשלל תפקיד פלטפורמה ממשתמש',
    fields: {
      actorUserId: actor.id,
      targetUserId: userId,
      // Surfaced only when it carries information — a cascade actually happened,
      // or we could not tell whether one did. A plain "no" is silence.
      ...(wasConsoleAgent === true ? { consoleAgent: 'הוסר גם ממוקד השיחות' } : {}),
      ...(wasConsoleAgent === null ? { consoleAgent: 'לא ידוע — בדיקת המוקד נכשלה' } : {}),
    },
  });
}
