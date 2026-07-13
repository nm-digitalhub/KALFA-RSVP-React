import { redirect } from 'next/navigation';
import { requireUser, requireActiveOrg, isOrgOwner } from '@/lib/auth/dal';
import { can } from '@/lib/permissions';
import { listMembers, listInvitations, listRoles } from '@/lib/data/orgs';

import { TeamClient } from './team-client';

export const metadata = { title: 'ניהול משתמשים' };

// User Management Area. Server-loads the org's members, pending invitations and
// the role catalog. Access to this management screen is gated by members.manage;
// all mutations re-verify members.manage server-side in the actions/data layer.
export default async function TeamPage() {
  const user = await requireUser();
  const { orgId } = await requireActiveOrg();
  const canManage = await can(orgId, 'members', 'manage');

  if (!canManage) {
    redirect('/app');
  }

  // Whether to reveal the roles-matrix entry point. Non-throwing check
  // (mirrors the layout's showTeam convention); the /app/team/roles route
  // re-checks requireOrgOwner independently.
  const canManageRoles = await isOrgOwner(orgId);

  const [members, invitations, roles] = await Promise.all([
    listMembers(orgId),
    listInvitations(orgId),
    listRoles(),
  ]);

  return (
    <TeamClient
      members={members}
      invitations={invitations}
      roles={roles}
      canManage={canManage}
      canManageRoles={canManageRoles}
      currentUserId={user.id}
    />
  );
}
